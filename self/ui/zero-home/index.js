import { createRunReplayPanel } from '../zero/replay-panel.js';
import { getLabUpgradeLevel, LAB_UPGRADE_LEVELS, LAB_UPGRADE_STORAGE_KEY } from '../../config/lab-upgrades.js';
const { setVfsProgress, attachVfsProgressListener } = createVfsProgressBinding(progress => setState({ vfsProgress: progress }));
import { normalizeVfsProgress, getCurrentFullSeedProgress, createVfsProgressBinding } from '../components/vfs-progress.js';
/**
 * @fileoverview Compact X / Zero boot shell.
 */

import {
  ZERO_GEMINI_AGENT_THROTTLE,
  ZERO_GEMINI_PROVIDER,
  ZERO_GEMINI_SERVER_TYPE,
  ZERO_MANAGED_MAX_ITERATIONS,
  buildZeroGeminiProxyConfig,
  getProxyHealthEndpoint,
  getZeroAccessHeaders
} from '../../config/zero-inference.js';
import {
  DEFAULT_ZERO_GOAL,
  formatGoalPacket,
  getRandomZeroGoal,
  normalizeZeroGoal
} from '../../config/zero-goals.js';
import {
  DEFAULT_DOPPLER_MODEL_ID,
  LOCAL_DOPPLER_MODELS,
  buildLocalDopplerModelConfig,
  getLocalDopplerModel
} from '../../config/doppler-local-models.js';
import {
  getBootSeedProfile,
  getBootSourceManifest,
  getOptionalBootSource,
  pickBootSeedFiles
} from '../../config/boot-seed.js';
import {
  loadVfsManifest,
  seedVfsFromManifest,
  writeVfsFile,
  readVfsFile,
  listVfsKeys
} from '../../boot-helpers/vfs-bootstrap.js';
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

let state = null;
let replayPanel = null;
const pauseRecordings = () => replayPanel?.pause();

const escapeText = (value) => String(value ?? '')
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
  const storage = getReploidStorage();
  const stored = String(storage.getItem('REPLOID_GOAL') || '').trim();
  const normalized = normalizeZeroGoal(stored);
  if (stored && normalized !== stored) {
    storage.setItem('REPLOID_GOAL', normalized);
  }
  return normalized;
};

const getStoredCycleIntervalSeconds = () =>
  normalizeCycleIntervalSeconds(getReploidStorage().getItem('REPLOID_CYCLE_INTERVAL_SECONDS'));



const withProxyState = (current = {}) => ({
  ...buildZeroGeminiProxyConfig(current),
  verifyState: current.verifyState || VERIFY_STATE.UNVERIFIED,
  verifyError: current.verifyError || null,
  modelVerifyState: current.modelVerifyState || VERIFY_STATE.UNVERIFIED,
  modelVerifyError: current.modelVerifyError || null
});

const getMode = () => window.getReploidMode?.() === 'x' ? 'x' : 'zero';
const externalAvailable = () => getMode() === 'x' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const savedExternal = () => {
  try { return externalAvailable() && JSON.parse(getReploidStorage().getItem('SELECTED_MODELS') || '[]')[0]?.provider === 'external'; } catch { return false; }
};
const createInitialState = () => ({
  connectionType: savedExternal() ? 'external' : 'proxy',
  externalReady: false,
  upgradeLevel: getLabUpgradeLevel(getMode()),
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
  if (state.connectionType === 'external') return externalAvailable() && state.externalReady;
  if (state.connectionType === 'proxy') {
    return !!(state.proxyConfig.url && state.proxyConfig.model);
  }
  if (state.connectionType === 'browser') {
    return !!getLocalDopplerModel(state.dopplerConfig.model);
  }
  return false;
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
        <p class="type-caption">Start with the minimal self-source. Inference is configured separately.</p>
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
        ${externalAvailable() ? `<button class="panel connection-option ${optionClass('external')}" type="button" data-action="choose-external" aria-pressed="${pressed('external')}"><span class="type-h2">Connected agent</span><span class="type-caption">Use the local reasoning mailbox</span></button>` : ''}
        ${getMode() === 'zero' ? `<button class="panel connection-option ${optionClass('browser')} ${browserUnavailable ? 'disabled' : ''}"
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
        </button>` : ''}
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
      <div class="zero-objective-settings">
        <div class="form-row zero-cycle-setting">
          <label class="type-label" for="cycle-interval-seconds">Cycle interval</label>
          <input type="number"
                 id="cycle-interval-seconds"
                 min="0"
                 max="${MAX_CYCLE_INTERVAL_SECONDS}"
                 step="0.1"
                 value="${escapeText(state.cycleIntervalSeconds)}" />
        </div>
        ${getMode() === 'zero' ? `<div class="form-row zero-upgrade-setting"><label class="type-label" for="zero-upgrade-level">Optional upgrades</label><select id="zero-upgrade-level">${LAB_UPGRADE_LEVELS.map(level => `<option value="${level}" ${state.upgradeLevel === level ? 'selected' : ''}>${level === 'spark' ? 'None: minimal X core' : level}</option>`).join('')}</select><span class="type-caption">Only the selected source closure is installed on Awaken. Existing work is kept.</span></div>` : ''}
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
  const recordings = container.querySelector('[data-boot-recordings]');

  const hasConnectionType = !!state.connectionType;
  let html = '<div class="wizard-sections wizard-sections-home zero-boot-home">';
  html += renderConnectionOptions();
  if (!hasConnectionType) {
    html += renderLockedSection('Configure inference', 'Choose an inference provider to unlock this section.');
  } else if (state.connectionType === 'proxy') {
    html += renderProxyConfig();
  } else if (state.connectionType === 'browser') {
    html += renderBrowserConfig();
  } else if (state.connectionType === 'external') {
    html += renderLockedSection('Connected agent', state.externalReady ? 'Local mailbox ready. Approval controls still apply.' : 'Checking local mailbox. Start it with REPLOID_EXTERNAL_BRAIN=true.');
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
  html += '<details class="wizard-step zero-inspect" data-boot-recordings><summary>Recordings</summary><div class="zero-inspect-content" data-boot-replay-panel></div></details>';
  html += '</div>';

  container.innerHTML = html;
  if (recordings) container.querySelector('[data-boot-recordings]').replaceWith(recordings);
  else replayPanel.mount(container.querySelector('[data-boot-replay-panel]'));
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

  if (state.connectionType === 'external' && externalAvailable() && state.externalReady) {
    models.push(withCycleThrottle({ id: 'external-brain', name: 'Connected agent', provider: 'external', hostType: 'direct' }));
  }

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
      authMode: 'firebase_auth_and_app_check',
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

  storage.setItem('REPLOID_MODE', getMode());
  if (getMode() === 'zero') storage.setItem(LAB_UPGRADE_STORAGE_KEY, state.upgradeLevel);
  storage.setItem('REPLOID_GENESIS_LEVEL', getLabUpgradeLevel(getMode()));
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
  const baseSource = getBootSourceManifest(bootProfile);
  const includeDoppler = state.connectionType === 'browser';
  const { manifest } = await loadVfsManifest({ includeDoppler });
  const optional = includeDoppler ? getOptionalBootSource('doppler') : null;
  const sourceEntries = new Map(baseSource.files.map((file, index) => [file, baseSource.seedFiles[index]]));
  optional?.files.forEach((file, index) => sourceEntries.set(file, optional.seedFiles[index]));
  const source = { ...baseSource, files: [...sourceEntries.keys()], seedFiles: [...sourceEntries.values()] };
  const selectedFiles = [...new Set([...pickBootSeedFiles(manifest.files, bootProfile), ...(optional?.seedFiles || [])])];
  const files = includeDoppler
    ? [...selectedFiles, ...manifest.files.filter(file => file.startsWith('/doppler/'))]
    : selectedFiles;
  await seedVfsFromManifest({ files }, {
    preserveOnBoot: true, logger: console,
    manifestText: JSON.stringify({ version: 1, files }),
    progressScope: 'boot', progressLabel: 'Selected self-source', onProgress: setVfsProgress
  });
  // This is an explicit operator selection, never a background migration.
  await writeVfsFile('/config/self-source-manifest.json', JSON.stringify(source, null, 2) + '\n');
  await writeVfsFile('/config/vfs-manifest.json', JSON.stringify({ version: 1, files }));

}

async function handleAwaken() {
  if (state.isAwakening) return;
  const goalPacket = formatGoalPacket(state.goal);
  if (!goalPacket) return;
  const storage = getReploidStorage();
  const previousLevels = [LAB_UPGRADE_STORAGE_KEY, 'REPLOID_GENESIS_LEVEL']
    .map(key => [key, storage.getItem(key)]);

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
    pauseRecordings();
    saveZeroConfig();
    await prepareVfsForAwaken();
    if (typeof window.triggerAwaken === 'function') {
      await window.triggerAwaken(goalPacket);
    }
  } catch (error) {
    // A missing optional source must not make the next reload unbootable.
    for (const [key, value] of previousLevels) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
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
      headers: await getZeroAccessHeaders(),
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
    case 'zero-upgrade-level':
      if (LAB_UPGRADE_LEVELS.includes(value)) setState({ upgradeLevel: value }, { render: false });
      break;
    case 'cycle-interval-seconds':
      setState({
        cycleIntervalSeconds: normalizeCycleIntervalSeconds(value)
      }, { render: false });
      break;
  }
}

async function checkExternalBrain() {
  try {
    const response = await fetch('/api/external-brain/status', {
      headers: { 'X-Reploid-External-Brain': '1' }, credentials: 'omit',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000)
    });
    const status = response.ok ? await response.json() : null;
    if (state.connectionType === 'external') setState({ externalReady: status?.enabled === true });
  } catch (error) {
    if (state.connectionType === 'external') setState({ externalReady: false, error: error.message });
  }
}

async function handleClick(event) {
  const actionEl = event.target.closest('[data-action]');
  const action = actionEl?.dataset.action;
  if (!action) return;

  event.preventDefault();
  switch (action) {
    case 'choose-external':
      if (!externalAvailable()) break;
      setState({ connectionType: 'external', externalReady: false });
      await checkExternalBrain();
      break;
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
  globalThis.REPLOID_ZERO_ACCESS_HEADERS = getZeroAccessHeaders;
  detachEventListeners();
  replayPanel?.dispose();
  containerEl.querySelector('[data-boot-recordings]')?.remove();
  replayPanel = createRunReplayPanel({ escapeHtml: escapeText, VFS: { read: path => readVfsFile(path), list: () => listVfsKeys() } });
  window.removeEventListener('pagehide', pauseRecordings);
  window.addEventListener('pagehide', pauseRecordings);
  container = containerEl;
  listenersAttached = false;
  renderScheduled = false;
  state = createInitialState();
  if (state.connectionType === 'external') void checkExternalBrain();
  attachVfsProgressListener();
  render();
  probeBrowserCapabilities().catch((error) => {
    console.warn('[ZeroHome] Capability probe failed:', error?.message || error);
  });
}
