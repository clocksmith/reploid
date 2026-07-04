/**
 * @fileoverview Minimal route-locked boot UI for /, /0, and /x.
 */

import {
  STEPS,
  VERIFY_STATE,
  canAwaken,
  checkSavedConfig,
  getStoredSwarmEnabled,
  getState,
  hydrateSavedConfig,
  resetWizard,
  saveConfig,
  setNestedState,
  setState,
  subscribe
} from '../boot-wizard/state.js';
import {
  generateSeededGoalPrompt,
  runDetection,
  testApiKey,
  testDirectModel,
  testLocalConnection,
  testProxyConnection,
  testProxyModel
} from '../boot-wizard/detection.js';
import {
  DEFAULT_REPLOID_HOME_GOAL,
  DEFAULT_ZERO_GOAL,
  formatGoalPacket,
  getRandomGoalEntry,
  getRandomZeroGoal
} from '../boot-wizard/goals.js';
import {
  findReploidEnvironmentTemplateId,
  getDefaultReploidEnvironment,
  getReploidEnvironmentTemplate
} from '../../config/reploid-environments.js';
import {
  createReploidPeerUrl,
  getCurrentReploidInstanceLabel,
  getCurrentReploidStorage as getReploidStorage
} from '../../instance.js';
import {
  clearVfsStore,
  ensureVfsFileMirrors,
  loadVfsManifest,
  seedVfsFromManifest
} from '../../boot-helpers/vfs-bootstrap.js';
import { getRuntimeSelfMirrorsByBootProfile } from '../../lab/profiles.js';
import {
  getReploidLaunchState,
  hasDirectInferenceConfig,
  resolveReploidModelConfig
} from '../boot-wizard/reploid-inference.js';
import { renderConnectionProviderOptions } from '../boot-wizard/steps/choose.js';
import { CLOUD_MODELS, renderDirectConfigStep } from '../boot-wizard/steps/direct.js';
import { renderProxyConfigStep } from '../boot-wizard/steps/proxy.js';
import { renderBrowserConfigStep } from '../boot-wizard/steps/browser.js';
import { renderAwakenedFilesPanel, renderGoalStep } from '../boot-wizard/steps/goal.js';
import {
  ZERO_GEMINI_MODEL,
  ZERO_GEMINI_PROVIDER,
  buildZeroGeminiProxyConfig,
  isZeroGeminiFunctionServer
} from '../boot-wizard/zero-function.js';
import {
  getBootSeedProfile,
  shouldHydrateFullManifest
} from '../../config/boot-seed.js';

const DEFAULT_DOPPLER_MODEL = 'smollm2-360m';
const DEFAULT_GTM_PROXY_PROVIDER = ZERO_GEMINI_PROVIDER;
const DEFAULT_GTM_PROXY_MODEL = ZERO_GEMINI_MODEL;
const RGR_SLOT_ROLES = Object.freeze([
  'elite',
  'performance',
  'robustness',
  'repair',
  'low-cost',
  'safety',
  'fallback'
]);
const ROUTE_HOME_CONFIG = Object.freeze({
  reploid: {
    providerMode: 'choice',
    providerCaption: '',
    goalTitle: 'Objective',
    goalCaption: '',
    awakenCaption: '',
    hideBootInternals: true,
    goalActionMode: 'generate-only',
    generatedStatusText: '',
    defaultGoal: DEFAULT_REPLOID_HOME_GOAL,
    goalPlaceholder: DEFAULT_REPLOID_HOME_GOAL
  },
  zero: {
    providerMode: 'local-or-proxy',
    providerTitle: 'Choose inference',
    providerCaption: 'Default: server proxy. Local Doppler is optional.',
    goalTitle: 'Set the first objective',
    goalCaption: '',
    awakenCaption: 'Awaken Zero with this inference path and objective.',
    hideBootInternals: true,
    goalActionMode: 'generate-only',
    generatedStatusText: '',
    defaultGoal: DEFAULT_ZERO_GOAL,
    goalPlaceholder: DEFAULT_ZERO_GOAL,
    allowedConnectionTypes: ['browser', 'proxy']
  },
  x: {
    providerMode: 'choice',
    providerCaption: 'Pick where reasoning runs before loading the prebuilt RSI surface.',
    goalTitle: 'Set the first objective',
    goalCaption: 'Set the first goal the mature substrate should pursue.',
    awakenCaption: 'Awaken X with the selected inference path and first goal.',
    hideBootInternals: true,
    goalActionMode: 'generate-only',
    generatedStatusText: ''
  }
});

let container = null;
let listenersAttached = false;
let renderScheduled = false;
let unsubscribeState = null;
let sponsorAccessExpanded = false;
let isInitialRender = true;
let lastRenderSignature = null;
let pendingDeferredRender = false;
let vfsProgressListenerAttached = false;

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeVfsProgress = (progress = {}) => {
  if (!progress || typeof progress !== 'object') return null;
  const total = Number(progress.total || 0);
  const current = Number(progress.current ?? progress.written ?? progress.fetched ?? 0);
  const percent = total > 0
    ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
    : 0;
  return {
    scope: String(progress.scope || 'vfs'),
    phase: String(progress.phase || ''),
    label: String(progress.label || ''),
    total,
    current,
    percent,
    written: Number(progress.written || 0),
    fetched: Number(progress.fetched || 0),
    skipped: Number(progress.skipped || 0),
    timestamp: Number(progress.timestamp || Date.now())
  };
};

const getCurrentFullSeedProgress = () => {
  if (typeof window === 'undefined') return null;
  return normalizeVfsProgress(window.REPLOID_VFS_FULL_SEED_PROGRESS || window.REPLOID_VFS_SEED_PROGRESS);
};

const setVfsProgress = (progress) => {
  const normalized = normalizeVfsProgress(progress);
  if (!normalized) return;
  setState({ vfsProgress: normalized });
};

const attachVfsProgressListener = () => {
  if (vfsProgressListenerAttached || typeof window === 'undefined') return;
  vfsProgressListenerAttached = true;
  window.addEventListener('reploid:vfs-seed-progress', (event) => {
    setVfsProgress(event.detail);
  });
};

const renderVfsProgress = (state) => {
  const progress = normalizeVfsProgress(state.vfsProgress || getCurrentFullSeedProgress());
  if (!progress) return '';
  const shouldShow = state.isAwakening
    || (state.mode !== 'reploid' && progress.scope === 'full' && progress.phase !== 'done');
  if (!shouldShow) return '';
  const label = progress.label || 'Preparing VFS.';
  const detail = progress.total > 0
    ? `${progress.current}/${progress.total} files`
    : 'Preparing files';
  return `
    <div class="vfs-hydration-status" aria-live="polite">
      <div class="vfs-hydration-copy">
        <span class="type-label">VFS</span>
        <span class="type-caption">${escapeHtml(label)}</span>
      </div>
      <div class="vfs-hydration-track" role="progressbar"
           aria-valuemin="0"
           aria-valuemax="100"
           aria-valuenow="${progress.percent}">
        <div class="vfs-hydration-bar" style="width: ${progress.percent}%"></div>
      </div>
      <span class="type-caption vfs-hydration-count">${escapeHtml(detail)}</span>
    </div>
  `;
};

const renderLockedSection = (title, caption) => `
  <div class="wizard-step wizard-stage-placeholder">
    <div class="goal-header">
      <h2 class="type-h2">${title}</h2>
      <p class="type-caption">${caption}</p>
    </div>
  </div>
`;

const renderAwakenButton = (state, options = {}) => {
  const disabled = options.disabled === true;
  const sizeClass = options.large ? ' btn-lg' : '';
  return `
    <button class="btn${sizeClass} btn-primary btn-op goal-action-button${state.isAwakening ? ' loading' : ''}"
            data-op="☇"
            data-action="awaken"
            id="awaken-btn"
            ${disabled ? 'disabled' : ''}
            aria-busy="${state.isAwakening ? 'true' : 'false'}">
      ${state.isAwakening ? 'Awakening...' : 'Awaken'}
    </button>
  `;
};

const getDefaultCloudModelForProvider = (provider) => {
  const models = CLOUD_MODELS[provider] || [];
  return models[0]?.id || null;
};

const getPreferredProxyProvider = (detection) => {
  const providers = detection.proxy?.configuredProviders || [];
  if (providers.includes(DEFAULT_GTM_PROXY_PROVIDER)) {
    return DEFAULT_GTM_PROXY_PROVIDER;
  }
  return providers[0] || null;
};

const getPreferredProxyModel = (provider) => {
  if (provider === DEFAULT_GTM_PROXY_PROVIDER) {
    return DEFAULT_GTM_PROXY_MODEL;
  }
  return getDefaultCloudModelForProvider(provider);
};
const getPreferredZeroProxyConfig = (state) => {
  return buildZeroGeminiProxyConfig(state.proxyConfig || {});
};

const getRouteHomeConfig = (mode) => ROUTE_HOME_CONFIG[mode] || ROUTE_HOME_CONFIG.reploid;
const isUsingOwnInference = (state) => state.mode === 'reploid' && state.connectionType === 'direct';
const shouldSeedDopplerVfs = (state) => state.connectionType === 'browser';
const getPeerLaunchUrl = () => createReploidPeerUrl(window.location.pathname);
const getFreshPeerLaunchUrl = () => createReploidPeerUrl(window.location.pathname, { freshIdentity: true });
const getRingTopologyLabel = (launch) => launch?.swarmEnabled ? 'peer-assisted' : 'local';
const getSlotPlacementLabel = (launch) => {
  if (launch?.hasInference && launch?.swarmEnabled) return 'local/remote';
  if (launch?.hasInference) return 'local';
  if (launch?.swarmEnabled) return 'remote';
  return 'empty';
};
const getPeerRoleLabel = (launch) => {
  if (!launch?.swarmEnabled) {
    return launch?.hasInference ? 'solo host' : 'offline';
  }
  if (launch?.role === 'provider') return 'host';
  if (launch?.role === 'consumer') return 'consumer';
  if (launch?.role === 'solo') return 'solo host';
  return 'waiting';
};
const getExecutorLabel = (launch) => {
  if (launch?.hasInference && launch?.swarmEnabled) return 'local host + remote slots';
  if (launch?.hasInference) return 'local host';
  if (launch?.swarmEnabled) return 'waiting for host';
  return 'none';
};
const getTransportPlanLabel = (launch) => {
  if (!launch?.swarmEnabled) return 'disabled';
  if (typeof window === 'undefined') return 'swarm';
  const params = new URLSearchParams(window.location.search);
  const explicitSwarm = params.get('swarm');
  const explicitSignaling = params.get('signaling')
    || getReploidStorage().getItem('REPLOID_SIGNALING_URL');
  if (explicitSwarm && explicitSwarm !== 'true') return 'WebRTC room';
  if (explicitSignaling) return 'WebRTC signaling';
  return 'local room';
};
const renderStatusMetric = (label, value) => `
  <span class="rgr-status-metric">
    <span class="rgr-status-label">${label}</span>
    <span class="rgr-status-value">${value}</span>
  </span>
`;
const omitPathEntry = (entries, path) => Object.fromEntries(
  Object.entries(entries || {}).filter(([entryPath]) => entryPath !== path)
);
const getSeedOverridesPayload = (state) => Object.fromEntries(
  Object.entries(state.seedOverrides || {})
    .filter(([path, content]) => typeof path === 'string' && typeof content === 'string')
);

const renderIntroStep = () => `
  <div class="wizard-step wizard-intro">
    <div class="goal-header">
      <h1 class="type-h1">Reploid</h1>
      <p class="type-caption">ring slots can be local or remote · peer ${getCurrentReploidInstanceLabel()} · <a class="link-secondary" href="${getPeerLaunchUrl()}" target="_blank" rel="noopener">new peer</a> · <a class="link-secondary" href="${getFreshPeerLaunchUrl()}" target="_blank" rel="noopener">fresh peer</a></p>
    </div>
  </div>
`;

const renderManagedInferenceStep = (state) => {
  const launch = getReploidLaunchState(state);
  const byokEnabled = launch.ownInference;
  const accessProvisioned = !!launch.accessProvisioned;
  const accessCode = String(state.accessConfig?.accessCode || '');
  const accessError = state.accessConfig?.error || '';
  const hasDirectInference = hasDirectInferenceConfig(state);
  const showSponsorAccessDetails = false;
  const sponsorAccessDetailsOpen = showSponsorAccessDetails
    && (sponsorAccessExpanded || !!accessCode || !!accessError);

  const topologyLabel = getRingTopologyLabel(launch);
  const slotPlacement = getSlotPlacementLabel(launch);
  const roleLabel = getPeerRoleLabel(launch);
  const executorLabel = getExecutorLabel(launch);
  const transportLabel = getTransportPlanLabel(launch);
  const slotSummary = `${RGR_SLOT_ROLES.length} ${slotPlacement}`;

  let statusLabel = 'Seed';
  let modelLabel = topologyLabel;
  let caption = 'No host attached';

  if (launch.hasDirectInference) {
    modelLabel = state.directConfig?.model || '';
    caption = launch.swarmEnabled
      ? 'Local slots execute here and remote slots may join'
      : 'All runnable slots execute locally';
  } else if (launch.hasAccessInference) {
    modelLabel = launch.accessModel;
    caption = launch.swarmEnabled
      ? 'Managed host can serve local and remote slots'
      : 'Managed host fills local slots';
  } else if (launch.swarmEnabled) {
    caption = 'Waiting for remote host slots';
  } else if (byokEnabled && !hasDirectInference) {
    caption = 'No provider selected';
  }

  const sponsorSummaryTitle = 'Sponsor access';
  const sponsorSummaryCaption = accessCode
    ? `${launch.accessWindowLabel} code added`
    : `Optional. Expand to unlock the ${launch.accessWindowLabel} sponsor window in this browser.`;

  return `
    <div class="wizard-step inference-bar">
      <div class="goal-header">
        <h2 class="type-h2">Ring</h2>
      </div>
      <div class="inference-bar-row">
        <div class="inference-bar-status">
          <div class="inference-bar-title">
            <span class="inference-bar-label">${statusLabel}</span>
            ${modelLabel ? `<span class="inference-bar-model">${modelLabel}</span>` : ''}
          </div>
          <p class="type-caption inference-bar-note">${caption}</p>
        </div>
        <div class="inference-bar-controls">
          <button class="inference-bar-configure${byokEnabled ? ' active' : ''}"
                  id="reploid-use-own-inference"
                  data-action="toggle-own-inference"
                  type="button">Configure</button>
          <label class="inference-bar-toggle">
            <input type="checkbox"
                   id="reploid-swarm-enabled"
                   ${state.swarmEnabled ? 'checked' : ''} />
            <span>Peer slots</span>
          </label>
        </div>
      </div>
      <div class="rgr-status-strip" aria-label="System and peer status">
        ${renderStatusMetric('Mode', 'Seed')}
        ${renderStatusMetric('Role', roleLabel)}
        ${renderStatusMetric('Slots', slotSummary)}
        ${renderStatusMetric('Transport', transportLabel)}
        ${renderStatusMetric('Host', executorLabel)}
        ${renderStatusMetric('Gate', 'anchor')}
      </div>
      ${showSponsorAccessDetails ? `
        <details class="inference-bar-shared-details"${sponsorAccessDetailsOpen ? ' open' : ''}>
          <summary class="inference-bar-shared-summary disclosure-summary">
            <span class="disclosure-summary-copy inference-bar-shared-copy">
              <span class="inference-bar-shared-title">${sponsorSummaryTitle}</span>
              <span class="type-caption">${sponsorSummaryCaption}</span>
            </span>
          </summary>
          ${accessProvisioned ? `
            <div class="inference-bar-row inference-bar-row-access">
              <input type="password"
                     id="reploid-access-code"
                     class="inference-bar-input"
                     placeholder="Enter sponsor access code"
                     value="${accessCode}"
                     autocomplete="off"
                     spellcheck="false" />
              <div class="inference-bar-meta">
                <span class="type-caption">${launch.accessWindowLabel} code</span>
                ${accessError ? `
                  <span class="type-caption type-caption-error">☒ ${accessError}</span>
                ` : ''}
              </div>
            </div>
          ` : `
            <div class="inference-bar-row inference-bar-row-copy">
              <div class="inference-bar-meta">
                <span class="type-caption">${caption}</span>
                ${accessError ? `
                  <span class="type-caption type-caption-error">☒ ${accessError}</span>
                ` : ''}
              </div>
            </div>
          `}
        </details>
      ` : ''}
    </div>
  `;
};

const scheduleRender = () => {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    const state = getState();
    const signature = getHomeRenderSignature(state);
    const isTypingGoal = document.activeElement?.id === 'goal-input';
    if (!isInitialRender && isTypingGoal) {
      pendingDeferredRender = pendingDeferredRender || signature !== lastRenderSignature;
      updateInteractiveUi(state);
      return;
    }
    if (isInitialRender || signature !== lastRenderSignature) {
      lastRenderSignature = signature;
      pendingDeferredRender = false;
      render();
      isInitialRender = false;
      return;
    }
    updateInteractiveUi(state);
  });
};

const getHomeRenderSignature = (state) => {
  const launch = state.mode === 'reploid' ? getReploidLaunchState(state) : null;
  return JSON.stringify({
    mode: state.mode,
    routeLockedMode: state.routeLockedMode,
    connectionType: state.connectionType,
    isAwakening: !!state.isAwakening,
    detection: state.detection,
    savedConfig: state.savedConfig,
    directConfig: state.directConfig,
    proxyConfig: state.proxyConfig,
    dopplerConfig: state.dopplerConfig,
    goalGenerator: state.goalGenerator,
    selectedGoalCategory: state.selectedGoalCategory,
    goalShuffleSeed: state.goalShuffleSeed,
    goalPresetsOpen: !!state.goalPresetsOpen,
    bootPayload: state.bootPayload,
    selfPreview: state.selfPreview,
    selectedSelfPath: state.selectedSelfPath,
    editingSeedPath: state.editingSeedPath,
    seedOverrides: state.seedOverrides,
    seedDraftPaths: Object.keys(state.seedDrafts || {}).sort(),
    vfsProgress: state.vfsProgress ? {
      scope: state.vfsProgress.scope,
      phase: state.vfsProgress.phase,
      current: state.vfsProgress.current,
      total: state.vfsProgress.total,
      percent: state.vfsProgress.percent,
      label: state.vfsProgress.label
    } : null,
    accessState: {
      error: state.accessConfig?.error || null,
      hasCode: !!String(state.accessConfig?.accessCode || '').trim()
    },
    launch: launch ? {
      ownInference: !!launch.ownInference,
      accessProvisioned: !!launch.accessProvisioned,
      accessWindowLabel: launch.accessWindowLabel || '',
      accessModel: launch.accessModel || '',
      hasInference: !!launch.hasInference,
      hasDirectInference: !!launch.hasDirectInference,
      hasAccessInference: !!launch.hasAccessInference,
      swarmEnabled: !!launch.swarmEnabled,
      role: launch.role || '',
      canAwaken: !!launch.canAwaken,
      isDead: !!launch.isDead
    } : null,
    hasGoal: state.mode === 'reploid' ? null : !!String(state.goal || '').trim(),
    canAwaken: state.mode === 'reploid' ? null : !!canAwaken()
  });
};

const syncInputValue = (id, value) => {
  const input = document.getElementById(id);
  if (!input || document.activeElement === input) return;
  const nextValue = String(value || '');
  if ('value' in input && input.value !== nextValue) {
    input.value = nextValue;
  }
};

const updateInteractiveUi = (state) => {
  if (!container) return;

  syncInputValue('goal-input', state.goal || '');

  const awakenBtn = container.querySelector('#awaken-btn');
  if (!awakenBtn) return;

  const ready = state.mode === 'reploid'
    ? !!getReploidLaunchState(state)?.canAwaken
    : !!canAwaken();
  const hasGoal = !!String(state.goal || '').trim();
  const isAwakening = !!state.isAwakening;

  awakenBtn.disabled = isAwakening || !hasGoal || !ready;
  awakenBtn.classList.toggle('loading', isAwakening);
  awakenBtn.setAttribute('aria-busy', isAwakening ? 'true' : 'false');
  awakenBtn.textContent = isAwakening ? 'Awakening...' : 'Awaken';
};

const autoSelectConnectionType = () => {
  const state = getState();
  if (state.connectionType) return;

  if (state.mode === 'reploid' && state.routeLockedMode === 'reploid') {
    const useOwnInference = getReploidStorage().getItem('REPLOID_USE_OWN_INFERENCE') === 'true';
    setState({ connectionType: useOwnInference ? 'direct' : 'access' });
    return;
  }

  const { detection, savedConfig } = state;
  const proxyDetected = detection.proxy?.detected;
  const hasManagedGemini = (detection.proxy?.configuredProviders || []).includes(DEFAULT_GTM_PROXY_PROVIDER);

  if (state.mode === 'reploid' && proxyDetected && hasManagedGemini) {
    const provider = getPreferredProxyProvider(detection);
    setNestedState('proxyConfig', {
      url: detection.proxy.url,
      serverType: 'reploid',
      provider,
      model: getPreferredProxyModel(provider)
    });
    setState({ connectionType: 'proxy' });
    return;
  }

  if (state.mode === 'zero') {
    setNestedState('proxyConfig', getPreferredZeroProxyConfig(state));
    setState({ connectionType: 'proxy' });
    return;
  }

  const hasSavedKeys = savedConfig?.hasSavedKey;
  const webgpuSupported = detection.webgpu?.supported;
  const options = [];

  if (proxyDetected) options.push('proxy');
  if (hasSavedKeys) options.push('direct');
  if (webgpuSupported && !proxyDetected && !hasSavedKeys) options.push('browser');

  if (options.length !== 1) return;

  const choice = options[0];
  if (choice === 'proxy') {
    const provider = getPreferredProxyProvider(detection);
    const proxyUpdates = {
      url: detection.proxy.url,
      serverType: 'reploid',
      provider,
      model: getPreferredProxyModel(provider)
    };
    setNestedState('proxyConfig', proxyUpdates);
    setState({ connectionType: 'proxy' });
    return;
  }

  if (choice === 'direct') {
    hydrateSavedConfig(savedConfig);
    return;
  }

  if (choice === 'browser') {
    setState({ connectionType: 'browser' });
    setNestedState('dopplerConfig', { model: DEFAULT_DOPPLER_MODEL });
  }
};

async function handleGenerateGoal() {
  const state = getState();
  if (state.mode === 'zero') {
    const goal = getRandomZeroGoal(Date.now(), state.goal);
    setState({
      goal: goal?.text || state.goal,
      goalGenerator: {
        status: 'ready',
        error: null,
        source: 'seed'
      }
    });
    return;
  }

  setState({
    goalGenerator: {
      status: 'generating',
      error: null,
      source: null
    }
  });

  try {
    const result = await generateSeededGoalPrompt();
    const goal = typeof result === 'string' ? result : result?.goal;
    const source = typeof result === 'string' ? 'model' : (result?.source || 'model');
    setState({
      goal,
      goalGenerator: {
        status: 'ready',
        error: null,
        source
      }
    });
  } catch (err) {
    setState({
      goalGenerator: {
        status: 'error',
        error: err?.message || 'Failed to generate goal',
        source: null
      }
    });
  }
}

async function handleTestDirectKey() {
  const state = getState();
  let { provider, apiKey, baseUrl } = state.directConfig;

  const keyInput = document.getElementById('direct-key');
  const urlInput = document.getElementById('direct-base-url');
  if (keyInput?.value) apiKey = keyInput.value;
  if (urlInput?.value) baseUrl = urlInput.value;

  if (keyInput?.value) setNestedState('directConfig', { apiKey });
  if (urlInput?.value) setNestedState('directConfig', { baseUrl });

  if (!provider) {
    setNestedState('directConfig', {
      verifyState: VERIFY_STATE.FAILED,
      verifyError: 'Select a provider first'
    });
    return;
  }

  if (!apiKey) {
    setNestedState('directConfig', {
      verifyState: VERIFY_STATE.FAILED,
      verifyError: 'Enter an API key first'
    });
    return;
  }

  if (provider === 'other' && !baseUrl) {
    setNestedState('directConfig', {
      verifyState: VERIFY_STATE.FAILED,
      verifyError: 'Enter a base URL for custom provider'
    });
    return;
  }

  setNestedState('directConfig', { verifyState: VERIFY_STATE.TESTING, verifyError: null });

  const result = await testApiKey(provider, apiKey, baseUrl);
  if (result.success) {
    const currentModel = getState().directConfig.model;
    const models = CLOUD_MODELS[provider] || [];
    const autoModel = !currentModel && models.length > 0 ? models[0].id : currentModel;
    setNestedState('directConfig', {
      verifyState: VERIFY_STATE.VERIFIED,
      verifyError: null,
      model: autoModel
    });
  } else {
    setNestedState('directConfig', {
      verifyState: VERIFY_STATE.FAILED,
      verifyError: result.error
    });
  }
}

async function handleTestProxy() {
  const state = getState();
  const { url, serverType } = state.proxyConfig;
  if (!url) return;

  setNestedState('proxyConfig', { verifyState: VERIFY_STATE.TESTING });
  let result = await testProxyConnection(url, serverType);

  if (!result.success && !isZeroGeminiFunctionServer(serverType)) {
    result = await testLocalConnection(url);
    if (result.success) {
      setNestedState('proxyConfig', {
        serverType: 'ollama',
        availableModels: result.models || []
      });
    }
  } else if (result.success) {
    setNestedState('proxyConfig', {
      serverType: serverType || 'reploid',
      availableProviders: result.providers || []
    });
  }

  setNestedState('proxyConfig', {
    verifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
    verifyError: result.error
  });
}

async function handleTestProxyModel() {
  const state = getState();
  const { url, provider, model, serverType } = state.proxyConfig;
  if (!model) return;

  setNestedState('proxyConfig', { modelVerifyState: VERIFY_STATE.TESTING, modelVerifyError: null });

  const result = serverType === 'ollama'
    ? await testProxyModel(url, 'ollama', model)
    : await testProxyModel(url, provider, model, serverType);

  setNestedState('proxyConfig', {
    modelVerifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
    modelVerifyError: result.error
  });
}

async function handleTestDirectModel() {
  const state = getState();
  const { provider, apiKey, model, baseUrl } = state.directConfig;
  if (!model || !apiKey) return;

  setNestedState('directConfig', { modelVerifyState: VERIFY_STATE.TESTING, modelVerifyError: null });
  const result = await testDirectModel(provider, apiKey, model, baseUrl);
  setNestedState('directConfig', {
    modelVerifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
    modelVerifyError: result.error
  });
}

async function doAwaken() {
  const state = getState();
  const goalPacket = formatGoalPacket(state.goal);
  if (!goalPacket) return;
  let modelConfig = null;

  setState({
    isAwakening: true,
    vfsProgress: getCurrentFullSeedProgress() || {
      scope: 'full',
      phase: 'prepare',
      label: 'Preparing VFS hydration.',
      total: 0,
      current: 0,
      percent: 0
    }
  });

  try {
    modelConfig = state.mode === 'reploid'
      ? await resolveReploidModelConfig(state)
      : null;

    if (state.mode === 'reploid' && typeof window.preloadReploidModules === 'function') {
      await window.preloadReploidModules();
    }
    if (state.mode === 'reploid') {
      await clearVfsStore();
    } else {
      const fullSeed = window.REPLOID_VFS_FULL_SEED_PROMISE;
      if (fullSeed && typeof fullSeed.then === 'function') {
        setVfsProgress({
          ...(getCurrentFullSeedProgress() || {}),
          scope: 'full',
          phase: 'await',
          label: 'Waiting for first-load VFS hydration.'
        });
        await fullSeed;
      }

      const bootProfile = getBootSeedProfile();
      const shouldHydrateRouteFully = shouldHydrateFullManifest(bootProfile);
      const includeDoppler = shouldSeedDopplerVfs(state);
      const { manifest, text } = await loadVfsManifest({ includeDoppler });
      if (includeDoppler || (shouldHydrateRouteFully && !fullSeed)) {
        await seedVfsFromManifest(manifest, {
          preserveOnBoot: true,
          logger: console,
          manifestText: text,
          progressScope: 'full',
          progressLabel: includeDoppler ? 'VFS hydration with Doppler files' : 'Full VFS hydration',
          onProgress: setVfsProgress
        });
      }
      await ensureVfsFileMirrors(getRuntimeSelfMirrorsByBootProfile(bootProfile, manifest?.files || []), {
        overwrite: false,
        logger: console,
        progressScope: 'full',
        onProgress: setVfsProgress
      });
    }
  } catch (err) {
    console.error('[BootHome] Failed to prepare awaken:', err);
    if (state.mode === 'reploid' && state.connectionType !== 'direct') {
      setNestedState('accessConfig', {
        error: err?.message || 'Failed to unlock access code'
      });
    }
    setState({ isAwakening: false });
    return;
  }

  saveConfig();
  if (window.triggerAwaken) {
    if (state.mode === 'reploid') {
      window.triggerAwaken({
        goal: goalPacket,
        environment: String(state.environment || ''),
        swarmEnabled: !!state.swarmEnabled,
        modelConfig,
        seedOverrides: getSeedOverridesPayload(state)
      });
    } else {
      window.triggerAwaken(goalPacket);
    }
  }
}

function handleChange(event) {
  const id = event.target.id;
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;

  switch (id) {
    case 'direct-provider':
      setNestedState('directConfig', {
        provider: value,
        model: value === 'other' ? null : getDefaultCloudModelForProvider(value),
        baseUrl: null,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'direct-base-url':
      setNestedState('directConfig', {
        baseUrl: value,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'direct-model':
      setNestedState('directConfig', { model: value });
      break;

    case 'proxy-url':
      setNestedState('proxyConfig', {
        url: value,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'proxy-provider': {
      const models = CLOUD_MODELS[value] || [];
      setNestedState('proxyConfig', {
        provider: value,
        model: models[0]?.id || null
      });
      break;
    }

    case 'proxy-model':
      setNestedState('proxyConfig', { model: value });
      break;

    case 'reploid-swarm-enabled':
      setState({ swarmEnabled: value });
      getReploidStorage().setItem('REPLOID_SWARM_ENABLED', value ? 'true' : 'false');
      break;

    /* own-inference toggle handled by click action 'toggle-own-inference' */
  }
}

function handleInput(event) {
  const id = event.target.id;
  const value = event.target.value;

  switch (id) {
    case 'direct-key':
      setNestedState('directConfig', { apiKey: value });
      break;

    case 'direct-base-url':
      setNestedState('directConfig', { baseUrl: value });
      break;

    case 'direct-model':
      if (getState().directConfig.provider === 'other') {
        setNestedState('directConfig', { model: value });
      }
      break;

    case 'proxy-url':
      setNestedState('proxyConfig', { url: value });
      break;

    case 'proxy-model':
      setNestedState('proxyConfig', { model: value });
      break;

    case 'goal-input':
      setState({
        goal: value,
        goalGenerator: {
          status: 'idle',
          error: null,
          source: null
        }
      });
      break;

    case 'reploid-access-code':
      setNestedState('accessConfig', {
        accessCode: value,
        error: null
      });
      break;

    case 'environment-input':
      setState({
        environment: value,
        selectedEnvironmentTemplate: findReploidEnvironmentTemplateId(value)
      });
      break;

    case 'seed-editor-input': {
      const path = getState().selectedSelfPath;
      if (!path) break;
      setState({
        seedDrafts: {
          ...(getState().seedDrafts || {}),
          [path]: value
        }
      });
      break;
    }
  }
}

async function handleClick(event) {
  const actionEl = event.target.closest('[data-action]');
  const action = actionEl?.dataset.action;
  if (!action) return;

  event.preventDefault();
  if (actionEl.closest('.disclosure-summary-actions')) {
    event.stopPropagation();
  }
  const state = getState();

  switch (action) {
    case 'choose-browser':
      setState({ connectionType: 'browser' });
      if (!state.dopplerConfig?.model) {
        setNestedState('dopplerConfig', { model: DEFAULT_DOPPLER_MODEL });
      }
      break;

    case 'choose-direct':
      setState({ connectionType: 'direct' });
      break;

    case 'choose-proxy': {
      const detection = getState().detection;
      const currentProxyConfig = getState().proxyConfig;
      const proxyDetected = detection.proxy?.detected;
      const ollamaDetected = detection.ollama?.detected;
      let proxyUpdates = {};

      if (!currentProxyConfig.url) {
        if (proxyDetected) {
          proxyUpdates.url = detection.proxy.url;
          proxyUpdates.serverType = 'reploid';
        } else if (ollamaDetected) {
          proxyUpdates.url = detection.ollama.url;
          proxyUpdates.serverType = 'ollama';
        } else {
          proxyUpdates.url = 'http://localhost:8000';
        }
      }

      if (!currentProxyConfig.provider && proxyDetected) {
        const provider = getPreferredProxyProvider(detection);
        proxyUpdates.provider = provider;
        proxyUpdates.model = getPreferredProxyModel(provider);
      }

      if (state.mode === 'zero') {
        proxyUpdates = {
          ...proxyUpdates,
          ...getPreferredZeroProxyConfig({
            ...state,
            proxyConfig: {
              ...currentProxyConfig,
              ...proxyUpdates
            },
            detection
          })
        };
      }

      if (Object.keys(proxyUpdates).length > 0) {
        setNestedState('proxyConfig', proxyUpdates);
      }
      setState({ connectionType: 'proxy' });
      break;
    }

    case 'toggle-own-inference': {
      const currentlyByok = isUsingOwnInference(getState());
      const next = !currentlyByok;
      getReploidStorage().setItem('REPLOID_USE_OWN_INFERENCE', next ? 'true' : 'false');
      if (next) {
        const saved = checkSavedConfig();
        if (saved?.primaryHostType === 'browser-cloud' && saved?.hasSavedKey) {
          hydrateSavedConfig(saved);
        } else {
          setState({ connectionType: 'direct' });
          setNestedState('directConfig', {
            provider: null,
            model: null,
            apiKey: null,
            baseUrl: null,
            verifyState: VERIFY_STATE.UNVERIFIED,
            verifyError: null,
            modelVerifyState: VERIFY_STATE.UNVERIFIED,
            modelVerifyError: null
          });
        }
      } else {
        setNestedState('accessConfig', {
          error: null
        });
        setState({ connectionType: 'access' });
      }
      break;
    }

    case 'toggle-goal-category': {
      const category = event.target.closest('[data-category]')?.dataset.category;
      if (category) setState({ selectedGoalCategory: category });
      break;
    }

    case 'select-goal': {
      const button = event.target.closest('[data-goal]');
      const goalValue = button?.dataset.goal;
      if (!goalValue) break;
      const category = button.closest('[data-category]')?.dataset.category;
      setState({
        goal: goalValue,
        selectedGoalCategory: category || state.selectedGoalCategory,
        goalGenerator: {
          status: 'idle',
          error: null,
          source: null
        }
      });
      break;
    }

    case 'shuffle-goals': {
      const goalShuffleSeed = Date.now();
      const shuffledGoal = getRandomGoalEntry(goalShuffleSeed, state.goal);
      setState({
        goalShuffleSeed,
        goal: shuffledGoal?.goal?.text || state.goal,
        selectedGoalCategory: shuffledGoal?.category || state.selectedGoalCategory,
        goalGenerator: {
          status: 'idle',
          error: null,
          source: null
        }
      });
      break;
    }

    case 'generate-goal':
      await handleGenerateGoal();
      break;

    case 'apply-environment-template': {
      const button = event.target.closest('[data-template]');
      const templateId = button?.dataset.template;
      const template = getReploidEnvironmentTemplate(templateId);
      if (!template) break;
      setState({
        environment: template.text,
        selectedEnvironmentTemplate: template.id
      });
      break;
    }

    case 'select-self-path': {
      const button = event.target.closest('[data-path]');
      const path = button?.dataset.path;
      if (path) setState({ selectedSelfPath: path });
      break;
    }

    case 'start-seed-edit': {
      if (state.selectedSelfPath) {
        setState({ editingSeedPath: state.selectedSelfPath });
      }
      break;
    }

    case 'save-seed-edit': {
      const path = state.selectedSelfPath;
      if (!path) break;
      const editor = document.getElementById('seed-editor-input');
      const nextContent = typeof editor?.value === 'string'
        ? editor.value
        : state.seedDrafts?.[path];
      if (typeof nextContent !== 'string') break;
      setState({
        seedOverrides: {
          ...(state.seedOverrides || {}),
          [path]: nextContent
        },
        seedDrafts: omitPathEntry(state.seedDrafts, path),
        editingSeedPath: null
      });
      break;
    }

    case 'cancel-seed-edit': {
      const path = state.selectedSelfPath;
      if (!path) break;
      setState({
        seedDrafts: omitPathEntry(state.seedDrafts, path),
        editingSeedPath: state.editingSeedPath === path ? null : state.editingSeedPath
      });
      break;
    }

    case 'revert-seed-file': {
      const path = state.selectedSelfPath;
      if (!path) break;
      setState({
        seedOverrides: omitPathEntry(state.seedOverrides, path),
        seedDrafts: omitPathEntry(state.seedDrafts, path),
        editingSeedPath: state.editingSeedPath === path ? null : state.editingSeedPath
      });
      break;
    }

    case 'select-doppler-model': {
      const modelId = event.target.closest('[data-model]')?.dataset.model;
      if (modelId) {
        setNestedState('dopplerConfig', { model: modelId });
      }
      break;
    }

    case 'test-direct-key':
      await handleTestDirectKey();
      break;

    case 'test-direct-model':
      await handleTestDirectModel();
      break;

    case 'test-proxy':
      await handleTestProxy();
      break;

    case 'test-proxy-model':
      await handleTestProxyModel();
      break;

    case 'switch-to-byok':
      setState({
        connectionType: null
      });
      break;

    case 'awaken':
      await doAwaken();
      break;
  }
}

function handleToggle(event) {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  if (details.classList.contains('goal-level-dropdown')) {
    setState({ goalPresetsOpen: details.open });
  } else if (details.classList.contains('inference-bar-shared-details')) {
    sponsorAccessExpanded = details.open;
  }
}

function handleFocusOut(event) {
  if (event.target?.id === 'goal-input' && pendingDeferredRender) {
    scheduleRender();
  }
}

function attachEventListeners() {
  if (!container) return;
  container.addEventListener('click', handleClick);
  container.addEventListener('change', handleChange);
  container.addEventListener('input', handleInput);
  container.addEventListener('toggle', handleToggle, true);
  container.addEventListener('focusout', handleFocusOut, true);
}

function render() {
  if (!container) return;

  const activeEl = document.activeElement;
  const focusId = activeEl?.id || null;
  const focusSelStart = activeEl?.selectionStart;
  const focusSelEnd = activeEl?.selectionEnd;
  const scrollTop = container.scrollTop;

  const state = getState();
  const homeConfig = getRouteHomeConfig(state.mode);
  const hasGoal = !!(state.goal && state.goal.trim());
  const launch = state.mode === 'reploid'
    ? getReploidLaunchState(state)
    : null;
  let html = '<div class="wizard-sections wizard-sections-home">';

  if (state.mode === 'reploid') {
    html += renderIntroStep();
    html += renderManagedInferenceStep(state);

    if (isUsingOwnInference(state)) {
      if (state.connectionType === 'direct') {
        html += `<div class="wizard-direct">${renderDirectConfigStep(state)}</div>`;
      } else if (state.connectionType === 'proxy') {
        html += `<div class="wizard-proxy">${renderProxyConfigStep(state)}</div>`;
      } else if (state.connectionType === 'browser') {
        html += `<div class="wizard-browser">${renderBrowserConfigStep(state)}</div>`;
      }
    }

    html += renderGoalStep(state, {
      title: homeConfig.goalTitle,
      caption: homeConfig.goalCaption,
      hideBootInternals: homeConfig.hideBootInternals,
      goalActionMode: homeConfig.goalActionMode,
      generatedStatusText: homeConfig.generatedStatusText,
      goalPlaceholder: homeConfig.goalPlaceholder,
      headingClass: 'type-h2',
      showMinimalAwakenedFiles: false,
      primaryActionHtml: renderAwakenButton(state, {
        disabled: state.isAwakening || !hasGoal || !launch?.canAwaken
      })
    });

    html += renderAwakenedFilesPanel(state, {
      showSourceBrowser: false,
      defaultOpen: false
    });
  } else {
    const hasConnectionType = !!state.connectionType;
    html += `
      <div class="wizard-step wizard-home-provider">
        ${renderConnectionProviderOptions(state, {
          standalone: true,
          title: homeConfig.providerTitle || 'Choose inference provider',
          caption: homeConfig.providerCaption,
          allowedConnectionTypes: homeConfig.allowedConnectionTypes
        })}
      </div>
    `;

    if (!hasConnectionType) {
      html += renderLockedSection('Configure inference', 'Choose an inference provider to unlock this section.');
    } else if (state.connectionType === 'direct') {
      html += `<div class="wizard-direct">${renderDirectConfigStep(state)}</div>`;
    } else if (state.connectionType === 'proxy') {
      html += `<div class="wizard-proxy">${renderProxyConfigStep(state)}</div>`;
    } else if (state.connectionType === 'browser') {
      html += `<div class="wizard-browser">${renderBrowserConfigStep(state)}</div>`;
    }

    if (!canAwaken()) {
      html += renderLockedSection(
        homeConfig.goalTitle,
        hasConnectionType
          ? 'Finish inference configuration to unlock the objective editor.'
          : 'Choose and configure inference before continuing.'
      );
      } else {
        html += renderGoalStep(state, {
          title: homeConfig.goalTitle,
          caption: homeConfig.goalCaption,
          hideBootInternals: homeConfig.hideBootInternals,
          goalActionMode: homeConfig.goalActionMode,
          generatedStatusText: homeConfig.generatedStatusText,
          goalPlaceholder: homeConfig.goalPlaceholder,
          headingClass: 'type-h2',
          primaryActionHtml: renderAwakenButton(state, {
            large: true,
            disabled: state.isAwakening || !hasGoal || !canAwaken()
          })
        });
      }

    html += renderVfsProgress(state);
  }

  html += '</div>';
  container.innerHTML = html;

  container.scrollTop = scrollTop;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (typeof focusSelStart === 'number' && typeof el.setSelectionRange === 'function') {
        try {
          el.setSelectionRange(focusSelStart, focusSelEnd);
        } catch (error) {
          console.debug('[BootHome] Failed to restore selection:', error?.message || error);
        }
      }
    }
  }

  if (!listenersAttached) {
    attachEventListeners();
    listenersAttached = true;
  }

}

export function initLockedBootHome(containerEl, mode = 'reploid') {
  container = containerEl;
  listenersAttached = false;
  renderScheduled = false;
  sponsorAccessExpanded = false;
  isInitialRender = true;
  lastRenderSignature = null;
  pendingDeferredRender = false;
  attachVfsProgressListener();

  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }

  const routeMode = ROUTE_HOME_CONFIG[mode] ? mode : 'reploid';
  const homeConfig = getRouteHomeConfig(routeMode);
  resetWizard();
  const defaultGoal = String(getState().goal || '').trim()
    ? getState().goal
    : String(homeConfig.defaultGoal || '');

  const storage = getReploidStorage();
  const swarmEnabled = getStoredSwarmEnabled();
  if (storage.getItem('REPLOID_SWARM_ENABLED') === null) {
    storage.setItem('REPLOID_SWARM_ENABLED', swarmEnabled ? 'true' : 'false');
  }
  const useOwnInference = storage.getItem('REPLOID_USE_OWN_INFERENCE') === 'true';
  const managedReploid = routeMode === 'reploid'
      ? {
        connectionType: useOwnInference ? 'direct' : 'access',
        environment: getDefaultReploidEnvironment(),
        selectedEnvironmentTemplate: null,
        goal: defaultGoal,
        swarmEnabled
      }
    : {};
  const managedZero = routeMode === 'zero'
    ? {
      connectionType: 'proxy',
      proxyConfig: getPreferredZeroProxyConfig(getState()),
      goal: defaultGoal
    }
    : {};
  setState({
    currentStep: STEPS.GOAL,
    mode: routeMode,
    routeLockedMode: routeMode,
    isAwakening: false,
    vfsProgress: getCurrentFullSeedProgress(),
    ...managedReploid,
    ...managedZero
  });

  unsubscribeState = subscribe(scheduleRender);

  const saved = checkSavedConfig();
  if (useOwnInference && saved?.hasSavedKey) {
    hydrateSavedConfig(saved);
  }
  setState({ savedConfig: saved });
  scheduleRender();

  const skipStartupDiscovery = routeMode === 'zero' || routeMode === 'x';
  runDetection({
    skipLocalScan: skipStartupDiscovery,
    skipDoppler: skipStartupDiscovery,
    onProgress: scheduleRender
  }).then(() => {
    autoSelectConnectionType();
  }).catch((err) => {
    console.warn('[BootHome] Detection failed:', err?.message || err);
  });
}

export function initReploidHome(containerEl) {
  initLockedBootHome(containerEl, 'reploid');
}
