/** Native whole-model contribution uses the same scoped provider as browser chat. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256Digest } from './hashing.js';
import { createReploidDopplerRuntimeService } from '../shared/infrastructure/doppler-runtime-service.js';
import { createNativeResidentProvider } from './native-resident-provider.js';
import { openNativeModelSource } from './native-model-source.js';
import { createModelAdapterResolver, selectModelAdapters } from '../packages/reploid/src/adapters/model-adapter.js';
import profile from '../apps/poolday/config/work-profile.json' with { type: 'json' };
import { resolvePartitionGeneration } from '../apps/poolday/config/partition-generation.js';
import { GENERATION_SETTINGS_CAPABILITY, assertSettingsSupported, normalizeGenerationSettings } from '../packages/reploid/src/mesh/generation-settings.js';
import { hasToolMessages, modelToolCallFormat } from '../shared/infrastructure/tool-call-constraint.js';

/** What this provider applies itself: the caller's output limit reaches the sampler options. */
export const NATIVE_WHOLE_MODEL_SETTINGS = Object.freeze({ ...GENERATION_SETTINGS_CAPABILITY, maxOutputTokens: true });
/** Tools are added only for a model whose catalog entry declares the tool-call format: the scoped
 * provider then renders the conversation and masks tokens so a call names a declared tool with
 * valid arguments. An unknown `toolCallFormat` throws. Output schemas and thinking stay unsupported. */
const NATIVE_TOOL_MODEL_SETTINGS = Object.freeze({ ...NATIVE_WHOLE_MODEL_SETTINGS, tools: true });
export const nativeWholeModelSettings = model => modelToolCallFormat(model) ? NATIVE_TOOL_MODEL_SETTINGS : NATIVE_WHOLE_MODEL_SETTINGS;

/** `fill({signal})`, when given, completes the model directory from verified peer pieces before
 * the manifest is read (server/native-model-files.js fillWholeModel); stop aborts it. */
export function createNativeWholeModel({ model, modelDirectory, nativeGpu, owner = null, onChange = () => {}, fill = null,
  configureMemory = async maxBytes => (await import('dopplerx/partitions')).configureDeviceMemoryBudget({ maxBytes }),
  resolveAdapter = createModelAdapterResolver({ models: [model] }),
  service = createReploidDopplerRuntimeService({ loadModule: () => import('dopplerx/compat') }),
  createResident = createNativeResidentProvider, providerPolicy = profile, resolveGeneration = resolvePartitionGeneration,
  // With `model.wholeRuntime.gather` (a catalog entry or an operator configuration) the weights are read through authenticated
  // worker gathering instead of the plain file loader; these two are replaced in tests.
  openSource = openNativeModelSource, loadGatherRuntime = () => import('dopplerx/partitions') }) {
  model = structuredClone(model);
  model.adapters = selectModelAdapters(model);
  const settingsCapability = nativeWholeModelSettings(model);
  let resident = null, preparing = null, stopping = null, closed = false, enabled = false, filling = null;
  // Owned authenticated storage of a gathered whole model. It outlives preparation and is closed only
  // after the resident that reads from it has closed.
  let gathered = null;
  const closeGathered = async () => { const source = gathered; gathered = null; await source?.storage?.close?.(); };
  const ownerAllows = () => {
    const decision = owner?.decide();
    return !decision || decision.action === 'admit'
      || decision.action === 'reduce' && decision.limits.maxConcurrentAttempts > 0;
  };
  const getState = () => {
    const state = resident?.getState() || { phase: filling ? 'acquiring-model' : 'idle', ready: false };
    return { ...state, mode: 'whole-model', offering: enabled,
      ready: enabled && !closed && ownerAllows() && state.ready,
      modelId: model.id, modelIdentity: state.modelIdentity ?? null };
  };
  const notify = () => onChange(getState());
  const advertisedPhase = state => {
    if (state.ready) return 'ready';
    if (['ready', 'executing'].includes(state.phase)) return 'idle';
    return state.phase;
  };
  const stop = () => stopping ||= (async () => {
    enabled = false; filling?.abort(new Error('Whole-model contribution stopped')); notify();
    await resident?.close();
    await preparing?.catch(() => {});
    resident = null;
    await closeGathered();
    notify();
  })().finally(() => { stopping = null; });
  return Object.freeze({
    getState,
    getGenerationSettingsCapability: () => settingsCapability,
    getExecutionState() {
      const state = getState();
      return { ...state,
        // Prepared capacity remains discoverable while its current slot is
        // occupied. The mesh separately advertises the available slot count.
        phase: advertisedPhase(state),
        activity: { phase: state.phase, completed: state.completed || 0, error: state.error || null }
      };
    },
    async contribute(approved) {
      if (approved !== true) throw new Error('Approve contribution before loading a whole model');
      if (closed || stopping) throw new Error('Whole-model contributor is stopping');
      if (preparing) return preparing;
      if (resident) return getState();
      enabled = true;
      preparing = (async () => {
        if (fill) {
          const controller = new AbortController(); filling = controller; notify();
          try { await fill({ signal: controller.signal }); }
          finally { if (filling === controller) filling = null; }
          if (!enabled || closed) throw new Error('Whole-model contribution stopped');
        }
        const root = await fs.realpath(modelDirectory);
        const manifestPath = await fs.realpath(path.join(root, 'manifest.json'));
        if (!manifestPath.startsWith(root + path.sep)) throw new Error('Native whole-model manifest escapes approved directory');
        const manifest = await fs.readFile(manifestPath);
        if (sha256Digest(manifest) !== model.identity) {
          throw new Error('Native whole-model manifest differs from the catalog');
        }
        if (!enabled || closed) throw new Error('Whole-model contribution stopped');
        await nativeGpu();
        if (!enabled || closed) throw new Error('Whole-model contribution stopped');
        const loadOptions = structuredClone(model.loadOptions || {});
        const budget = loadOptions.runtimeConfig?.shared?.bufferPool?.budget;
        const maximum = owner?.gpuBufferBytes(budget?.maxTotalBytes ?? Infinity);
        if (Number.isFinite(maximum)) {
          // The pool limit alone excludes some persistent weight/state allocations.
          await configureMemory(maximum);
          loadOptions.runtimeConfig ??= {};
          loadOptions.runtimeConfig.shared ??= {};
          loadOptions.runtimeConfig.shared.bufferPool ??= {};
          loadOptions.runtimeConfig.shared.bufferPool.budget ??= {};
          loadOptions.runtimeConfig.shared.bufferPool.budget.maxTotalBytes = maximum;
          loadOptions.runtimeConfig.inference ??= {};
          loadOptions.runtimeConfig.inference.session ??= {};
          loadOptions.runtimeConfig.inference.session.prefillChunkSubmitMode ??= 'sync';
        }
        // A catalog model without explicit generation runs whole with its partition route's
        // policy: the same output budget and a KV cache sized to that policy's context. The work
        // profile alone left the runtime's default context no larger than its output budget.
        const generation = model.generation || resolveGeneration(model);
        if (!model.generation) {
          loadOptions.runtimeConfig ??= {};
          loadOptions.runtimeConfig.inference ??= {};
          loadOptions.runtimeConfig.inference.session ??= {};
          loadOptions.runtimeConfig.inference.session.kvcache ??= {};
          loadOptions.runtimeConfig.inference.session.kvcache.maxSeqLen ??= generation.maxSeqLen;
        }
        const manifestText = manifest.toString('utf8');
        let source = { manifest: JSON.parse(manifestText), manifestText, manifestHash: model.identity.slice(7),
          baseUrl: pathToFileURL(root + path.sep).href };
        if (model.wholeRuntime?.gather) {
          // The same authenticated bytes for the manifest and every weight piece; no URL can replace them.
          gathered = await openSource({ model, modelDirectory: root, runtime: await loadGatherRuntime(),
            gather: model.wholeRuntime.gather });
          if (!enabled || closed) throw new Error('Whole-model contribution stopped');
          source = { manifest: gathered.manifest, manifestText, manifestHash: model.identity.slice(7), storageContext: gathered.storage };
          loadOptions.isolatedLoader = true;
        }
        resident = createResident({ service, model, resolveAdapter, generation, providerPolicy,
          maxOutcomeCharacters: providerPolicy.maxOutcomeCharacters, loadOptions, source, onChange: notify });
        await resident.prepare();
        return getState();
      })().catch(async error => {
        enabled = false;
        await resident?.close(); resident = null;
        await closeGathered().catch(() => {});
        notify(); throw error;
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
      const ownerPolicyDigest = owner?.digest ?? null;
      // Anything beyond the advertised capability is refused here rather than silently ignored.
      const settings = normalizeGenerationSettings(controls.settings);
      assertSettingsSupported(settingsCapability, settings);
      if (!settingsCapability.tools && hasToolMessages(messages)) throw new Error('This model declares no tool-call format; tool messages are refused');
      const limit = settings?.maxOutputTokens ?? null;
      return Promise.resolve(resident.generate(messages, onUpdate, { ...controls, adapters,
        ...(settings ? { settings } : {}), ...(limit === null ? {} : { maxOutputTokens: limit }) }))
        .then(result => ({ ...result, ownerPolicyDigest }));
    },
    stop,
    async close() { closed = true; await stop(); }
  });
}
