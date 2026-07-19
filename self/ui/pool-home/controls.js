/**
 * @fileoverview Route control bindings for the Reploid product home.
 */

import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createProviderClient } from '../../pool/provider-client.js';
import { adapterRequirementFromPublication } from '../../pool/adapter-publication.js';
import {
  createPublishedAdapterOriginFetcher,
  listFetchableAdapterPublications,
  resolveFetchableAdapterPublication
} from '../../pool/adapter-registry.js';
import { buildModelArtifactUrls, verifyModelArtifactManifest } from '../../pool/model-artifacts.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import {
  LAUNCH_MODEL,
  buildLaunchProviderModel,
  getEnabledPoolModelContract,
  listPoolModels,
  validateModelRuntimeCapabilities
} from '../../pool/model-contract.js';
import { createPoolIdentity } from '../../pool/identity.js';
import {
  PARTICIPATION_MODES,
  readParticipationPreferences,
  writeParticipationPreferences
} from '../../pool/participation-profile.js';
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
  refreshRecordTimelineState,
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
const participationIdentity = createPoolIdentity('requester', {
  localOnly: true,
  namespace: 'network_participation'
});

const canRequestWith = (preferences) => (
  preferences.mode === PARTICIPATION_MODES.request || preferences.mode === PARTICIPATION_MODES.both
);
const canContributeWith = (preferences) => (
  preferences.mode === PARTICIPATION_MODES.contribute || preferences.mode === PARTICIPATION_MODES.both
);

const requestControlAvailability = new WeakMap();

const setRequestControlParticipation = (control, canRequest) => {
  if (!canRequest) {
    if (!requestControlAvailability.has(control)) {
      requestControlAvailability.set(control, control.disabled);
    }
    control.disabled = true;
    return;
  }
  if (!requestControlAvailability.has(control)) return;
  control.disabled = requestControlAvailability.get(control);
  requestControlAvailability.delete(control);
};

const shortIdentity = (identity = {}) => {
  const value = String(identity.identityRootId || identity.deviceId || '');
  const fingerprint = value.replace(/^[^_]+_/, '');
  return fingerprint ? `ID ${fingerprint.slice(0, 6)}…${fingerprint.slice(-4)}` : 'Identity unavailable';
};

export const refreshParticipationControls = async (preferences = readParticipationPreferences()) => {
  const canRequest = canRequestWith(preferences);
  const canContribute = canContributeWith(preferences);
  document.documentElement.dataset.poolParticipationMode = preferences.mode;
  document.body.dataset.poolParticipationMode = preferences.mode;
  document.querySelectorAll('[data-pool-participation]').forEach((surface) => {
    surface.dataset.participationMode = preferences.mode;
  });
  document.querySelectorAll('[data-pool-participation-mode]').forEach((button) => {
    const active = button.dataset.poolParticipationMode === preferences.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-pool-request-control], [data-pool-run-surface="run"] input, [data-pool-run-surface="run"] textarea, [data-pool-run-surface="run"] select, [data-pool-run-surface="run"] button').forEach((control) => {
    if (control.closest('[data-pool-participation]')) return;
    setRequestControlParticipation(control, canRequest);
  });
  document.querySelectorAll('.pool-home-ask-dock').forEach((form) => {
    form.hidden = !canRequest;
  });
  document.querySelectorAll('.pool-home-share-toggle').forEach((button) => {
    button.hidden = !canContribute;
  });
  try {
    const identity = await participationIdentity.getDeviceIdentity();
    document.querySelectorAll('[data-pool-device-identity]').forEach((element) => {
      element.textContent = shortIdentity(identity);
      element.dataset.identityProtection = identity.keyProtection;
      element.title = identity.keyProtection === 'passkey'
        ? 'Passkey-bound device identity'
        : identity.keyProtection === 'browser_non_exportable'
          ? 'Non-exportable browser device key'
          : 'Browser identity fallback; use a passkey for stronger protection';
    });
    document.querySelectorAll('[data-pool-passkey]').forEach((button) => {
      button.disabled = identity.keyProtection === 'passkey';
      button.textContent = identity.keyProtection === 'passkey'
        ? 'Passkey protected'
        : 'Protect identity with passkey';
    });
  } catch (error) {
    document.querySelectorAll('[data-pool-device-identity]').forEach((element) => {
      element.textContent = 'Identity unavailable';
      element.title = errorString(error);
    });
  }
  return preferences;
};

const updateParticipationPreference = async (nextPreferences) => {
  const previous = readParticipationPreferences();
  const next = writeParticipationPreferences(nextPreferences);
  await getProviderContributionController().applyParticipationPreferences(previous, next);
  await refreshParticipationControls(next);
  return next;
};

export const bindParticipationControls = () => {
  document.querySelectorAll('[data-pool-participation-mode]').forEach((button) => {
    if (button.dataset.poolParticipationBound === 'true') return;
    button.dataset.poolParticipationBound = 'true';
    button.addEventListener('click', () => {
      void updateParticipationPreference({
        ...readParticipationPreferences(),
        mode: button.dataset.poolParticipationMode
      });
    });
  });
  document.querySelectorAll('[data-pool-permission], [data-pool-limit]').forEach((control) => {
    if (control.dataset.poolParticipationBound === 'true') return;
    control.dataset.poolParticipationBound = 'true';
    control.addEventListener('change', () => {
      const current = readParticipationPreferences();
      const permissions = { ...current.permissions };
      const limits = { ...current.limits };
      if (control.dataset.poolPermission) permissions[control.dataset.poolPermission] = control.checked;
      if (control.dataset.poolLimit) {
        limits[control.dataset.poolLimit] = control.type === 'checkbox'
          ? control.checked
          : Number(control.value);
      }
      void updateParticipationPreference({ ...current, permissions, limits });
    });
  });
  document.querySelectorAll('[data-pool-passkey]').forEach((button) => {
    if (button.dataset.poolPasskeyBound === 'true') return;
    button.dataset.poolPasskeyBound = 'true';
    button.addEventListener('click', async () => {
      const status = button.closest('[data-pool-participation]')?.querySelector('[data-pool-passkey-status]');
      button.disabled = true;
      if (status) status.textContent = 'Waiting for passkey';
      try {
        await participationIdentity.enrollPasskey();
        if (status) status.textContent = 'Passkey bound to this device identity.';
      } catch (error) {
        if (status) status.textContent = errorString(error);
      } finally {
        await refreshParticipationControls();
      }
    });
  });
  void refreshParticipationControls();
};

export const POOL_DEVICE_CAPABILITY_TIERS = Object.freeze({
  basic: Object.freeze({ id: 'basic', label: 'Basic', minScore: 1, maxConcurrentJobs: 1, maxTokensPerJob: 64 }),
  standard: Object.freeze({ id: 'standard', label: 'Standard', minScore: 40, maxConcurrentJobs: 1, maxTokensPerJob: 128 }),
  advanced: Object.freeze({ id: 'advanced', label: 'Advanced', minScore: 65, maxConcurrentJobs: 2, maxTokensPerJob: 256 }),
  high: Object.freeze({ id: 'high', label: 'High capacity', minScore: 85, maxConcurrentJobs: 3, maxTokensPerJob: 512 })
});

const bytesToMiB = (value) => Number(value || 0) / (1024 * 1024);
const median = (values = []) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const capabilityTierForScore = (score, measured) => {
  if (!measured || score < POOL_DEVICE_CAPABILITY_TIERS.standard.minScore) {
    return POOL_DEVICE_CAPABILITY_TIERS.basic;
  }
  if (score >= POOL_DEVICE_CAPABILITY_TIERS.high.minScore) return POOL_DEVICE_CAPABILITY_TIERS.high;
  if (score >= POOL_DEVICE_CAPABILITY_TIERS.advanced.minScore) return POOL_DEVICE_CAPABILITY_TIERS.advanced;
  return POOL_DEVICE_CAPABILITY_TIERS.standard;
};

export const scorePoolDeviceCapability = ({ deviceInfo = {}, benchmark = {} } = {}) => {
  if (deviceInfo.hasWebGPU !== true) {
    return Object.freeze({
      supported: false,
      score: 0,
      tier: Object.freeze({ id: 'unsupported', label: 'Request only', maxConcurrentJobs: 0, maxTokensPerJob: 0 }),
      measured: false,
      summary: 'WebGPU is unavailable. This browser can request work but cannot advertise local model execution.'
    });
  }
  const limits = deviceInfo.limits || {};
  const maxBufferMiB = bytesToMiB(deviceInfo.maxBufferSize || limits.maxBufferSize);
  const storageMiB = bytesToMiB(limits.maxStorageBufferBindingSize);
  const workgroupSize = Number(limits.maxComputeInvocationsPerWorkgroup || limits.maxComputeWorkgroupSizeX || 0);
  const gigaOpsPerSecond = Number(benchmark.gigaOpsPerSecond || 0);
  const stability = Number(benchmark.stability || 0);
  const measured = benchmark.status === 'measured' && gigaOpsPerSecond > 0;
  let score = 20;
  score += maxBufferMiB >= 512 ? 20 : maxBufferMiB >= 256 ? 16 : maxBufferMiB >= 128 ? 12 : maxBufferMiB >= 64 ? 8 : 3;
  score += storageMiB >= 256 ? 15 : storageMiB >= 128 ? 12 : storageMiB >= 64 ? 8 : storageMiB >= 32 ? 5 : 2;
  score += workgroupSize >= 256 ? 5 : workgroupSize >= 128 ? 3 : 1;
  score += deviceInfo.hasF16 || deviceInfo.features?.includes?.('shader-f16') ? 10 : 0;
  score += deviceInfo.hasSubgroups || deviceInfo.features?.includes?.('subgroups') ? 5 : 0;
  score += gigaOpsPerSecond >= 100 ? 20 : gigaOpsPerSecond >= 40 ? 16 : gigaOpsPerSecond >= 12 ? 11 : gigaOpsPerSecond > 0 ? 6 : 0;
  score += stability >= 0.85 ? 5 : stability >= 0.65 ? 3 : stability > 0 ? 1 : 0;
  score = Math.min(100, Math.round(measured ? score : Math.min(score, 39)));
  const tier = capabilityTierForScore(score, measured);
  return Object.freeze({
    supported: true,
    measured,
    score,
    tier,
    maxBufferMiB,
    storageMiB,
    workgroupSize,
    gigaOpsPerSecond,
    stability,
    summary: measured
      ? `${tier.label} browser compute based on observed WebGPU limits and a bounded local kernel.`
      : 'WebGPU is present, but the bounded kernel did not produce a stable measurement. Contribution stays conservative.'
  });
};

export const resolveCapabilityAvailabilityLimits = (participation = {}, capabilityProfile = {}) => ({
  maxConcurrentJobs: Math.min(
    Math.max(1, Number(participation.limits?.maxConcurrentJobs || 1)),
    Math.max(0, Number(capabilityProfile.tier?.maxConcurrentJobs || 0))
  ),
  maxTokensPerJob: Math.min(
    Math.max(16, Number(participation.limits?.maxTokensPerJob || 16)),
    Math.max(0, Number(capabilityProfile.tier?.maxTokensPerJob || 0))
  )
});

const runBoundedWebGpuProbe = async () => {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu?.requestAdapter) return { status: 'unavailable', samplesMs: [] };
  const usage = globalThis.GPUBufferUsage;
  if (!usage) return { status: 'unavailable', samplesMs: [] };
  let device = null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { status: 'adapter_unavailable', samplesMs: [] };
    device = await adapter.requestDevice();
    const elementCount = 65_536;
    const iterations = 64;
    const buffer = device.createBuffer({
      size: elementCount * 4,
      usage: usage.STORAGE
    });
    const shader = device.createShaderModule({ code: `
      @group(0) @binding(0) var<storage, read_write> values: array<f32>;
      @compute @workgroup_size(256)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        if (id.x >= ${elementCount}u) { return; }
        var value = f32(id.x % 251u) * 0.001;
        for (var index = 0u; index < ${iterations}u; index = index + 1u) {
          value = value * 1.000001 + f32(index & 7u) * 0.000001;
        }
        values[id.x] = value;
      }
    ` });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: shader, entryPoint: 'main' }
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }]
    });
    const submit = async () => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(elementCount / 256));
      pass.end();
      const started = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      return performance.now() - started;
    };
    await submit();
    const samplesMs = [];
    for (let index = 0; index < 5; index += 1) samplesMs.push(await submit());
    const medianMs = median(samplesMs);
    const operations = elementCount * iterations * 2;
    const gigaOpsPerSecond = medianMs > 0 ? operations / (medianMs / 1000) / 1e9 : 0;
    const stability = samplesMs.length > 1
      ? Math.min(...samplesMs) / Math.max(...samplesMs)
      : 1;
    buffer.destroy?.();
    return { status: 'measured', samplesMs, medianMs, gigaOpsPerSecond, stability };
  } catch (error) {
    return { status: 'failed', samplesMs: [], error: errorString(error) };
  } finally {
    device?.destroy?.();
  }
};

let capabilityAssessmentPromise = null;

export const assessPoolDeviceCapability = async ({ runtime = null, force = false } = {}) => {
  if (capabilityAssessmentPromise && !force) return capabilityAssessmentPromise;
  capabilityAssessmentPromise = (async () => {
    const activeRuntime = runtime || window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
    const deviceInfo = typeof activeRuntime?.getDeviceInfo === 'function'
      ? await activeRuntime.getDeviceInfo()
      : { hasWebGPU: !!navigator.gpu, features: [], limits: {} };
    const benchmark = deviceInfo.hasWebGPU ? await runBoundedWebGpuProbe() : { status: 'unavailable', samplesMs: [] };
    const scored = scorePoolDeviceCapability({ deviceInfo, benchmark });
    const modelEligibility = listPoolModels({ enabledOnly: true }).map((model) => {
      const qualification = validateModelRuntimeCapabilities(model, deviceInfo);
      const minimumScore = Number(model.browserCapability?.minimumScore ?? 40);
      const scoreQualified = scored.score >= minimumScore;
      return {
        modelId: model.modelId,
        label: model.label || model.modelId,
        eligible: scored.supported && qualification.ok && scoreQualified,
        minimumScore,
        minimumTier: model.browserCapability?.minimumTier || 'standard',
        reasons: [
          ...qualification.reasons,
          ...(!scoreQualified ? [`device capability score ${scored.score} is below required score ${minimumScore}`] : [])
        ]
      };
    });
    const profile = Object.freeze({
      schema: 'reploid.pool.device-capability/v1',
      measuredAt: new Date().toISOString(),
      deviceInfo,
      benchmark,
      ...scored,
      modelEligibility
    });
    window.REPLOID_POOL_DEVICE_CAPABILITY = profile;
    window.dispatchEvent(new CustomEvent('reploid:pool-device-capability', { detail: profile }));
    return profile;
  })();
  return capabilityAssessmentPromise;
};

const formatMetric = (value, suffix, digits = 0) => (
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}${suffix}` : '--'
);

const renderCapabilityProfileState = (root, profile) => {
  if (!root || !profile) return;
  root.dataset.capabilityState = profile.supported ? 'ready' : 'unsupported';
  const setText = (selector, value) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  };
  setText('[data-pool-capability-tier]', profile.tier.label);
  setText('[data-pool-capability-score]', profile.supported ? `${profile.score}/100` : 'N/A');
  setText('[data-pool-capability-summary]', profile.summary);
  setText('[data-pool-capability-webgpu]', profile.supported ? 'Available' : 'Unavailable');
  setText('[data-pool-capability-buffer]', formatMetric(profile.maxBufferMiB, ' MiB'));
  setText('[data-pool-capability-kernel]', profile.measured ? formatMetric(profile.gigaOpsPerSecond, ' GOPS', 1) : 'Not measured');
  setText('[data-pool-capability-stability]', profile.measured ? `${Math.round(profile.stability * 100)}%` : '--');
  const meter = root.querySelector('[data-pool-capability-meter]');
  if (meter) meter.style.width = `${profile.score}%`;
  const models = root.querySelector('[data-pool-capability-models]');
  if (models) {
    models.replaceChildren();
    const eligible = profile.modelEligibility.filter((model) => model.eligible);
    const rows = eligible.length ? eligible : [{ label: 'Request from another contributor', eligible: false }];
    for (const model of rows) {
      const item = document.createElement('span');
      item.dataset.eligible = String(Boolean(model.eligible));
      item.textContent = model.label;
      models.append(item);
    }
  }
  const providerModel = document.getElementById('pool-provider-model');
  if (providerModel) {
    for (const option of providerModel.options) {
      const eligibility = profile.modelEligibility.find((entry) => entry.modelId === option.value);
      option.disabled = eligibility ? !eligibility.eligible : true;
      option.title = eligibility?.eligible
        ? `Qualified at ${profile.tier.label}`
        : eligibility?.reasons?.join('; ') || 'Not qualified by this device profile';
    }
    if (providerModel.selectedOptions[0]?.disabled) {
      const eligibleOption = [...providerModel.options].find((option) => !option.disabled);
      if (eligibleOption) providerModel.value = eligibleOption.value;
    }
    providerModel.dispatchEvent(new Event('change', { bubbles: true }));
  }
};

export const bindCapabilityAssessmentControls = () => {
  const roots = [...document.querySelectorAll('[data-pool-capability-profile]')];
  if (!roots.length) return;
  const run = async (force = false) => {
    roots.forEach((root) => { root.dataset.capabilityState = 'checking'; });
    const profile = await assessPoolDeviceCapability({ force });
    roots.forEach((root) => renderCapabilityProfileState(root, profile));
  };
  roots.forEach((root) => {
    const rerun = root.querySelector('[data-pool-capability-rerun]');
    if (!rerun || rerun.dataset.poolCapabilityBound === 'true') return;
    rerun.dataset.poolCapabilityBound = 'true';
    rerun.addEventListener('click', () => void run(true));
  });
  void run(false);
};

const setDashboardActivityExpanded = (expanded) => {
  const activity = document.querySelector('[data-pool-dashboard-activity]');
  if (!activity) return;
  activity.dataset.expanded = String(expanded);
  activity.classList.toggle('is-expanded', expanded);
  activity.querySelectorAll('[data-pool-activity-toggle]').forEach((button) => {
    button.setAttribute('aria-expanded', String(expanded));
  });
};

export const applyPoolDashboardView = (view = 'home', { updateHistory = true } = {}) => {
  const normalized = ['home', 'ask', 'compute', 'records'].includes(view) ? view : 'home';
  const stage = document.querySelector('.pool-home-stage');
  if (!stage) return normalized;
  stage.dataset.poolDashboardView = normalized;
  document.querySelectorAll('[data-pool-dashboard-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.poolDashboardPanel !== normalized;
  });
  document.querySelectorAll('.pool-nav-link[data-pool-dashboard-view]').forEach((control) => {
    const active = control.dataset.poolDashboardView === normalized;
    control.classList.toggle('is-active', active);
    if (active) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
  });
  const titles = { home: 'Workspace', ask: 'Run', compute: 'Contribute', records: 'Records' };
  document.querySelectorAll('[data-pool-dashboard-title]').forEach((element) => {
    element.textContent = titles[normalized];
  });
  if (normalized === 'records') setDashboardActivityExpanded(true);
  if (updateHistory) {
    const url = new URL(window.location.href);
    if (normalized === 'home') url.searchParams.delete('view');
    else url.searchParams.set('view', normalized);
    window.history.pushState({ reploidPoolDashboardView: normalized }, '', `${url.pathname}${url.search}`);
  }
  return normalized;
};

export const bindPoolDashboardControls = () => {
  document.querySelectorAll('.pool-nav-link[data-pool-dashboard-view], [data-pool-dashboard-view-target]').forEach((control) => {
    if (control.dataset.poolDashboardBound === 'true') return;
    control.dataset.poolDashboardBound = 'true';
    control.addEventListener('click', (event) => {
      event.preventDefault();
      applyPoolDashboardView(control.dataset.poolDashboardView || control.dataset.poolDashboardViewTarget || 'home');
    });
  });
  document.querySelectorAll('[data-pool-activity-toggle]').forEach((button) => {
    if (button.dataset.poolActivityBound === 'true') return;
    button.dataset.poolActivityBound = 'true';
    button.addEventListener('click', () => {
      const activity = document.querySelector('[data-pool-dashboard-activity]');
      setDashboardActivityExpanded(activity?.dataset.expanded !== 'true');
    });
  });
};

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

const adapterOptionLabel = (publication = {}) => String(
  publication.pack?.label
  || publication.pack?.runtimeManifest?.name
  || publication.pack?.packId
  || publication.packHash
  || 'Adapter pack'
);

const createSelectOption = (label, value = '') => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
};

const refreshAdapterOptions = async (adapterSelect, model, { allowBaseModel = true } = {}) => {
  if (!adapterSelect || !model) return [];
  const previousValue = adapterSelect.value;
  const requestId = String(Number(adapterSelect.dataset.poolAdapterRequestId || 0) + 1);
  adapterSelect.dataset.poolAdapterRequestId = requestId;
  adapterSelect.disabled = true;
  adapterSelect.replaceChildren(createSelectOption('Loading published packs…'));
  try {
    const publications = await listFetchableAdapterPublications({
      sdk: createPoolSdk(),
      model
    });
    if (adapterSelect.dataset.poolAdapterRequestId !== requestId) return publications;
    adapterSelect.replaceChildren();
    if (allowBaseModel) adapterSelect.append(createSelectOption('Base model only'));
    else adapterSelect.append(createSelectOption('Choose a published adapter pack'));
    for (const publication of publications) {
      adapterSelect.append(createSelectOption(adapterOptionLabel(publication), publication.packHash));
    }
    const previousStillExists = [...adapterSelect.options].some((option) => option.value === previousValue);
    adapterSelect.value = previousStillExists ? previousValue : '';
    adapterSelect.disabled = publications.length === 0 && !allowBaseModel;
    adapterSelect.dataset.poolAdapterStatus = publications.length > 0 ? 'available' : 'empty';
    if (publications.length === 0) {
      adapterSelect.options[adapterSelect.options.length - 1].textContent = allowBaseModel
        ? 'Base model only — no published packs for this model'
        : 'No published packs for this model';
    }
    return publications;
  } catch (error) {
    if (adapterSelect.dataset.poolAdapterRequestId !== requestId) return [];
    adapterSelect.replaceChildren(createSelectOption(
      allowBaseModel ? 'Base model only — adapter registry unavailable' : 'Adapter registry unavailable',
      ''
    ));
    adapterSelect.disabled = !allowBaseModel;
    adapterSelect.dataset.poolAdapterStatus = 'error';
    adapterSelect.dataset.poolAdapterError = errorString(error);
    return [];
  }
};

const resolveSelectedAdapter = async (adapterSelect, model, { required = false } = {}) => {
  const packHash = String(adapterSelect?.value || '').trim();
  if (!packHash) {
    if (required) throw new Error('Select a published adapter pack before running the adapter lane');
    return null;
  }
  const publication = await resolveFetchableAdapterPublication({
    sdk: createPoolSdk(),
    packHash,
    model
  });
  return adapterRequirementFromPublication(publication, { state: 'fetchable' });
};

const bindPeerRunSurface = ({
  button,
  prompt,
  form = null,
  policySelect = null,
  modelSelect = null,
  adapterSelect = null,
  adapterRequired = () => false,
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
    updateRunState(
      'running',
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
    try {
      const selectedModel = getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
      const adapter = await resolveSelectedAdapter(adapterSelect, selectedModel, {
        required: Boolean(adapterRequired())
      });
      const modelRequirements = adapter ? { ...selectedModel, adapter } : selectedModel;
      setResult(resultId, describeSelectedRun({
        status: 'finding_peer_provider',
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelId: selectedModel.modelId,
        adapterPackHash: adapter?.packHash || null
      }), { stream: true });
      const result = await runPeerJob({
        roomId: getPeerRoomId(),
        requesterClient,
        prompt: promptText,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelRequirements,
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
          model: getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL,
          adapterPackHash: adapterSelect?.value || null
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

const runWorkloadOf = (modelSelect) => (
  modelSelect?.selectedOptions?.[0]?.dataset?.workload || 'text-generation'
);

const syncRunWorkloadAffordance = (modelSelect) => {
  const badge = document.querySelector('[data-pool-run-workload]');
  const promptLabel = document.querySelector('[data-pool-run-prompt-label]');
  const workload = runWorkloadOf(modelSelect);
  const isSequence = workload !== 'text-generation';
  if (badge) badge.textContent = workload.replace(/[-_]/g, ' ');
  if (promptLabel) promptLabel.textContent = isSequence ? 'Sequence' : 'Prompt';
};

export const bindRunControls = () => {
  const modelSelect = document.getElementById('pool-run-model');
  const adapterSelect = document.getElementById('pool-run-adapter');
  bindPeerRunSurface({
    button: document.getElementById('pool-run-submit'),
    prompt: document.getElementById('pool-run-prompt'),
    policySelect: document.getElementById('pool-run-policy'),
    modelSelect,
    adapterSelect,
    resultId: 'pool-run-result'
  });
  if (modelSelect && modelSelect.dataset.poolWorkloadBound !== 'true') {
    modelSelect.dataset.poolWorkloadBound = 'true';
    modelSelect.addEventListener('change', () => {
      syncRunWorkloadAffordance(modelSelect);
      void refreshAdapterOptions(adapterSelect, getEnabledPoolModelContract(modelSelect.value) || LAUNCH_MODEL);
    });
    syncRunWorkloadAffordance(modelSelect);
  }
  void refreshAdapterOptions(adapterSelect, getEnabledPoolModelContract(modelSelect?.value) || LAUNCH_MODEL);
};

const bindHomeLaneChips = (input, adapterSelect) => {
  const chips = [...document.querySelectorAll('.pool-lane-chip')];
  const stage = document.querySelector('.pool-home-stage');
  const adapterPicker = adapterSelect?.closest('[data-pool-home-adapter-picker]');
  if (chips.length === 0 || !stage) return;
  chips.forEach((chip) => {
    if (chip.disabled || chip.dataset.poolLaneBound === 'true') return;
    chip.dataset.poolLaneBound = 'true';
    chip.addEventListener('click', () => {
      chips.forEach((other) => {
        other.classList.toggle('is-active', other === chip);
        other.setAttribute('aria-pressed', String(other === chip));
      });
      const lane = chip.dataset.poolLane || 'text';
      stage.dataset.poolLane = lane;
      if (adapterPicker) adapterPicker.hidden = lane !== 'adapters';
      if (lane === 'adapters') {
        void refreshAdapterOptions(adapterSelect, LAUNCH_MODEL, { allowBaseModel: false });
      } else if (adapterSelect) {
        adapterSelect.value = '';
      }
    });
  });
};

export const bindHomeAskControls = () => {
  const form = document.getElementById('pool-home-ask-form');
  const input = document.getElementById('pool-home-ask-prompt');
  const button = document.getElementById('pool-home-run-submit');
  const adapterSelect = document.getElementById('pool-home-adapter');
  if (!form || !input || !button) return;
  bindSuggestedPromptEditing(input);
  bindHomeLaneChips(input, adapterSelect);
  bindPeerRunSurface({
    button,
    prompt: input,
    form,
    adapterSelect,
    adapterRequired: () => document.querySelector('.pool-home-stage')?.dataset.poolLane === 'adapters',
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
  const adapterSdk = createPoolSdk();
  const fetchAdapterFromOrigin = createPublishedAdapterOriginFetcher({ sdk: adapterSdk });

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
        identity: getProviderIdentity(),
        fetchAdapterFromOrigin
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
      const homeControl = controls.workerToggleButton.id === 'pool-home-provider-toggle';
      controls.workerToggleButton.textContent = active
        ? (homeControl ? 'Stop sharing' : 'Stop')
        : (homeControl ? 'Start sharing' : 'Start contributing');
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
    const runtime = getRuntime();
    const capabilityProfile = await assessPoolDeviceCapability({ runtime });
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
    const loaded = await loadSelectedProviderModel();
    const model = loaded.model || runtime.getModelInfo();
    currentModel = model;
    const participation = readParticipationPreferences();
    let adapterPacks = [];
    if (participation.permissions.relayArtifacts) {
      try {
        const publications = await listFetchableAdapterPublications({ sdk: adapterSdk, model });
        const maxArtifactBytes = participation.limits.storageBudgetMiB * 1024 * 1024;
        adapterPacks = publications.filter((publication) => (
          Number(publication.pack?.adapter?.bytes || 0) <= maxArtifactBytes
        )).map((publication) => (
          adapterRequirementFromPublication(publication, { state: 'fetchable' })
        ));
        updateProviderHealth({ adapters: adapterPacks.length ? `${adapterPacks.length}_fetchable` : 'none' });
      } catch (error) {
        updateProviderHealth({ adapters: 'registry_unavailable', adapterRegistryError: errorString(error) });
      }
    } else {
      updateProviderHealth({ adapters: 'relay_disabled' });
    }
    const providerIdentityState = await getProviderIdentity().resolve();
    const capabilityLimits = resolveCapabilityAvailabilityLimits(participation, capabilityProfile);
    await stopPeerProvider();
    const node = createPeerProviderNode({
      roomId: getPeerRoomId(),
      providerClient: getProviderClient(),
      roomBusFactory: getPeerRoomBusFactory(),
      onActivity: handlePeerActivity
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
      transport: 'webrtc_peer_room',
      ...result
    };
  };

  const startWorker = async () => {
    if (workerRunning || workerStarting) return;
    const participation = readParticipationPreferences();
    if (!canContributeWith(participation)) {
      writeParticipationPreferences({ ...participation, mode: PARTICIPATION_MODES.both });
      await refreshParticipationControls(readParticipationPreferences());
    }
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
    },
    async applyParticipationPreferences(previous, next) {
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

const syncProviderWorkloadCapability = (modelSelect) => {
  const badge = document.querySelector('[data-pool-provider-workload]');
  if (!badge) return;
  const workload = modelSelect?.selectedOptions?.[0]?.dataset?.workload || 'text_generation';
  badge.textContent = workload.replace(/[-_]/g, ' ');
};

export const bindProviderControls = () => {
  const modelInput = document.getElementById('pool-provider-model');
  getProviderContributionController().attachControls({
    workerToggleButton: document.getElementById('pool-provider-worker-toggle')
      || document.getElementById('pool-home-provider-toggle'),
    modelInput,
    mount: document.getElementById('app')
  });
  if (modelInput && modelInput.dataset.poolWorkloadBound !== 'true') {
    modelInput.dataset.poolWorkloadBound = 'true';
    modelInput.addEventListener('change', () => syncProviderWorkloadCapability(modelInput));
    syncProviderWorkloadCapability(modelInput);
  }
};

export const bindRecordFacetControls = () => {
  const ledger = document.getElementById('pool-record-ledger');
  if (!ledger || ledger.dataset.poolFacetBound === 'true') return;
  ledger.dataset.poolFacetBound = 'true';
  ledger.addEventListener('click', (event) => {
    const chip = event.target.closest?.('[data-pool-record-facet]');
    if (!chip) return;
    ledger.dataset.recordFacet = chip.dataset.poolRecordFacet || 'all';
    refreshRecordTimelineState();
  });
};

export const bindReceiptControls = () => {
  bindRecordFacetControls();
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
