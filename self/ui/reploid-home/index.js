/**
 * @fileoverview Minimal home surface for the primary Reploid route.
 */

import { getDefaultReploidEnvironment } from '../../config/reploid-environments.js';
import {
  DREAM_INSTANCE_MANIFEST_PATH,
  getDreamInstanceSeedSummary
} from '../../dream-instance.js';
import {
  createReploidPeerUrl,
  getCurrentReploidInstanceLabel,
  getCurrentReploidStorage
} from '../../instance.js';

const DEFAULT_GOAL = [
  'Run one Shadow RGR self-improvement cycle: read the kernel prompt, RGR blueprints, runtime, and capsule; identify one measurable weakness; produce one reversible candidate plus a receipt/archive entry with baseline, score vector, rollback path, and gate reasons. Do not promote.'
].join(' ');

const GENERATED_GOALS = Object.freeze([
  'Read the runtime and capsule, find one status metric that lacks evidence, and write a Shadow receipt with candidate, score vector, rollback path, and gate reasons.',
  'Read the kernel prompt and RGR blueprints, propose one wording change that reduces self-approval risk, and archive the candidate without promoting it.',
  'Inspect the tool scheduler, compare current batching against the RGR rules, and write one reversible prompt or blueprint candidate with score evidence.',
  'Create a Shadow receipt proving the live self can read, write an artifact, hot-load only when needed, recover from blocked inference, and explain the gate result.',
  'Find one brittle boot or service-worker path, propose the smallest reversible candidate, and archive replay evidence before any self patch.',
  'Generate two self-repair candidates for one repeated runtime failure, score both against safety and reversibility, and keep only the Pareto survivor in the archive.',
  'Design a peer-assisted witness flow where remote browsers add anchor observations but cannot approve promotion, then write the blueprint candidate and receipt.',
  'Find one place the system could accidentally let a candidate judge its own validator, then write a quarantine candidate with explicit gate reasons.',
  'Turn the boot path into a measurable Shadow benchmark with baseline, expected replay, failure signal, and a no-promotion receipt.',
  'Create a mutation budget candidate that limits self-edits, tracks rollback, and rejects promotion when Q_anchor is below threshold.',
  'Improve the agent prompt so every proposed self-change names baseline, candidate, score vector, receipt path, and why Promote is still blocked.',
  'Build a local archive artifact schema for failed candidates, recovered states, rejected mutations, and lessons for later Shadow cycles.',
  'Stress-test the browser self by planning missing inference, stale service worker, broken VFS file, and peer-loss cases as replayable Shadow checks.',
  'Propose a minimal comparison artifact for two self-versions using evidence, Pareto keys, and anchor status rather than confidence.',
  'Make the next cycle produce one useful Shadow artifact before any code edit is allowed, then score whether that constraint improved safety.'
]);

const RING_SLOTS = Object.freeze([
  'elite',
  'performance',
  'robustness',
  'repair',
  'low-cost',
  'safety',
  'fallback'
]);
const DREAM_INSTANCE = Object.freeze(getDreamInstanceSeedSummary());

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
    ? DEFAULT_GOAL
    : normalized;
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const normalize = (value) => String(value || '').trim();

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
  }

  return {
    goal: migrateStoredGoal(storage.getItem('REPLOID_HOME_GOAL')) || DEFAULT_GOAL,
    swarmEnabled: storedSwarm === null ? true : storedSwarm === 'true',
    ownInference: storedOwnInference,
    directProvider: savedModel?.provider || DEFAULT_DIRECT_PROVIDER,
    directModel: normalizeDirectModel(savedModel?.provider || DEFAULT_DIRECT_PROVIDER, savedModel?.id),
    directKey: savedModel?.apiKey || '',
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

const getLaunch = (state) => {
  const hasInference = getHasDirectInference(state);
  const topology = state.swarmEnabled ? 'peer-assisted' : 'local';
  const slots = hasInference && state.swarmEnabled
    ? 'local/remote'
    : hasInference
      ? 'local'
      : state.swarmEnabled
        ? 'remote'
        : 'empty';
  const role = state.swarmEnabled
    ? hasInference ? 'provider' : 'consumer'
    : hasInference ? 'solo host' : 'offline';
  const executor = hasInference && state.swarmEnabled
    ? 'local host + remote slots'
    : hasInference
      ? 'local host'
      : state.swarmEnabled
        ? 'waiting for host'
        : 'none';
  const note = hasInference
    ? state.swarmEnabled
      ? 'Local slots execute here and remote slots may join'
      : 'All runnable slots execute locally'
    : state.swarmEnabled
      ? 'Waiting for remote host slots'
      : 'No executor attached';

  return {
    hasInference,
    topology,
    slots,
    role,
    executor,
    note,
    canAwaken: hasInference || state.swarmEnabled
  };
};

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
  }
};

const renderMetric = (label, value) => `
  <span class="rgr-status-metric">
    <span class="rgr-status-label">${escapeHtml(label)}</span>
    <span class="rgr-status-value">${escapeHtml(value || '-')}</span>
  </span>
`;

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
  const selfFiles = [
    '/self/self.json',
    DREAM_INSTANCE_MANIFEST_PATH,
    '/self/prompts/kernel.md',
    '/self/blueprints/0x000112-recursive-gepa-ring.md',
    '/self/blueprints/rgr-slot-topology.md',
    '/self/blueprints/rgr-dream-instance-manifest.md',
    '/self/dream-instance.js',
    '/self/runtime.js',
    '/self/bridge.js',
    '/self/capsule/index.js',
    '/self/host/start-reploid.js'
  ];

  return `
    <div class="wizard-sections wizard-sections-home">
      <div class="wizard-step wizard-intro">
        <div class="goal-header">
          <h1 class="type-h1">Reploid</h1>
          <p class="type-caption">ring slots can be local or remote · peer ${escapeHtml(getCurrentReploidInstanceLabel())} · <a class="link-secondary" href="${escapeHtml(peerUrl)}" target="_blank" rel="noopener">new peer</a> · <a class="link-secondary" href="${escapeHtml(freshPeerUrl)}" target="_blank" rel="noopener">fresh peer</a></p>
        </div>
      </div>

      <div class="wizard-step inference-bar">
        <div class="goal-header">
          <h2 class="type-h2">Ring</h2>
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
        <div class="rgr-status-strip" aria-label="System and peer status">
          ${renderMetric('Mode', 'Seed')}
          ${renderMetric('Role', launch.role)}
          ${renderMetric('Slots', slotSummary)}
          ${renderMetric('Transport', state.swarmEnabled ? 'local room' : 'disabled')}
          ${renderMetric('Host', launch.executor)}
          ${renderMetric('Gate', 'anchor')}
          ${renderMetric('Dream', DREAM_INSTANCE.state)}
        </div>
      </div>

      <div class="wizard-step dream-instance-panel" aria-label="Dream instance manifest">
        <div class="goal-header">
          <h2 class="type-h2">Dream instance</h2>
          <p class="type-caption">manifested in the awakened self at ${escapeHtml(DREAM_INSTANCE.manifestPath)}</p>
        </div>
        <div class="dream-instance-status-strip">
          ${renderMetric('State', DREAM_INSTANCE.state)}
          ${renderMetric('Mode', DREAM_INSTANCE.mode)}
          ${renderMetric('Stages', `${DREAM_INSTANCE.stageCount} gates`)}
          ${renderMetric('Gate', DREAM_INSTANCE.gate)}
        </div>
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
        <button class="btn" id="awaken-btn" type="button"${state.isAwakening || !launch.canAwaken || !normalize(state.goal) ? ' disabled' : ''}>${state.isAwakening ? 'Awakening...' : 'Awaken'}</button>
      </div>

      <details class="seed-browser-panel">
        <summary class="seed-browser-summary">
          <span>Awakened files</span>
        </summary>
        <div class="seed-browser-grid">
          <div class="seed-tree-panel">
            <h3 class="type-h3">Self tree</h3>
            ${selfFiles.map((path) => `
              <button class="seed-path-row" type="button" data-action="select-self-path" data-path="${escapeHtml(path)}">${escapeHtml(path)}</button>
            `).join('')}
          </div>
          <pre class="seed-viewer-panel">{
  "selfHosted": true,
  "productModel": "Reploid",
  "coreInvariant": "Self-improvement runs in Shadow before promotion.",
  "instances": {
    "dream": "${escapeHtml(DREAM_INSTANCE.manifestPath)}"
  },
  "visibleTools": ["ReadFile", "WriteFile", "CreateTool", "LoadModule"]
}</pre>
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

  const handleAwaken = async () => {
    if (state.isAwakening) return;
    setState({ isAwakening: true }, { rerender: false });
    updateAwakenButton();
    await onAwaken({
      goal: state.goal,
      environment: getDefaultReploidEnvironment(),
      swarmEnabled: state.swarmEnabled,
      modelConfig: buildModelConfig(),
      seedOverrides: {}
    });
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
      setState({ ownInference: !state.ownInference });
      return;
    }
    if (action === 'generate-goal') {
      event.preventDefault();
      const availableGoals = GENERATED_GOALS.filter((goal) => goal !== state.goal);
      const pool = availableGoals.length > 0 ? availableGoals : GENERATED_GOALS;
      const next = pool[Math.floor(Math.random() * pool.length)];
      setState({
        goal: next,
        goalStatus: ''
      });
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
