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
  runDetection, testApiKey, testProxyConnection, testLocalConnection
} from './detection.js';

// Step renderers
import { renderStartStep, renderDetectStep } from './steps/detect.js';
import { renderChooseStep } from './steps/choose.js';
import { renderDirectConfigStep } from './steps/direct.js';
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
 * Handle START step - always go to DETECT (unified intro)
 */
function handleStart() {
  const saved = checkSavedConfig();
  setState({ savedConfig: saved, currentStep: STEPS.DETECT });
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
  goToStep(STEPS.CHOOSE);
}

/**
 * Main render function
 */
function render() {
  if (!container) return;

  const state = getState();
  let html = '';

  // Persistent header (shown after CHOOSE step)
  if ([STEPS.DIRECT_CONFIG, STEPS.PROXY_CONFIG,
       STEPS.DOPPLER_CONFIG, STEPS.GOAL, STEPS.AWAKEN].includes(state.currentStep)) {
    html += renderHeader(state);
  }

  // Step content
  switch (state.currentStep) {
    case STEPS.START:
      html += renderStartStep(state);
      break;
    case STEPS.DETECT:
      html += renderDetectStep(state);
      break;
    case STEPS.CHOOSE:
      html += renderChooseStep(state);
      break;
    case STEPS.DIRECT_CONFIG:
      html += renderDirectConfigStep(state);
      break;
    case STEPS.PROXY_CONFIG:
      html += renderProxyConfigStep(state);
      break;
    case STEPS.DOPPLER_CONFIG:
      html += renderBrowserConfigStep(state);
      break;
    case STEPS.GOAL:
      html += renderGoalStep(state);
      break;
    case STEPS.AWAKEN:
      html += renderAwakenStep(state);
      break;
  }

  // Footer
  html += renderFooter(state);

  container.innerHTML = html;

  // Only attach listeners once (use event delegation)
  if (!listenersAttached) {
    attachEventListeners();
    listenersAttached = true;
  }
}

/**
 * Render persistent header with connection status
 */
function renderHeader(state) {
  const { connectionType, directConfig, proxyConfig, dopplerConfig } = state;

  let statusIcon = '○';
  let statusClass = 'unverified';
  let statusText = 'Not configured';
  let modelName = '';

  let verifyState = VERIFY_STATE.UNVERIFIED;

  if (connectionType === 'direct') {
    modelName = directConfig.model || directConfig.provider || '';
    verifyState = directConfig.verifyState;
  } else if (connectionType === 'proxy') {
    modelName = proxyConfig.model || 'Proxy';
    verifyState = proxyConfig.verifyState;
  } else if (connectionType === 'browser') {
    modelName = dopplerConfig.model || 'Doppler WebGPU';
    verifyState = VERIFY_STATE.VERIFIED;
  }

  if (verifyState === VERIFY_STATE.VERIFIED) {
    statusIcon = '★';
    statusClass = 'verified';
    statusText = connectionType === 'browser' ? 'Local' : 'Verified';
  } else if (verifyState === VERIFY_STATE.FAILED) {
    statusIcon = '☒';
    statusClass = 'failed';
    statusText = 'Failed';
  } else if (verifyState === VERIFY_STATE.TESTING) {
    statusIcon = '☍';
    statusClass = 'testing';
    statusText = 'Testing...';
  } else {
    statusIcon = '☡';
    statusClass = 'unverified';
    statusText = 'Unverified';
  }

  return `
    <div class="wizard-header">
      <div class="wizard-connection-status ${statusClass}" data-action="edit-connection">
        <span class="status-icon">${statusIcon}</span>
        <span class="status-model">${modelName}</span>
        <span class="status-text">${statusText}</span>
      </div>
    </div>
  `;
}

/**
 * Render footer
 */
function renderFooter(state) {
  if (state.currentStep === STEPS.DETECT || state.currentStep === STEPS.AWAKEN) return '';

  return `
    <div class="wizard-footer">
      <a class="footer-link" data-action="forget-device">clear saved settings</a>
    </div>
  `;
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

  const state = getState();

  switch (action) {
    case 'continue-saved':
      if (state.savedConfig?.hasSavedKey) {
        hydrateSavedConfig(state.savedConfig);
        goToStep(STEPS.GOAL);
      } else {
        const keyInput = document.getElementById('saved-api-key');
        if (keyInput?.value) {
          hydrateSavedConfig(state.savedConfig, keyInput.value);
          goToStep(STEPS.GOAL);
        }
      }
      break;

    case 'reconfigure':
      goToStep(STEPS.DETECT);
      break;

    case 'start-scan':
      startDetection();
      break;

    case 'skip-detection':
      setNestedState('detection', { scanSkipped: true });
      goToStep(STEPS.CHOOSE);
      break;

    case 'choose-browser':
      setState({ connectionType: 'browser' });
      goToStep(STEPS.DOPPLER_CONFIG);
      break;

    case 'choose-direct':
      setState({ connectionType: 'direct' });
      goToStep(STEPS.DIRECT_CONFIG);
      break;

    case 'choose-proxy':
      setState({ connectionType: 'proxy' });
      goToStep(STEPS.PROXY_CONFIG);
      break;

    case 'explore-docs':
      window.location.href = 'docs/INDEX.md';
      break;

    case 'back-to-choose':
      goToStep(STEPS.CHOOSE);
      break;

    case 'back-to-config': {
      const backConnType = state.connectionType;
      if (backConnType === 'direct') goToStep(STEPS.DIRECT_CONFIG);
      else if (backConnType === 'proxy') goToStep(STEPS.PROXY_CONFIG);
      else goToStep(STEPS.DOPPLER_CONFIG);
      break;
    }

    case 'test-direct-key':
      handleTestDirectKey();
      break;

    case 'test-proxy':
      handleTestProxy();
      break;

    case 'continue-to-goal':
      goToStep(STEPS.GOAL);
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

    case 'edit-config': {
      const connType = state.connectionType;
      if (connType === 'direct') goToStep(STEPS.DIRECT_CONFIG);
      else if (connType === 'proxy') goToStep(STEPS.PROXY_CONFIG);
      else goToStep(STEPS.DOPPLER_CONFIG);
      break;
    }

    case 'awaken-anyway':
      doAwaken();
      break;

    case 'forget-device':
      if (confirm('This will clear all saved configuration and API keys. Continue?')) {
        forgetDevice();
        goToStep(STEPS.DETECT);
      }
      break;

    case 'edit-connection':
      goToStep(STEPS.CHOOSE);
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
      setState({ enableDopplerSubstrate: value });
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

    case 'proxy-provider':
      setNestedState('proxyConfig', { provider: value });
      break;

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

function doAwaken() {
  const state = getState();
  saveConfig();

  if (window.triggerAwaken) {
    window.triggerAwaken(state.goal);
  }
}

async function handleAwaken() {
  const state = getState();
  const { connectionType, directConfig, proxyConfig } = state;

  let verifyState = VERIFY_STATE.VERIFIED;
  if (connectionType === 'direct') verifyState = directConfig.verifyState;
  else if (connectionType === 'proxy') verifyState = proxyConfig.verifyState;

  goToStep(STEPS.AWAKEN);

  if (verifyState === VERIFY_STATE.VERIFIED) {
    doAwaken();
  }
}

export { STEPS, getState, goToStep };
