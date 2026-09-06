/** Explicit product participation for an application-selected answer model. */
import config from './pool-config.json' with { type: 'json' };
import { createPoolIdentity } from './identity.js';
import { exportPublicKey, sha256Hex } from './inference-receipt.js';
import { createLocalPackExecutor } from './local-pack-executor.js';
import { createOperationRoomProvider } from './operation-room-network.js';
import { packPeerModel } from './peer-pack-job.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { validateOperationModel } from './operation-model.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { snapshotPackOperationData as snapshot } from './pack-operation.js';
import { normalizeExecutionAdapterSet } from './adapter-execution.js';
const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function createOperationParticipation({ networkOptions, onChange = () => {},
  policy: input = config.operationParticipation, executorFactory = createLocalPackExecutor,
  createProvider = createOperationRoomProvider, registry = createPackOperationRegistry(),
  adapterResolver = null, observeAdapters = async () => [] }) {
  const policy = snapshot(input);
  assert(policy.schema === 'reploid.pool.operation-participation-policy/v1'
    && typeof policy.identityNamespace === 'string' && policy.identityNamespace.length > 0
    && Number.isSafeInteger(policy.maxConfigurationBytes) && policy.maxConfigurationBytes > 0
    && Number.isSafeInteger(policy.maxModelArtifactBytes) && policy.maxModelArtifactBytes > 0
    && Array.isArray(policy.inputClasses) && policy.inputClasses.length > 0, 'Sharing policy is missing');
  let provider = null, executor = null, state = { phase: 'idle', modelId: null, error: null }, epoch = 0;
  const notify = patch => { state = { ...state, ...patch }; onChange({ ...state }); };
  const stop = async () => {
    epoch++; const active = provider; provider = null;
    if (state.phase !== 'idle') notify({ phase: 'stopping' });
    try { await active?.close(); await executor?.close(); }
    finally { executor = null; notify({ phase: 'idle', modelId: null }); }
  };
  return {
    getState: () => ({ ...state }),
    async start({ configuration, approved }) {
      assert(state.phase === 'idle', 'Stop sharing before changing models');
      assert(approved === true, 'Confirm the model publisher and sharing first');
      const selected = snapshot(configuration), model = selected.generator;
      assert(selected.schema === 'reploid.document-models/v1' && model, 'Choose document model settings with an answer model');
      const validation = validateOperationModel(model, registry);
      assert(validation.ok, validation.reasons.join('; '));
      assert(registry[model.executablePack.requiredOperation].definition.dopplerOperation.name === 'generate', 'Choose an answer model');
      assert(model.packOpenOptions?.trustedSigners && Object.keys(model.packOpenOptions.trustedSigners).length > 0,
        'Model settings must identify their publisher');
      assert(model.executablePack.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0) <= policy.maxModelArtifactBytes,
        'This model exceeds the configured download allowance');
      const token = ++epoch;
      const current = () => assert(token === epoch, 'Sharing cancelled');
      notify({ phase: 'starting', modelId: model.modelId, error: null });
      try {
        const approvedAdapters = await normalizeExecutionAdapterSet(
          selected.executionAdapters === undefined ? config.peerJobs.execution.adapters.defaultAdapterSet : selected.executionAdapters,
          { model: packPeerModel(model), policy: config.peerJobs.execution.adapters }); current();
        assert(!approvedAdapters.length || adapterResolver, 'Connect the approved specializations before sharing this model');
        const identity = createPoolIdentity('provider', { localOnly: true, namespace: policy.identityNamespace });
        const keys = await identity.getSigningKeyPair(); current();
        const publicKey = await exportPublicKey(keys.publicKey);
        const keyId = await sha256Hex(Uint8Array.from(atob(publicKey), char => char.charCodeAt(0))); current();
        const modelIdentity = await hashDopplerEvidence(packPeerModel(model)); current();
        executor = executorFactory();
        provider = createProvider({ ...networkOptions(), identity: { keyId, publicKey, privateKey: keys.privateKey }, models: [model], executor, adapterResolver,
          authorize: job => token === epoch && state.phase === 'sharing'
            && job.body.intent.adapterSet.every(entry => approvedAdapters.some(approved => approved.identity === entry.identity)),
          observeCapabilities: async execution => ({ schema: config.peerJobs.providerCapabilitySchema.observationSchema,
            observedAt: Date.now(), gpuIdentity: null,
            models: [{ identity: modelIdentity, availability: executor.getState().retainedModelId === model.modelId ? 'resident' : 'fetchable' }],
            adapters: (await observeAdapters()).filter(row => approvedAdapters.some(entry => entry.identity === row.identity)),
            experts: [], operations: [registry[model.executablePack.requiredOperation].definition.dopplerOperation],
            inputClasses: policy.inputClasses, resources: { ...policy.resources, activeJobs: execution.active ? 1 : 0, queuedJobs: execution.queued } }),
          onError: error => { if (token === epoch) notify({ error: error.message }); } });
        await provider.start(); current(); notify({ phase: 'sharing' });
      } catch (error) {
        if (token === epoch) { await stop(); notify({ error: error.message }); }
        throw error;
      }
    },
    stop,
    close: stop
  };
}
