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
  findReploidEnvironmentTemplateId,
  getDefaultReploidEnvironment,
  getReploidEnvironmentTemplate
} from '../../config/reploid-environments.js';
import { clearVfsStore, loadVfsManifest, seedVfsFromManifest } from '../../boot-helpers/vfs-bootstrap.js';
import {
  getReploidLaunchState,
  hasDirectInferenceConfig,
  resolveReploidModelConfig
} from '../boot-wizard/reploid-inference.js';
import { renderConnectionProviderOptions } from '../boot-wizard/steps/choose.js';
import { CLOUD_MODELS, renderDirectConfigStep } from '../boot-wizard/steps/direct.js';
import { renderProxyConfigStep } from '../boot-wizard/steps/proxy.js';
import { renderBrowserConfigStep } from '../boot-wizard/steps/browser.js';
import { renderGoalStep } from '../boot-wizard/steps/goal.js';

const DEFAULT_DOPPLER_MODEL = 'smollm2-360m';
const DEFAULT_GTM_PROXY_PROVIDER = 'gemini';
const DEFAULT_GTM_PROXY_MODEL = 'gemini-3.1-flash-lite-preview';
const ROUTE_HOME_CONFIG = Object.freeze({
  reploid: {
    providerMode: 'choice',
    providerCaption: 'Primary Reploid keeps boot minimal: access code, your own inference, or swarm consumer mode.',
    goalTitle: 'Compose self',
    goalCaption: 'Reploid starts from explicit self files: manifest, identity, access windows, runtime, bridge, tool runner, Capsule shell, and writable roots for memory, tools, and artifacts.',
    awakenCaption: 'Awaken a minimal browser-native seed Reploid with explicit self files for runtime, identity, collaboration, and self-improvement.',
    hideBootInternals: true
  },
  zero: {
    providerMode: 'choice',
    providerCaption: 'Pick where reasoning runs before awakening Zero.',
    goalTitle: 'Set the first objective',
    goalCaption: 'Set the first objective for the mutable local Reploid.',
    awakenCaption: 'Awaken Zero with the selected inference path and first objective.',
    hideBootInternals: true
  },
  x: {
    providerMode: 'choice',
    providerCaption: 'Pick where reasoning runs before loading the prebuilt RSI surface.',
    goalTitle: 'Set the first objective',
    goalCaption: 'Set the first goal the mature substrate should pursue.',
    awakenCaption: 'Awaken X with the selected inference path and first goal.',
    hideBootInternals: true
  }
});

let container = null;
let listenersAttached = false;
let renderScheduled = false;
let unsubscribeState = null;

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

const getRouteHomeConfig = (mode) => ROUTE_HOME_CONFIG[mode] || ROUTE_HOME_CONFIG.reploid;
const isUsingOwnInference = (state) => state.mode === 'reploid' && state.connectionType === 'direct';

const renderIntroStep = () => `
  <div class="wizard-step wizard-intro">
    <div class="goal-header">
      <h2 class="type-h1">Reploid</h2>
      <p class="type-caption">Self-modifying browser substrate that boots from explicit self files, then iteratively rewrites and extends its own runtime, tools, and shell. A reversible, auditable seed for bounded recursive self-improvement under staged capability gates.</p>
    </div>
  </div>
`;

const renderManagedInferenceStep = (state) => {
  const launch = getReploidLaunchState(state);
  const byokEnabled = launch.ownInference;
  const modelLabel = byokEnabled
    ? (state.directConfig?.model || 'Configure below')
    : launch.accessModel;
  const statusLabel = byokEnabled ? 'Your inference' : 'Access code';

  let caption = '';
  if (byokEnabled) {
    caption = hasDirectInferenceConfig(state)
      ? (launch.swarmEnabled
        ? 'Swarm on. This Reploid will provide inference to peers after awaken.'
        : 'Solo. Inference stays private to this Reploid.')
      : 'Finish configuring your own inference below, or turn Configure off to return to access code.';
  } else if (launch.hasAccessInference) {
    caption = launch.swarmEnabled
      ? `Swarm on. Access code unlocks provider mode for the ${launch.accessWindowLabel} access window.`
      : `Solo. Access code unlocks local inference in the browser for the ${launch.accessWindowLabel} access window.`;
  } else if (!launch.accessProvisioned) {
    caption = launch.swarmEnabled
      ? 'No access window is provisioned in this build. Swarm consumer mode can still awaken without local inference.'
      : 'No access window is provisioned in this build yet. Use Configure for BYOK or enable Swarm to awaken as a consumer.';
  } else if (launch.swarmEnabled) {
    caption = `Enter the ${launch.accessWindowLabel} access code to awaken as a provider, or continue without one to awaken as a swarm consumer.`;
  } else {
    caption = `Enter the ${launch.accessWindowLabel} access code to unlock inference, or use Configure to bring your own key.`;
  }

  return `
    <div class="wizard-step inference-bar">
      <div class="inference-bar-row">
        <div class="inference-bar-status">
          <span class="inference-bar-label">${statusLabel}</span>
          <span class="inference-bar-model">${modelLabel}</span>
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
            <span>Swarm</span>
          </label>
        </div>
      </div>
      <div class="inference-bar-row inference-bar-row-access">
        <input type="password"
               id="reploid-access-code"
               class="inference-bar-input"
               placeholder="${launch.accessProvisioned ? 'Enter access code' : 'Provision access windows to enable this path'}"
               value="${state.accessConfig?.accessCode || ''}"
               ${byokEnabled ? 'disabled' : ''}
               autocomplete="off"
               spellcheck="false" />
        <div class="inference-bar-meta">
          <span class="type-caption">${caption}</span>
          ${state.accessConfig?.error ? `
            <span class="type-caption type-caption-error">☒ ${state.accessConfig.error}</span>
          ` : ''}
        </div>
      </div>
    </div>
  `;
};

const scheduleRender = () => {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
};

const autoSelectConnectionType = () => {
  const state = getState();
  if (state.connectionType) return;

  if (state.mode === 'reploid' && state.routeLockedMode === 'reploid') {
    const useOwnInference = localStorage.getItem('REPLOID_USE_OWN_INFERENCE') === 'true';
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

  if (state.mode === 'zero' && detection.webgpu?.supported) {
    setState({ connectionType: 'browser' });
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
  let modelConfig = null;

  setState({ isAwakening: true });

  try {
    modelConfig = state.mode === 'reploid'
      ? await resolveReploidModelConfig(state)
      : null;

    if (state.mode === 'reploid' && typeof window.preloadReploidModules === 'function') {
      await window.preloadReploidModules();
    }
    await clearVfsStore();
    if (state.mode !== 'reploid') {
      const { manifest, text } = await loadVfsManifest();
      await seedVfsFromManifest(manifest, {
        preserveOnBoot: false,
        logger: console,
        manifestText: text
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
        includeBootstrapperWithinSelf: false,
        swarmEnabled: !!state.swarmEnabled,
        modelConfig
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

    case 'include-bootstrapper-within-self':
      setState({ includeBootstrapperWithinSelf: value });
      localStorage.setItem('REPLOID_INCLUDE_BOOTSTRAPPER_WITHIN_SELF', value ? 'true' : 'false');
      break;

    case 'reploid-swarm-enabled':
      setState({ swarmEnabled: value });
      localStorage.setItem('REPLOID_SWARM_ENABLED', value ? 'true' : 'false');
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
          error: null
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

      if (!currentProxyConfig.provider && proxyDetected) {
        const provider = getPreferredProxyProvider(detection);
        proxyUpdates.provider = provider;
        proxyUpdates.model = getPreferredProxyModel(provider);
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
      localStorage.setItem('REPLOID_USE_OWN_INFERENCE', next ? 'true' : 'false');
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
  }
}

function attachEventListeners() {
  if (!container) return;
  container.addEventListener('click', handleClick);
  container.addEventListener('change', handleChange);
  container.addEventListener('input', handleInput);
  container.addEventListener('toggle', handleToggle, true);
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
      hideBootInternals: homeConfig.hideBootInternals
    });

    const awakenDisabled = state.isAwakening || !hasGoal || !launch?.canAwaken;
    let awakenCaption = homeConfig.awakenCaption;
    if (!hasGoal) {
      awakenCaption = 'Set a first objective, then awaken.';
    } else if (launch?.isDead) {
      awakenCaption = 'Enter an access code, configure your own inference, or enable Swarm to awaken as a consumer.';
    } else if (launch?.role === 'consumer') {
      awakenCaption = 'Awaken as a swarm consumer. This Reploid has no local inference and will wait for provider peers.';
    } else if (launch?.role === 'provider') {
      awakenCaption = 'Awaken as a swarm provider. This Reploid may serve peers while continuing its own work.';
    }

    html += `
      <div class="wizard-step wizard-awaken wizard-awaken-simple">
        <div class="goal-header">
          <h2 class="type-h1">Awaken</h2>
          <p class="type-caption">${awakenCaption}</p>
        </div>
        <div class="wizard-actions-row">
          <button class="btn btn-lg btn-prism${state.isAwakening ? ' loading' : ''}"
                  data-action="awaken"
                  id="awaken-btn"
                  ${awakenDisabled ? 'disabled' : ''}
                  aria-busy="${state.isAwakening ? 'true' : 'false'}">
            ${state.isAwakening ? 'Awakening...' : 'Awaken'}
          </button>
        </div>
      </div>
    `;
  } else {
    const hasConnectionType = !!state.connectionType;
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
        hideBootInternals: homeConfig.hideBootInternals
      });
    }

    if (!canAwaken() || !hasGoal) {
      html += renderLockedSection(
        'Awaken',
        !canAwaken()
          ? 'Finish inference configuration and set a first objective before awakening.'
          : 'Set a first objective to unlock this section.'
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
              ${state.isAwakening ? 'Awakening...' : 'Awaken'}
            </button>
          </div>
        </div>
      `;
    }
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

  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }

  const routeMode = ROUTE_HOME_CONFIG[mode] ? mode : 'reploid';
  resetWizard();

  const swarmEnabled = localStorage.getItem('REPLOID_SWARM_ENABLED') === 'true';
  const useOwnInference = localStorage.getItem('REPLOID_USE_OWN_INFERENCE') === 'true';
  const managedReploid = routeMode === 'reploid'
    ? {
        connectionType: useOwnInference ? 'direct' : 'access',
        environment: getDefaultReploidEnvironment(),
        selectedEnvironmentTemplate: null,
        includeBootstrapperWithinSelf: false,
        swarmEnabled
      }
    : {};
  setState({
    currentStep: STEPS.GOAL,
    mode: routeMode,
    routeLockedMode: routeMode,
    isAwakening: false,
    ...managedReploid
  });

  unsubscribeState = subscribe(scheduleRender);

  const saved = checkSavedConfig();
  if (useOwnInference && saved?.hasSavedKey) {
    hydrateSavedConfig(saved);
  }
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

export function initReploidHome(containerEl) {
  initLockedBootHome(containerEl, 'reploid');
}
