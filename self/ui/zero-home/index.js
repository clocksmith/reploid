/**
 * @fileoverview Zero-only locked boot shell.
 */

import {
  ZERO_GEMINI_AGENT_THROTTLE,
  ZERO_GEMINI_PROVIDER,
  ZERO_GEMINI_SERVER_TYPE,
  ZERO_MANAGED_MAX_ITERATIONS,
  buildZeroGeminiProxyConfig,
  getProxyHealthEndpoint
} from '../../config/zero-inference.js';
import {
  DEFAULT_ZERO_GOAL,
  formatGoalPacket,
  getRandomZeroGoal
} from '../../config/zero-goals.js';
import {
  DEFAULT_DOPPLER_MODEL_ID,
  LOCAL_DOPPLER_MODELS,
  buildLocalDopplerModelConfig,
  getLocalDopplerModel
} from '../../config/doppler-local-models.js';
import {
  getBootSeedProfile,
  shouldHydrateFullManifest
} from '../../config/boot-seed.js';
import {
  ensureVfsFileMirrors,
  loadVfsManifest,
  seedVfsFromManifest
} from '../../boot-helpers/vfs-bootstrap.js';
import { getRuntimeSelfMirrorsByBootProfile } from '../../lab/profiles.js';
import { getCurrentReploidStorage as getReploidStorage } from '../../instance.js';

const VERIFY_STATE = Object.freeze({
  UNVERIFIED: 'unverified',
  TESTING: 'testing',
  VERIFIED: 'verified',
  FAILED: 'failed'
});
const DEFAULT_CYCLE_INTERVAL_SECONDS = 7.7;
const MAX_CYCLE_INTERVAL_SECONDS = 3600;
const PROBE_TIMEOUT_MS = 3000;

let container = null;
let listenersAttached = false;
let renderScheduled = false;
let vfsProgressListenerAttached = false;
let state = null;

const escapeText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeCycleIntervalSeconds = (value, fallback = DEFAULT_CYCLE_INTERVAL_SECONDS) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(MAX_CYCLE_INTERVAL_SECONDS, Math.max(0, parsed));
  return Math.round(clamped * 10) / 10;
};

const getStoredGoal = () => {
  const stored = getReploidStorage().getItem('REPLOID_GOAL');
  return String(stored || '').trim() || DEFAULT_ZERO_GOAL;
};

const getStoredCycleIntervalSeconds = () =>
  normalizeCycleIntervalSeconds(getReploidStorage().getItem('REPLOID_CYCLE_INTERVAL_SECONDS'));

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

const withProxyState = (current = {}) => ({
  ...buildZeroGeminiProxyConfig(current),
  verifyState: current.verifyState || VERIFY_STATE.UNVERIFIED,
  verifyError: current.verifyError || null,
  modelVerifyState: current.modelVerifyState || VERIFY_STATE.UNVERIFIED,
  modelVerifyError: current.modelVerifyError || null
});

const createInitialState = () => ({
  connectionType: 'proxy',
  detection: {
    webgpu: { supported: false, checked: false }
  },
  proxyConfig: withProxyState(),
  dopplerConfig: {
    model: DEFAULT_DOPPLER_MODEL_ID,
    verifyState: VERIFY_STATE.UNVERIFIED
  },
  goal: getStoredGoal(),
  goalGenerator: { status: 'idle', error: null },
  cycleIntervalSeconds: getStoredCycleIntervalSeconds(),
  isAwakening: false,
  error: null,
  vfsProgress: getCurrentFullSeedProgress()
});

const setState = (updates, { render = true } = {}) => {
  state = {
    ...state,
    ...updates
  };
  if (render) scheduleRender();
};

const setProxyConfig = (updates, options = {}) => {
  setState({
    proxyConfig: {
      ...state.proxyConfig,
      ...updates
    }
  }, options);
};

const setDopplerConfig = (updates, options = {}) => {
  setState({
    dopplerConfig: {
      ...state.dopplerConfig,
      ...updates
    }
  }, options);
};

const canAwaken = () => {
  if (state.connectionType === 'proxy') {
    return !!(state.proxyConfig.url && state.proxyConfig.model);
  }
  if (state.connectionType === 'browser') {
    return !!getLocalDopplerModel(state.dopplerConfig.model);
  }
  return false;
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

const renderAwakenButton = () => {
  const ready = canAwaken();
  const hasGoal = !!String(state.goal || '').trim();
  return `
    <button class="btn btn-lg btn-primary btn-op goal-action-button${state.isAwakening ? ' loading' : ''}"
            data-op="☇"
            data-action="awaken"
            id="awaken-btn"
            ${state.isAwakening || !hasGoal || !ready ? 'disabled' : ''}
            aria-busy="${state.isAwakening ? 'true' : 'false'}">
      ${state.isAwakening ? 'Awakening...' : 'Awaken'}
    </button>
  `;
};

const renderConnectionOptions = () => {
  const browserUnavailable = state.detection.webgpu.checked && !state.detection.webgpu.supported;
  const optionClass = (type) => state.connectionType === type ? '' : 'border-ghost';
  const pressed = (type) => state.connectionType === type ? 'true' : 'false';
  return `
    <div class="wizard-step wizard-home-provider">
      <div class="goal-header">
        <h2 class="type-h1">Choose inference</h2>
        <p class="type-caption">Default: server proxy. Local Doppler is optional.</p>
      </div>
      <div class="connection-options connection-options-compact">
        <button class="panel connection-option ${optionClass('proxy')}"
                type="button"
                data-action="choose-proxy"
                aria-pressed="${pressed('proxy')}">
          <span class="type-h2">☍ Server proxy <span class="badge">Recommended</span></span>
          <span class="type-caption">Use the managed server proxy</span>
          <div class="option-capabilities">
            <span class="tag">Server proxy</span>
          </div>
        </button>
        <button class="panel connection-option ${optionClass('browser')} ${browserUnavailable ? 'disabled' : ''}"
                type="button"
                data-action="choose-browser"
                aria-pressed="${pressed('browser')}"
                ${browserUnavailable ? 'disabled' : ''}>
          <span class="type-h2">⎈ Doppler</span>
          <span class="type-caption">${browserUnavailable ? 'Optional local model unavailable without WebGPU' : 'Optional local Doppler model via WebGPU'}</span>
          <div class="option-capabilities">
            <span class="tag">Private</span>
            <span class="tag">WebGPU local</span>
          </div>
        </button>
      </div>
    </div>
  `;
};

const renderProxyConfig = () => {
  const proxy = state.proxyConfig;
  return `
    <div class="wizard-step wizard-proxy-config">
      <h2 class="type-h1">Server proxy</h2>
      <p class="type-caption">Default inference path.</p>
      <div class="config-form">
        <div class="form-row">
          <label class="type-label" for="proxy-url">Server URL</label>
          <div class="input-row">
            <input type="text"
                   id="proxy-url"
                   placeholder="/zero/gemini"
                   value="${escapeText(proxy.url || '')}" />
            <button class="btn" type="button" data-action="test-proxy">
              ${proxy.verifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </div>
          ${proxy.verifyState === VERIFY_STATE.VERIFIED ? '<span class="type-caption">★ Server proxy connected</span>' : ''}
          ${proxy.verifyState === VERIFY_STATE.FAILED ? `
            <span class="type-caption">☒ ${escapeText(proxy.verifyError || 'Connection failed')}</span>
          ` : ''}
        </div>
        <div class="form-row">
          <label class="type-label" for="proxy-model">Model</label>
          <input type="text"
                 id="proxy-model"
                 value="${escapeText(proxy.model || '')}" />
          <span class="type-caption">${escapeText(ZERO_GEMINI_PROVIDER)} through ${escapeText(ZERO_GEMINI_SERVER_TYPE)}</span>
        </div>
      </div>
    </div>
  `;
};

const renderBrowserConfig = () => `
  <div class="wizard-step wizard-doppler-config">
    <h2 class="type-h1">Optional local Doppler</h2>
    <p class="type-caption">Select a browser-local model only when you want Zero to run without the server proxy.</p>
    <div class="model-options">
      ${LOCAL_DOPPLER_MODELS.map((model) => {
        const selected = state.dopplerConfig.model === model.id;
        return `
          <button class="model-option ${selected ? 'selected' : ''}"
                  type="button"
                  data-action="select-doppler-model"
                  data-model="${escapeText(model.id)}"
                  aria-pressed="${selected ? 'true' : 'false'}">
            <div class="model-info">
              <span class="model-name">${escapeText(model.name)}</span>
              ${model.recommended ? '<span class="model-badge">Recommended</span>' : ''}
            </div>
            <div class="model-meta">
              <span class="model-size">${escapeText(model.size)}</span>
              <span class="model-status">${selected ? 'Downloads on awaken' : 'Select for first run'}</span>
            </div>
          </button>
        `;
      }).join('')}
    </div>
  </div>
`;

const renderLockedSection = (title, caption) => `
  <div class="wizard-step wizard-stage-placeholder">
    <div class="goal-header">
      <h2 class="type-h2">${escapeText(title)}</h2>
      <p class="type-caption">${escapeText(caption)}</p>
    </div>
  </div>
`;

const renderGoalStep = () => {
  const ready = canAwaken();
  const generating = state.goalGenerator.status === 'generating';
  return `
    <div class="wizard-step wizard-goal">
      <div class="goal-header">
        <h2 class="type-h1">Set the first objective</h2>
      </div>
      <div class="form-row">
        <div class="goal-label-row">
          <label class="type-label" for="goal-input">Goal</label>
          <div class="goal-primary-action">
            <button class="btn btn-primary btn-op goal-action-button"
                    type="button"
                    data-op="⚄"
                    data-action="shuffle-goal">
              Shuffle
            </button>
          </div>
        </div>
        <textarea id="goal-input"
                  class="goal-input"
                  rows="6"
                  spellcheck="true"
                  placeholder="${escapeText(DEFAULT_ZERO_GOAL)}">${escapeText(state.goal)}</textarea>
        ${state.goalGenerator.error ? `
          <span class="type-caption">☒ ${escapeText(state.goalGenerator.error)}</span>
        ` : ''}
      </div>
      <div class="form-row">
        <label class="type-label" for="cycle-interval-seconds">Cycle interval</label>
        <input type="number"
               id="cycle-interval-seconds"
               min="0"
               max="${MAX_CYCLE_INTERVAL_SECONDS}"
               step="0.1"
               value="${escapeText(state.cycleIntervalSeconds)}" />
      </div>
      <div class="goal-primary-action">
        ${ready ? renderAwakenButton() : ''}
      </div>
      ${generating ? '<span class="type-caption">Generating...</span>' : ''}
    </div>
  `;
};

const renderVfsProgress = () => {
  const progress = normalizeVfsProgress(state.vfsProgress || getCurrentFullSeedProgress());
  if (!progress) return '';
  const shouldShow = state.isAwakening || (progress.scope === 'full' && progress.phase !== 'done');
  if (!shouldShow) return '';
  const label = progress.label || 'Preparing VFS.';
  const detail = progress.total > 0
    ? `${progress.current}/${progress.total} files`
    : 'Preparing files';
  return `
    <div class="vfs-hydration-status" aria-live="polite">
      <div class="vfs-hydration-copy">
        <span class="type-label">VFS</span>
        <span class="type-caption">${escapeText(label)}</span>
      </div>
      <div class="vfs-hydration-track" role="progressbar"
           aria-valuemin="0"
           aria-valuemax="100"
           aria-valuenow="${progress.percent}">
        <div class="vfs-hydration-bar" style="width: ${progress.percent}%"></div>
      </div>
      <span class="type-caption vfs-hydration-count">${escapeText(detail)}</span>
    </div>
  `;
};

const renderError = () => state.error ? `
  <div class="wizard-step border-error">
    <div class="goal-header">
      <h2 class="type-h2">Boot preparation failed</h2>
      <p class="type-caption">☒ ${escapeText(state.error)}</p>
    </div>
  </div>
` : '';

function render() {
  if (!container || !state) return;

  const activeEl = document.activeElement;
  const focusId = activeEl?.id || null;
  const focusSelStart = activeEl?.selectionStart;
  const focusSelEnd = activeEl?.selectionEnd;
  const scrollTop = container.scrollTop;

  const hasConnectionType = !!state.connectionType;
  let html = '<div class="wizard-sections wizard-sections-home">';
  html += renderConnectionOptions();
  if (!hasConnectionType) {
    html += renderLockedSection('Configure inference', 'Choose an inference provider to unlock this section.');
  } else if (state.connectionType === 'proxy') {
    html += renderProxyConfig();
  } else if (state.connectionType === 'browser') {
    html += renderBrowserConfig();
  }
  if (!canAwaken()) {
    html += renderLockedSection(
      'Set the first objective',
      hasConnectionType
        ? 'Finish inference configuration to unlock the objective editor.'
        : 'Choose and configure inference before continuing.'
    );
  } else {
    html += renderGoalStep();
  }
  html += renderVfsProgress();
  html += renderError();
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
          console.debug('[ZeroHome] Failed to restore selection:', error?.message || error);
        }
      }
    }
  }

  if (!listenersAttached) {
    attachEventListeners();
    listenersAttached = true;
  }
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  const requestFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback) => setTimeout(callback, 0);
  requestFrame(() => {
    renderScheduled = false;
    render();
  });
}

const saveZeroConfig = () => {
  const storage = getReploidStorage();
  const cycleIntervalSeconds = normalizeCycleIntervalSeconds(state.cycleIntervalSeconds);
  const withCycleThrottle = (model) => ({
    ...model,
    agentCycleThrottle: {
      cycleIntervalMs: cycleIntervalSeconds * 1000,
      cycleIntervalSeconds
    }
  });
  const models = [];

  if (state.connectionType === 'proxy' && state.proxyConfig.model) {
    models.push(withCycleThrottle({
      id: state.proxyConfig.model,
      name: state.proxyConfig.model,
      provider: state.proxyConfig.provider || ZERO_GEMINI_PROVIDER,
      hostType: 'proxy-cloud',
      proxyUrl: state.proxyConfig.url,
      endpoint: state.proxyConfig.endpoint || state.proxyConfig.url,
      serverType: state.proxyConfig.serverType || ZERO_GEMINI_SERVER_TYPE,
      maxIterations: ZERO_MANAGED_MAX_ITERATIONS,
      managedServerProxy: true,
      agentThrottle: state.proxyConfig.agentThrottle || ZERO_GEMINI_AGENT_THROTTLE
    }));
  }

  if (state.connectionType === 'browser' && state.dopplerConfig.model) {
    const model = buildLocalDopplerModelConfig(state.dopplerConfig.model);
    if (model) {
      models.push(withCycleThrottle({
        ...model,
        queryMethod: 'browser'
      }));
    }
  }

  storage.setItem('REPLOID_MODE', 'zero');
  storage.setItem('REPLOID_GENESIS_LEVEL', 'spark');
  storage.setItem('REPLOID_CYCLE_INTERVAL_SECONDS', String(cycleIntervalSeconds));
  storage.setItem('REPLOID_GOAL', String(state.goal || '').trim());
  if (models.length > 0) {
    storage.setItem('SELECTED_MODELS', JSON.stringify(models));
  }
};

async function prepareVfsForAwaken() {
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
  const includeDoppler = state.connectionType === 'browser';
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

async function handleAwaken() {
  const goalPacket = formatGoalPacket(state.goal);
  if (!goalPacket) return;

  setState({
    isAwakening: true,
    error: null,
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
    await prepareVfsForAwaken();
    saveZeroConfig();
    if (typeof window.triggerAwaken === 'function') {
      await window.triggerAwaken(goalPacket);
    }
  } catch (error) {
    console.error('[ZeroHome] Failed to prepare awaken:', error);
    setState({
      isAwakening: false,
      error: error?.message || 'Failed to prepare Zero awaken'
    });
  }
}

async function handleTestProxy() {
  const { url, serverType } = state.proxyConfig;
  if (!url) return;
  setProxyConfig({ verifyState: VERIFY_STATE.TESTING, verifyError: null });
  try {
    const response = await fetch(getProxyHealthEndpoint(url, serverType), {
      method: 'GET',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    setProxyConfig({ verifyState: VERIFY_STATE.VERIFIED, verifyError: null });
  } catch (error) {
    setProxyConfig({
      verifyState: VERIFY_STATE.FAILED,
      verifyError: error?.message || 'Connection failed'
    });
  }
}

function handleInput(event) {
  const id = event.target.id;
  const value = event.target.value;
  switch (id) {
    case 'goal-input':
      setState({
        goal: value,
        goalGenerator: { status: 'idle', error: null }
      }, { render: false });
      break;
    case 'proxy-url':
      setProxyConfig({
        url: value,
        endpoint: value,
        verifyState: VERIFY_STATE.UNVERIFIED,
        verifyError: null
      }, { render: false });
      break;
    case 'proxy-model':
      setProxyConfig({
        model: value,
        modelVerifyState: VERIFY_STATE.UNVERIFIED,
        modelVerifyError: null
      }, { render: false });
      break;
    case 'cycle-interval-seconds':
      setState({
        cycleIntervalSeconds: normalizeCycleIntervalSeconds(value)
      }, { render: false });
      break;
  }
}

async function handleClick(event) {
  const actionEl = event.target.closest('[data-action]');
  const action = actionEl?.dataset.action;
  if (!action) return;

  event.preventDefault();
  switch (action) {
    case 'choose-proxy':
      setState({
        connectionType: 'proxy',
        proxyConfig: withProxyState(state.proxyConfig)
      });
      break;
    case 'choose-browser':
      setState({ connectionType: 'browser' });
      if (!state.dopplerConfig.model) {
        setDopplerConfig({ model: DEFAULT_DOPPLER_MODEL_ID });
      }
      break;
    case 'select-doppler-model': {
      const modelId = actionEl.dataset.model;
      if (modelId) setDopplerConfig({ model: modelId });
      break;
    }
    case 'shuffle-goal': {
      const goal = getRandomZeroGoal(Date.now(), state.goal);
      setState({
        goal: goal?.text || state.goal,
        goalGenerator: { status: 'ready', error: null }
      });
      break;
    }
    case 'test-proxy':
      await handleTestProxy();
      break;
    case 'awaken':
      await handleAwaken();
      break;
  }
}

function attachEventListeners() {
  if (!container) return;
  container.addEventListener('click', handleClick);
  container.addEventListener('input', handleInput);
}

function detachEventListeners() {
  if (!container || !listenersAttached) return;
  container.removeEventListener('click', handleClick);
  container.removeEventListener('input', handleInput);
  listenersAttached = false;
}

async function probeBrowserCapabilities() {
  const supported = typeof navigator !== 'undefined' && !!navigator.gpu;
  setState({
    detection: {
      ...state.detection,
      webgpu: { supported, checked: true }
    }
  });
}

export function initZeroBootHome(containerEl) {
  detachEventListeners();
  container = containerEl;
  listenersAttached = false;
  renderScheduled = false;
  state = createInitialState();
  attachVfsProgressListener();
  render();
  probeBrowserCapabilities().catch((error) => {
    console.warn('[ZeroHome] Capability probe failed:', error?.message || error);
  });
}
