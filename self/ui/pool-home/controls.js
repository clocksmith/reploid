/**
 * @fileoverview Route control bindings for the Reploid product home.
 */

import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createProviderClient } from '../../pool/provider-client.js';
import { buildModelArtifactUrls, verifyModelArtifactManifest } from '../../pool/model-artifacts.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import {
  LAUNCH_MODEL,
  buildLaunchProviderModel,
  getEnabledPoolModelContract,
  validateModelRuntimeCapabilities
} from '../../pool/model-contract.js';
import { createPoolIdentity } from '../../pool/identity.js';
import { FASTEST_RECEIPT_POLICY_ID, listPolicies } from '../../pool/policy-router.js';
import { createPeerProviderNode, runPeerJob } from '../../pool/peer-room.js';
import { createPoolSdk, verifyReceiptRecord } from '../../pool/sdk.js';
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
  refreshContributionStatusBar,
  refreshProviderStorageHealth,
  refreshRoomActivityState,
  renderReceiptLedger,
  setPoolRunVisualState,
  setResult,
  updateProviderHealth,
  updateProviderStatus
} from './view.js';
import {
  recordContributionReceipt,
  updateContributionState
} from './contribution-state.js';

const errorString = (error) => String(error?.message || error?.error || error || 'Unknown error');
const POOL_ROOM_ACTIVITY_POLL_MS = 5000;

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
  `Deploy ${model?.modelId || 'the selected model'} artifacts at the configured model base, or attach a compatible Doppler runtime handle before contributing.`
);

const usesRegistryBackedDopplerLoad = (model = {}) => (
  Boolean(model.dopplerLoadRef || model.registryId || model.loadRef)
  && !model.modelBaseUrl
  && !model.artifactPolicy?.baseUrl
);

const formatDeviceLabel = (deviceInfo = {}) => {
  const adapter = deviceInfo.adapterInfo || {};
  return [
    adapter.vendor,
    adapter.architecture,
    adapter.device
  ].filter(Boolean).join(' / ') || deviceInfo.probeStatus || 'unknown';
};

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

const bindSuggestedPromptEditing = (input) => {
  if (!input || input.dataset.poolSuggestedPromptBound === 'true') return;
  input.dataset.poolSuggestedPromptBound = 'true';
  const clearSuggestedPrompt = () => {
    if (input.dataset.poolSuggestedPromptCleared === 'true') return;
    const suggestedPrompt = String(input.dataset.poolSuggestedPrompt || '');
    if (suggestedPrompt && input.value === suggestedPrompt) {
      input.value = '';
      input.dataset.poolSuggestedPromptCleared = 'true';
    }
  };
  input.addEventListener('focus', clearSuggestedPrompt);
  input.addEventListener('pointerdown', clearSuggestedPrompt);
};

const refreshServerRoomActivity = async (isActive = () => true) => {
  const activity = document.getElementById('pool-room-activity');
  const networkState = document.querySelector('[data-pool-network-state]');
  if (!activity && !networkState) return null;
  if (getPeerRelayMode() === 'local') {
    if (isActive()) refreshRoomActivityState();
    return null;
  }
  try {
    const summary = await createPoolSdk({ authTokenProvider: null }).peerRoomSummary(getPeerRoomId(), { limit: 100 });
    if (isActive()) refreshRoomActivityState(summary);
    return summary;
  } catch (error) {
    if (isActive()) refreshRoomActivityState({ error: errorString(error) });
    return null;
  }
};

export const bindRoomActivityControls = () => {
  window.REPLOID_POOL_ROOM_ACTIVITY_STOP?.();
  if (!document.getElementById('pool-room-activity') && !document.querySelector('[data-pool-network-state]')) return;
  let active = true;
  let refreshing = false;
  const refresh = async () => {
    if (!active || refreshing || document.visibilityState === 'hidden') return;
    refreshing = true;
    try {
      await refreshServerRoomActivity(() => active);
    } finally {
      refreshing = false;
    }
  };
  const intervalId = window.setInterval(() => void refresh(), POOL_ROOM_ACTIVITY_POLL_MS);
  window.REPLOID_POOL_ROOM_ACTIVITY_STOP = () => {
    active = false;
    window.clearInterval(intervalId);
    if (window.REPLOID_POOL_ROOM_ACTIVITY_STOP) window.REPLOID_POOL_ROOM_ACTIVITY_STOP = null;
  };
  void refresh();
};

const probeModelArtifacts = async (model) => {
  if (window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT !== true && usesRegistryBackedDopplerLoad(model)) {
    return {
      ok: true,
      status: 'doppler_registry',
      runtime: model.runtime || 'doppler',
      loadRef: model.dopplerLoadRef || model.registryId || model.loadRef,
      action: 'Doppler runtime identity is checked after model load.'
    };
  }
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

const RUN_ACTIVITY_COPY = Object.freeze({
  peer_run_intent_created: 'Request signed',
  peer_provider_discovery_started: 'Finding compatible contributor tabs',
  peer_assignment_planned: 'Contributor tabs matched',
  peer_inference_started: 'Contributor tabs are answering',
  peer_receipts_received: 'Checking returned receipts',
  peer_agreement_verified: 'Agreement verified',
  peer_run_completed: 'Answer verified',
  peer_run_failed: 'Run needs attention'
});

const bindPeerRunSurface = ({
  button,
  prompt,
  form = null,
  policySelect = null,
  modelSelect = null,
  resultId
} = {}) => {
  if (!button || !prompt || !resultId || button.dataset.poolRunBound === 'true') return;
  button.dataset.poolRunBound = 'true';
  const requesterIdentity = createPoolIdentity('requester', {
    localOnly: true,
    namespace: getRequesterIdentityNamespace()
  });
  const requesterClient = createRequesterClient({
    sdk: null,
    identity: requesterIdentity
  });
  const updateRunState = (state, phase = '', message = '') => {
    setPoolRunVisualState({ state, phase, message });
  };
  const handleRunActivity = (activity = {}) => {
    const failed = activity.status === 'peer_run_failed';
    updateRunState(
      failed ? 'error' : activity.status === 'peer_run_completed' ? 'complete' : 'running',
      activity.phase || '',
      RUN_ACTIVITY_COPY[activity.status] || 'Running on the network'
    );
  };
  const submitRunRequest = async () => {
    const promptText = prompt.value.trim();
    if (!promptText) {
      updateRunState('error', 'prompt', 'Enter a prompt to run');
      setResult(resultId, {
        status: 'error',
        error: 'Prompt is required',
        reason: 'The request body is empty.',
        action: 'Enter a prompt, then run again.'
      }, { stream: true });
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const idleLabel = button.textContent;
    button.textContent = 'Running';
    updateRunState('submitting', 'prompt', 'Preparing signed request');
    setResult(resultId, describeSelectedRun({
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
        generationConfig: getPeerGenerationConfig(),
        onActivity: handleRunActivity
      });
      result.inviteUrl = getPeerInviteUrl();
      result.relay = getPeerRelayMode();
      addReceiptLedgerRow({
        ...(result.receiptRecord || result),
        requesterAcceptance: result.requesterAcceptance || null,
        agreement: result.agreement || null
      }, result.receiptHash);
      void refreshServerRoomActivity();
      setResult(resultId, result, { stream: true });
      updateRunState('complete', 'answer', 'Answer verified');
    } catch (error) {
      setResult(resultId, displayPoolError(error, {
        title: 'Request could not complete',
        action: 'Open Contribute in another tab with the same room, start contributing, wait for the tab to say Available, then run again.',
        context: {
          roomId: getPeerRoomId(),
          relay: getPeerRelayMode(),
          model: getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL
        }
      }), { stream: true });
      updateRunState('error', 'error', 'Run needs attention');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = idleLabel;
    }
  };
  const submit = (event) => {
    event?.preventDefault?.();
    void submitRunRequest();
  };
  if (form) form.addEventListener('submit', submit);
  else button.addEventListener('click', submit);
  updateRunState('idle');
};

export const bindRunControls = () => {
  bindPeerRunSurface({
    button: document.getElementById('pool-run-submit'),
    prompt: document.getElementById('pool-run-prompt'),
    policySelect: document.getElementById('pool-run-policy'),
    modelSelect: document.getElementById('pool-run-model'),
    resultId: 'pool-run-result'
  });
};

export const bindHomeAskControls = () => {
  const form = document.getElementById('pool-home-ask-form');
  const input = document.getElementById('pool-home-ask-prompt');
  const button = document.getElementById('pool-home-run-submit');
  if (!form || !input || !button) return;
  bindSuggestedPromptEditing(input);
  bindPeerRunSurface({
    button,
    prompt: input,
    form,
    resultId: 'pool-home-run-result'
  });
};

const createProviderContributionController = () => {
  let peerProviderIdentity = null;
  let peerProviderClient = null;
  let peerProviderNode = null;
  let workerRunning = false;
  let workerStarting = false;
  let lifecycleGeneration = 0;
  let currentModel = null;
  let controls = {
    workerToggleButton: null,
    modelInput: null,
    mount: null
  };

  const getRuntime = () => {
    const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
    window.REPLOID_DOPPLER_RUNTIME = runtime;
    return runtime;
  };

  const getMount = () => controls.mount || document.getElementById('app');

  const getProviderIdentity = () => {
    if (!peerProviderIdentity) {
      peerProviderIdentity = createPoolIdentity('provider', {
        localOnly: true,
        namespace: getProviderIdentityNamespace()
      });
    }
    return peerProviderIdentity;
  };

  const getProviderClient = () => {
    if (!peerProviderClient) {
      peerProviderClient = createProviderClient({
        sdk: null,
        runtime: getRuntime(),
        identity: getProviderIdentity()
      });
    }
    return peerProviderClient;
  };

  const getSelectedModelId = () => (
    controls.modelInput?.value
    || currentModel?.modelId
    || LAUNCH_MODEL.modelId
  );

  const getProviderModel = () => ({
    ...buildLaunchProviderModel({ modelId: getSelectedModelId() })
  });

  const setContributionState = (patch = {}) => {
    updateContributionState({
      roomId: getPeerRoomId(),
      relay: getPeerRelayMode(),
      modelId: currentModel?.modelId || getSelectedModelId(),
      ...patch
    });
    refreshContributionStatusBar();
  };

  const syncWorkerControls = () => {
    if (controls.modelInput && currentModel?.modelId && (workerRunning || workerStarting)) {
      controls.modelInput.value = currentModel.modelId;
    }
    if (controls.workerToggleButton) {
      const active = workerRunning || workerStarting;
      controls.workerToggleButton.disabled = false;
      controls.workerToggleButton.textContent = active ? 'Stop' : 'Start contributing';
      controls.workerToggleButton.dataset.op = active ? '■' : '▶';
      controls.workerToggleButton.dataset.contributionAction = active ? 'stop' : 'start';
      controls.workerToggleButton.setAttribute('aria-pressed', String(active));
      controls.workerToggleButton.classList.toggle('btn-primary', !active);
      controls.workerToggleButton.classList.toggle('btn-ghost', active);
    }
    if (controls.modelInput) controls.modelInput.disabled = workerRunning || workerStarting;
    refreshContributionStatusBar();
  };

  const setProviderStatus = (status) => updateProviderStatus(getMount(), status);

  const syncProviderPanel = () => {
    if (!controls.modelInput && !controls.workerToggleButton) {
      syncWorkerControls();
      return;
    }
    setProviderStatus(workerStarting ? 'Starting' : workerRunning ? 'Available' : 'Idle');
    updateProviderHealth({
      webgpu: navigator.gpu ? 'available' : 'unavailable',
      storage: navigator.storage ? 'available' : 'unknown',
      hardware: 'unknown',
      queue: workerRunning ? 'listening' : 'stopped'
    });
    void refreshProviderStorageHealth();
    syncWorkerControls();
  };

  const modelMatchesLoadedRuntime = (model = {}) => {
    const runtime = getRuntime();
    const loaded = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
    return !!loaded
      && loaded.modelId === model.modelId
      && loaded.modelHash === model.modelHash
      && loaded.manifestHash === model.manifestHash
      && loaded.runtime === model.runtime
      && loaded.backend === model.backend
      && (loaded.workload || model.workload || 'text_generation') === (model.workload || 'text_generation');
  };

  const loadSelectedProviderModel = async () => {
    const runtime = getRuntime();
    setProviderStatus('Starting');
    await refreshProviderStorageHealth();
    updateProviderHealth({
      webgpu: navigator.gpu ? 'available' : 'unavailable',
      model: 'loading',
      artifact: window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT === true ? 'checking' : 'strict_preflight_off',
      queue: 'starting'
    });
    const model = getEnabledPoolModelContract(getSelectedModelId());
    if (!model) throw new Error('Selected model is not enabled for peer contribution');
    currentModel = model;
    const deviceInfo = typeof runtime?.getDeviceInfo === 'function'
      ? await runtime.getDeviceInfo()
      : { hasWebGPU: !!navigator.gpu, features: [] };
    updateProviderHealth({
      webgpu: deviceInfo.hasWebGPU ? 'available' : 'unavailable',
      hardware: formatDeviceLabel(deviceInfo),
      maxBufferSize: deviceInfo.maxBufferSize || null
    });
    const capabilityCheck = validateModelRuntimeCapabilities(model, deviceInfo);
    if (!capabilityCheck.ok) {
      updateProviderHealth({
        webgpu: 'unsupported_model_capability',
        model: 'capability_blocked',
        queue: 'stopped'
      });
      const error = new Error(capabilityCheck.reasons.join('; '));
      error.code = 'model_runtime_capability_unsupported';
      error.payload = {
        model,
        deviceInfo,
        capabilityCheck,
        action: capabilityCheck.action
      };
      throw error;
    }
    if (modelMatchesLoadedRuntime(model) && runtime.isReady?.()) {
      updateProviderHealth({
        model: model.modelId,
        artifact: 'ready',
        trust: 'signed_record'
      });
      return {
        ok: true,
        status: 'model_loaded',
        model: runtime.getModelInfo()
      };
    }
    const artifactPreflight = await probeModelArtifacts(model);
    updateProviderHealth({
      artifact: artifactPreflight.ok ? artifactPreflight.status : 'manifest_unavailable'
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
    const manifestByteHash = artifactPreflight.ok
      ? artifactPreflight.observedHashes?.textHash
      : null;
    const loadResult = await runtime.loadModel({
      ...model,
      ...(manifestByteHash ? { manifestByteHash } : {})
    });
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
      artifact: artifactPreflight.ok ? artifactPreflight.status : 'manifest_unavailable',
      trust: 'signed_record'
    });
    return {
      ...loadResult,
      artifactPreflight,
      status: 'model_loaded'
    };
  };

  const stopPeerProvider = async () => {
    if (!peerProviderNode) return null;
    const node = peerProviderNode;
    peerProviderNode = null;
    return node.stop();
  };

  const handlePeerActivity = (event) => {
    if (event?.status === 'provider_advertised') {
      setProviderStatus('Available');
      updateProviderHealth({ queue: 'listening' });
      setContributionState({ state: 'idle', optedIn: true, lastError: null });
      return;
    }
    if (event?.status === 'peer_session_opening') {
      setProviderStatus('Connecting');
      updateProviderHealth({ queue: 'opening_session' });
      setContributionState({ state: 'working', optedIn: true, lastError: null });
    }
    if (event?.status === 'peer_session_open') {
      setProviderStatus('Answering');
      updateProviderHealth({ queue: 'running_peer_job' });
      setContributionState({ state: 'working', optedIn: true, lastError: null });
    }
    if (event?.status === 'peer_receipt_sent') {
      setProviderStatus('Available');
      updateProviderHealth({
        queue: 'receipt_sent',
        lastReceipt: event.receiptRecord?.receiptHash || 'signed'
      });
      if (event.receiptRecord) {
        recordContributionReceipt(event.receiptRecord, {
          roomId: getPeerRoomId(),
          modelId: currentModel?.modelId || getSelectedModelId()
        });
        addReceiptLedgerRow(event.receiptRecord, event.receiptRecord.receiptHash);
      }
      setContributionState({
        state: 'idle',
        optedIn: true,
        lastReceiptHash: event.receiptRecord?.receiptHash || null,
        lastError: null
      });
    }
    if (event?.status === 'peer_acceptance_received') {
      updateProviderHealth({
        queue: 'accepted',
        reputation: 'local_event_received'
      });
      setContributionState({ state: 'idle', optedIn: true, lastError: null });
    }
    if (event?.status === 'peer_session_failed') {
      setProviderStatus(workerRunning ? 'Available' : 'Idle');
      updateProviderHealth({ queue: 'session_failed' });
      setContributionState({
        state: workerRunning ? 'idle' : 'inactive',
        optedIn: workerRunning,
        lastError: errorString(event.error || event.reason || 'Peer session failed')
      });
    }
    setResult('pool-provider-result', {
      runner: 'peer_room',
      roomId: getPeerRoomId(),
      relay: getPeerRelayMode(),
      inviteUrl: getPeerInviteUrl(),
      ...event
    });
    void refreshServerRoomActivity();
  };

  const ensurePeerProviderReady = async () => {
    const loaded = await loadSelectedProviderModel();
    const runtime = getRuntime();
    const model = loaded.model || runtime.getModelInfo();
    currentModel = model;
    const providerIdentityState = await getProviderIdentity().resolve();
    await stopPeerProvider();
    const node = createPeerProviderNode({
      roomId: getPeerRoomId(),
      providerClient: getProviderClient(),
      roomBusFactory: getPeerRoomBusFactory(),
      onActivity: handlePeerActivity
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

  const startWorker = async () => {
    if (workerRunning || workerStarting) return;
    const generation = ++lifecycleGeneration;
    workerStarting = true;
    setContributionState({ state: 'starting', optedIn: true, lastError: null });
    syncWorkerControls();
    setResult('pool-provider-result', {
      runner: 'peer_room_starting',
      roomId: getPeerRoomId(),
      model: getProviderModel()
    });
    setProviderStatus('Starting');
    try {
      const ready = await ensurePeerProviderReady();
      if (generation !== lifecycleGeneration) {
        await stopPeerProvider().catch(() => null);
        return;
      }
      workerStarting = false;
      workerRunning = true;
      setProviderStatus('Available');
      updateProviderHealth({ queue: 'listening' });
      setContributionState({ state: 'idle', optedIn: true, lastError: null });
      setResult('pool-provider-result', {
        runner: 'peer_room_listening',
        relay: getPeerRelayMode(),
        inviteUrl: getPeerInviteUrl(),
        ...ready
      });
    } catch (error) {
      if (generation !== lifecycleGeneration) return;
      await stopPeerProvider().catch(() => null);
      workerStarting = false;
      workerRunning = false;
      setProviderStatus('Idle');
      updateProviderHealth({ queue: 'stopped', model: 'load_failed' });
      setContributionState({
        state: 'error',
        optedIn: false,
        lastError: errorString(error)
      });
      setResult('pool-provider-result', displayPoolError(error, {
        title: 'This tab could not start',
        action: 'Load a compatible model first. If the manifest URL is missing, deploy the model artifacts or attach a Doppler runtime handle.',
        context: {
          runner: 'stopped',
          roomId: getPeerRoomId(),
          relay: getPeerRelayMode(),
          model: getProviderModel()
        }
      }));
      document.getElementById('pool-provider-details')?.setAttribute('open', '');
    } finally {
      if (generation === lifecycleGeneration) syncWorkerControls();
    }
  };

  const stopWorker = async () => {
    lifecycleGeneration += 1;
    controls.workerToggleButton?.setAttribute('disabled', 'true');
    const stopped = await stopPeerProvider().catch((error) => ({
      error: error.message,
      payload: error.payload || null
    }));
    workerStarting = false;
    workerRunning = false;
    setProviderStatus('Idle');
    updateProviderHealth({ queue: 'stopped' });
    setContributionState({ state: 'inactive', optedIn: false, lastError: null });
    setResult('pool-provider-result', { runner: 'stopped', peer: stopped });
    syncWorkerControls();
  };

  return {
    attachControls(nextControls = {}) {
      controls = {
        workerToggleButton: nextControls.workerToggleButton || null,
        modelInput: nextControls.modelInput || null,
        mount: nextControls.mount || controls.mount || document.getElementById('app')
      };
      if (controls.modelInput && currentModel?.modelId) controls.modelInput.value = currentModel.modelId;
      if (controls.workerToggleButton && controls.workerToggleButton.dataset.poolContributionBound !== 'true') {
        controls.workerToggleButton.dataset.poolContributionBound = 'true';
        controls.workerToggleButton.addEventListener('click', () => {
          if (workerRunning || workerStarting) void stopWorker();
          else void startWorker();
        });
      }
      syncProviderPanel();
    }
  };
};

let providerContributionController = null;

const getProviderContributionController = () => {
  if (!providerContributionController) {
    providerContributionController = createProviderContributionController();
  }
  return providerContributionController;
};

export const bindProviderControls = () => {
  getProviderContributionController().attachControls({
    workerToggleButton: document.getElementById('pool-provider-worker-toggle'),
    modelInput: document.getElementById('pool-provider-model'),
    mount: document.getElementById('app')
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
  void refreshServerRoomActivity();
  button.addEventListener('click', async () => {
    const receiptHash = input.value.trim();
    if (!receiptHash) {
      setResult('pool-receipt-result', { error: 'Hash is required' });
      return;
    }
    button.disabled = true;
    try {
      const record = findReceiptLedgerRecord(receiptHash);
      if (!record) {
        setResult('pool-receipt-result', {
          status: 'not_found',
          receiptHash,
          action: 'Submit a local peer-room job first, then inspect Records from this browser.'
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
