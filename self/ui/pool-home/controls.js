/**
 * @fileoverview Route control bindings for the Reploid product home.
 */

import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createProviderClient } from '../../pool/provider-client.js';
import { buildModelArtifactUrls, verifyModelArtifactManifest } from '../../pool/model-artifacts.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import { LAUNCH_MODEL, buildLaunchProviderModel, getEnabledPoolModelContract } from '../../pool/model-contract.js';
import { createPoolIdentity } from '../../pool/identity.js';
import { FASTEST_RECEIPT_POLICY_ID, listPolicies } from '../../pool/policy-router.js';
import { createPeerProviderNode, runPeerJob } from '../../pool/peer-room.js';
import { verifyReceiptRecord } from '../../pool/sdk.js';
import {
  addReceiptLedgerRow,
  describeSelectedRun,
  findReceiptLedgerRecord,
  getPeerDiscoveryWindowMs,
  getPeerGenerationConfig,
  getPeerInviteUrl,
  getPeerReceiptWindowMs,
  getPeerRelayMode,
  getPeerRoomBusFactory,
  getPeerRoomId,
  refreshProviderStorageHealth,
  renderReceiptLedger,
  setResult,
  updateProviderHealth,
  updateProviderStatus
} from './view.js';

const errorString = (error) => String(error?.message || error?.error || error || 'Unknown error');

const displayPoolError = (error, {
  title = 'Request failed',
  action = 'Check the details below, then try the operation again.',
  context = {}
} = {}) => ({
  status: 'error',
  error: title,
  reason: errorString(error),
  code: error?.code || error?.payload?.code || null,
  retryable: error?.retryable ?? error?.payload?.retryable ?? null,
  action: error?.payload?.action || error?.action || action,
  ...context,
  payload: error?.payload || null
});

const artifactPreflightFailureAction = (model) => (
  `Deploy ${model?.modelId || 'the selected model'} artifacts at the configured model base, or attach a compatible Doppler runtime handle before starting a contributor.`
);

const getPageIdentityNamespace = (globalKey) => {
  if (window[globalKey]) return window[globalKey];
  const id = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  window[globalKey] = `page_${id}`;
  return window[globalKey];
};

const getProviderIdentityNamespace = () => getPageIdentityNamespace('REPLOID_POOL_PROVIDER_NAMESPACE');
const getRequesterIdentityNamespace = () => getPageIdentityNamespace('REPLOID_POOL_REQUESTER_NAMESPACE');

const probeModelArtifacts = async (model) => {
  try {
    return {
      status: 'verified_manifest',
      ...(await verifyModelArtifactManifest({ model }))
    };
  } catch (error) {
    let urls = error.urls || null;
    try {
      urls = urls || buildModelArtifactUrls(model);
    } catch {
      urls = null;
    }
    return {
      ok: false,
      status: 'manifest_unavailable',
      error: errorString(error),
      statusCode: error.status || null,
      retryable: error.retryable === true,
      urls,
      action: artifactPreflightFailureAction(model)
    };
  }
};

export const bindRunControls = () => {
  const button = document.getElementById('pool-run-submit');
  const prompt = document.getElementById('pool-run-prompt');
  const policySelect = document.getElementById('pool-run-policy');
  const modelSelect = document.getElementById('pool-run-model');
  if (!button || !prompt) return;
  const requesterIdentity = createPoolIdentity('requester', {
    localOnly: true,
    namespace: getRequesterIdentityNamespace()
  });
  const requesterClient = createRequesterClient({
    sdk: null,
    identity: requesterIdentity
  });
  button.addEventListener('click', async () => {
    const promptText = prompt.value.trim();
    if (!promptText) {
      setResult('pool-run-result', {
        status: 'error',
        error: 'Prompt is required',
        reason: 'The request body is empty.',
        action: 'Enter a prompt, then run the request again.'
      }, { stream: true });
      return;
    }
    button.disabled = true;
    setResult('pool-run-result', describeSelectedRun({
      status: 'finding_peer_provider',
      policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
      modelId: modelSelect?.value || LAUNCH_MODEL.modelId
    }), { stream: true });
    try {
      const result = await runPeerJob({
        roomId: getPeerRoomId(),
        requesterClient,
        prompt: promptText,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelRequirements: getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL,
        discoveryWindowMs: getPeerDiscoveryWindowMs(),
        receiptWindowMs: getPeerReceiptWindowMs(),
        roomBusFactory: getPeerRoomBusFactory(),
        generationConfig: getPeerGenerationConfig()
      });
      result.inviteUrl = getPeerInviteUrl();
      result.relay = getPeerRelayMode();
      addReceiptLedgerRow({
        ...(result.receiptRecord || result),
        requesterAcceptance: result.requesterAcceptance || null,
        agreement: result.agreement || null
      }, result.receiptHash);
      setResult('pool-run-result', result, { stream: true });
    } catch (error) {
      setResult('pool-run-result', displayPoolError(error, {
        title: 'Request could not complete',
        action: 'Open Mesh in another tab with the same room, click Start, wait for the node to listen, then run this request again.',
        context: {
          roomId: getPeerRoomId(),
          relay: getPeerRelayMode(),
          model: getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL
        }
      }), { stream: true });
    } finally {
      button.disabled = false;
    }
  });
};

export const bindProviderControls = () => {
  const workerStartButton = document.getElementById('pool-provider-worker-start');
  const workerStopButton = document.getElementById('pool-provider-worker-stop');
  const modelInput = document.getElementById('pool-provider-model');
  if (!modelInput || !workerStartButton) return;
  const peerProviderIdentity = createPoolIdentity('provider', {
    localOnly: true,
    namespace: getProviderIdentityNamespace()
  });
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  const mount = document.getElementById('app');
  updateProviderStatus(mount, 'NODE // OFFLINE');
  updateProviderHealth({
    webgpu: navigator.gpu ? 'available' : 'unavailable',
    storage: navigator.storage ? 'available' : 'unknown'
  });
  void refreshProviderStorageHealth();
  const peerProviderClient = createProviderClient({
    sdk: null,
    runtime,
    identity: peerProviderIdentity
  });
  const getProviderModel = () => ({
    ...buildLaunchProviderModel({ modelId: modelInput.value || LAUNCH_MODEL.modelId })
  });
  const modelMatchesLoadedRuntime = (model = {}) => {
    const loaded = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
    return !!loaded
      && loaded.modelId === model.modelId
      && loaded.modelHash === model.modelHash
      && loaded.manifestHash === model.manifestHash
      && loaded.runtime === model.runtime
      && loaded.backend === model.backend;
  };
  const loadSelectedProviderModel = async () => {
    updateProviderStatus(mount, 'NODE // SPAWNING');
    await refreshProviderStorageHealth();
    updateProviderHealth({
      webgpu: navigator.gpu ? 'available' : 'unavailable',
      model: 'loading',
      artifact: window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT === true ? 'checking' : 'strict_preflight_off',
      queue: 'starting'
    });
    const model = getEnabledPoolModelContract(modelInput.value || LAUNCH_MODEL.modelId);
    if (!model) throw new Error('Selected model is not enabled for peer contribution');
    if (modelMatchesLoadedRuntime(model) && runtime.isReady?.()) {
      updateProviderHealth({
        model: model.modelId,
        artifact: 'ready',
        trust: 'receipt-backed'
      });
      return {
        ok: true,
        status: 'model_loaded',
        model: runtime.getModelInfo()
      };
    }
    const artifactPreflight = await probeModelArtifacts(model);
    updateProviderHealth({
      artifact: artifactPreflight.ok ? 'verified_manifest' : 'manifest_unavailable'
    });
    if (window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT === true && !artifactPreflight.ok) {
      const error = new Error(artifactPreflight.error || 'model artifact preflight failed');
      error.code = 'model_artifact_unavailable';
      error.payload = {
        model,
        artifactPreflight,
        action: artifactPreflight.action
      };
      throw error;
    }
    const loadResult = await runtime.loadModel(model);
    if (!loadResult?.ok || !runtime.isReady?.() || !modelMatchesLoadedRuntime(model)) {
      const reason = loadResult?.reason || 'Doppler runtime did not expose the selected model after load';
      const error = new Error(`Doppler model load failed: ${reason}`);
      error.code = 'doppler_model_load_failed';
      error.payload = {
        model,
        artifactPreflight,
        loadResult,
        loadState: runtime.getLoadState?.() || null,
        webgpu: navigator.gpu ? 'available' : 'unavailable',
        action: artifactPreflight.ok
          ? 'Check the Doppler module URL and browser WebGPU support, then try Load again.'
          : artifactPreflight.action
      };
      throw error;
    }
    updateProviderHealth({
      model: model.modelId,
      artifact: artifactPreflight ? 'verified_manifest' : 'ready',
      trust: 'receipt-backed'
    });
    return {
      ...loadResult,
      artifactPreflight,
      status: 'model_loaded'
    };
  };
  let peerProviderNode = null;
  const stopPeerProvider = async () => {
    if (!peerProviderNode) return null;
    const node = peerProviderNode;
    peerProviderNode = null;
    return node.stop();
  };
  const ensurePeerProviderReady = async () => {
    const loaded = await loadSelectedProviderModel();
    const model = loaded.model || runtime.getModelInfo();
    const providerIdentityState = await peerProviderIdentity.resolve();
    await stopPeerProvider();
    const node = createPeerProviderNode({
      roomId: getPeerRoomId(),
      providerClient: peerProviderClient,
      roomBusFactory: getPeerRoomBusFactory(),
      onActivity(event) {
        if (event?.status === 'provider_advertised') {
          updateProviderStatus(mount, 'NODE // SPAWNED');
          updateProviderHealth({ queue: 'listening' });
          return;
        }
        if (event?.status === 'peer_session_opening') {
          updateProviderStatus(mount, 'NODE // SPAWNING');
          updateProviderHealth({ queue: 'opening_session' });
        }
        if (event?.status === 'peer_session_open') {
          updateProviderStatus(mount, 'NODE // SPAWNED');
          updateProviderHealth({ queue: 'running_peer_job' });
        }
        if (event?.status === 'peer_receipt_sent') {
          updateProviderStatus(mount, 'NODE // SPAWNED');
          updateProviderHealth({
            queue: 'receipt_sent',
            lastReceipt: event.receiptRecord?.receiptHash || 'signed'
          });
        }
        if (event?.status === 'peer_acceptance_received') {
          updateProviderHealth({
            queue: 'accepted',
            reputation: 'local_event_received'
          });
        }
        if (event?.status === 'peer_session_failed') {
          updateProviderStatus(mount, 'NODE // OFFLINE');
          updateProviderHealth({ queue: 'session_failed' });
        }
        setResult('pool-provider-result', {
          runner: 'peer_room',
          roomId: getPeerRoomId(),
          relay: getPeerRelayMode(),
          inviteUrl: getPeerInviteUrl(),
          ...event
        });
      }
    });
    peerProviderNode = node;
    const result = await node.start({
      models: [model],
      availability: {
        maxConcurrentJobs: 1,
        maxTokensPerJob: 128,
        acceptedPolicies: listPolicies().map((policy) => policy.policyId)
      }
    });
    return {
      identity: providerIdentityState,
      transport: 'webrtc_peer_room',
      ...result
    };
  };
  let workerRunning = false;
  const syncWorkerButtons = () => {
    if (workerStartButton) workerStartButton.disabled = workerRunning;
    if (workerStopButton) workerStopButton.disabled = !workerRunning;
  };
  const stopWorker = () => {
    workerRunning = false;
    syncWorkerButtons();
    updateProviderStatus(mount, 'NODE // OFFLINE');
  };
  workerStartButton?.addEventListener('click', async () => {
    if (workerRunning) return;
    workerStartButton.disabled = true;
    setResult('pool-provider-result', { runner: 'peer_room_starting', roomId: getPeerRoomId(), model: getProviderModel() });
    updateProviderStatus(mount, 'NODE // SPAWNING');
    try {
      const ready = await ensurePeerProviderReady();
      workerRunning = true;
      syncWorkerButtons();
      updateProviderStatus(mount, 'NODE // SPAWNED');
      updateProviderHealth({ queue: 'listening' });
      setResult('pool-provider-result', { runner: 'peer_room_listening', relay: getPeerRelayMode(), inviteUrl: getPeerInviteUrl(), ...ready });
    } catch (error) {
      await stopPeerProvider().catch(() => null);
      stopWorker();
      updateProviderHealth({ queue: 'stopped', model: 'load_failed' });
      setResult('pool-provider-result', displayPoolError(error, {
        title: 'Contributor could not start',
        action: 'Load a compatible model first. If the manifest URL is missing, deploy the model artifacts or attach a Doppler runtime handle.',
        context: {
          runner: 'stopped',
          roomId: getPeerRoomId(),
          relay: getPeerRelayMode(),
          model: getProviderModel()
        }
      }));
    } finally {
      syncWorkerButtons();
    }
  });
  workerStopButton?.addEventListener('click', async () => {
    workerStopButton.disabled = true;
    const stopped = await stopPeerProvider().catch((error) => ({ error: error.message, payload: error.payload || null }));
    stopWorker();
    updateProviderHealth({ queue: 'stopped' });
    setResult('pool-provider-result', { runner: 'stopped', peer: stopped });
  });
};

export const bindReceiptControls = () => {
  const button = document.getElementById('pool-receipt-lookup');
  const input = document.getElementById('pool-receipt-hash');
  if (!button || !input) return;
  const ledgerContainer = document.getElementById('pool-receipt-ledger');
  if (ledgerContainer) {
    ledgerContainer.innerHTML = renderReceiptLedger();
  }
  button.addEventListener('click', async () => {
    const receiptHash = input.value.trim();
    if (!receiptHash) {
      setResult('pool-receipt-result', { error: 'Receipt hash is required' });
      return;
    }
    button.disabled = true;
    try {
      const record = findReceiptLedgerRecord(receiptHash);
      if (!record) {
        setResult('pool-receipt-result', {
          status: 'not_found',
          receiptHash,
          action: 'Run a local peer-room job first, then inspect the receipt from this browser.'
        });
        return;
      }
      setResult('pool-receipt-result', {
        ...record,
        localVerification: record.receipt ? await verifyReceiptRecord(record) : null
      });
    } catch (error) {
      setResult('pool-receipt-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
};
