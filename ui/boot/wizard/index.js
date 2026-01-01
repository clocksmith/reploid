/**
 * @fileoverview Boot Wizard UI
 * Step-by-step configuration wizard for Reploid.
 */

import {
  STEPS, VERIFY_STATE,
  getState, setState, setNestedState, subscribe,
  goToStep, checkSavedConfig, saveConfig, forgetDevice,
  canAwaken, getCapabilityLevel, hydrateSavedConfig
} from './state.js';

import {
  checkHttps, checkWebGPU, runDetection,
  testApiKey, testProxyConnection, testLocalConnection
} from './detection.js';

import { GOAL_CATEGORIES, filterGoalsByCapability } from './goals.js';

// Cloud provider model lists
const CLOUD_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude 4 Sonnet' },
    { id: 'claude-opus-4-5-20251101', name: 'Claude 4.5 Opus' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' }
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
  ]
};

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
  // Store saved config but always go to unified DETECT screen
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
    onProgress: () => {
      // Re-render on each progress update
      render();
    }
  });

  setNestedState('detection', { scanning: false });
  // Auto-advance to choose after detection
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
  if ([STEPS.API_CONFIG, STEPS.PROXY_CONFIG, STEPS.LOCAL_CONFIG,
       STEPS.DOPPLER_CONFIG, STEPS.GOAL, STEPS.AWAKEN].includes(state.currentStep)) {
    html += renderHeader();
  }

  // Step content
  switch (state.currentStep) {
    case STEPS.START:
      html += renderStartStep();
      break;
    case STEPS.DETECT:
      html += renderDetectStep();
      break;
    case STEPS.CHOOSE:
      html += renderChooseStep();
      break;
    case STEPS.API_CONFIG:
      html += renderApiConfigStep();
      break;
    case STEPS.PROXY_CONFIG:
      html += renderProxyConfigStep();
      break;
    case STEPS.LOCAL_CONFIG:
      html += renderLocalConfigStep();
      break;
    case STEPS.DOPPLER_CONFIG:
      html += renderDopplerConfigStep();
      break;
    case STEPS.GOAL:
      html += renderGoalStep();
      break;
    case STEPS.AWAKEN:
      html += renderAwakenStep();
      break;
  }

  // Footer
  html += renderFooter();

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
function renderHeader() {
  const state = getState();
  const { connectionType, apiConfig, proxyConfig, localConfig, dopplerConfig } = state;

  let statusIcon = '○';
  let statusClass = 'unverified';
  let statusText = 'Not configured';
  let modelName = '';

  // Get verify state and model based on connection type
  let verifyState = VERIFY_STATE.UNVERIFIED;

  if (connectionType === 'api') {
    modelName = apiConfig.model || apiConfig.provider || '';
    verifyState = apiConfig.verifyState;
  } else if (connectionType === 'proxy') {
    modelName = proxyConfig.model || 'Proxy';
    verifyState = proxyConfig.verifyState;
  } else if (connectionType === 'local') {
    modelName = localConfig.model || 'Local';
    verifyState = localConfig.verifyState;
  } else if (connectionType === 'browser') {
    modelName = dopplerConfig.model || 'Doppler WebGPU';
    verifyState = VERIFY_STATE.VERIFIED; // Local browser is always verified
  }

  // Set status display based on verify state
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
 * Render START step (resume saved config)
 */
function renderStartStep() {
  const state = getState();
  const saved = state.savedConfig;

  if (!saved) return '';

  return `
    <div class="wizard-step wizard-start">
      <h1 class="intro-title">REPLOID</h1>
      <p class="intro-tagline"><a href="https://github.com/clocksmith/reploid" target="_blank" class="tagline-link">self-modifying AI agent in the browser</a></p>
      <div class="saved-config-summary">
        <div class="config-item">
          <span class="config-label">Provider</span>
          <span class="config-value">${saved.primaryProvider || 'Unknown'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">Model</span>
          <span class="config-value">${saved.primaryModel || 'Unknown'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">Key</span>
          <span class="config-value">${saved.hasSavedKey ? 'Saved locally' : 'Not saved'}</span>
        </div>
      </div>

      ${saved.hasSavedKey ? `
        <div class="wizard-actions stacked">
          <button class="btn btn-primary" data-action="continue-saved">
            Continue with this setup
          </button>
          <button class="btn btn-secondary" data-action="reconfigure">
            Change configuration
          </button>
        </div>
      ` : `
        <form class="inline-key-entry" autocomplete="off" onsubmit="return false;">
          <input type="text" name="username" autocomplete="username" style="display:none" aria-hidden="true" />
          <input type="password" id="saved-api-key" placeholder="Enter API key" class="inline-input" autocomplete="new-password" />
          <button type="button" class="btn btn-primary" data-action="continue-with-key">
            Continue
          </button>
        </form>
        <div class="wizard-actions stacked">
          <button class="btn btn-secondary" data-action="reconfigure">
            Change configuration
          </button>
        </div>
      `}
    </div>
  `;
}

/**
 * Render DETECT step - unified intro/landing page
 */
function renderDetectStep() {
  const state = getState();
  const { detection, savedConfig } = state;
  const isScanning = detection.scanning;

  // If not scanning yet, show intro/landing
  if (!isScanning && !detection.webgpu.checked) {
    return `
      <div class="wizard-step wizard-intro">
        <h1 class="intro-title">REPLOID</h1>
        <p class="intro-tagline"><a href="https://github.com/clocksmith/reploid" target="_blank" class="tagline-link">self-modifying AI agent in the browser</a></p>

        <div class="intro-actions">
          ${savedConfig ? `
            ${!savedConfig.hasSavedKey ? `
              <input type="password" id="saved-api-key" placeholder="API key" class="intro-key-input" />
            ` : ''}
            <button class="btn btn-primary" data-action="continue-saved">
              Continue
            </button>
            <button class="btn" data-action="start-scan">
              New session
            </button>
          ` : `
            <button class="btn btn-primary" data-action="start-scan">
              Begin
            </button>
          `}
        </div>
      </div>
    `;
  }

  // Scanning in progress
  return `
    <div class="wizard-step wizard-detect">
      <h2>Scanning</h2>

      <div class="detection-list">
        <div class="detection-item ${detection.webgpu.checked ? (detection.webgpu.supported ? 'online' : 'offline') : 'checking'}">
          <span class="detection-icon">${detection.webgpu.checked ? (detection.webgpu.supported ? '★' : '☒') : '☍'}</span>
          <span class="detection-label">WebGPU</span>
          <span class="detection-status">
            ${detection.webgpu.checked ? (detection.webgpu.supported ? 'Available' : 'Not supported') : '...'}
          </span>
        </div>

        <div class="detection-item ${detection.doppler?.checked ? (detection.doppler?.supported ? 'online' : 'offline') : 'checking'}">
          <span class="detection-icon">${detection.doppler?.checked ? (detection.doppler?.supported ? '★' : '☒') : '☍'}</span>
          <span class="detection-label">Doppler</span>
          <span class="detection-status">
            ${detection.doppler?.checked ? (detection.doppler?.supported ? 'Ready' : 'N/A') : '...'}
          </span>
        </div>

        <div class="detection-item ${detection.ollama?.checked ? (detection.ollama?.detected ? 'online' : 'offline') : 'checking'}">
          <span class="detection-icon">${detection.ollama?.checked ? (detection.ollama?.detected ? '★' : detection.ollama?.blocked ? '☡' : '☒') : '☍'}</span>
          <span class="detection-label">Ollama</span>
          <span class="detection-status">
            ${detection.ollama?.checked
              ? (detection.ollama?.detected
                ? `${detection.ollama.models?.length || 0} models`
                : detection.ollama?.blocked ? 'Blocked' : 'N/A')
              : '...'}
          </span>
        </div>

        <div class="detection-item ${detection.proxy?.checked ? (detection.proxy?.detected ? 'online' : 'offline') : 'checking'}">
          <span class="detection-icon">${detection.proxy?.checked ? (detection.proxy?.detected ? '★' : detection.proxy?.blocked ? '☡' : '☒') : '☍'}</span>
          <span class="detection-label">Proxy</span>
          <span class="detection-status">
            ${detection.proxy?.checked
              ? (detection.proxy?.detected ? 'Found' : detection.proxy?.blocked ? 'Blocked' : 'N/A')
              : '...'}
          </span>
        </div>
      </div>

      <div class="wizard-actions centered">
        <button class="btn btn-tertiary" data-action="skip-detection">
          Skip
        </button>
      </div>
    </div>
  `;
}

/**
 * Render CHOOSE step
 */
function renderChooseStep() {
  const state = getState();
  const { detection } = state;

  const webgpuSupported = detection.webgpu.supported;
  const ollamaDetected = detection.ollama?.detected;
  const proxyDetected = detection.proxy?.detected;
  const localBlocked = detection.ollama?.blocked || detection.proxy?.blocked;

  return `
    <div class="wizard-step wizard-choose">
      <h2>How do you want to connect?</h2>

      <div class="connection-options">
        <button class="connection-option ${!webgpuSupported ? 'disabled' : ''}"
                data-action="choose-browser"
                ${!webgpuSupported ? 'disabled' : ''}>
          <div class="option-header">
            <span class="option-icon">☖</span>
            <span class="option-title">Browser Model (Doppler)</span>
            ${webgpuSupported ? '<span class="option-badge recommended">Recommended</span>' : ''}
          </div>
          <div class="option-description">
            ${webgpuSupported
              ? 'Run models locally in your browser via WebGPU'
              : 'WebGPU not supported in this browser'}
          </div>
          <div class="option-capabilities">
            <span class="cap-tag cap-substrate">★ Full substrate access</span>
            <span class="cap-tag cap-privacy">★ Private</span>
            <span class="cap-tag cap-warn">☡ Limited reasoning</span>
          </div>
        </button>

        <button class="connection-option" data-action="choose-api">
          <div class="option-header">
            <span class="option-icon">☁</span>
            <span class="option-title">API Key</span>
          </div>
          <div class="option-description">
            Use Claude, GPT-4, or Gemini with your API key
          </div>
          <div class="option-capabilities">
            <span class="cap-tag cap-reasoning">★ High reasoning</span>
            <span class="cap-tag cap-warn">☒ No substrate access</span>
          </div>
        </button>

        <button class="connection-option" data-action="choose-proxy">
          <div class="option-header">
            <span class="option-icon">☍</span>
            <span class="option-title">Proxy Server</span>
            ${proxyDetected ? '<span class="option-badge detected">Detected</span>' : ''}
          </div>
          <div class="option-description">
            ${proxyDetected
              ? `Found at ${detection.proxy.url}`
              : 'Connect to a proxy server'}
          </div>
          ${localBlocked ? `
            <div class="option-warning">
              Browser blocked auto-detect. Enter address manually.
            </div>
          ` : ''}
        </button>

        <button class="connection-option" data-action="choose-local">
          <div class="option-header">
            <span class="option-icon">☗</span>
            <span class="option-title">Local Server</span>
            ${ollamaDetected ? '<span class="option-badge detected">Ollama detected</span>' : ''}
          </div>
          <div class="option-description">
            ${ollamaDetected
              ? `Found ${detection.ollama.models?.length || 0} models on localhost`
              : 'Connect to Ollama or compatible server'}
          </div>
          ${localBlocked ? `
            <div class="option-warning">
              Browser blocked auto-detect. Enter address manually.
            </div>
          ` : ''}
        </button>

        <button class="connection-option tertiary" data-action="explore-docs">
          <div class="option-header">
            <span class="option-icon">☐</span>
            <span class="option-title">Explore docs only</span>
          </div>
          <div class="option-description">
            Browse documentation without an agent
          </div>
        </button>
      </div>
    </div>
  `;
}

/**
 * Render API_CONFIG step
 */
function renderApiConfigStep() {
  const state = getState();
  const { apiConfig, detection, enableDopplerSubstrate } = state;
  const isOther = apiConfig.provider === 'other';
  const models = apiConfig.provider && !isOther ? (CLOUD_MODELS[apiConfig.provider] || []) : [];

  return `
    <div class="wizard-step wizard-api-config">
      <h2>API Configuration</h2>

      <div class="config-form">
        <div class="form-row">
          <label>Provider</label>
          <select id="api-provider" class="config-select">
            <option value="">Select provider...</option>
            <option value="anthropic" ${apiConfig.provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
            <option value="openai" ${apiConfig.provider === 'openai' ? 'selected' : ''}>OpenAI (GPT-4)</option>
            <option value="gemini" ${apiConfig.provider === 'gemini' ? 'selected' : ''}>Google (Gemini)</option>
            <option value="other" ${apiConfig.provider === 'other' ? 'selected' : ''}>Other (OpenAI-compatible)</option>
          </select>
        </div>

        ${isOther ? `
          <div class="form-row">
            <label>Base URL</label>
            <input type="text"
                   id="api-base-url"
                   class="config-input"
                   placeholder="https://api.example.com/v1"
                   value="${apiConfig.baseUrl || ''}" />
            <div class="form-note">OpenAI-compatible API base URL</div>
          </div>
        ` : ''}

        <div class="form-row">
          <label>API Key</label>
          <form class="input-with-action" autocomplete="off" onsubmit="return false;">
            <input type="text" name="username" autocomplete="username" style="display:none" aria-hidden="true" />
            <input type="password"
                   id="api-key"
                   class="config-input"
                   placeholder="Enter your API key"
                   autocomplete="new-password"
                   value="${apiConfig.apiKey || ''}" />
            <button type="button"
                    class="btn btn-secondary"
                    data-action="test-api-key"
                    ${isOther && !apiConfig.baseUrl ? 'disabled' : ''}>
              ${apiConfig.verifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </form>
          ${apiConfig.verifyState === VERIFY_STATE.VERIFIED ? `
            <div class="form-success">★ Connection verified</div>
          ` : ''}
          ${apiConfig.verifyState === VERIFY_STATE.FAILED ? `
            <div class="form-error">☒ ${apiConfig.verifyError || 'Connection failed'}</div>
          ` : ''}
          ${apiConfig.provider === 'anthropic' ? `
            <div class="form-note">Test sends minimal request (~10 tokens, ~$0.00001)</div>
          ` : ''}
        </div>

        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox"
                   id="remember-key"
                   ${apiConfig.rememberKey ? 'checked' : ''} />
            <span>Remember this key locally</span>
          </label>
          <div class="form-note warning">Key stored unencrypted in browser</div>
        </div>

        <div class="form-row">
          <label>Model</label>
          ${isOther ? `
            <input type="text"
                   id="api-model"
                   class="config-input"
                   placeholder="Enter model name (e.g., gpt-4)"
                   value="${apiConfig.model || ''}" />
          ` : `
            <select id="api-model" class="config-select" ${!apiConfig.provider ? 'disabled' : ''}>
              <option value="">Select model...</option>
              ${models.map(m => `
                <option value="${m.id}" ${apiConfig.model === m.id ? 'selected' : ''}>${m.name}</option>
              `).join('')}
            </select>
          `}
        </div>

        ${detection.webgpu.supported ? `
          <div class="form-row substrate-option">
            <label class="checkbox-label">
              <input type="checkbox"
                     id="enable-doppler"
                     ${enableDopplerSubstrate ? 'checked' : ''} />
              <span>Also enable Doppler for substrate access</span>
            </label>
            <div class="form-note">Enables LoRA, activation steering, weight inspection</div>
          </div>
          ${enableDopplerSubstrate ? `
            <div class="form-row doppler-model-inline">
              <label>Doppler Model</label>
              <select id="doppler-model-inline" class="config-select">
                <option value="smollm2-360m" ${state.dopplerConfig?.model === 'smollm2-360m' ? 'selected' : ''}>SmolLM2 360M (Recommended)</option>
                <option value="gemma-2b" ${state.dopplerConfig?.model === 'gemma-2b' ? 'selected' : ''}>Gemma 2B</option>
                <option value="qwen-0.5b" ${state.dopplerConfig?.model === 'qwen-0.5b' ? 'selected' : ''}>Qwen 0.5B</option>
              </select>
            </div>
          ` : ''}
        ` : ''}
      </div>

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-choose">
          Back
        </button>
        <button class="btn btn-primary"
                data-action="continue-to-goal"
                ${!apiConfig.provider || !apiConfig.model ? 'disabled' : ''}>
          Continue ${apiConfig.verifyState !== VERIFY_STATE.VERIFIED ? '(unverified)' : ''}
        </button>
      </div>
    </div>
  `;
}

/**
 * Render PROXY_CONFIG step
 */
function renderProxyConfigStep() {
  const state = getState();
  const { proxyConfig, detection } = state;
  const detectedUrl = detection.proxy?.url || '';

  return `
    <div class="wizard-step wizard-proxy-config">
      <h2>Proxy Configuration</h2>

      <div class="config-form">
        <div class="form-row">
          <label>Proxy URL</label>
          <div class="input-with-action">
            <input type="text"
                   id="proxy-url"
                   class="config-input"
                   placeholder="http://localhost:8000"
                   value="${proxyConfig.url || detectedUrl}" />
            <button class="btn btn-secondary" data-action="test-proxy">
              ${proxyConfig.verifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </div>
          ${proxyConfig.verifyState === VERIFY_STATE.VERIFIED ? `
            <div class="form-success">★ Connection verified</div>
          ` : ''}
          ${proxyConfig.verifyState === VERIFY_STATE.FAILED ? `
            <div class="form-error">☒ ${proxyConfig.verifyError || 'Connection failed'}</div>
          ` : ''}
        </div>

        <div class="form-row">
          <label>Model</label>
          <input type="text"
                 id="proxy-model"
                 class="config-input"
                 placeholder="Enter model name"
                 value="${proxyConfig.model || ''}" />
        </div>
      </div>

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-choose">
          Back
        </button>
        <button class="btn btn-primary"
                data-action="continue-to-goal"
                ${!proxyConfig.url || !proxyConfig.model ? 'disabled' : ''}>
          Continue ${proxyConfig.verifyState !== VERIFY_STATE.VERIFIED ? '(unverified)' : ''}
        </button>
      </div>
    </div>
  `;
}

/**
 * Render LOCAL_CONFIG step
 */
function renderLocalConfigStep() {
  const state = getState();
  const { localConfig, detection } = state;
  const detectedUrl = detection.ollama?.url || 'http://localhost:11434';
  const detectedModels = detection.ollama?.models || [];

  return `
    <div class="wizard-step wizard-local-config">
      <h2>Local Server Configuration</h2>

      <div class="config-form">
        <div class="form-row">
          <label>Server URL</label>
          <div class="input-with-action">
            <input type="text"
                   id="local-url"
                   class="config-input"
                   placeholder="http://localhost:11434"
                   value="${localConfig.url || detectedUrl}" />
            <button class="btn btn-secondary" data-action="test-local">
              ${localConfig.verifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </div>
          ${localConfig.verifyState === VERIFY_STATE.VERIFIED ? `
            <div class="form-success">★ Connection verified</div>
          ` : ''}
          ${localConfig.verifyState === VERIFY_STATE.FAILED ? `
            <div class="form-error">☒ ${localConfig.verifyError || 'Connection failed'}</div>
          ` : ''}
        </div>

        <div class="form-row">
          <label>Model</label>
          ${detectedModels.length > 0 ? `
            <select id="local-model" class="config-select">
              <option value="">Select model...</option>
              ${detectedModels.map(m => `
                <option value="${m.id}" ${localConfig.model === m.id ? 'selected' : ''}>${m.name}</option>
              `).join('')}
            </select>
          ` : `
            <input type="text"
                   id="local-model"
                   class="config-input"
                   placeholder="Enter model name (e.g., llama3:8b)"
                   value="${localConfig.model || ''}" />
          `}
        </div>
      </div>

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-choose">
          Back
        </button>
        <button class="btn btn-primary"
                data-action="continue-to-goal"
                ${!localConfig.url || !localConfig.model ? 'disabled' : ''}>
          Continue ${localConfig.verifyState !== VERIFY_STATE.VERIFIED ? '(unverified)' : ''}
        </button>
      </div>
    </div>
  `;
}

/**
 * Render DOPPLER_CONFIG step
 */
function renderDopplerConfigStep() {
  const state = getState();
  const { dopplerConfig, detection } = state;
  const models = detection.doppler?.models || [];

  // Available Doppler models to download
  const downloadableModels = [
    { id: 'smollm2-360m', name: 'SmolLM2 360M', size: '200MB', recommended: true },
    { id: 'gemma-2b', name: 'Gemma 2B', size: '1.2GB' },
    { id: 'qwen-0.5b', name: 'Qwen 0.5B', size: '300MB' }
  ];

  return `
    <div class="wizard-step wizard-doppler-config">
      <h2>Browser Model Setup</h2>
      <p class="wizard-subtitle">Select a model to run locally via WebGPU</p>

      <div class="model-options">
        ${downloadableModels.map(m => {
          const cached = models.some(cm => cm.id === m.id);
          return `
            <button class="model-option ${dopplerConfig.model === m.id ? 'selected' : ''} ${cached ? 'cached' : ''}"
                    data-action="select-doppler-model"
                    data-model="${m.id}">
              <div class="model-info">
                <span class="model-name">${m.name}</span>
                ${m.recommended ? '<span class="model-badge">Recommended</span>' : ''}
              </div>
              <div class="model-meta">
                <span class="model-size">${m.size}</span>
                <span class="model-status">${cached ? '★ Cached' : 'Download required'}</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>

      ${dopplerConfig.downloadProgress !== null ? `
        <div class="download-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${dopplerConfig.downloadProgress}%"></div>
          </div>
          <span class="progress-text">${dopplerConfig.downloadProgress}%</span>
        </div>
      ` : ''}

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-choose">
          Back
        </button>
        <button class="btn btn-primary"
                data-action="continue-to-goal"
                ${!dopplerConfig.model ? 'disabled' : ''}>
          Continue
        </button>
      </div>
    </div>
  `;
}

/**
 * Render GOAL step
 */
function renderGoalStep() {
  const state = getState();
  const capabilities = getCapabilityLevel();
  const filteredGoals = filterGoalsByCapability(GOAL_CATEGORIES, capabilities);

  return `
    <div class="wizard-step wizard-goal">
      <h2>What do you want to do?</h2>

      <div class="goal-categories">
        ${Object.entries(filteredGoals).map(([category, goals]) => `
          <div class="goal-category">
            <div class="category-header">
              <span class="category-name">${category}</span>
              ${goals.some(g => g.locked) ? `
                <span class="category-lock">Some goals require different setup</span>
              ` : ''}
            </div>
            <div class="category-goals">
              ${goals.map(goal => `
                <button class="goal-chip ${goal.locked ? 'locked' : ''} ${goal.recommended ? 'recommended' : ''}"
                        data-action="select-goal"
                        data-goal="${goal.text}"
                        ${goal.locked ? 'disabled' : ''}>
                  ${goal.text}
                  ${goal.recommended ? '<span class="goal-tag recommended">Recommended</span>' : ''}
                  ${goal.locked ? `<span class="goal-tag locked">${goal.lockReason}</span>` : ''}
                </button>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="custom-goal">
        <label>Or describe your own goal:</label>
        <textarea id="custom-goal"
                  class="goal-input"
                  placeholder="What would you like the agent to do?"
                  rows="3">${state.goal || ''}</textarea>
      </div>

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-config">
          Back
        </button>
        <button class="btn btn-secondary" data-action="advanced-options">
          Advanced Options
        </button>
        <button class="btn btn-primary btn-awaken"
                data-action="awaken"
                ${!canAwaken() ? 'disabled' : ''}>
          Awaken Agent
        </button>
      </div>
    </div>
  `;
}

/**
 * Render AWAKEN step
 */
function renderAwakenStep() {
  const state = getState();
  const { connectionType, apiConfig, proxyConfig, localConfig, dopplerConfig } = state;

  // Get verify state based on connection type
  let verifyState = VERIFY_STATE.VERIFIED;
  if (connectionType === 'api') {
    verifyState = apiConfig.verifyState;
  } else if (connectionType === 'proxy') {
    verifyState = proxyConfig.verifyState;
  } else if (connectionType === 'local') {
    verifyState = localConfig.verifyState;
  } else if (connectionType === 'browser') {
    verifyState = VERIFY_STATE.VERIFIED; // Local browser is always verified
  }

  return `
    <div class="wizard-step wizard-awaken">
      ${verifyState !== VERIFY_STATE.VERIFIED ? `
        <div class="awaken-warning">
          <h3>☡ Connection not verified</h3>
          <p>Your connection hasn't been tested. The agent may fail to start.</p>
          <div class="warning-actions">
            <button class="btn btn-secondary" data-action="test-now">Test now</button>
            <button class="btn btn-tertiary" data-action="edit-config">Edit config</button>
            <button class="btn btn-primary" data-action="awaken-anyway">Continue anyway</button>
          </div>
        </div>
      ` : `
        <div class="awaken-progress">
          <h2>Awakening Agent</h2>
          <div class="progress-steps">
            <div class="progress-step" id="step-vfs">Initializing VFS...</div>
            <div class="progress-step" id="step-snapshot">Creating genesis snapshot...</div>
            <div class="progress-step" id="step-model">Connecting to model...</div>
            <div class="progress-step" id="step-memory">Loading memory systems...</div>
            <div class="progress-step" id="step-agent">Starting agent loop...</div>
          </div>
        </div>
      `}
    </div>
  `;
}

/**
 * Render footer
 */
function renderFooter() {
  const state = getState();

  // Don't show footer on intro or during awaken
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

  // Use event delegation
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
      // Check if we need a key
      if (state.savedConfig?.hasSavedKey) {
        // Has saved key, go straight to GOAL
        hydrateSavedConfig(state.savedConfig);
        goToStep(STEPS.GOAL);
      } else {
        // Need to get key from input
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
      // User consented to scanning
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

    case 'choose-api':
      setState({ connectionType: 'api' });
      goToStep(STEPS.API_CONFIG);
      break;

    case 'choose-proxy':
      setState({ connectionType: 'proxy' });
      goToStep(STEPS.PROXY_CONFIG);
      break;

    case 'choose-local':
      setState({ connectionType: 'local' });
      goToStep(STEPS.LOCAL_CONFIG);
      break;

    case 'explore-docs':
      // Limited mode - just show docs
      window.location.href = 'docs/INDEX.md';
      break;

    case 'back-to-choose':
      goToStep(STEPS.CHOOSE);
      break;

    case 'back-to-config': {
      const backConnType = state.connectionType;
      if (backConnType === 'api') goToStep(STEPS.API_CONFIG);
      else if (backConnType === 'proxy') goToStep(STEPS.PROXY_CONFIG);
      else if (backConnType === 'local') goToStep(STEPS.LOCAL_CONFIG);
      else goToStep(STEPS.DOPPLER_CONFIG);
      break;
    }

    case 'test-api-key':
      handleTestApiKey();
      break;

    case 'test-proxy':
      handleTestProxy();
      break;

    case 'test-local':
      handleTestLocal();
      break;

    case 'continue-to-goal':
      goToStep(STEPS.GOAL);
      break;

    case 'select-doppler-model':
      const modelId = e.target.closest('[data-model]')?.dataset.model;
      if (modelId) {
        setNestedState('dopplerConfig', { model: modelId });
      }
      break;

    case 'select-goal':
      const goalText = e.target.closest('[data-goal]')?.dataset.goal;
      if (goalText) {
        setState({ goal: goalText });
        const textarea = document.getElementById('custom-goal');
        if (textarea) textarea.value = goalText;
      }
      break;

    case 'awaken':
      handleAwaken();
      break;

    case 'test-now':
      // Test connection from AWAKEN warning screen
      handleTestFromAwaken();
      break;

    case 'edit-config': {
      // Go back to config step from AWAKEN warning
      const connType = state.connectionType;
      if (connType === 'api') goToStep(STEPS.API_CONFIG);
      else if (connType === 'proxy') goToStep(STEPS.PROXY_CONFIG);
      else if (connType === 'local') goToStep(STEPS.LOCAL_CONFIG);
      else goToStep(STEPS.DOPPLER_CONFIG);
      break;
    }

    case 'awaken-anyway':
      // Proceed despite unverified connection
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
    case 'api-provider':
      setNestedState('apiConfig', {
        provider: value,
        model: null,
        baseUrl: null,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'api-base-url':
      setNestedState('apiConfig', {
        baseUrl: value,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'api-key':
      setNestedState('apiConfig', {
        apiKey: value,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'remember-key':
      setNestedState('apiConfig', { rememberKey: value });
      break;

    case 'api-model':
      setNestedState('apiConfig', { model: value });
      break;

    case 'enable-doppler':
      setState({ enableDopplerSubstrate: value });
      // Auto-select a default model if enabling
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

    case 'proxy-model':
      setNestedState('proxyConfig', { model: value });
      break;

    case 'local-url':
      setNestedState('localConfig', {
        url: value,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;

    case 'local-model':
      setNestedState('localConfig', { model: value });
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

    case 'api-key':
      setNestedState('apiConfig', { apiKey: value });
      break;

    case 'api-base-url':
      setNestedState('apiConfig', { baseUrl: value });
      break;

    case 'api-model':
      // For "other" provider with text input
      if (getState().apiConfig.provider === 'other') {
        setNestedState('apiConfig', { model: value });
      }
      break;

    case 'proxy-url':
      setNestedState('proxyConfig', { url: value });
      break;

    case 'proxy-model':
      setNestedState('proxyConfig', { model: value });
      break;

    case 'local-url':
      setNestedState('localConfig', { url: value });
      break;

    case 'local-model':
      setNestedState('localConfig', { model: value });
      break;
  }
}

async function handleTestApiKey() {
  const state = getState();
  const { provider, apiKey, baseUrl } = state.apiConfig;

  // Validation with user feedback
  if (!provider) {
    setNestedState('apiConfig', {
      verifyState: VERIFY_STATE.FAILED,
      verifyError: 'Select a provider first'
    });
    return;
  }

  if (!apiKey) {
    setNestedState('apiConfig', {
      verifyState: VERIFY_STATE.FAILED,
      verifyError: 'Enter an API key first'
    });
    return;
  }

  if (provider === 'other' && !baseUrl) {
    setNestedState('apiConfig', {
      verifyState: VERIFY_STATE.FAILED,
      verifyError: 'Enter a base URL for custom provider'
    });
    return;
  }

  setNestedState('apiConfig', { verifyState: VERIFY_STATE.TESTING, verifyError: null });
  render();

  const result = await testApiKey(provider, apiKey, baseUrl);

  setNestedState('apiConfig', {
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

  const result = await testProxyConnection(url);

  setNestedState('proxyConfig', {
    verifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
    verifyError: result.error
  });
}

async function handleTestLocal() {
  const state = getState();
  const { url } = state.localConfig;

  if (!url) return;

  setNestedState('localConfig', { verifyState: VERIFY_STATE.TESTING });
  render();

  const result = await testLocalConnection(url);

  setNestedState('localConfig', {
    verifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
    verifyError: result.error
  });
}

/**
 * Test connection from AWAKEN warning screen
 */
async function handleTestFromAwaken() {
  const state = getState();
  const { connectionType, apiConfig, proxyConfig, localConfig } = state;

  if (connectionType === 'api') {
    await handleTestApiKey();
  } else if (connectionType === 'proxy') {
    await handleTestProxy();
  } else if (connectionType === 'local') {
    await handleTestLocal();
  }

  // If now verified, proceed to awaken
  const updatedState = getState();
  let newVerifyState = VERIFY_STATE.UNVERIFIED;
  if (connectionType === 'api') newVerifyState = updatedState.apiConfig.verifyState;
  else if (connectionType === 'proxy') newVerifyState = updatedState.proxyConfig.verifyState;
  else if (connectionType === 'local') newVerifyState = updatedState.localConfig.verifyState;

  if (newVerifyState === VERIFY_STATE.VERIFIED) {
    doAwaken();
  }
}

/**
 * Actually perform the awaken
 */
function doAwaken() {
  const state = getState();

  // Save config
  saveConfig();

  // Trigger the actual boot awaken
  if (window.triggerAwaken) {
    window.triggerAwaken(state.goal);
  }
}

/**
 * Handle awaken button click - go to AWAKEN step (shows warning if unverified)
 */
async function handleAwaken() {
  const state = getState();
  const { connectionType, apiConfig, proxyConfig, localConfig } = state;

  // Check verify state
  let verifyState = VERIFY_STATE.VERIFIED;
  if (connectionType === 'api') verifyState = apiConfig.verifyState;
  else if (connectionType === 'proxy') verifyState = proxyConfig.verifyState;
  else if (connectionType === 'local') verifyState = localConfig.verifyState;

  // Go to awaken step (will show warning if not verified)
  goToStep(STEPS.AWAKEN);

  // If already verified, proceed immediately
  if (verifyState === VERIFY_STATE.VERIFIED) {
    doAwaken();
  }
}

export { STEPS, getState, goToStep };
