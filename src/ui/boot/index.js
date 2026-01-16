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

import {
  buildGoalCriteria,
  findGoalMeta,
  formatGoalPacket,
  parseCriteriaText
} from './goals.js';

import { serializeModuleOverrides } from '../../config/module-resolution.js';
import { readVfsFile } from '../../boot/vfs-bootstrap.js';

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

const updateHitlConfig = (updates) => {
  let current = {
    approvalMode: 'autonomous',
    moduleOverrides: {},
    everyNSteps: 5,
    stepCounter: 0
  };

  try {
    const raw = localStorage.getItem('REPLOID_HITL_CONFIG');
    if (raw) {
      current = { ...current, ...JSON.parse(raw) };
    }
  } catch (e) {
    current = {
      approvalMode: 'autonomous',
      moduleOverrides: {},
      everyNSteps: 5,
      stepCounter: 0
    };
  }

  const next = { ...current, ...updates };
  localStorage.setItem('REPLOID_HITL_CONFIG', JSON.stringify(next));
  return next;
};

async function ensureModuleConfigLoaded() {
  const current = getState().moduleConfig || {};
  if (current.loading || (current.genesis && current.registry)) return;

  setState({ moduleConfig: { ...current, loading: true, error: null } });

  try {
    const [genesisText, registryText] = await Promise.all([
      readVfsFile('/config/genesis-levels.json'),
      readVfsFile('/config/module-registry.json')
    ]);

    if (!genesisText) {
      throw new Error('Missing genesis config in VFS');
    }
    if (!registryText) {
      throw new Error('Missing module registry in VFS');
    }

    const genesis = JSON.parse(genesisText);
    const registry = JSON.parse(registryText);

    setState({
      moduleConfig: {
        loading: false,
        error: null,
        genesis,
        registry
      }
    });
  } catch (err) {
    setState({
      moduleConfig: {
        loading: false,
        error: err.message || 'Failed to load module registry',
        genesis: null,
        registry: null
      }
    });
  }
}

/**
 * Initialize wizard
 */
export function initWizard(containerEl) {
  container = containerEl;
  listenersAttached = false;
  isInitialRender = true;
  lastModuleConfigState = null;
  subscribe(scheduleUpdate);
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
 * First call builds DOM, subsequent calls update classes/attributes only
 */
let isInitialRender = true;
let updateScheduled = false;

// Track state that requires full re-render
let lastModuleConfigState = null;
let lastAdvancedOpen = null;
let lastDirectVerifyState = null;
let lastProxyVerifyState = null;
let lastDirectModel = null;
let lastDirectModelVerifyState = null;

function scheduleUpdate() {
  if (updateScheduled) return;
  updateScheduled = true;
  requestAnimationFrame(() => {
    updateScheduled = false;
    const state = getState();

    // Full re-render when structural changes occur
    const moduleConfigState = JSON.stringify(state.moduleConfig);
    const moduleConfigChanged = moduleConfigState !== lastModuleConfigState;
    const advancedOpenChanged = state.advancedOpen !== lastAdvancedOpen;
    const directVerifyChanged = state.directConfig?.verifyState !== lastDirectVerifyState;
    const proxyVerifyChanged = state.proxyConfig?.verifyState !== lastProxyVerifyState;
    const directModelChanged = state.directConfig?.model !== lastDirectModel;
    const directModelVerifyChanged = state.directConfig?.modelVerifyState !== lastDirectModelVerifyState;

    if (isInitialRender || moduleConfigChanged || advancedOpenChanged ||
        directVerifyChanged || proxyVerifyChanged || directModelChanged || directModelVerifyChanged) {
      lastModuleConfigState = moduleConfigState;
      lastAdvancedOpen = state.advancedOpen;
      lastDirectVerifyState = state.directConfig?.verifyState;
      lastProxyVerifyState = state.proxyConfig?.verifyState;
      lastDirectModel = state.directConfig?.model;
      lastDirectModelVerifyState = state.directConfig?.modelVerifyState;
      render();
    } else {
      updateUI();
    }
  });
}

/**
 * Update UI without full re-render - just toggle classes and attributes
 */
function updateUI() {
  if (!container) return;
  const state = getState();

  // Update connection type selection
  container.querySelectorAll('[data-action^="choose-"]').forEach(btn => {
    const type = btn.dataset.action.replace('choose-', '');
    btn.classList.toggle('border-ghost', state.connectionType !== type);
  });

  // Show/hide config sections based on connection type
  const directSection = container.querySelector('.wizard-direct');
  const proxySection = container.querySelector('.wizard-proxy');
  const browserSection = container.querySelector('.wizard-browser');
  const goalSection = container.querySelector('.wizard-goal');
  const awakenSection = container.querySelector('.wizard-awaken');

  if (directSection) directSection.style.display = state.connectionType === 'direct' ? '' : 'none';
  if (proxySection) proxySection.style.display = state.connectionType === 'proxy' ? '' : 'none';
  if (browserSection) browserSection.style.display = state.connectionType === 'browser' ? '' : 'none';

  // Show goal/awaken when ready
  const ready = canAwaken();
  if (goalSection) goalSection.style.display = ready ? '' : 'none';
  if (awakenSection) awakenSection.style.display = ready ? '' : 'none';

  // Update accordion states
  container.querySelectorAll('.accordion-header[data-category]').forEach(header => {
    const category = header.dataset.category;
    const isSelected = category === state.selectedGoalCategory;
    header.setAttribute('aria-expanded', isSelected);
    const content = header.nextElementSibling;
    if (content) content.setAttribute('aria-hidden', !isSelected);
  });

  // Update advanced panel visibility
  const advancedPanel = container.querySelector('.advanced-panel');
  if (advancedPanel) advancedPanel.style.display = state.advancedOpen ? '' : 'none';

  // Update genesis level select
  const genesisSelect = container.querySelector('#advanced-genesis-level');
  if (genesisSelect && state.advancedConfig?.genesisLevel) {
    genesisSelect.value = state.advancedConfig.genesisLevel;
  }

  // Update preserve checkbox
  const preserveCheckbox = container.querySelector('#preserve-on-boot');
  if (preserveCheckbox) {
    preserveCheckbox.checked = !!state.advancedConfig?.preserveOnBoot;
  }

  // Update awaken button based on goal and loading state
  const awakenBtn = container.querySelector('[data-action="awaken"]');
  const hasGoal = !!(state.goal && state.goal.trim());
  const isAwakening = !!state.isAwakening;
  if (awakenBtn) {
    awakenBtn.disabled = !hasGoal || isAwakening;
    awakenBtn.classList.toggle('loading', isAwakening);
    awakenBtn.setAttribute('aria-busy', isAwakening);
    awakenBtn.textContent = isAwakening ? 'Awakening...' : 'Awaken Agent';
    if (!hasGoal && !isAwakening) {
      awakenBtn.title = 'Select or enter a goal above to awaken the agent.';
    } else {
      awakenBtn.removeAttribute('title');
    }
  }

  // Update advanced settings button text
  const advancedBtnInAwaken = container.querySelector('.wizard-awaken [data-action="advanced-settings"]');
  if (advancedBtnInAwaken) {
    advancedBtnInAwaken.textContent = state.advancedOpen ? 'Hide advanced' : 'Advanced settings';
  }

  updateGoalBuilderUI(state);

  // Load module config if needed
  if (state.advancedOpen || ready) {
    ensureModuleConfigLoaded();
  }
}

function updateGoalBuilderUI(state) {
  const builder = container.querySelector('.goal-builder');
  if (!builder) return;

  const criteriaText = state.goalCriteria || '';
  const criteriaList = parseCriteriaText(criteriaText);
  const criteriaCount = criteriaList.length;
  const countEl = builder.querySelector('[data-goal-criteria-count]');
  if (countEl) {
    countEl.textContent = criteriaCount ? `${criteriaCount} criteria` : 'No criteria yet';
  }

  const goalMeta = findGoalMeta(state.goal);
  const goalTitle = goalMeta?.view || (state.goal ? 'Custom goal' : 'No goal selected');
  const goalDescription = goalMeta?.text || state.goal || 'Pick a goal to see details.';
  const titleEl = builder.querySelector('[data-goal-meta-title]');
  if (titleEl) titleEl.textContent = goalTitle;
  const textEl = builder.querySelector('[data-goal-meta-text]');
  if (textEl) textEl.textContent = goalDescription;

  const tags = [];
  if (goalMeta?.level) tags.push(goalMeta.level);
  if (goalMeta?.requires?.doppler) tags.push('Doppler');
  if (goalMeta?.requires?.model) tags.push('Model access');
  if (goalMeta?.requires?.reasoning) tags.push(`Reasoning ${goalMeta.requires.reasoning}`);
  if (goalMeta?.recommended) tags.push('Recommended');
  if (Array.isArray(goalMeta?.tags)) tags.push(...goalMeta.tags);
  const uniqueTags = Array.from(new Set(tags)).slice(0, 10);

  const tagsEl = builder.querySelector('[data-goal-meta-tags]');
  if (tagsEl) {
    tagsEl.replaceChildren();
    if (uniqueTags.length === 0) {
      const emptyTag = document.createElement('span');
      emptyTag.className = 'type-caption';
      emptyTag.textContent = 'No signals yet.';
      tagsEl.appendChild(emptyTag);
    } else {
      uniqueTags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'tag';
        tagEl.textContent = tag;
        tagsEl.appendChild(tagEl);
      });
    }
  }

  const suggestions = buildGoalCriteria(state.goal, goalMeta);
  const suggestionsEl = builder.querySelector('[data-goal-suggestions]');
  if (suggestionsEl) {
    suggestionsEl.replaceChildren();
    if (suggestions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'criteria-item criteria-empty type-caption';
      empty.textContent = 'No suggestions yet.';
      suggestionsEl.appendChild(empty);
    } else {
      suggestions.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'criteria-item';
        const indexEl = document.createElement('span');
        indexEl.className = 'criteria-index';
        indexEl.textContent = String(index + 1);
        const textEl = document.createElement('span');
        textEl.className = 'criteria-text';
        textEl.textContent = item;
        li.append(indexEl, textEl);
        suggestionsEl.appendChild(li);
      });
    }
  }

  const criteriaInput = builder.querySelector('#goal-criteria');
  if (criteriaInput && document.activeElement !== criteriaInput && criteriaInput.value !== criteriaText) {
    criteriaInput.value = criteriaText;
  }

  const customGoalInput = container.querySelector('#custom-goal');
  if (customGoalInput && document.activeElement !== customGoalInput && customGoalInput.value !== (state.goal || '')) {
    customGoalInput.value = state.goal || '';
  }

  const applyButton = builder.querySelector('[data-action="apply-goal-suggestions"]');
  if (applyButton) applyButton.disabled = suggestions.length === 0;
  const clearButton = builder.querySelector('[data-action="clear-goal-criteria"]');
  if (clearButton) clearButton.disabled = !criteriaText.trim();
}

function render() {
  if (!container) return;

  // Save focus/scroll before DOM replacement
  const activeEl = document.activeElement;
  const focusId = activeEl?.id || null;
  const focusSelStart = activeEl?.selectionStart;
  const focusSelEnd = activeEl?.selectionEnd;
  const scrollTop = container.scrollTop;

  const state = getState();
  let html = '<div class="wizard-sections">';

  // Header
  html += `
    <div class="wizard-brand">
      <div class="brand-row">
        <h1 class="type-display">REPLOID</h1>
        <a class="link-secondary" href="/reset.html">clear saved settings</a>
      </div>
      <a class="intro-tagline" href="https://github.com/clocksmith/reploid" target="_blank" rel="noopener">self-modifying AI agent in the browser → view source code</a>
    </div>
  `;

  // Section 1: Always show connection type selection
  html += renderChooseStep(state);

  // Section 2: Render ALL config sections (hidden by CSS initially)
  // Direct config
  const directDisplay = state.connectionType === 'direct' ? '' : 'none';
  html += `<div class="wizard-direct" style="display:${directDisplay}">${renderDirectConfigStep(state)}</div>`;

  // Proxy config
  const proxyDisplay = state.connectionType === 'proxy' ? '' : 'none';
  html += `<div class="wizard-proxy" style="display:${proxyDisplay}">${renderProxyConfigStep(state)}</div>`;

  // Browser config
  const browserDisplay = state.connectionType === 'browser' ? '' : 'none';
  html += `<div class="wizard-browser" style="display:${browserDisplay}">${renderBrowserConfigStep(state)}</div>`;

  // Section 3: Goal and awaken (hidden until ready)
  const ready = canAwaken();
  const goalDisplay = ready ? '' : 'none';
  html += `<div style="display:${goalDisplay}">${renderGoalStep(state)}</div>`;
  html += `<div style="display:${goalDisplay}">${renderAwakenStep(state)}</div>`;

  html += '</div>';

  container.innerHTML = html;
  isInitialRender = false;

  // Restore scroll and focus
  container.scrollTop = scrollTop;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (typeof focusSelStart === 'number' && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(focusSelStart, focusSelEnd); } catch (e) { /* ignore */ }
      }
    }
  }

  if (state.advancedOpen || ready) {
    ensureModuleConfigLoaded();
  }

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
      setState({
        connectionType: null,
        goal: null,
        goalCriteria: '',
        goalCriteriaSource: 'auto'
      });
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

    case 'toggle-goal-category': {
      const category = e.target.closest('[data-category]')?.dataset.category;
      if (category) {
        setState({ selectedGoalCategory: category });
      }
      break;
    }

    case 'select-goal': {
      const goalText = e.target.closest('[data-goal]')?.dataset.goal;
      if (goalText) {
        const goalMeta = findGoalMeta(goalText);
        const suggestions = buildGoalCriteria(goalText, goalMeta);
        const criteriaText = suggestions.join('\n');
        setState({
          goal: goalText,
          goalCriteria: criteriaText,
          goalCriteriaSource: 'auto'
        });
        const textarea = document.getElementById('custom-goal');
        if (textarea) textarea.value = goalText;
        const criteriaInput = document.getElementById('goal-criteria');
        if (criteriaInput) criteriaInput.value = criteriaText;
      }
      break;
    }

    case 'apply-goal-suggestions': {
      const goalMeta = findGoalMeta(state.goal);
      const suggestions = buildGoalCriteria(state.goal, goalMeta);
      const criteriaText = suggestions.join('\n');
      setState({
        goalCriteria: criteriaText,
        goalCriteriaSource: 'auto'
      });
      const criteriaInput = document.getElementById('goal-criteria');
      if (criteriaInput) criteriaInput.value = criteriaText;
      break;
    }

    case 'clear-goal-criteria': {
      setState({ goalCriteria: '', goalCriteriaSource: 'custom' });
      const criteriaInput = document.getElementById('goal-criteria');
      if (criteriaInput) criteriaInput.value = '';
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
      setState({ advancedOpen: !state.advancedOpen });
      break;

    case 'module-override': {
      const button = e.target.closest('[data-module][data-value]');
      if (!button) break;
      const moduleName = button.dataset.module;
      const value = button.dataset.value;
      if (!moduleName || !value) break;

      const overrides = { ...(state.advancedConfig?.moduleOverrides || {}) };
      if (value === 'inherit') {
        delete overrides[moduleName];
      } else if (value === 'on' || value === 'off') {
        overrides[moduleName] = value;
      }

      const serialized = serializeModuleOverrides(overrides);
      localStorage.setItem('REPLOID_MODULE_OVERRIDES', serialized);
      setNestedState('advancedConfig', { moduleOverrides: overrides });
      break;
    }

    case 'reset-module-overrides': {
      if (confirm('Reset all module overrides?')) {
        localStorage.removeItem('REPLOID_MODULE_OVERRIDES');
        setNestedState('advancedConfig', { moduleOverrides: {} });
      }
      break;
    }

    case 'awaken-anyway':
      doAwaken();
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

    case 'preserve-on-boot':
      localStorage.setItem('REPLOID_PRESERVE_ON_BOOT', value ? 'true' : 'false');
      setNestedState('advancedConfig', { preserveOnBoot: value });
      break;

    case 'advanced-genesis-level':
      localStorage.setItem('REPLOID_GENESIS_LEVEL', value);
      setNestedState('advancedConfig', { genesisLevel: value });
      break;

    case 'advanced-hitl-mode': {
      const mode = value;
      const next = updateHitlConfig({
        approvalMode: mode
      });
      setNestedState('advancedConfig', {
        hitlApprovalMode: next.approvalMode,
        hitlEveryNSteps: next.everyNSteps
      });
      break;
    }

    case 'advanced-hitl-steps': {
      const steps = parseInt(value, 10);
      if (Number.isNaN(steps)) break;
      const clamped = Math.min(100, Math.max(1, steps));
      const next = updateHitlConfig({
        everyNSteps: clamped
      });
      setNestedState('advancedConfig', {
        hitlApprovalMode: next.approvalMode,
        hitlEveryNSteps: next.everyNSteps
      });
      break;
    }

    case 'module-override-filter':
      setState({ moduleOverrideFilter: value });
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
      {
        const current = getState();
        const updates = { goal: value };
        if (current.goalCriteriaSource === 'auto') {
          const goalMeta = findGoalMeta(value);
          const suggestions = buildGoalCriteria(value, goalMeta);
          updates.goalCriteria = suggestions.join('\n');
        }
        setState(updates);
      }
      break;

    case 'goal-criteria':
      setState({ goalCriteria: value, goalCriteriaSource: 'custom' });
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

    case 'module-override-search':
      setState({ moduleOverrideSearch: value });
      break;
  }
}

async function handleTestDirectKey() {
  const state = getState();
  let { provider, apiKey, baseUrl } = state.directConfig;

  // Read values directly from inputs in case state is stale
  const keyInput = document.getElementById('direct-key');
  const urlInput = document.getElementById('direct-base-url');
  if (keyInput?.value) apiKey = keyInput.value;
  if (urlInput?.value) baseUrl = urlInput.value;

  // Update state with current input values
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
  render();

  const result = await testApiKey(provider, apiKey, baseUrl);

  if (result.success) {
    // Auto-select first model for this provider if none selected
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
    await doAwaken();
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

async function doAwaken() {
  const state = getState();
  const goalPacket = formatGoalPacket(state.goal, state.goalCriteria) || state.goal;
  saveConfig();

  // Set loading state immediately
  setState({ isAwakening: true });

  // Clear VFS before awakening to ensure fresh hydration from source files
  if (window.clearVFS) {
    console.log('[Boot] Clearing VFS before awaken...');
    try {
      const steps = await window.clearVFS();
      console.log('[Boot] VFS cleared:', steps);
    } catch (err) {
      console.warn('[Boot] VFS clear failed, continuing anyway:', err);
    }
  }

  if (window.triggerAwaken) {
    window.triggerAwaken(goalPacket);
  }
  // Note: isAwakening stays true since the page will transition to agent UI
}

async function handleAwaken() {
  await doAwaken();
}

export { STEPS, getState, goToStep };
