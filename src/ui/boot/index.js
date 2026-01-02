/**
 * @fileoverview Boot Wizard UI
 * Step-by-step configuration wizard for Reploid.
 */

import {
  STEPS, VERIFY_STATE,
  getState, setState, setNestedState, subscribe,
  goToStep, checkSavedConfig, saveConfig, forgetDevice,
  canAwaken, hydrateSavedConfig
} from './state.js';

import {
  runDetection, testApiKey, testProxyConnection, testLocalConnection,
  testProxyModel, testDirectModel
} from './detection.js';

// Step renderers
import { renderChooseStep } from './steps/choose.js';
import { renderDirectConfigStep, CLOUD_MODELS } from './steps/direct.js';
import { renderProxyConfigStep } from './steps/proxy.js';
import { renderBrowserConfigStep } from './steps/browser.js';
import { renderGoalStep } from './steps/goal.js';
import { renderAwakenStep } from './steps/awaken.js';

// DOM container reference
let container = null;
let listenersAttached = false;

/**
 * Initialize wizard
 */
export function initWizard(containerEl) {
  container = containerEl;
  listenersAttached = false;
  subscribe(render);
  handleStart();
}

/**
 * Handle START - run detection in background and show choose step
 */
function handleStart() {
  const saved = checkSavedConfig();
  setState({ savedConfig: saved, currentStep: STEPS.CHOOSE });
  // Run detection in background, then auto-select if appropriate
  runDetection({
    skipLocalScan: false,
    onProgress: () => render()
  }).then(() => {
    autoSelectConnectionType();
  });
}

/**
 * Auto-select connection type based on detection results
 */
function autoSelectConnectionType() {
  const state = getState();
  if (state.connectionType) return; // Already selected

  const { detection, savedConfig } = state;
  const proxyDetected = detection.proxy?.detected;
  const hasSavedKeys = savedConfig?.hasSavedKey;
  const webgpuSupported = detection.webgpu?.supported;

  // Count how many options are available
  const options = [];
  if (proxyDetected) options.push('proxy');
  if (hasSavedKeys) options.push('direct');
  if (webgpuSupported && !proxyDetected && !hasSavedKeys) options.push('browser');

  // Only auto-select if exactly one option detected
  if (options.length === 1) {
    const choice = options[0];
    if (choice === 'proxy') {
      // Trigger proxy selection with auto-config
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
    } else if (choice === 'direct') {
      hydrateSavedConfig(savedConfig);
    } else if (choice === 'browser') {
      setState({ connectionType: 'browser' });
      setNestedState('dopplerConfig', { model: 'smollm2-360m' });
    }
  }
}

/**
 * Start detection phase (after user consent)
 */
async function startDetection() {
  setNestedState('detection', { scanning: true });
  render();

  await runDetection({
    skipLocalScan: false,
    onProgress: () => render()
  });

  setNestedState('detection', { scanning: false });
  // Render will update with detection results
}

/**
 * Main render function - single page with progressive reveal
 */
function render() {
  if (!container) return;

  const state = getState();
  let html = '<div class="wizard-sections">';

  // Header
  html += `
    <div class="wizard-brand">
      <div class="brand-row">
        <h1 class="type-display">REPLOID</h1>
        <a class="link-secondary" data-action="forget-device">clear saved settings</a>
      </div>
      <a class="intro-tagline" href="https://github.com/clocksmith/reploid" target="_blank" rel="noopener">self-modifying AI agent in the browser → view source code</a>
    </div>
  `;

  // Section 1: Always show connection type selection
  html += renderChooseStep(state);

  // Section 2: Show config for selected connection type
  if (state.connectionType === 'direct') {
    html += renderDirectConfigStep(state);
  } else if (state.connectionType === 'proxy') {
    html += renderProxyConfigStep(state);
  } else if (state.connectionType === 'browser') {
    html += renderBrowserConfigStep(state);
  }

  // Section 3: Show goal if config is ready
  if (canAwaken()) {
    html += renderGoalStep(state);
    html += renderAwakenStep(state);
  }

  html += '</div>';

  container.innerHTML = html;

  // Only attach listeners once (use event delegation)
  if (!listenersAttached) {
    attachEventListeners();
    listenersAttached = true;
  }
}

/**
 * Attach event listeners after render
 */
function attachEventListeners() {
  if (!container) return;
  container.addEventListener('click', handleClick);
  container.addEventListener('change', handleChange);
  container.addEventListener('input', handleInput);
}

function handleClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  // Prevent default browser behavior (form submission, link navigation, hash changes)
  e.preventDefault();

  const state = getState();

  switch (action) {
    case 'continue-saved':
      if (state.savedConfig?.hasSavedKey) {
        hydrateSavedConfig(state.savedConfig);
      } else {
        const keyInput = document.getElementById('saved-api-key');
        if (keyInput?.value) {
          hydrateSavedConfig(state.savedConfig, keyInput.value);
        }
      }
      // Render will show the right sections based on state
      break;

    case 'reconfigure':
      setState({ connectionType: null, goal: null });
      break;

    case 'start-scan':
      startDetection();
      break;

    case 'skip-detection':
      // No longer needed - detection runs in background
      break;

    case 'choose-browser':
      setState({ connectionType: 'browser' });
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

      // Build updates for proxy config
      const proxyUpdates = {};

      // Set URL from detection if not already set
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

      // Auto-select first provider and model if available
      if (providers.length > 0 && !currentProxyConfig.provider) {
        const firstProvider = providers[0];
        const providerModels = CLOUD_MODELS[firstProvider] || [];
        proxyUpdates.provider = firstProvider;
        if (providerModels.length > 0) {
          proxyUpdates.model = providerModels[0].id;
        }
      }

      if (Object.keys(proxyUpdates).length > 0) {
        setNestedState('proxyConfig', proxyUpdates);
      }
      setState({ connectionType: 'proxy' });
      break;
    }

    case 'back-to-choose':
      setState({ connectionType: null });
      break;

    case 'back-to-config': {
      // No longer needed - single page
      break;
    }

    case 'test-direct-key':
      handleTestDirectKey();
      break;

    case 'test-proxy':
      handleTestProxy();
      break;

    case 'test-proxy-model':
      handleTestProxyModel();
      break;

    case 'test-direct-model':
      handleTestDirectModel();
      break;

    case 'continue-to-goal':
      // Goal shows automatically when config is ready
      break;

    case 'select-doppler-model': {
      const modelId = e.target.closest('[data-model]')?.dataset.model;
      if (modelId) {
        setNestedState('dopplerConfig', { model: modelId });
      }
      break;
    }

    case 'select-goal': {
      const goalText = e.target.closest('[data-goal]')?.dataset.goal;
      if (goalText) {
        setState({ goal: goalText });
        const textarea = document.getElementById('custom-goal');
        if (textarea) textarea.value = goalText;
      }
      break;
    }

    case 'awaken':
      handleAwaken();
      break;

    case 'test-now':
      handleTestFromAwaken();
      break;

    case 'edit-config':
      // Config section is always visible - user can scroll up
      break;

    case 'advanced-settings':
      // TODO: Show advanced settings modal
      alert('Advanced settings coming soon');
      break;

    case 'awaken-anyway':
      doAwaken();
      break;

    case 'forget-device':
      if (confirm('This will clear all saved configuration and API keys. Continue?')) {
        forgetDevice();
      }
      break;

    case 'edit-connection':
      setState({ connectionType: null });
      break;
  }
}

function handleChange(e) {
  const id = e.target.id;
  const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;

  switch (id) {
    case 'direct-provider':
      setNestedState('directConfig', {
        provider: value,
        model: null,
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

    case 'direct-key':
      setNestedState('directConfig', {
        apiKey: value,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'remember-key':
      setNestedState('directConfig', { rememberKey: value });
      break;

    case 'direct-model':
      setNestedState('directConfig', { model: value });
      break;

    case 'enable-doppler':
      setState({ enableModelAccess: value });
      if (value && !getState().dopplerConfig.model) {
        setNestedState('dopplerConfig', { model: 'smollm2-360m' });
      }
      break;

    case 'doppler-model-inline':
      setNestedState('dopplerConfig', { model: value });
      break;

    case 'proxy-url':
      setNestedState('proxyConfig', {
        url: value,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'proxy-provider': {
      // Auto-select first model for this provider
      const models = CLOUD_MODELS[value] || [];
      const firstModel = models.length > 0 ? models[0].id : null;
      setNestedState('proxyConfig', { provider: value, model: firstModel });
      break;
    }

    case 'proxy-model':
      setNestedState('proxyConfig', { model: value });
      break;
  }
}

function handleInput(e) {
  const id = e.target.id;
  const value = e.target.value;

  switch (id) {
    case 'custom-goal':
      setState({ goal: value });
      break;

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
  }
}

async function handleTestDirectKey() {
  const state = getState();
  const { provider, apiKey, baseUrl } = state.directConfig;

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
  render();

  const result = await testApiKey(provider, apiKey, baseUrl);

  setNestedState('directConfig', {
    verifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
    verifyError: result.error
  });
}

async function handleTestProxy() {
  const state = getState();
  const { url } = state.proxyConfig;

  if (!url) return;

  setNestedState('proxyConfig', { verifyState: VERIFY_STATE.TESTING });
  render();

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

async function handleTestFromAwaken() {
  const state = getState();
  const { connectionType } = state;

  if (connectionType === 'direct') {
    await handleTestDirectKey();
  } else if (connectionType === 'proxy') {
    await handleTestProxy();
  }

  const updatedState = getState();
  let newVerifyState = VERIFY_STATE.UNVERIFIED;
  if (connectionType === 'direct') newVerifyState = updatedState.directConfig.verifyState;
  else if (connectionType === 'proxy') newVerifyState = updatedState.proxyConfig.verifyState;

  if (newVerifyState === VERIFY_STATE.VERIFIED) {
    doAwaken();
  }
}

async function handleTestProxyModel() {
  const state = getState();
  const { url, provider, model, serverType } = state.proxyConfig;

  if (!model) return;

  setNestedState('proxyConfig', { modelVerifyState: VERIFY_STATE.TESTING, modelVerifyError: null });
  render();

  let result;
  if (serverType === 'ollama') {
    // For Ollama, use generate endpoint
    result = await testProxyModel(url, 'ollama', model);
  } else {
    result = await testProxyModel(url, provider, model);
  }

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
  render();

  const result = await testDirectModel(provider, apiKey, model, baseUrl);

  setNestedState('directConfig', {
    modelVerifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
    modelVerifyError: result.error
  });
}

function doAwaken() {
  const state = getState();
  saveConfig();

  if (window.triggerAwaken) {
    window.triggerAwaken(state.goal);
  }
}

async function handleAwaken() {
  doAwaken();
}

export { STEPS, getState, goToStep };
