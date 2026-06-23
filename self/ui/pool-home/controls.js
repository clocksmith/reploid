/**
 * @fileoverview Route control bindings for the Reploid product home.
 */

import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createAgentClient } from '../../pool/agent-client.js';
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
  getNodeGrid,
  getPeerInviteUrl,
  getPeerRelayMode,
  getPeerRoomBusFactory,
  getPeerRoomId,
  refreshProviderStorageHealth,
  refreshPeerLedgerState,
  renderReceiptLedger,
  setNodeGridProgress,
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
  const pollButton = document.getElementById('pool-run-poll');
  const prompt = document.getElementById('pool-run-prompt');
  const policySelect = document.getElementById('pool-run-policy');
  const modelSelect = document.getElementById('pool-run-model');
  const maxSpendInput = document.getElementById('pool-run-max-spend');
  if (!button || !prompt) return;
  const requesterIdentity = createPoolIdentity('requester', { localOnly: true });
  const requesterClient = createRequesterClient({
    sdk: null,
    identity: requesterIdentity
  });
  let lastPeerResult = null;
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
    lastPeerResult = null;
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
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null,
        roomBusFactory: getPeerRoomBusFactory(),
        generationConfig: {
          mode: 'greedy',
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 128,
          seed: '0000000000000000'
        }
      });
      result.inviteUrl = getPeerInviteUrl();
      result.relay = getPeerRelayMode();
      lastPeerResult = result;
      addReceiptLedgerRow(result.receiptRecord || result, result.receiptHash);
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
  pollButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-run-result', lastPeerResult, { stream: true });
      return;
    }
    setResult('pool-run-result', {
      status: 'no_local_peer_result',
      action: 'Run a local peer-room request first.'
    }, { stream: true });
  });
};

export const bindAgentControls = () => {
  const submitButton = document.getElementById('pool-agent-submit');
  const prompt = document.getElementById('pool-agent-prompt');
  const policySelect = document.getElementById('pool-agent-policy');
  const maxSpendInput = document.getElementById('pool-agent-max-spend');
  if (!submitButton || !prompt) return;
  const agentIdentity = createPoolIdentity('agent', { localOnly: true });
  const agentClient = createAgentClient({
    sdk: null,
    identity: agentIdentity,
    pointBudget: 0
  });
  let lastPeerResult = null;
  submitButton.addEventListener('click', async () => {
    submitButton.disabled = true;
    lastPeerResult = null;
    setResult('pool-agent-result', describeSelectedRun({
      status: 'finding_peer_provider',
      policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
      modelId: LAUNCH_MODEL.modelId
    }));
    try {
      const identity = await agentIdentity.resolve();
      const result = await runPeerJob({
        roomId: getPeerRoomId(),
        requesterClient: agentClient,
        prompt: prompt.value,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelRequirements: LAUNCH_MODEL,
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null,
        roomBusFactory: getPeerRoomBusFactory(),
        generationConfig: {
          mode: 'greedy',
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 128,
          seed: '0000000000000000'
        }
      });
      result.identity = identity;
      result.inviteUrl = getPeerInviteUrl();
      result.relay = getPeerRelayMode();
      lastPeerResult = result;
      addReceiptLedgerRow(result.receiptRecord || result, result.receiptHash);
      setResult('pool-agent-result', result);
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      submitButton.disabled = false;
    }
  });
};

export const bindProviderControls = () => {
  const loadButton = document.getElementById('pool-provider-load');
  const profileButton = document.getElementById('pool-provider-profile');
  const workerStartButton = document.getElementById('pool-provider-worker-start');
  const workerStopButton = document.getElementById('pool-provider-worker-stop');
  const modelInput = document.getElementById('pool-provider-model');
  if (!modelInput || !workerStartButton) return;
  const peerProviderIdentity = createPoolIdentity('provider', { localOnly: true });
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  const mount = document.getElementById('app');
  const nodeGrid = getNodeGrid(mount);
  updateProviderStatus(mount, 'NODE // OFFLINE');
  setNodeGridProgress(nodeGrid, 0);
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
    setNodeGridProgress(nodeGrid, 0.2);
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
      setNodeGridProgress(nodeGrid, 0.7);
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
    setNodeGridProgress(nodeGrid, 0.7);
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
          setNodeGridProgress(nodeGrid, 0.9);
          updateProviderHealth({ queue: 'opening_session' });
        }
        if (event?.status === 'peer_session_open') {
          updateProviderStatus(mount, 'NODE // SPAWNED');
          setNodeGridProgress(nodeGrid, 1);
          updateProviderHealth({ queue: 'running_peer_job' });
        }
        if (event?.status === 'peer_receipt_sent') {
          updateProviderStatus(mount, 'NODE // SPAWNED');
          setNodeGridProgress(nodeGrid, 1);
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
          setNodeGridProgress(nodeGrid, 0);
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
    setNodeGridProgress(nodeGrid, 0);
  };
  loadButton?.addEventListener('click', async () => {
    loadButton.disabled = true;
    setResult('pool-provider-result', { status: 'loading_model', model: getProviderModel() });
    try {
      setResult('pool-provider-result', await loadSelectedProviderModel());
      setNodeGridProgress(nodeGrid, 0.8);
    } catch (error) {
      setResult('pool-provider-result', displayPoolError(error, {
        title: 'Model download failed',
        action: 'Deploy the configured model artifacts or attach a compatible Doppler runtime handle, then try Load again.',
        context: {
          model: getProviderModel()
        }
      }));
      updateProviderHealth({ model: 'load_failed', artifact: error.payload?.artifactPreflight?.status || 'failed', queue: 'error' });
      updateProviderStatus(mount, 'NODE // OFFLINE');
      setNodeGridProgress(nodeGrid, 0);
    } finally {
      loadButton.disabled = false;
    }
  });
  profileButton?.addEventListener('click', async () => {
    profileButton.disabled = true;
    try {
      const runtimeProfile = typeof runtime.getRuntimeProfile === 'function'
        ? await runtime.getRuntimeProfile()
        : { error: 'runtime profile unavailable' };
      setResult('pool-provider-result', runtimeProfile);
    } catch (error) {
      setResult('pool-provider-result', displayPoolError(error, { title: 'Profile failed' }));
    } finally {
      profileButton.disabled = false;
    }
  });
  workerStartButton?.addEventListener('click', async () => {
    if (workerRunning) return;
    workerStartButton.disabled = true;
    setResult('pool-provider-result', { runner: 'peer_room_starting', roomId: getPeerRoomId(), model: getProviderModel() });
    updateProviderStatus(mount, 'NODE // SPAWNING');
    setNodeGridProgress(nodeGrid, 0.9);
    try {
      const ready = await ensurePeerProviderReady();
      workerRunning = true;
      syncWorkerButtons();
      updateProviderStatus(mount, 'NODE // SPAWNED');
      setNodeGridProgress(nodeGrid, 1);
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

export const bindReputationControls = () => {
  const button = document.getElementById('pool-reputation-refresh');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      refreshPeerLedgerState();
      setResult('pool-reputation-result', {
        status: 'local_peer_ledger_refreshed',
        transport: 'webrtc_peer_room_local'
      });
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
};
