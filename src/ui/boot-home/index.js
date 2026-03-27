/**
 * @fileoverview Minimal route-locked boot UI for /, /0, and /x.
 */

import {
  STEPS,
  VERIFY_STATE,
  canAwaken,
  checkSavedConfig,
  getState,
  hydrateSavedConfig,
  resetWizard,
  saveConfig,
  setNestedState,
  setState,
  subscribe
} from '../boot-wizard/state.js';
import {
  generateGoalPrompt,
  runDetection,
  testApiKey,
  testDirectModel,
  testLocalConnection,
  testProxyConnection,
  testProxyModel
} from '../boot-wizard/detection.js';
import { formatGoalPacket, getGoalEntries } from '../boot-wizard/goals.js';
import {
  findAbsoluteZeroEnvironmentTemplateId,
  getAbsoluteZeroEnvironmentTemplate
} from '../../config/absolute-zero-environments.js';
import { ABSOLUTE_ZERO_HOST_SOURCE_MIRRORS, ABSOLUTE_ZERO_SELF_SOURCE_MIRRORS } from '../../capsule/contract.js';
import { clearVfsStore, loadVfsManifest, seedVfsFromManifest } from '../../boot-helpers/vfs-bootstrap.js';
import { renderConnectionProviderOptions } from '../boot-wizard/steps/choose.js';
import { CLOUD_MODELS, renderDirectConfigStep } from '../boot-wizard/steps/direct.js';
import { renderProxyConfigStep } from '../boot-wizard/steps/proxy.js';
import { renderBrowserConfigStep } from '../boot-wizard/steps/browser.js';
import { renderGoalStep } from '../boot-wizard/steps/goal.js';

const DEFAULT_DOPPLER_MODEL = 'smollm2-360m';
const VFS_BYPASS_HEADER = 'x-reploid-vfs-bypass';
const ROUTE_HOME_CONFIG = Object.freeze({
  absolute_zero: {
    providerMode: 'choice',
    providerCaption: 'Pick where reasoning runs before composing the initial Absolute Zero substrate.',
    goalTitle: 'Compose substrate',
    goalCaption: 'Absolute Zero starts from the contract-visible substrate only.',
    awakenCaption: 'Launch Absolute Zero with the current environment and selected inference path.',
    hideBootInternals: true
  },
  zero: {
    providerMode: 'choice',
    providerCaption: 'Pick where reasoning runs before loading Zero.',
    goalTitle: 'Set a goal',
    goalCaption: 'Set the first goal the mutable local substrate should pursue.',
    awakenCaption: 'Launch Zero with the selected inference path and first goal.',
    hideBootInternals: true
  },
  x: {
    providerMode: 'choice',
    providerCaption: 'Pick where reasoning runs before loading the prebuilt RSI surface.',
    goalTitle: 'Set a goal',
    goalCaption: 'Set the first goal the mature substrate should pursue.',
    awakenCaption: 'Launch X with the selected inference path and first goal.',
    hideBootInternals: true
  }
});

let container = null;
let listenersAttached = false;
let renderScheduled = false;
let unsubscribeState = null;

const fetchPreviewSourceText = async (webPath) => {
  const response = await fetch(webPath, {
    cache: 'no-store',
    headers: {
      [VFS_BYPASS_HEADER]: '1'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to load preview source: ${webPath} (${response.status})`);
  }
  return response.text();
};

const loadMirrorContents = async (mirrors) => {
  const entries = await Promise.all(
    mirrors.map(async ({ webPath, vfsPath }) => [vfsPath, await fetchPreviewSourceText(webPath)])
  );
  return Object.fromEntries(entries);
};

const renderLockedSection = (title, caption) => `
  <div class="wizard-step wizard-stage-placeholder">
    <div class="goal-header">
      <h2 class="type-h1">${title}</h2>
      <p class="type-caption">${caption}</p>
    </div>
  </div>
`;

const getDefaultCloudModelForProvider = (provider) => {
  const models = CLOUD_MODELS[provider] || [];
  return models[0]?.id || null;
};

const getRouteHomeConfig = (mode) => ROUTE_HOME_CONFIG[mode] || ROUTE_HOME_CONFIG.absolute_zero;

const scheduleRender = () => {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
};

const ensureAbsoluteZeroPreviewLoaded = async (includeHostWithinSelf = false) => {
  const current = getState().absoluteZeroPreview || {};
  const needSelf = !current.loadedSelf && !current.loadingSelf;
  const needHost = includeHostWithinSelf && !current.loadedHost && !current.loadingHost;

  if (!needSelf && !needHost) return;

  setNestedState('absoluteZeroPreview', {
    loadingSelf: current.loadingSelf || needSelf,
    loadingHost: current.loadingHost || needHost,
    error: null
  });

  try {
    const nextContents = { ...(getState().absoluteZeroPreview?.contents || {}) };
    if (needSelf) {
      Object.assign(nextContents, await loadMirrorContents(ABSOLUTE_ZERO_SELF_SOURCE_MIRRORS));
    }
    if (needHost) {
      Object.assign(nextContents, await loadMirrorContents(ABSOLUTE_ZERO_HOST_SOURCE_MIRRORS));
    }

    setNestedState('absoluteZeroPreview', {
      contents: nextContents,
      loadingSelf: false,
      loadedSelf: current.loadedSelf || needSelf,
      loadingHost: false,
      loadedHost: current.loadedHost || needHost,
      error: null
    });
  } catch (err) {
    setNestedState('absoluteZeroPreview', {
      loadingSelf: false,
      loadingHost: false,
      error: err?.message || 'Failed to load Absolute Zero file previews'
    });
  }
};

const autoSelectConnectionType = () => {
  const state = getState();
  if (state.connectionType) return;

  const { detection, savedConfig } = state;
  if (state.mode === 'zero' && detection.webgpu?.supported) {
    setState({ connectionType: 'browser' });
    return;
  }

  const proxyDetected = detection.proxy?.detected;
  const hasSavedKeys = savedConfig?.hasSavedKey;
  const webgpuSupported = detection.webgpu?.supported;
  const options = [];

  if (proxyDetected) options.push('proxy');
  if (hasSavedKeys) options.push('direct');
  if (webgpuSupported && !proxyDetected && !hasSavedKeys) options.push('browser');

  if (options.length !== 1) return;

  const choice = options[0];
  if (choice === 'proxy') {
    const providers = detection.proxy?.configuredProviders || [];
    const proxyUpdates = {
      url: detection.proxy.url,
      serverType: 'reploid'
    };
    if (providers.length > 0) {
      proxyUpdates.provider = providers[0];
      const providerModels = CLOUD_MODELS[providers[0]] || [];
      if (providerModels.length > 0) {
        proxyUpdates.model = providerModels[0].id;
      }
    }
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
  setState({
    goalGenerator: {
      status: 'generating',
      error: null
    }
  });

  try {
    const goal = await generateGoalPrompt();
    setState({
      goal,
      goalGenerator: {
        status: 'ready',
        error: null
      }
    });
  } catch (err) {
    setState({
      goalGenerator: {
        status: 'error',
        error: err?.message || 'Failed to generate goal'
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
  const { url } = state.proxyConfig;
  if (!url) return;

  setNestedState('proxyConfig', { verifyState: VERIFY_STATE.TESTING });
  let result = await testProxyConnection(url);

  if (!result.success) {
    result = await testLocalConnection(url);
    if (result.success) {
      setNestedState('proxyConfig', {
        serverType: 'ollama',
        availableModels: result.models || []
      });
    }
  } else {
    setNestedState('proxyConfig', {
      serverType: 'reploid',
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
    : await testProxyModel(url, provider, model);

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

  setState({ isAwakening: true });

  try {
    if (state.mode === 'absolute_zero' && typeof window.preloadAbsoluteZeroModules === 'function') {
      await window.preloadAbsoluteZeroModules();
    }
    await clearVfsStore();
    if (state.mode !== 'absolute_zero') {
      const { manifest, text } = await loadVfsManifest();
      await seedVfsFromManifest(manifest, {
        preserveOnBoot: false,
        logger: console,
        manifestText: text
      });
    }
  } catch (err) {
    console.error('[BootHome] Failed to prepare awaken:', err);
    setState({ isAwakening: false });
    return;
  }

  saveConfig();
  if (window.triggerAwaken) {
    if (state.mode === 'absolute_zero') {
      window.triggerAwaken({
        goal: goalPacket,
        environment: String(state.environment || ''),
        includeHostWithinSelf: !!state.includeHostWithinSelf
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

    case 'include-host-within-self':
      setState({ includeHostWithinSelf: value });
      localStorage.setItem('REPLOID_INCLUDE_HOST_WITHIN_SELF', value ? 'true' : 'false');
      break;
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
          error: null
        }
      });
      break;

    case 'environment-input':
      setState({
        environment: value,
        selectedEnvironmentTemplate: findAbsoluteZeroEnvironmentTemplateId(value)
      });
      break;
  }
}

async function handleClick(event) {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  event.preventDefault();
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
      const providers = detection.proxy?.configuredProviders || [];
      const proxyDetected = detection.proxy?.detected;
      const ollamaDetected = detection.ollama?.detected;
      const proxyUpdates = {};

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

      if (providers.length > 0 && !currentProxyConfig.provider) {
        const firstProvider = providers[0];
        const providerModels = CLOUD_MODELS[firstProvider] || [];
        proxyUpdates.provider = firstProvider;
        proxyUpdates.model = providerModels[0]?.id || null;
      }

      if (Object.keys(proxyUpdates).length > 0) {
        setNestedState('proxyConfig', proxyUpdates);
      }
      setState({ connectionType: 'proxy' });
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
          error: null
        }
      });
      break;
    }

    case 'shuffle-goals': {
      const goalShuffleSeed = Date.now();
      const shuffledGoal = getGoalEntries(goalShuffleSeed)
        .flatMap(([category, goals]) => goals.map((goal) => ({ category, goal })))
        .find((entry) => !entry.goal?.locked);
      setState({
        goalShuffleSeed,
        goal: shuffledGoal?.goal?.text || state.goal,
        selectedGoalCategory: shuffledGoal?.category || state.selectedGoalCategory,
        goalGenerator: {
          status: 'idle',
          error: null
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
      const template = getAbsoluteZeroEnvironmentTemplate(templateId);
      if (!template) break;
      setState({
        environment: template.text,
        selectedEnvironmentTemplate: template.id
      });
      break;
    }

    case 'select-absolute-zero-path': {
      const button = event.target.closest('[data-path]');
      const path = button?.dataset.path;
      if (path) setState({ selectedAbsoluteZeroPath: path });
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

    case 'awaken':
      await doAwaken();
      break;
  }
}

function attachEventListeners() {
  if (!container) return;
  container.addEventListener('click', handleClick);
  container.addEventListener('change', handleChange);
  container.addEventListener('input', handleInput);
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
  const hasConnectionType = !!state.connectionType;
  const ready = canAwaken();
  const hasGoal = !!(state.goal && state.goal.trim());
  let html = '<div class="wizard-sections wizard-sections-home">';

  html += `
    <div class="wizard-step wizard-home-provider">
      ${renderConnectionProviderOptions(state, {
        standalone: true,
        caption: homeConfig.providerCaption
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

  if (!ready) {
    html += renderLockedSection(
      homeConfig.goalTitle,
      hasConnectionType
        ? (state.mode === 'absolute_zero'
          ? 'Finish inference configuration to unlock the contract-visible substrate editor.'
          : 'Finish inference configuration to unlock the goal editor.')
        : 'Choose and configure inference before continuing.'
    );
  } else {
    html += renderGoalStep(state, {
      title: homeConfig.goalTitle,
      caption: homeConfig.goalCaption,
      hideBootInternals: homeConfig.hideBootInternals
    });
  }

  if (!ready || !hasGoal) {
    html += renderLockedSection(
      'Awaken',
      !ready
        ? 'Finish inference configuration and set a goal before awakening.'
        : 'Set a goal to unlock this section.'
    );
  } else {
    html += `
      <div class="wizard-step wizard-awaken wizard-awaken-simple">
        <div class="goal-header">
          <h2 class="type-h1">Awaken</h2>
          <p class="type-caption">${homeConfig.awakenCaption}</p>
        </div>

        <div class="wizard-actions-row">
          <button class="btn btn-lg btn-prism${state.isAwakening ? ' loading' : ''}"
                  data-action="awaken"
                  id="awaken-btn"
                  ${state.isAwakening ? 'disabled' : ''}
                  aria-busy="${state.isAwakening ? 'true' : 'false'}">
            ${state.isAwakening ? 'Awakening...' : 'Awaken Agent'}
          </button>
        </div>
      </div>
    `;
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

  if (state.mode === 'absolute_zero') {
    ensureAbsoluteZeroPreviewLoaded(!!state.includeHostWithinSelf);
  }

  if (!listenersAttached) {
    attachEventListeners();
    listenersAttached = true;
  }
}

export function initLockedBootHome(containerEl, mode = 'absolute_zero') {
  container = containerEl;
  listenersAttached = false;
  renderScheduled = false;

  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }

  const routeMode = ROUTE_HOME_CONFIG[mode] ? mode : 'absolute_zero';
  resetWizard();
  setState({
    currentStep: STEPS.GOAL,
    mode: routeMode,
    routeLockedMode: routeMode,
    advancedOpen: false,
    isAwakening: false
  });

  unsubscribeState = subscribe(scheduleRender);

  const saved = checkSavedConfig();
  setState({ savedConfig: saved });
  scheduleRender();

  runDetection({
    skipLocalScan: false,
    onProgress: scheduleRender
  }).then(() => {
    autoSelectConnectionType();
  }).catch((err) => {
    console.warn('[BootHome] Detection failed:', err?.message || err);
  });
}

export function initAbsoluteZeroHome(containerEl) {
  initLockedBootHome(containerEl, 'absolute_zero');
}
