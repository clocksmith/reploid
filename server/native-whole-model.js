/** Native whole-model contribution uses the same scoped provider as browser chat. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createReploidDopplerRuntimeService } from '../self/infrastructure/doppler-runtime-service.js';
import { createWorkResidentProvider } from '../self/providers/work-resident-provider.js';
import { createWorkAdapterResolver, selectWorkAdapters } from '../self/providers/work-adapter.js';
import profile from '../self/config/work-profile.json' with { type: 'json' };

export function createNativeWholeModel({ model, modelDirectory, nativeGpu, owner = null, onChange = () => {},
  resolveAdapter = createWorkAdapterResolver({ models: [model] }),
  service = createReploidDopplerRuntimeService({ loadModule: () => import('doppler-gpu/compat') }),
  createResident = createWorkResidentProvider }) {
  model = structuredClone(model);
  model.adapters = selectWorkAdapters(model);
  let resident = null, preparing = null, stopping = null, closed = false, enabled = false;
  const ownerAllows = () => {
    const decision = owner?.decide();
    return !decision || decision.action === 'admit'
      || decision.action === 'reduce' && decision.limits.maxConcurrentAttempts > 0;
  };
  const getState = () => {
    const state = resident?.getState() || { phase: 'idle', ready: false };
    return { ...state, mode: 'whole-model', offering: enabled,
      ready: enabled && !closed && ownerAllows() && state.ready,
      modelId: model.id, modelIdentity: state.modelIdentity ?? null };
  };
  const notify = () => onChange(getState());
  const stop = () => stopping ||= (async () => {
    enabled = false; notify();
    await resident?.close();
    await preparing?.catch(() => {});
    resident = null; notify();
  })().finally(() => { stopping = null; });
  return Object.freeze({
    getState,
    async contribute(approved) {
      if (approved !== true) throw new Error('Approve contribution before loading a whole model');
      if (closed || stopping) throw new Error('Whole-model contributor is stopping');
      if (preparing) return preparing;
      if (resident) return getState();
      enabled = true;
      preparing = (async () => {
        const root = await fs.realpath(modelDirectory);
        const manifestPath = await fs.realpath(path.join(root, 'manifest.json'));
        if (!manifestPath.startsWith(root + path.sep)) throw new Error('Native whole-model manifest escapes approved directory');
        const manifest = await fs.readFile(manifestPath);
        if ('sha256:' + createHash('sha256').update(manifest).digest('hex') !== model.identity) {
          throw new Error('Native whole-model manifest differs from the catalog');
        }
        if (!enabled || closed) throw new Error('Whole-model contribution stopped');
        await nativeGpu();
        if (!enabled || closed) throw new Error('Whole-model contribution stopped');
        const loadOptions = structuredClone(model.loadOptions || {});
        const budget = loadOptions.runtimeConfig?.shared?.bufferPool?.budget;
        if (owner && budget) budget.maxTotalBytes = owner.gpuBufferBytes(budget.maxTotalBytes);
        resident = createResident({ service, model, resolveAdapter, generation: model.generation || profile.generation,
          maxOutcomeCharacters: profile.maxOutcomeCharacters, loadOptions,
          source: { manifest: JSON.parse(manifest.toString('utf8')), manifestText: manifest.toString('utf8'),
            manifestHash: model.identity.slice(7), baseUrl: pathToFileURL(root + path.sep).href }, onChange: notify });
        await resident.prepare();
        return getState();
      })().catch(async error => {
        enabled = false;
        await resident?.close(); resident = null; notify(); throw error;
      }).finally(() => { preparing = null; });
      return preparing;
    },
    generate(messages, onUpdate, controls) {
      if (!getState().ready) throw Object.assign(new Error('Whole-model capacity unavailable'), { code: 'CAPACITY_UNAVAILABLE' });
      const identities = controls.adapterIdentities || [];
      if (!Array.isArray(identities) || identities.length > 1) throw new Error('Select at most one prepared adapter');
      const adapters = identities.map(identity => {
        const selected = model.adapters?.find(adapter => adapter.identity === identity);
        if (!selected || !getState().adapterIdentities?.includes(identity)) {
          throw new Error('Requested adapter is not prepared on this contributor');
        }
        return structuredClone(selected);
      });
      return resident.generate(messages, onUpdate, { ...controls, adapters });
    },
    stop,
    async close() { closed = true; await stop(); }
  });
}
