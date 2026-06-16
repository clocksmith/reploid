/**
 * @fileoverview Route control bindings for the Reploid product home.
 */

import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createAgentClient } from '../../pool/agent-client.js';
import { createProviderClient } from '../../pool/provider-client.js';
import { verifyModelArtifactManifest } from '../../pool/model-artifacts.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import { LAUNCH_MODEL, buildLaunchProviderModel, getEnabledPoolModelContract } from '../../pool/model-contract.js';
import { createPoolIdentity } from '../../pool/identity.js';
import { FASTEST_RECEIPT_POLICY_ID, listPolicies } from '../../pool/policy-router.js';
import { createPeerProviderNode, runPeerJob } from '../../pool/peer-room.js';
import { verifyReceiptRecord } from '../../pool/sdk.js';
import { PROVIDER_WORKER_INTERVAL_MS } from './constants.js';
import {
  addReceiptLedgerRow,
  describeSelectedRun,
  getNodeGrid,
  getPeerInviteUrl,
  getPeerRelayMode,
  getPeerRoomBusFactory,
  getPeerRoomId,
  refreshProviderStorageHealth,
  renderReceiptLedger,
  setNodeGridProgress,
  setResult,
  updateProviderHealth,
  updateProviderStatus
} from './view.js';

export const bindRunControls = (sdk) => {
  const button = document.getElementById('pool-run-submit');
  const pollButton = document.getElementById('pool-run-poll');
  const acceptButton = document.getElementById('pool-run-accept');
  const rejectButton = document.getElementById('pool-run-reject');
  const prompt = document.getElementById('pool-run-prompt');
  const policySelect = document.getElementById('pool-run-policy');
  const modelSelect = document.getElementById('pool-run-model');
  const maxSpendInput = document.getElementById('pool-run-max-spend');
  if (!button || !prompt) return;
  const requesterIdentity = createPoolIdentity('requester', { localOnly: true });
  const requesterClient = createRequesterClient({
    sdk,
    identity: requesterIdentity
  });
  let lastJobId = null;
  let lastReceiptHash = null;
  let lastPeerResult = null;
  const syncReceiptActions = () => {
    const canDecide = !!lastReceiptHash && !lastPeerResult;
    if (acceptButton) acceptButton.disabled = !canDecide;
    if (rejectButton) rejectButton.disabled = !canDecide;
  };
  syncReceiptActions();
  button.addEventListener('click', async () => {
    button.disabled = true;
    lastJobId = null;
    lastReceiptHash = null;
    lastPeerResult = null;
    syncReceiptActions();
    setResult('pool-run-result', describeSelectedRun({
      status: 'finding_peer_provider',
      policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
      modelId: modelSelect?.value || LAUNCH_MODEL.modelId
    }), { stream: true });
    try {
      const result = await runPeerJob({
        roomId: getPeerRoomId(),
        requesterClient,
        prompt: prompt.value,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelRequirements: getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL,
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null,
        roomBusFactory: getPeerRoomBusFactory(sdk),
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
      lastJobId = result?.assignment?.jobId || null;
      lastReceiptHash = result?.receiptHash || null;
      syncReceiptActions();
      setResult('pool-run-result', result, { stream: true });
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      button.disabled = false;
    }
  });
  pollButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-run-result', lastPeerResult, { stream: true });
      return;
    }
    if (!lastJobId) {
      setResult('pool-run-result', { error: 'No submitted job to poll' });
      return;
    }
    pollButton.disabled = true;
    try {
      const result = await requesterClient.pollJob(lastJobId);
      lastReceiptHash = result?.job?.receiptHash || lastReceiptHash;
      syncReceiptActions();
      setResult('pool-run-result', result, { stream: true });
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      pollButton.disabled = false;
    }
  });
  acceptButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-run-result', lastPeerResult, { stream: true });
      return;
    }
    if (!lastReceiptHash) {
      setResult('pool-run-result', { error: 'No verifier-accepted receipt to accept' }, { stream: true });
      return;
    }
    acceptButton.disabled = true;
    try {
      setResult('pool-run-result', await requesterClient.acceptReceipt(lastReceiptHash, true));
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      acceptButton.disabled = false;
    }
  });
  rejectButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-run-result', { error: 'Peer receipt already has a local requester decision', result: lastPeerResult }, { stream: true });
      return;
    }
    if (!lastReceiptHash) {
      setResult('pool-run-result', { error: 'No verifier-accepted receipt to reject' }, { stream: true });
      return;
    }
    rejectButton.disabled = true;
    try {
      setResult('pool-run-result', await requesterClient.acceptReceipt(lastReceiptHash, false));
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      rejectButton.disabled = false;
    }
  });
};

export const bindAgentControls = (sdk) => {
  const submitButton = document.getElementById('pool-agent-submit');
  const pollButton = document.getElementById('pool-agent-poll');
  const acceptButton = document.getElementById('pool-agent-accept');
  const rejectButton = document.getElementById('pool-agent-reject');
  const prompt = document.getElementById('pool-agent-prompt');
  const policySelect = document.getElementById('pool-agent-policy');
  const maxSpendInput = document.getElementById('pool-agent-max-spend');
  if (!submitButton || !prompt) return;
  const agentIdentity = createPoolIdentity('agent', { localOnly: true });
  const agentClient = createAgentClient({
    sdk,
    identity: agentIdentity,
    pointBudget: 0
  });
  let lastJobId = null;
  let lastReceiptHash = null;
  let lastPeerResult = null;
  submitButton.addEventListener('click', async () => {
    submitButton.disabled = true;
    lastJobId = null;
    lastReceiptHash = null;
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
        roomBusFactory: getPeerRoomBusFactory(sdk),
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
      lastJobId = result?.assignment?.jobId || null;
      lastReceiptHash = result?.receiptHash || null;
      setResult('pool-agent-result', result);
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      submitButton.disabled = false;
    }
  });
  pollButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-agent-result', lastPeerResult);
      return;
    }
    if (!lastJobId) {
      setResult('pool-agent-result', { error: 'No submitted agent job to poll' });
      return;
    }
    pollButton.disabled = true;
    try {
      const result = await agentClient.pollJob(lastJobId);
      lastReceiptHash = result?.job?.receiptHash || lastReceiptHash;
      setResult('pool-agent-result', result);
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      pollButton.disabled = false;
    }
  });
  acceptButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-agent-result', lastPeerResult);
      return;
    }
    if (!lastReceiptHash) {
      setResult('pool-agent-result', { error: 'No verifier-accepted receipt to accept' });
      return;
    }
    acceptButton.disabled = true;
    try {
      setResult('pool-agent-result', await agentClient.acceptReceipt(lastReceiptHash, true));
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      acceptButton.disabled = false;
    }
  });
  rejectButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-agent-result', { error: 'Peer receipt already has a local agent decision', result: lastPeerResult });
      return;
    }
    if (!lastReceiptHash) {
      setResult('pool-agent-result', { error: 'No verifier-accepted receipt to reject' });
      return;
    }
    rejectButton.disabled = true;
    try {
      setResult('pool-agent-result', await agentClient.acceptReceipt(lastReceiptHash, false));
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      rejectButton.disabled = false;
    }
  });
};

export const bindProviderControls = (sdk) => {
  const loadButton = document.getElementById('pool-provider-load');
  const profileButton = document.getElementById('pool-provider-profile');
  const registerButton = document.getElementById('pool-provider-register');
  const heartbeatButton = document.getElementById('pool-provider-heartbeat');
  const nextButton = document.getElementById('pool-provider-next');
  const executeButton = document.getElementById('pool-provider-execute');
  const stepButton = document.getElementById('pool-provider-step');
  const workerStartButton = document.getElementById('pool-provider-worker-start');
  const workerStopButton = document.getElementById('pool-provider-worker-stop');
  const pointsButton = document.getElementById('pool-provider-points');
  const reputationButton = document.getElementById('pool-provider-reputation');
  const modelInput = document.getElementById('pool-provider-model');
  if (!registerButton || !nextButton || !modelInput) return;
  const providerIdentity = createPoolIdentity('provider');
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
  const providerClient = createProviderClient({
    sdk,
    runtime,
    identity: providerIdentity
  });
  const peerProviderClient = createProviderClient({
    sdk,
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
    if (!model) throw new Error('Selected model is not enabled for provider registration');
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
    let artifactPreflight = null;
    if (window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT === true) {
      artifactPreflight = await verifyModelArtifactManifest({ model });
    }
    const loadResult = await runtime.loadModel(model);
    if (!loadResult?.ok || !runtime.isReady?.() || !modelMatchesLoadedRuntime(model)) {
      const reason = loadResult?.reason || 'Doppler runtime did not expose the selected model after load';
      const error = new Error(`Doppler model load failed: ${reason}`);
      error.payload = {
        model,
        loadResult,
        loadState: runtime.getLoadState?.() || null
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
  const ensureProviderReady = async () => {
    const loaded = await loadSelectedProviderModel();
    const model = loaded.model || runtime.getModelInfo();
    const providerIdentityState = await providerIdentity.resolve();
    const result = await providerClient.register({
      models: [model],
      device: {
        hasWebGPU: !!navigator.gpu,
        browserSurface: 'pool_provider_ui'
      },
      availability: {
        maxConcurrentJobs: 1,
        maxTokensPerJob: 128,
        acceptedPolicies: listPolicies().map((policy) => policy.policyId)
      },
    });
    return {
      identity: providerIdentityState,
      registration: result
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
      roomBusFactory: getPeerRoomBusFactory(sdk),
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
  let lastAssignment = null;
  let workerRunning = false;
  let workerTimer = null;
  const syncWorkerButtons = () => {
    if (workerStartButton) workerStartButton.disabled = workerRunning;
    if (workerStopButton) workerStopButton.disabled = !workerRunning;
  };
  const stopWorker = () => {
    workerRunning = false;
    if (workerTimer) window.clearTimeout(workerTimer);
    workerTimer = null;
    syncWorkerButtons();
    updateProviderStatus(mount, 'NODE // OFFLINE');
    setNodeGridProgress(nodeGrid, 0);
  };
  const runWorkerLoop = async () => {
    if (!workerRunning) return;
    try {
      const result = await providerClient.runWorkerStep();
      lastAssignment = result?.status === 'executed_assignment' ? null : result?.assignment || lastAssignment;
      setResult('pool-provider-result', {
        runner: 'running',
        ...result
      });
      if (workerRunning) {
        workerTimer = window.setTimeout(runWorkerLoop, PROVIDER_WORKER_INTERVAL_MS);
      }
    } catch (error) {
      stopWorker();
      setResult('pool-provider-result', { runner: 'stopped', error: error.message, payload: error.payload || null });
    }
  };
  loadButton?.addEventListener('click', async () => {
    loadButton.disabled = true;
    setResult('pool-provider-result', { status: 'loading_model', model: getProviderModel() });
    try {
      setResult('pool-provider-result', await loadSelectedProviderModel());
      setNodeGridProgress(nodeGrid, 0.8);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
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
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      profileButton.disabled = false;
    }
  });
  registerButton.addEventListener('click', async () => {
    registerButton.disabled = true;
    try {
      setResult('pool-provider-result', { status: 'registering', model: getProviderModel() });
      setResult('pool-provider-result', await ensureProviderReady());
      setNodeGridProgress(nodeGrid, 1);
      updateProviderStatus(mount, 'NODE // SPAWNED');
      updateProviderHealth({ queue: 'hosted_registered' });
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
      updateProviderHealth({ queue: 'hosted_register_failed' });
      updateProviderStatus(mount, 'NODE // OFFLINE');
      setNodeGridProgress(nodeGrid, 0);
    } finally {
      registerButton.disabled = false;
    }
  });
  nextButton.addEventListener('click', async () => {
    nextButton.disabled = true;
    try {
      const result = await providerClient.nextAssignment();
      lastAssignment = result?.assignment || null;
      updateProviderHealth({ queue: lastAssignment ? 'hosted_assignment_ready' : 'hosted_queue_empty' });
      setResult('pool-provider-result', result);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      nextButton.disabled = false;
    }
  });
  heartbeatButton?.addEventListener('click', async () => {
    heartbeatButton.disabled = true;
    try {
      const result = await providerClient.heartbeat();
      updateProviderHealth({ queue: result?.status || 'hosted_heartbeat_sent' });
      setResult('pool-provider-result', result);
    } catch (error) {
      updateProviderHealth({ queue: 'hosted_heartbeat_failed' });
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      heartbeatButton.disabled = false;
    }
  });
  executeButton?.addEventListener('click', async () => {
    if (!lastAssignment) {
      setResult('pool-provider-result', { error: 'No assignment to execute' });
      return;
    }
    executeButton.disabled = true;
    try {
      setResult('pool-provider-result', await providerClient.executeAssignment(lastAssignment, {
        commitReveal: 'auto'
      }));
      updateProviderHealth({ queue: 'hosted_assignment_executed' });
      lastAssignment = null;
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      executeButton.disabled = false;
    }
  });
  stepButton?.addEventListener('click', async () => {
    stepButton.disabled = true;
    try {
      const result = await providerClient.runWorkerStep();
      lastAssignment = result?.status === 'executed_assignment' ? null : result?.assignment || lastAssignment;
      updateProviderHealth({ queue: result?.status || 'hosted_step_complete' });
      setResult('pool-provider-result', result);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      stepButton.disabled = false;
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
      setResult('pool-provider-result', { runner: 'stopped', error: error.message, payload: error.payload || null });
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
  pointsButton?.addEventListener('click', async () => {
    pointsButton.disabled = true;
    try {
      const identity = await providerIdentity.resolve();
      setResult('pool-provider-result', await sdk.points(identity.roleId));
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      pointsButton.disabled = false;
    }
  });
  reputationButton?.addEventListener('click', async () => {
    reputationButton.disabled = true;
    try {
      const identity = await providerIdentity.resolve();
      const reputation = await sdk.reputation(identity.roleId);
      updateProviderHealth({ reputation: reputation?.providerId || reputation?.record?.providerId || 'loaded' });
      setResult('pool-provider-result', reputation);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      reputationButton.disabled = false;
    }
  });
};

export const bindReceiptControls = (sdk) => {
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
      const record = await sdk.getReceipt(receiptHash);
      addReceiptLedgerRow(record, receiptHash);
      if (ledgerContainer) {
        ledgerContainer.innerHTML = renderReceiptLedger();
      }
      setResult('pool-receipt-result', {
        ...record,
        localVerification: await verifyReceiptRecord(record)
      });
    } catch (error) {
      setResult('pool-receipt-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
};

export const bindReputationControls = (sdk) => {
  const button = document.getElementById('pool-reputation-lookup');
  const statusButton = document.getElementById('pool-status-lookup');
  const metricsButton = document.getElementById('pool-metrics-lookup');
  const deploymentButton = document.getElementById('pool-deployment-check');
  const input = document.getElementById('pool-reputation-provider');
  if (!button || !input) return;
  const providerIdentity = createPoolIdentity('provider');
  providerIdentity.resolve().then((identity) => {
    input.value = identity.roleId;
  }).catch(() => {});
  button.addEventListener('click', async () => {
    const providerId = input.value.trim();
    if (!providerId) {
      setResult('pool-reputation-result', { error: 'Provider id is required' });
      return;
    }
    button.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.reputation(providerId));
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
  metricsButton?.addEventListener('click', async () => {
    metricsButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.metrics());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      metricsButton.disabled = false;
    }
  });
  statusButton?.addEventListener('click', async () => {
    statusButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.status());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      statusButton.disabled = false;
    }
  });
  deploymentButton?.addEventListener('click', async () => {
    deploymentButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.deploymentCheck());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      deploymentButton.disabled = false;
    }
  });
};
