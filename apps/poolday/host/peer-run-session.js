import { createLocalPackExecutor } from '../pool/local-pack-executor.js';
import { runPeerJob } from '../pool/peer-room.js';
import { createRequesterClient } from '../pool/requester-client.js';
import { createPackOperationRegistry } from '../../../shared/pool/pack-operation-adapters.js';
import { hashDopplerEvidence } from '../../../shared/pool/executable-pack.js';
import { createPoolIdentity } from '../../../shared/pool/identity.js';
import { createPoolSdk } from '../../../shared/pool/sdk.js';
import { getPoolRtcConfig } from '../../../shared/pool/rtc-config.js';
import { normalizeSequenceInput } from '../../../shared/pool/sequence-workload.js';
import { FASTEST_RECEIPT_POLICY_ID } from '../pool/policy-router.js';
import { getPeerRoomId, getPeerRoomBusFactory, getPeerRelayMode } from './product-context.js';
import { getPeerExecutionConfig, getPeerReceiptWindowMs } from './peer-execution-config.js';
const errorString = error => String(error?.message || error?.error || error || 'Unknown error');
const recoveryCodeOf = error => error?.code || error?.payload?.code || null;
export const canOfferLocalFallback = error => ['peer_provider_not_found', 'peer_provider_model_mismatch', 'peer_provider_unresponsive'].includes(recoveryCodeOf(error));
export const supportsLocalRequest = (request) => request?.policyId === FASTEST_RECEIPT_POLICY_ID
    && !request.researchSubmission && !request.adapterPackHash
    && request.selectedModel?.executablePack?.requiredOperation === 'encodeSequence';

/** Own one route's execution handles; UI bindings supply input and display callbacks only. */
export function createPeerRunSession({ identityNamespace }) {
  const requesterIdentity = createPoolIdentity('requester', { localOnly: true, namespace: identityNamespace });
  const requesterClient = createRequesterClient({ sdk: null, identity: requesterIdentity });
  const rtcSdk = createPoolSdk();
  let disposed = false, localExecutor = null;
  const runLocal = async (request, { onLocalExecution = () => {} } = {}) => {
    if (disposed) throw new Error('Run view was closed');
    if (!supportsLocalRequest(request)) throw new Error('The selected checks cannot be replaced by local execution');
    onLocalExecution();
    const executor = createLocalPackExecutor();
    localExecutor = executor;
    const cancel = () => executor.cancel();
    window.addEventListener('pagehide', cancel, { once: true });
    try {
      const definition = createPackOperationRegistry().encodeSequence.definition;
      const execution = await executor.run({
        model: request.selectedModel,
        input: { sequence: normalizeSequenceInput(request.sequence, request.sequenceRequest.alphabet) },
        options: { includeTokenEmbeddings: false, includeLogits: false },
        limits: {
          maxInputBytes: definition.maximumLimits.maxInputBytes,
          maxOutputBytes: definition.maximumLimits.maxOutputBytes,
          deadlineAt: Date.now() + Math.min(getPeerReceiptWindowMs(), definition.maximumLimits.maxJobMs)
        }
      });
      const sequenceResultHash = await hashDopplerEvidence(execution.output);
      return {
        status: 'completed', statusLabel: 'Completed locally', transport: 'local_capsule',
        policyId: 'local_capsule_execution', requestedPolicyId: request.policyId,
        model: request.selectedModel, outputKind: request.selectedModel.workload,
        sequenceOutput: execution.output, sequenceResultHash,
        embeddingDimensions: execution.output.embeddingDim,
        receiptHash: execution.receipt.receiptDigest,
        localExecution: execution,
        claimBoundary: 'Verified Capsule execution on this device; no independent contributor comparison.'
      };
    } finally {
      window.removeEventListener('pagehide', cancel);
      await executor.close();
      localExecutor = null;
    }
  };

  return {
    requesterIdentity, runLocal,
    async run(request, { onActivity = () => {}, onLocalExecution = () => {} } = {}) {
      if (disposed) throw Error('Run view was closed');
      if (request.localExecution === true) return runLocal(request, { onLocalExecution });
      const config = getPeerExecutionConfig();
      let contributorStarted = false, acceptingNetworkActivity = true;
      try { return await runPeerJob({
        roomId: getPeerRoomId(),
        requesterClient,
        prompt: request.promptText,
        sequence: request.sequence,
        sequenceRequest: request.sequenceRequest,
        policyId: request.policyId,
        modelRequirements: request.modelRequirements,
        discoveryWindowMs: config.discoveryWindowMs,
        sessionAcceptWindowMs: config.sessionAcceptWindowMs,
        receiptWindowMs: config.receiptWindowMs,
        queueWindowMs: config.queueWindowMs,
        transportConnectWindowMs: config.transportConnectWindowMs,
        roomBusFactory: getPeerRoomBusFactory(),
        relayAckSigner: requesterClient.createRelayAcknowledgement.bind(requesterClient),
        generationConfig: config.generation,
        knownProviderAdverts: request.knownProviderAdverts || [],
        rtcConfigProvider: getPeerRelayMode() === 'server' && window.REPLOID_POOL_FORCE_RELAY === true
          // Public server-relay discovery may be anonymous.  Do not request
          // scoped TURN credentials unless the caller explicitly requires the
          // relay-only transport; direct ICE remains available by default.
          ? () => getPoolRtcConfig({ sdk: rtcSdk, forceRelay: true })
          : null,
        onActivity: (activity) => {
          if (disposed || !acceptingNetworkActivity) return;
          if (activity.status === 'peer_provider_execution_started') contributorStarted = true;
          onActivity(activity);
        }
      }).catch(async (error) => {
        if (disposed || contributorStarted || !canOfferLocalFallback(error) || !supportsLocalRequest(request) || !navigator.gpu) throw error;
        acceptingNetworkActivity = false;
        const result = await runLocal(request, { onLocalExecution });
        result.networkFailure = { code: recoveryCodeOf(error), message: errorString(error) };
        return result;
      }); } finally { acceptingNetworkActivity = false; }
    },
    close() { disposed = true; localExecutor?.cancel(); }
  };
}
