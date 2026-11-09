import { createDopplerRuntime } from '../pool/doppler-runtime.js';
import { createProviderClient } from '../pool/provider-client.js';
import { createPeerProviderNode } from '../pool/peer-room.js';
import { createPublishedAdapterOriginFetcher, listFetchableAdapterPublications } from '../pool/adapter-registry.js';
import { adapterRequirementFromPublication } from '../pool/adapter-publication.js';
import { listPolicies } from '../pool/policy-router.js';
import { createPoolSdk } from '../../../shared/pool/sdk.js';
import { createPoolIdentity } from '../../../shared/pool/identity.js';
import { getPoolRtcConfig } from '../../../shared/pool/rtc-config.js';
import { LAUNCH_MODEL, POOLDAY_MODEL_WORKLOADS, buildLaunchProviderModel, getEnabledPoolModelContract, validateModelRuntimeCapabilities } from '../../../shared/pool/model-contract.js';
import { PARTICIPATION_MODES, readParticipationPreferences, writeParticipationPreferences } from '../../../shared/pool/participation-profile.js';
import { getPeerRoomId, getPeerRelayMode, getPeerRoomBusFactory } from './product-context.js';
import { assessPoolDeviceCapability, resolveCapabilityAvailabilityLimits } from './device-capability.js';
import { probeModelArtifacts, supportsAdapterPublications } from './model-artifact-probe.js';
import { readContributionResumeIntent, writeContributionResumeIntent, clearContributionResumeIntent } from './contribution-resume.js';
const POOL_ADAPTER_DISCOVERY_TIMEOUT_MS = 5000;
const POOL_PROVIDER_ACTIVITY_HISTORY_LIMIT = 64;
const errorString = error => String(error?.message || error?.error || error || 'Unknown error');
const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(message)), timeoutMs);
  promise.then(resolve, reject).finally(() => clearTimeout(timer));
});

export const createProviderContributionSession = (ports) => {
  const { getProviderIdentityNamespace, refreshContributionStatusBar, updateProviderHealth,
    refreshProviderStorageHealth, formatDeviceLabel, recordContributionReceipt, addReceiptLedgerRow,
    updateContributionState, setResult, refreshServerRoomActivity, refreshParticipationControls, displayPoolError,
    getPeerInviteUrl, canContributeWith } = ports;
  let peerProviderIdentity = null;
  let peerProviderClient = null;
  let peerProviderNode = null;
  let workerRunning = false;
  let workerStarting = false;
  let lifecycleGeneration = 0;
  let currentModel = null;
  let requestedModelId = null;
  let workerStartPromise = null;
  let providerReadyState = null;
  let latestProviderActivity = null;
  let latestRelayActivity = null;
  let providerActivityHistory = [];
  let restoreAttempted = false;
  const adapterSdk = createPoolSdk();
  const fetchAdapterFromOrigin = createPublishedAdapterOriginFetcher({ sdk: adapterSdk });

  const getRuntime = () => {
    const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
    window.REPLOID_DOPPLER_RUNTIME = runtime;
    return runtime;
  };


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
        identity: getProviderIdentity(),
        fetchAdapterFromOrigin
      });
    }
    return peerProviderClient;
  };

  const getSelectedModelId = () => (
    requestedModelId
    || ports.getSelectedModelId()
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

  const syncWorkerControls = () => ports.renderControls({ workerRunning, workerStarting, modelId: currentModel?.modelId });
  const setProviderStatus = ports.setProviderStatus;
  const setProviderNotice = ports.setProviderNotice;

  const syncProviderPanel = () => {
    if (!ports.hasControls()) {
      syncWorkerControls();
      return;
    }
    setProviderStatus(workerStarting ? 'Starting' : workerRunning ? 'Available' : 'Idle');
    if (workerStarting || workerRunning) setProviderNotice(null);
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
      && (loaded.workload || model.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding) === (model.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding);
  };

  const loadSelectedProviderModel = async (generation) => {
    const runtime = getRuntime();
    setProviderStatus('Starting');
    await refreshProviderStorageHealth();
    if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
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
    if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
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
    if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
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
    if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
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
    const result = await node.stop();
    if (peerProviderNode === node) peerProviderNode = null;
    return result;
  };

  const handlePeerActivity = (event) => {
    providerActivityHistory.push(event);
    if (providerActivityHistory.length > POOL_PROVIDER_ACTIVITY_HISTORY_LIMIT) {
      providerActivityHistory = providerActivityHistory.slice(-POOL_PROVIDER_ACTIVITY_HISTORY_LIMIT);
    }
    const isRelayActivity = String(event?.status || '').startsWith('relay-');
    if (isRelayActivity) latestRelayActivity = event;
    else if (event?.status !== 'provider_advertised') latestProviderActivity = event;
    if (event?.status === 'relay-publish-retrying'
      || event?.status === 'relay-poll-failed'
      || event?.status === 'relay-dispatch-retrying') {
      setProviderStatus('Relay retrying');
      updateProviderHealth({ queue: 'relay_retrying' });
    }
    if (event?.status === 'relay-circuit-open') {
      setProviderStatus('Relay unavailable');
      updateProviderHealth({ queue: 'relay_unavailable' });
    }
    if (event?.status === 'relay-circuit-half-open') {
      setProviderStatus('Checking relay');
      updateProviderHealth({ queue: 'relay_recovery_check' });
    }
    if (event?.status === 'relay-circuit-closed') {
      setProviderStatus(workerRunning ? 'Available' : 'Starting');
      updateProviderHealth({ queue: workerRunning ? 'listening' : 'starting' });
    }
    if (event?.status === 'provider_advertised') {
      // Periodic discovery publication does not settle an executing job or an error.
      if (!latestProviderActivity) {
        setProviderStatus('Available');
        updateProviderHealth({ queue: 'listening' });
        setContributionState({ state: 'idle', optedIn: true, lastError: null });
      }
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
    if (event?.status === 'peer_execution_started') {
      setProviderStatus('Computing');
      updateProviderHealth({ queue: 'executing_peer_job' });
      setContributionState({ state: 'working', optedIn: true, lastError: null });
    }
    if (event?.status === 'peer_execution_abandoned') {
      const stillComputing = Number(event.activeExecutionCount || 0) > 0;
      const queued = Number(event.queueDepth || 0) > 0;
      setProviderStatus(stillComputing ? 'Computing' : queued ? 'Queued' : workerRunning ? 'Available' : 'Idle');
      updateProviderHealth({
        queue: stillComputing
          ? 'executing_peer_job'
          : queued
            ? 'queued_peer_job'
            : workerRunning
              ? 'listening'
              : 'inactive'
      });
      setContributionState({
        state: stillComputing || queued ? 'working' : workerRunning ? 'idle' : 'inactive',
        optedIn: workerRunning,
        lastError: event.outcome === 'failed' ? errorString(event.error) : null
      });
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
      ...(providerReadyState || {}),
      runner: providerReadyState ? 'peer_room_listening' : 'peer_room',
      roomId: getPeerRoomId(),
      relay: getPeerRelayMode(),
      inviteUrl: getPeerInviteUrl(),
      ...(latestProviderActivity || {}),
      latestRelayActivity,
      activityHistory: providerActivityHistory
    });
    void refreshServerRoomActivity();
  };

  const ensurePeerProviderReady = async (generation) => {
    const runtime = getRuntime();
    const capabilityProfile = await assessPoolDeviceCapability({ runtime });
    if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
    const selectedEligibility = capabilityProfile.modelEligibility.find((entry) => (
      entry.modelId === getSelectedModelId()
    ));
    if (!selectedEligibility?.eligible) {
      const error = new Error(selectedEligibility?.reasons?.join('; ') || 'This device did not qualify for the selected model');
      error.code = 'device_capability_model_ineligible';
      error.payload = {
        capabilityProfile,
        selectedModelId: getSelectedModelId(),
        action: 'Choose an eligible model or request work from another contributor.'
      };
      throw error;
    }
    updateProviderHealth({
      capability: `${capabilityProfile.tier.id}_${capabilityProfile.score}`,
      hardware: formatDeviceLabel(capabilityProfile.deviceInfo)
    });
    const loaded = await loadSelectedProviderModel(generation);
    if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
    const model = loaded.model || runtime.getModelInfo();
    currentModel = model;
    const participation = readParticipationPreferences();
    let adapterPacks = [];
    if (participation.permissions.relayArtifacts && supportsAdapterPublications(model)) {
      try {
        const publications = await withTimeout(
          listFetchableAdapterPublications({ sdk: adapterSdk, model }),
          Number(window.REPLOID_POOL_ADAPTER_DISCOVERY_TIMEOUT_MS || POOL_ADAPTER_DISCOVERY_TIMEOUT_MS),
          'Adapter publication discovery timed out'
        );
        if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
        const maxArtifactBytes = participation.limits.storageBudgetMiB * 1024 * 1024;
        adapterPacks = publications.filter((publication) => (
          Number(publication.pack?.adapter?.bytes || 0) <= maxArtifactBytes
        )).map((publication) => (
          adapterRequirementFromPublication(publication, { state: 'fetchable' })
        ));
        updateProviderHealth({ adapters: adapterPacks.length ? `${adapterPacks.length}_fetchable` : 'none' });
      } catch (error) {
        if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
        updateProviderHealth({ adapters: 'registry_unavailable', adapterRegistryError: errorString(error) });
      }
    } else if (!participation.permissions.relayArtifacts) {
      updateProviderHealth({ adapters: 'relay_disabled' });
    } else {
      updateProviderHealth({ adapters: 'not_applicable' });
    }
    const providerIdentityState = await getProviderIdentity().resolve();
    if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
    const capabilityLimits = resolveCapabilityAvailabilityLimits(participation, capabilityProfile);
    await stopPeerProvider();
    if (generation !== undefined && generation !== lifecycleGeneration) throw new Error('Aborted');
    const node = createPeerProviderNode({
      roomId: getPeerRoomId(),
      providerClient: getProviderClient(),
      roomBusFactory: getPeerRoomBusFactory(),
      relayAckSigner: getProviderClient().createRelayAcknowledgement.bind(getProviderClient()),
      rtcConfigProvider: getPeerRelayMode() === 'server' && window.REPLOID_POOL_FORCE_RELAY === true
        ? () => getPoolRtcConfig({ sdk: adapterSdk, forceRelay: true })
        : null,
      onActivity: (event) => {
        if (generation !== undefined && generation !== lifecycleGeneration) return;
        handlePeerActivity(event);
      }
    });
    peerProviderNode = node;
    const result = await node.start({
      models: [{ ...model, adapterPacks }],
      availability: {
        ...capabilityLimits,
        acceptedPolicies: listPolicies().map((policy) => policy.policyId),
        artifactRelay: participation.permissions.relayArtifacts,
        resultVerification: participation.permissions.verifyResults,
        storageBudgetMiB: participation.limits.storageBudgetMiB,
        bandwidthBudgetMbps: participation.limits.bandwidthBudgetMbps,
        activeJobs: 0
      }
    });
    return {
      identity: providerIdentityState,
      capabilityProfile,
      runtime: runtime.getRuntimeInfo?.() || loaded.runtime || null,
      transport: 'webrtc_peer_room',
      ...result
    };
  };

  const startWorker = async () => {
    if (workerRunning) {
      return {
        ok: true,
        status: 'peer_room_listening',
        model: currentModel
      };
    }
    if (workerStartPromise) return workerStartPromise;
    workerStartPromise = (async () => {
      const participation = readParticipationPreferences();
      if (!canContributeWith(participation)) {
        writeParticipationPreferences({ ...participation, mode: PARTICIPATION_MODES.both });
        await refreshParticipationControls(readParticipationPreferences());
      }
      const generation = ++lifecycleGeneration;
      providerReadyState = null;
      latestProviderActivity = null;
      latestRelayActivity = null;
      providerActivityHistory = [];
      workerStarting = true;
      setContributionState({ state: 'starting', optedIn: true, lastError: null });
      syncWorkerControls();
      setResult('pool-provider-result', {
        runner: 'peer_room_starting',
        roomId: getPeerRoomId(),
        model: getProviderModel()
      });
      setProviderStatus('Starting');
      setProviderNotice(null);
      try {
        const ready = await ensurePeerProviderReady(generation);
        if (generation !== lifecycleGeneration) {
          await stopPeerProvider().catch(() => null);
          return {
            ok: false,
            status: 'aborted'
          };
        }
        workerStarting = false;
        workerRunning = true;
        providerReadyState = ready;
        writeContributionResumeIntent({ modelId: currentModel?.modelId || getSelectedModelId() });
        setProviderStatus('Available');
        setProviderNotice(null);
        updateProviderHealth({ queue: 'listening' });
        setContributionState({ state: 'idle', optedIn: true, lastError: null });
        setResult('pool-provider-result', {
          runner: 'peer_room_listening',
          relay: getPeerRelayMode(),
          inviteUrl: getPeerInviteUrl(),
          ...ready
        });
        return {
          ok: true,
          status: 'peer_room_listening',
          ...ready
        };
      } catch (error) {
        if (generation !== lifecycleGeneration) {
          return {
            ok: false,
            status: 'aborted',
            error
          };
        }
        await stopPeerProvider().catch(() => null);
        workerStarting = false;
        workerRunning = false;
        providerReadyState = null;
        clearContributionResumeIntent();
        setProviderStatus('Could not start');
        setProviderNotice({
          state: 'error',
          title: error?.code === 'doppler_model_load_failed' ? 'Model failed to load' : 'Sharing could not start',
          message: 'Nothing was shared. Check the model and browser GPU support, then choose Start sharing to retry.'
        });
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
        return {
          ok: false,
          status: 'error',
          error
        };
      } finally {
        if (generation === lifecycleGeneration) syncWorkerControls();
      }
    })();
    try {
      return await workerStartPromise;
    } finally {
      workerStartPromise = null;
    }
  };

  const stopWorker = async () => {
    lifecycleGeneration += 1;
    ports.setStopping();
    const runtime = getRuntime();
    const cancellation = await runtime.cancelActiveWork?.({ reason: 'provider_stopped' }).catch((error) => ({
      ok: false,
      status: 'cancellation_failed',
      reason: error.message
    })) || null;
    workerStarting = false;
    workerRunning = false;
    providerReadyState = null;
    latestProviderActivity = null;
    latestRelayActivity = null;
    providerActivityHistory = [];
    clearContributionResumeIntent();
    setProviderStatus('Stopping');
    setProviderNotice(null);
    updateProviderHealth({ queue: 'cancelling_active_work' });
    setContributionState({ state: 'inactive', optedIn: false, lastError: null });
    setResult('pool-provider-result', {
      runner: 'stopping',
      peer: { status: 'peer_provider_stopping' },
      cancellation
    });
    const stopped = await stopPeerProvider().catch((error) => ({
      error: error.message,
      payload: error.payload || null
    }));
    const runtimeClosed = await runtime.close?.({ cancellation }).catch((error) => ({
      error: error.message
    }));
    setProviderStatus('Idle');
    setProviderNotice(null);
    updateProviderHealth({ queue: 'stopped' });
    setResult('pool-provider-result', {
      runner: 'stopped',
      peer: stopped,
      cancellation,
      runtime: runtimeClosed || null
    });
    syncWorkerControls();
  };

  let preferenceApplyPromise = Promise.resolve();

  const restorePersistedContribution = async () => {
    if (restoreAttempted || workerRunning || workerStarting) return null;
    restoreAttempted = true;
    const intent = readContributionResumeIntent();
    const participation = readParticipationPreferences();
    if (!intent || !canContributeWith(participation)) return null;
    if (intent.roomId !== getPeerRoomId() || intent.relay !== getPeerRelayMode()) return null;
    const model = getEnabledPoolModelContract(intent.modelId);
    if (!model) {
      clearContributionResumeIntent();
      return null;
    }
    requestedModelId = model.modelId;
    ports.selectModel(model.modelId);
    return startWorker();
  };

  return {
    attach() { syncProviderPanel(); void restorePersistedContribution(); },
    resume() { restoreAttempted = false; return restorePersistedContribution(); },
    toggle() { return workerRunning || workerStarting ? stopWorker() : startWorker(); },
    async startForModel(modelId) {
      const model = getEnabledPoolModelContract(modelId);
      if (!model) {
        const error = new Error('Selected model is not enabled for peer contribution');
        error.code = 'peer_provider_model_disabled';
        throw error;
      }
      if (workerRunning && currentModel?.modelId !== model.modelId) {
        await stopWorker();
      }
      requestedModelId = model.modelId;
      ports.selectModel(model.modelId);
      const result = await startWorker();
      if (!result?.ok) {
        throw result?.error || new Error('This browser did not become available to the room');
      }
      return result;
    },
    async applyParticipationPreferences(previous, next) {
      preferenceApplyPromise = preferenceApplyPromise.then(async () => {
        if (!workerRunning && !workerStarting) {
          syncProviderPanel();
          return;
        }
        if (!canContributeWith(next)) {
          await stopWorker();
          return;
        }
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
          await stopWorker();
          await startWorker();
        }
      }).catch(() => {});
      await preferenceApplyPromise;
    },
    async handleModelChange() {
      const nextModelId = ports.getSelectedModelId() || null;
      const activeModelId = requestedModelId || currentModel?.modelId || null;
      requestedModelId = nextModelId;
      if ((workerRunning || workerStarting) && nextModelId !== activeModelId) {
        await stopWorker();
        await startWorker();
      }
    },
    async dispose({ preserveResumeIntent = true } = {}) {
      lifecycleGeneration += 1;
      await stopPeerProvider();
      workerStarting = false;
      workerRunning = false;
      workerStartPromise = null;
      providerReadyState = null;
      latestProviderActivity = null;
      latestRelayActivity = null;
      providerActivityHistory = [];
      if (!preserveResumeIntent) clearContributionResumeIntent();
    }
  };
};
