/**
 * @fileoverview Minimal home surface for the primary Reploid route.
 */

import { getDefaultReploidEnvironment } from '../../config/reploid-environments.js';
import {
  createReploidPeerUrl,
  getCurrentReploidInstanceLabel,
  getCurrentReploidStorage
} from '../../instance.js';
import {
  DEFAULT_REPLOID_HOME_GOAL,
  RING_SLOTS,
  SELF_FILE_PATHS,
  SELF_SOURCE_PATHS,
  getGeneratedSelfFilePreview,
  getReploidLaunchLabels
} from '../shared/reploid-contract.js';

const GENERATED_GOALS = Object.freeze([
  DEFAULT_REPLOID_HOME_GOAL,
  'Read /self/blueprint-index.json, choose one lazy blueprint needed for this objective, and summarize the contract before changing anything.',
  'Inspect the tabula-rasa boot contract, then write one /shadow candidate that removes inherited context from the first prompt.',
  'Read the tool and promotion contracts, then draft one /shadow tool candidate plus /artifacts evidence without touching /self.',
  'Read the blueprint index contract and propose the smallest index entry that makes one architecture task easier to discover.',
  'Trace the / boot route, identify one remaining wizard fallback, and write the smallest reversible /shadow fix.'
]);

const DIRECT_MODELS = Object.freeze({
  gemini: [
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview' }
  ]
});

const DEFAULT_DIRECT_PROVIDER = 'gemini';
const DEFAULT_DIRECT_MODEL = DIRECT_MODELS.gemini[0].id;
const normalizeDirectModel = (provider, modelId) => {
  const models = DIRECT_MODELS[provider] || DIRECT_MODELS.gemini;
  const normalized = normalize(modelId);
  return models.some((model) => model.id === normalized)
    ? normalized
    : models[0].id;
};

const migrateStoredGoal = (goal) => {
  const normalized = normalize(goal);
  const isLegacyDefault = (
    normalized.startsWith('Run an')
    && normalized.includes('Shadow RSI cycle')
    && normalized.includes('Blueprint 0x000112')
  ) || (
    normalized.startsWith('Run a Shadow')
    && normalized.includes('cycle over the boot path')
  );
  return isLegacyDefault
    ? DEFAULT_REPLOID_HOME_GOAL
    : normalized;
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const normalize = (value) => String(value || '').trim();

const pickRandomGoal = (currentGoal = '') => {
  const current = normalize(currentGoal);
  const candidates = GENERATED_GOALS.filter((goal) => normalize(goal) !== current);
  const pool = candidates.length > 0 ? candidates : GENERATED_GOALS;
  if (pool.length === 0) return current;
  return pool[Math.floor(Math.random() * pool.length)] || pool[0];
};

const createInitialState = () => {
  const storage = getCurrentReploidStorage();
  const storedSwarm = storage.getItem('REPLOID_SWARM_ENABLED');
  const storedOwnInference = storage.getItem('REPLOID_USE_OWN_INFERENCE') === 'true';
  let savedModel = null;
  try {
    const models = JSON.parse(storage.getItem('SELECTED_MODELS') || '[]');
    savedModel = Array.isArray(models) ? models[0] : null;
  } catch {
    savedModel = null;
    storage.removeItem('SELECTED_MODELS', { removeLegacy: true });
  }
  if (!storedOwnInference) {
    savedModel = null;
    storage.removeItem('SELECTED_MODELS', { removeLegacy: true });
  }

  return {
    goal: migrateStoredGoal(storage.getItem('REPLOID_HOME_GOAL')) || DEFAULT_REPLOID_HOME_GOAL,
    swarmEnabled: storedSwarm === null ? true : storedSwarm === 'true',
    ownInference: storedOwnInference,
    directProvider: savedModel?.provider || DEFAULT_DIRECT_PROVIDER,
    directModel: normalizeDirectModel(savedModel?.provider || DEFAULT_DIRECT_PROVIDER, savedModel?.id),
    directKey: savedModel?.apiKey || '',
    selectedSelfPath: '/self/self.json',
    selectedSelfContent: null,
    selectedSelfStatus: 'generated preview',
    selfBrowserOpen: false,
    isAwakening: false,
    goalStatus: ''
  };
};

const getHasDirectInference = (state) => !!(
  state.ownInference
  && normalize(state.directProvider)
  && normalize(state.directModel)
  && normalize(state.directKey)
);

const getLaunch = (state) => getReploidLaunchLabels(state);

const persistState = (state) => {
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_HOME_GOAL', state.goal || '');
  storage.setItem('REPLOID_SWARM_ENABLED', state.swarmEnabled ? 'true' : 'false');
  storage.setItem('REPLOID_USE_OWN_INFERENCE', state.ownInference ? 'true' : 'false');

  if (getHasDirectInference(state)) {
    storage.setItem('SELECTED_MODELS', JSON.stringify([{
      id: state.directModel,
      name: state.directModel,
      provider: state.directProvider,
      hostType: 'browser-cloud',
      apiKey: state.directKey
    }]));
  } else {
    storage.removeItem('SELECTED_MODELS', { removeLegacy: true });
  }
};

const renderMetric = (label, value) => `
  <span class="rgr-status-metric">
    <span class="rgr-status-label">${escapeHtml(label)}</span>
    <span class="rgr-status-value">${escapeHtml(value || '-')}</span>
  </span>
`;

const renderMetricStrip = (metrics, options = {}) => {
  const className = ['boot-status-strip', options.className].filter(Boolean).join(' ');
  const label = options.label ? ` aria-label="${escapeHtml(options.label)}"` : '';
  return `
    <div class="${className}"${label}>
      ${metrics.map(([metricLabel, metricValue]) => renderMetric(metricLabel, metricValue)).join('')}
    </div>
  `;
};

const renderDirectConfig = (state) => {
  if (!state.ownInference) return '';
  const models = DIRECT_MODELS[state.directProvider] || DIRECT_MODELS.gemini;
  return `
    <div class="direct-config-grid" aria-label="Own inference">
      <label class="field-inline">
        <span>Provider</span>
        <select id="direct-provider">
          <option value="gemini"${state.directProvider === 'gemini' ? ' selected' : ''}>Gemini</option>
        </select>
      </label>
      <label class="field-inline">
        <span>Model</span>
        <select id="direct-model">
          ${models.map((model) => `
            <option value="${escapeHtml(model.id)}"${state.directModel === model.id ? ' selected' : ''}>${escapeHtml(model.name)}</option>
          `).join('')}
        </select>
      </label>
      <label class="field-inline field-inline-key">
        <span>Key</span>
        <input id="direct-key"
               type="password"
               value="${escapeHtml(state.directKey)}"
               autocomplete="off"
               spellcheck="false"
               placeholder="Gemini API key" />
      </label>
    </div>
  `;
};

const renderHome = (state) => {
  const launch = getLaunch(state);
  const peerUrl = createReploidPeerUrl(window.location.pathname || '/');
  const freshPeerUrl = createReploidPeerUrl(window.location.pathname || '/', { freshIdentity: true });
  const slotSummary = `${RING_SLOTS.length} ${launch.slots}`;
  const selectedSelfPath = SELF_FILE_PATHS.includes(state.selectedSelfPath)
    ? state.selectedSelfPath
    : SELF_FILE_PATHS[0];
  const selectedSelfContent = state.selectedSelfContent ?? getGeneratedSelfFilePreview(selectedSelfPath);

  return `
    <div class="wizard-sections wizard-sections-home">
      <div class="wizard-step wizard-intro">
        <div class="goal-header">
          <h1 class="type-h1">Reploid</h1>
          <p class="type-caption">blueprint-first runtime · peer ${escapeHtml(getCurrentReploidInstanceLabel())} · <a class="link-secondary" href="${escapeHtml(peerUrl)}" target="_blank" rel="noopener">new peer</a> · <a class="link-secondary" href="${escapeHtml(freshPeerUrl)}" target="_blank" rel="noopener">fresh peer</a></p>
        </div>
      </div>

      <div class="wizard-step inference-bar">
        <div class="goal-header">
          <h2 class="type-h2">Runtime</h2>
        </div>
        <div class="inference-bar-row">
          <div class="inference-bar-status">
            <div class="inference-bar-title">
              <span class="inference-bar-label">Seed</span>
              <span class="inference-bar-model">${escapeHtml(launch.topology)}</span>
            </div>
            <p class="type-caption inference-bar-note">${escapeHtml(launch.note)}</p>
          </div>
          <div class="inference-bar-controls">
            <button class="inference-bar-configure${state.ownInference ? ' active' : ''}"
                    id="reploid-use-own-inference"
                    data-action="toggle-own-inference"
                    type="button">Configure</button>
            <label class="inference-bar-toggle">
              <input type="checkbox" id="reploid-swarm-enabled"${state.swarmEnabled ? ' checked' : ''} />
              <span>Peer slots</span>
            </label>
          </div>
        </div>
        ${renderDirectConfig(state)}
        ${renderMetricStrip([
          ['Mode', 'Seed'],
          ['Role', launch.role],
          ['Slots', slotSummary],
          ['Transport', state.swarmEnabled ? 'local room' : 'disabled'],
          ['Host', launch.executor],
          ['Gate', 'Promote']
        ], {
          className: 'rgr-status-strip',
          label: 'System and peer status'
        })}
      </div>

      <div class="wizard-step goal-step">
        <div class="goal-header">
          <h2 class="type-h2">Objective</h2>
        </div>
        <textarea id="goal-input" maxlength="500" spellcheck="true">${escapeHtml(state.goal)}</textarea>
        <div class="goal-toolbar">
          <button class="btn btn-ghost" type="button" data-action="generate-goal">SHUFFLE</button>
          <span class="goal-toolbar-status type-caption">${escapeHtml(state.goalStatus)}</span>
        </div>
      </div>

      <div class="seed-browser-actions">
        <button class="btn btn-primary btn-op${state.isAwakening ? ' loading' : ''}" data-op="☇" id="awaken-btn" type="button" aria-busy="${state.isAwakening ? 'true' : 'false'}"${state.isAwakening || !launch.canAwaken || !normalize(state.goal) ? ' disabled' : ''}>${state.isAwakening ? 'Awakening...' : 'Awaken'}</button>
      </div>

      <details class="seed-browser-panel"${state.selfBrowserOpen ? ' open' : ''}>
        <summary class="seed-browser-summary">
          <span>Seed files</span>
        </summary>
        <div class="seed-browser-grid">
          <div class="seed-tree-panel">
            <h3 class="type-h3">Self tree</h3>
            ${SELF_FILE_PATHS.map((path) => `
              <button class="seed-path-row${path === selectedSelfPath ? ' selected' : ''}"
                      type="button"
                      data-action="select-self-path"
                      data-path="${escapeHtml(path)}"
                      aria-pressed="${path === selectedSelfPath ? 'true' : 'false'}">${escapeHtml(path)}</button>
            `).join('')}
          </div>
          <div class="seed-viewer-panel">
            <div class="seed-viewer-header">
              <h3 class="type-h3">${escapeHtml(selectedSelfPath)}</h3>
              <span class="seed-viewer-status type-caption">${escapeHtml(state.selectedSelfStatus || '')}</span>
            </div>
            <pre class="seed-file-viewer">${escapeHtml(selectedSelfContent || '')}</pre>
          </div>
        </div>
      </details>
    </div>
  `;
};

export function initReploidHome(mount, options = {}) {
  if (!mount) return null;
  let state = createInitialState();
  const onAwaken = typeof options.onAwaken === 'function'
    ? options.onAwaken
    : async (payload) => window.triggerAwaken?.(payload);

  const setState = (updates = {}, { rerender = true } = {}) => {
    state = { ...state, ...updates };
    persistState(state);
    if (rerender) render();
  };

  const updateAwakenButton = () => {
    const button = mount.querySelector('#awaken-btn');
    if (!button) return;
    const launch = getLaunch(state);
    button.disabled = state.isAwakening || !launch.canAwaken || !normalize(state.goal);
    button.textContent = state.isAwakening ? 'Awakening...' : 'Awaken';
  };

  const render = () => {
    mount.style.display = 'block';
    mount.innerHTML = renderHome(state);
  };

  const handleInput = (event) => {
    const target = event.target;
    if (target?.id === 'goal-input') {
      state = { ...state, goal: target.value };
      persistState(state);
      updateAwakenButton();
      return;
    }
    if (target?.id === 'direct-key') {
      state = { ...state, directKey: target.value };
      persistState(state);
      updateAwakenButton();
    }
  };

  const handleChange = (event) => {
    const target = event.target;
    if (target?.id === 'reploid-swarm-enabled') {
      setState({ swarmEnabled: !!target.checked });
      return;
    }
    if (target?.id === 'direct-provider') {
      const provider = target.value || DEFAULT_DIRECT_PROVIDER;
      setState({
        directProvider: provider,
        directModel: (DIRECT_MODELS[provider] || DIRECT_MODELS.gemini)[0].id
      });
      return;
    }
    if (target?.id === 'direct-model') {
      setState({ directModel: target.value || DEFAULT_DIRECT_MODEL });
    }
  };

  const buildModelConfig = () => {
    if (!getHasDirectInference(state)) return null;
    return {
      id: state.directModel,
      name: state.directModel,
      provider: state.directProvider,
      hostType: 'browser-cloud',
      apiKey: state.directKey,
      baseUrl: null
    };
  };

  const readSelfFilePreview = async (path) => {
    const generatedPreview = getGeneratedSelfFilePreview(path);
    if (generatedPreview) {
      return {
        content: generatedPreview,
        status: 'generated preview'
      };
    }

    const sourcePath = SELF_SOURCE_PATHS[path];
    if (!sourcePath) {
      throw new Error(`No preview source for ${path}`);
    }
    const response = await fetch(sourcePath, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load ${sourcePath} (${response.status})`);
    }
    return {
      content: await response.text(),
      status: 'source preview'
    };
  };

  const selectSelfPath = async (path) => {
    if (!SELF_FILE_PATHS.includes(path)) return;
    setState({
      selectedSelfPath: path,
      selectedSelfContent: 'Loading...',
      selectedSelfStatus: 'loading',
      selfBrowserOpen: true
    });

    try {
      const preview = await readSelfFilePreview(path);
      if (state.selectedSelfPath !== path) return;
      setState({
        selectedSelfContent: preview.content,
        selectedSelfStatus: preview.status,
        selfBrowserOpen: true
      });
    } catch (error) {
      if (state.selectedSelfPath !== path) return;
      setState({
        selectedSelfContent: `[unavailable] ${error?.message || error}`,
        selectedSelfStatus: 'unavailable',
        selfBrowserOpen: true
      });
    }
  };

  const handleAwaken = async () => {
    if (state.isAwakening) return;
    setState({ isAwakening: true }, { rerender: false });
    updateAwakenButton();
    try {
      await onAwaken({
        goal: state.goal,
        environment: getDefaultReploidEnvironment(),
        swarmEnabled: state.swarmEnabled,
        modelConfig: buildModelConfig(),
        seedOverrides: {}
      });
    } catch (error) {
      console.error('[Reploid] Awaken failed', error);
      setState({
        isAwakening: false,
        goalStatus: `Awaken failed: ${error?.message || error || 'unknown error'}`
      });
    }
  };

  const handleClick = async (event) => {
    const action = event.target?.closest?.('[data-action]')?.dataset?.action;
    if (event.target?.id === 'awaken-btn') {
      event.preventDefault();
      await handleAwaken();
      return;
    }
    if (action === 'toggle-own-inference') {
      event.preventDefault();
      const ownInference = !state.ownInference;
      setState({
        ownInference,
        directKey: ownInference ? state.directKey : ''
      });
      return;
    }
    if (action === 'generate-goal') {
      event.preventDefault();
      setState({
        goal: pickRandomGoal(state.goal),
        goalStatus: ''
      });
      return;
    }
    if (action === 'select-self-path') {
      event.preventDefault();
      await selectSelfPath(event.target.closest('[data-path]')?.dataset?.path || '');
    }
  };

  mount.addEventListener('input', handleInput);
  mount.addEventListener('change', handleChange);
  mount.addEventListener('click', handleClick);
  render();

  return {
    cleanup() {
      mount.removeEventListener('input', handleInput);
      mount.removeEventListener('change', handleChange);
      mount.removeEventListener('click', handleClick);
    }
  };
}

export default {
  initReploidHome
};
