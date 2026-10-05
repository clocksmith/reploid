/** Adapt identified chat attempts to existing execution ports; own only the scheduler we create. */
import { createChatScheduler } from '../vendor/reploid/chat/index.js';
import { createWorkResidentProvider } from '../providers/work-resident-provider.js';
import { createWorkAdapterResolver } from '../providers/work-adapter.js';
import { createWorkNetworkProvider } from '../providers/work-network-provider.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function createChatExecution({ service, swarm, partitions, scheduler, models, getModels, profile, onChange = () => {} }) {
  let local = null;
  const resolveAdapter = createWorkAdapterResolver({ models });

  const sessionScheduler = scheduler || createChatScheduler({
    open: async reqModel => {
      const resident = createWorkResidentProvider({ service, model: reqModel,
        resolveAdapter, generation: profile.generation, maxOutcomeCharacters: profile.maxOutcomeCharacters,
        onChange(state) { local = state; onChange(); } });
      await resident.prepare();
      return {
        run: (req, { signal: runSignal, onDelta }) => resident.generate(req.messages, onDelta,
          { signal: runSignal, adapters: req.model.adapters || [] }),
        reset: async () => assert(resident.getState().ready, 'Resident session requires replacement'),
        // The resident applies and removes adapters inside the same device lease as generation.
        setAdapters: async () => {},
        close: resident.close
      };
    },
    observe: () => {}
  });

  // Reuse the existing network provider. No simulated production responses.
  const execute = async (request, controls) => {
    const { threadId, attemptId, model } = request;
    assert(model.provider === 'doppler', 'Chat requires a Doppler participant');
    const catalogModel = getModels().find(m => m.id === model.id && m.identity === model.identity);
    assert(catalogModel, 'Selected model is not in the verified catalog');
    const allowedAdapters = catalogModel.availableAdapters || [];
    for (const adapter of model.adapters || []) {
      const verified = allowedAdapters.some(a => a.identity === adapter.identity && a.baseModelIdentity === model.identity);
      assert(verified, 'This execution path cannot apply the selected adapter');
    }
    let sequence = 0;
    const state = (status, execution) => controls.onState({ threadId, attemptId, status, execution });

    if (model.partition) {
      assert(partitions?.generate, 'Partition execution service is unavailable');
      return partitions.generate(request, controls);
    }

    if (request.permissions?.sharingScope === 'local' || (local?.ready && local.modelIdentity === model.identity)) {
      const maxOutputTokens = Math.min(
        request.maxOutputTokens || profile.generation?.maxTokens || 1024,
        4096
      );
      state('queued', { provider: 'doppler', placement: 'local-webgpu' });
      const result = await sessionScheduler.schedule({
        ...request,
        maxOutputTokens
      }, {
        signal: controls.signal,
        onDelta: text => controls.onDelta({ threadId, attemptId, sequence: sequence++, text }),
        onState: status => state(status, { provider: 'doppler', placement: 'local-webgpu' })
      });
      const execution = { provider: 'doppler', placement: 'local-webgpu', modelId: result.model,
        modelIdentity: result.modelIdentity, adapterIdentities: result.adapterIdentities };
      return {
        threadId,
        attemptId,
        modelId: result.model,
        modelIdentity: result.modelIdentity,
        adapterIdentities: result.adapterIdentities,
        content: result.content,
        execution
      };
    }

    assert(swarm?.generate, 'No connected participant can execute this model');
    const provider = createWorkNetworkProvider({
      model, service, scope: 'chat:' + attemptId, signal: controls.signal,
      swarm,
      generation: profile.generation, maxOutcomeCharacters: profile.maxOutcomeCharacters,
      controls: {
        async approve(preview) {
          return controls.requestApproval({ ...preview, peerId: preview.providerId, threadId, attemptId });
        },
        async record(record) {
          if (record.stage === 'approved') state('executing', {
            provider: 'peer', placement: 'peer-whole-request', peerId: record.preview.providerId
          });
        }
      },
      onProgress(progress) {
        // The network provider emits text; Doppler's loader emits progress records.
        const loading = progress !== null && typeof progress === 'object';
        const local = loading || (typeof progress === 'string' && /executing on this device/i.test(progress));
        state(local ? 'loading' : 'queued', local ? { provider: 'doppler', placement: 'local-webgpu' } : null);
      }
    });
    state('queued', null);
    const result = await provider.generate(request.messages, text => {
      controls.onDelta({ threadId, attemptId, sequence: sequence++, text });
    }, { signal: controls.signal });
    const execution = result.peerId
      ? { provider: 'peer', placement: 'peer-whole-request', peerId: result.peerId }
      : { provider: 'doppler', placement: 'local-webgpu' };
    Object.assign(execution, { modelId: result.model, modelIdentity: result.modelIdentity, adapterIdentities: result.adapterIdentities });
    return { threadId, attemptId, modelId: result.model, modelIdentity: result.modelIdentity,
      adapterIdentities: result.adapterIdentities, content: result.content, execution };
  };

  let closing = null;
  return Object.freeze({
    execute,
    prepareLocal: model => sessionScheduler.prepare(model),
    getLocalState: () => local ? structuredClone(local) : null,
    getState: () => structuredClone(sessionScheduler.getState()),
    close() {
      // Injected schedulers are borrowed and may serve other conversation owners.
      closing ??= Promise.resolve().then(() => scheduler ? undefined : sessionScheduler.close());
      return closing;
    }
  });
}
