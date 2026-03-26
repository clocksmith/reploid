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
  testProxyModel, testDirectModel, generateGoalPrompt
} from './detection.js';

import { formatGoalPacket, getGoalEntries } from './goals.js';
import {
  findAbsoluteZeroEnvironmentTemplateId,
  getAbsoluteZeroEnvironmentTemplate
} from '../../config/absolute-zero-environments.js';
import {
  getBootModeConfig,
  inferBootModeFromGenesis,
  normalizeBootMode
} from '../../config/boot-modes.js';
import { pickBootSeedFiles } from '../../config/boot-seed.js';
import {
  ABSOLUTE_ZERO_HOST_SOURCE_MIRRORS,
  ABSOLUTE_ZERO_SELF_SOURCE_MIRRORS
} from '../../capsule/contract.js';
import { serializeModuleOverrides } from '../../config/module-resolution.js';
import { setSecurityEnabled } from '../../core/security-config.js';
import { readVfsFile, loadVfsManifest, seedVfsFromManifest, clearVfsStore } from '../../boot-helpers/vfs-bootstrap.js';

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
const VFS_BYPASS_HEADER = 'x-reploid-vfs-bypass';

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

const toSortedFileList = (files) => Array.from(new Set(
  (Array.isArray(files) ? files : []).filter((file) => typeof file === 'string' && file.trim())
)).sort();

const buildFileTree = (files) => {
  const sortedFiles = toSortedFileList(files);
  if (sortedFiles.length === 0) return '';

  const root = {};
  for (const file of sortedFiles) {
    const parts = file.replace(/^\/+/, '').split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      if (isLeaf) {
        node[part] = null;
        return;
      }
      node[part] = node[part] || {};
      node = node[part];
    });
  }

  const lines = [];
  const walk = (node, prefix = '') => {
    const entries = Object.keys(node).sort((left, right) => {
      const leftDir = node[left] && typeof node[left] === 'object';
      const rightDir = node[right] && typeof node[right] === 'object';
      if (leftDir !== rightDir) return leftDir ? -1 : 1;
      return left.localeCompare(right);
    });

    entries.forEach((name, index) => {
      const child = node[name];
      const isLast = index === entries.length - 1;
      const branch = isLast ? '└─ ' : '├─ ';
      const nextPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
      const isDir = !!child && typeof child === 'object';
      lines.push(`${prefix}${branch}${name}${isDir ? '/' : ''}`);
      if (isDir) walk(child, nextPrefix);
    });
  };

  walk(root);
  return lines.join('\n');
};

const summarizeRoots = (files) => {
  const counts = new Map();
  for (const file of toSortedFileList(files)) {
    const root = file.replace(/^\/+/, '').split('/').filter(Boolean)[0] || '.';
    counts.set(root, (counts.get(root) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([root, count]) => ({ root, count }));
};

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

async function ensureBootPayloadLoaded() {
  const current = getState().bootPayload || {};
  if (current.loading || current.loaded) return;

  setState({
    bootPayload: {
      ...current,
      loading: true,
      loaded: false,
      error: null
    }
  });

  try {
    const { manifest } = await loadVfsManifest();
    const manifestFiles = toSortedFileList(manifest?.files || []);
    const bootFiles = pickBootSeedFiles(manifestFiles);

    setState({
      bootPayload: {
        loading: false,
        loaded: true,
        error: null,
        bootFiles,
        bootTree: buildFileTree(bootFiles),
        manifestFiles,
        rootSummary: summarizeRoots(manifestFiles)
      }
    });
  } catch (err) {
    setState({
      bootPayload: {
        loading: false,
        loaded: false,
        error: err?.message || 'Failed to load boot manifest',
        bootFiles: [],
        bootTree: '',
        manifestFiles: [],
        rootSummary: []
      }
    });
  }
}

async function ensureAbsoluteZeroPreviewLoaded(includeHostWithinSelf = false) {
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
}

/**
 * Initialize wizard
 */
export function initWizard(containerEl) {
  container = containerEl;
  listenersAttached = false;
  isInitialRender = true;
  lastModuleConfigState = null;
  lastMode = null;
  subscribe(scheduleUpdate);
  handleStart();
}

/**
 * Handle START - run detection in background and show choose step
 */
function handleStart() {
  const saved = checkSavedConfig();
  setState({ savedConfig: saved, currentStep: STEPS.CHOOSE });
  ensureBootPayloadLoaded();
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
  if (state.mode === 'zero' && detection.webgpu?.supported) {
    setState({ connectionType: 'browser' });
    if (!state.dopplerConfig?.model) {
      setNestedState('dopplerConfig', { model: 'smollm2-360m' });
    }
    return;
  }

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
let lastMode = null;
let lastConnectionType = null;
let lastCanAwaken = null;
let lastBootPayloadState = null;
let lastAbsoluteZeroPreviewState = null;
let lastSelectedAbsoluteZeroPath = null;
let lastGoal = null;
let lastEnvironment = null;
let lastIncludeHostWithinSelf = null;
let lastSelectedGoalCategory = null;
let lastGoalShuffleSeed = null;
let lastGoalGeneratorState = null;

const getDefaultCloudModelForProvider = (provider) => {
  const models = CLOUD_MODELS[provider] || [];
  return models[0]?.id || null;
};

const renderLockedSection = (title, caption) => `
  <div class="wizard-step wizard-stage-placeholder">
    <div class="goal-header">
      <h2 class="type-h1">${title}</h2>
      <p class="type-caption">${caption}</p>
    </div>
  </div>
`;

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
    const modeChanged = state.mode !== lastMode;
    const connectionTypeChanged = state.connectionType !== lastConnectionType;
    const readyToAwaken = canAwaken();
    const canAwakenChanged = readyToAwaken !== lastCanAwaken;
    const bootPayloadState = JSON.stringify(state.bootPayload);
    const bootPayloadChanged = bootPayloadState !== lastBootPayloadState;
    const absoluteZeroPreviewState = JSON.stringify(state.absoluteZeroPreview);
    const absoluteZeroPreviewChanged = absoluteZeroPreviewState !== lastAbsoluteZeroPreviewState;
    const selectedAbsoluteZeroPathChanged = state.selectedAbsoluteZeroPath !== lastSelectedAbsoluteZeroPath;
    const goalChanged = state.goal !== lastGoal;
    const environmentChanged = state.environment !== lastEnvironment;
    const includeHostWithinSelfChanged = !!state.includeHostWithinSelf !== !!lastIncludeHostWithinSelf;
    const selectedGoalCategoryChanged = state.selectedGoalCategory !== lastSelectedGoalCategory;
    const goalShuffleSeedChanged = state.goalShuffleSeed !== lastGoalShuffleSeed;
    const goalGeneratorState = JSON.stringify(state.goalGenerator);
    const goalGeneratorChanged = goalGeneratorState !== lastGoalGeneratorState;

    if (isInitialRender || moduleConfigChanged || advancedOpenChanged ||
        directVerifyChanged || proxyVerifyChanged || directModelChanged || directModelVerifyChanged ||
        modeChanged || connectionTypeChanged || canAwakenChanged ||
        bootPayloadChanged || absoluteZeroPreviewChanged ||
        selectedAbsoluteZeroPathChanged || goalChanged || environmentChanged ||
        includeHostWithinSelfChanged || selectedGoalCategoryChanged ||
        goalShuffleSeedChanged || goalGeneratorChanged) {
      lastModuleConfigState = moduleConfigState;
      lastAdvancedOpen = state.advancedOpen;
      lastDirectVerifyState = state.directConfig?.verifyState;
      lastProxyVerifyState = state.proxyConfig?.verifyState;
      lastDirectModel = state.directConfig?.model;
      lastDirectModelVerifyState = state.directConfig?.modelVerifyState;
      lastMode = state.mode;
      lastConnectionType = state.connectionType;
      lastCanAwaken = readyToAwaken;
      lastBootPayloadState = bootPayloadState;
      lastAbsoluteZeroPreviewState = absoluteZeroPreviewState;
      lastSelectedAbsoluteZeroPath = state.selectedAbsoluteZeroPath;
      lastGoal = state.goal;
      lastEnvironment = state.environment;
      lastIncludeHostWithinSelf = !!state.includeHostWithinSelf;
      lastSelectedGoalCategory = state.selectedGoalCategory;
      lastGoalShuffleSeed = state.goalShuffleSeed;
      lastGoalGeneratorState = goalGeneratorState;
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

  // Show goal and awaken sections
  const ready = canAwaken();
  if (goalSection) goalSection.style.display = '';
  if (awakenSection) awakenSection.style.display = '';

  // Update accordion states
  const goalHeaders = Array.from(container.querySelectorAll('.accordion-header[data-category]'));
  const fallbackCategory = goalHeaders[0]?.dataset.category || null;
  const selectedCategory = state.selectedGoalCategory || fallbackCategory;
  goalHeaders.forEach(header => {
    const category = header.dataset.category;
    const isSelected = category === selectedCategory;
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
  const preserveCheckbox = container.querySelector('#advanced-preserve-vfs');
  if (preserveCheckbox) {
    preserveCheckbox.checked = !!state.advancedConfig?.preserveOnBoot;
  }

  const securityCheckbox = container.querySelector('#advanced-security-enabled');
  if (securityCheckbox) {
    securityCheckbox.checked = state.advancedConfig?.securityEnabled !== false;
  }

  const hitlModeSelect = container.querySelector('#advanced-hitl-mode');
  if (hitlModeSelect && state.advancedConfig?.hitlApprovalMode) {
    hitlModeSelect.value = state.advancedConfig.hitlApprovalMode;
  }

  const hitlStepsInput = container.querySelector('#advanced-hitl-steps');
  if (hitlStepsInput && Number.isFinite(state.advancedConfig?.hitlEveryNSteps)) {
    hitlStepsInput.value = state.advancedConfig.hitlEveryNSteps;
  }

  const hitlCadenceRow = container.querySelector('[data-advanced-hitl-cadence]');
  if (hitlCadenceRow) {
    const showCadence = state.advancedConfig?.hitlApprovalMode === 'every_n';
    hitlCadenceRow.style.display = showCadence ? '' : 'none';
    if (hitlStepsInput) {
      hitlStepsInput.disabled = !showCadence;
    }
  }

  const overrideCountEl = container.querySelector('[data-advanced-override-count]');
  const resetOverridesBtn = container.querySelector('[data-action="reset-module-overrides"]');
  if (overrideCountEl || resetOverridesBtn) {
    const overrideCount = Object.keys(state.advancedConfig?.moduleOverrides || {}).length;
    if (overrideCountEl) {
      overrideCountEl.textContent = `${overrideCount} active`;
    }
    if (resetOverridesBtn) {
      resetOverridesBtn.disabled = overrideCount === 0;
    }
  }

  // Update awaken button based on goal, readiness, and loading state
  const awakenBtn = container.querySelector('[data-action="awaken"]');
  const hasGoal = !!(state.goal && state.goal.trim());
  const isAwakening = !!state.isAwakening;
  if (awakenBtn) {
    const blockedByModules = awakenBtn.dataset.blocked === 'modules';
    const disabled = !ready || !hasGoal || isAwakening || blockedByModules;
    awakenBtn.disabled = disabled;
    awakenBtn.classList.toggle('loading', isAwakening);
    awakenBtn.setAttribute('aria-busy', isAwakening);
    awakenBtn.textContent = isAwakening ? 'Awakening...' : 'Awaken Agent';

    if (blockedByModules) {
      const reason = awakenBtn.dataset.blockedReason || 'Missing required modules';
      awakenBtn.setAttribute('title', reason);
    } else if (!hasGoal) {
      awakenBtn.setAttribute('title', 'Set a goal to awaken');
    } else if (!ready && state.mode === 'zero') {
      awakenBtn.setAttribute('title', 'Zero needs a browser-local model');
    } else {
      awakenBtn.removeAttribute('title');
    }
  }

  // Update advanced settings button text
  const advancedBtnInAwaken = container.querySelector('.wizard-awaken [data-action="advanced-settings"]');
  if (advancedBtnInAwaken) {
    advancedBtnInAwaken.textContent = state.advancedOpen ? 'Hide advanced' : 'Advanced settings';
  }

  updateGoalSelectionUI(state);

  // Load module config if needed
  if (state.advancedOpen || ready) {
    ensureModuleConfigLoaded();
  }
  if (!state.bootPayload?.loaded && !state.bootPayload?.loading && !state.bootPayload?.error) {
    ensureBootPayloadLoaded();
  }
  if (state.mode === 'absolute_zero') {
    ensureAbsoluteZeroPreviewLoaded(!!state.includeHostWithinSelf);
  }
}

function updateGoalSelectionUI(state) {
  if (!container) return;
  const goalInput = container.querySelector('#goal-input');
  if (goalInput && document.activeElement !== goalInput && goalInput.value !== (state.goal || '')) {
    goalInput.value = state.goal || '';
  }

  const environmentInput = container.querySelector('#environment-input');
  if (environmentInput && document.activeElement !== environmentInput && environmentInput.value !== (state.environment || '')) {
    environmentInput.value = state.environment || '';
  }

  const includeHostCheckbox = container.querySelector('#include-host-within-self');
  if (includeHostCheckbox) {
    includeHostCheckbox.checked = !!state.includeHostWithinSelf;
  }

  container.querySelectorAll('[data-action="select-goal"]').forEach((el) => {
    const goalValue = el.dataset.goal || '';
    const isSelected = goalValue === (state.goal || '');
    el.classList.toggle('selected', isSelected);
  });

  container.querySelectorAll('[data-action="apply-environment-template"]').forEach((el) => {
    const templateId = el.dataset.template || '';
    const isSelected = templateId === (state.selectedEnvironmentTemplate || '');
    el.classList.toggle('selected', isSelected);
    el.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  container.querySelectorAll('[data-action="toggle-goal-category"]').forEach((el) => {
    const category = el.dataset.category || '';
    const isSelected = category === (state.selectedGoalCategory || '');
    el.classList.toggle('selected', isSelected);
    el.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  container.querySelectorAll('[data-action="select-absolute-zero-path"]').forEach((el) => {
    const path = el.dataset.path || '';
    const isSelected = path === (state.selectedAbsoluteZeroPath || '');
    el.classList.toggle('selected', isSelected);
    el.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
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
        <h1 class="type-display wizard-wordmark">REPLOID</h1>
        <a class="link-secondary type-caption"
           href="https://github.com/clocksmith/reploid"
           target="_blank"
           rel="noopener">See source on GitHub</a>
      </div>
      <div class="wizard-brand-copy">
        <p class="intro-tagline type-caption">
          Reploid is a browser-native self-modifying agent substrate for studying bounded recursive self-improvement (RSI), not a claim that true RSI already exists.
        </p>
        <h2 class="type-h2 intro-explainer-title">What self-modification, RSI, and weak AGI mean</h2>
        <p class="intro-tagline type-caption">
          A self-modifying agent can rewrite parts of its own tools, prompts, or runtime, while a self-improving agent shows measured gains from some of those changes. Truly unbounded RSI would start implying artificial general intelligence (AGI) or artificial superintelligence (ASI), which is why it remains theoretical here.
        </p>
      </div>
    </div>
  `;

  // Section 1: Always show connection type selection
  html += renderChooseStep(state);

  // Section 2: Ordered progressive reveal
  const hasConnectionType = !!state.connectionType;
  const ready = canAwaken();
  const hasGoal = !!(state.goal && state.goal.trim());
  const goalSectionTitle = state.mode === 'absolute_zero' ? 'Compose substrate' : 'Set a goal';

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
      goalSectionTitle,
      hasConnectionType
        ? 'Finish inference configuration to unlock this section.'
        : 'Choose and configure inference before continuing.'
    );
  } else {
    html += renderGoalStep(state);
  }

  if (!ready || !hasGoal) {
    html += renderLockedSection(
      'Awaken',
      !ready
        ? 'Finish inference configuration and set a goal before awakening.'
        : 'Set a goal to unlock this section.'
    );
  } else {
    html += renderAwakenStep(state);
  }

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
  if (!state.bootPayload?.loaded && !state.bootPayload?.loading && !state.bootPayload?.error) {
    ensureBootPayloadLoaded();
  }
  if (state.mode === 'absolute_zero') {
    ensureAbsoluteZeroPreviewLoaded(!!state.includeHostWithinSelf);
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

async function handleClick(e) {
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
        connectionType: null
      });
      break;

    case 'start-scan':
      startDetection();
      break;

    case 'skip-detection':
      // No longer needed - detection runs in background
      break;

    case 'toggle-goal-category': {
      const category = e.target.closest('[data-category]')?.dataset.category;
      if (category) {
        setState({ selectedGoalCategory: category });
      }
      break;
    }

    case 'select-goal': {
      const button = e.target.closest('[data-goal]');
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

    case 'generate-goal':
      await handleGenerateGoal();
      break;

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

    case 'apply-environment-template': {
      const button = e.target.closest('[data-template]');
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
      const button = e.target.closest('[data-path]');
      const path = button?.dataset.path;
      if (!path) break;
      setState({ selectedAbsoluteZeroPath: path });
      break;
    }

    case 'choose-mode': {
      const button = e.target.closest('[data-mode]');
      const nextMode = normalizeBootMode(button?.dataset.mode, '');
      if (!nextMode) break;

      const modeConfig = getBootModeConfig(nextMode);
      const nextState = {
        mode: nextMode,
        advancedConfig: {
          ...state.advancedConfig,
          genesisLevel: modeConfig.genesisLevel
        }
      };

      if (nextMode === 'zero' && state.detection.webgpu?.supported) {
        nextState.connectionType = 'browser';
        nextState.dopplerConfig = {
          ...state.dopplerConfig,
          model: state.dopplerConfig?.model || 'smollm2-360m'
        };
      }

      localStorage.setItem('REPLOID_MODE', nextMode);
      localStorage.setItem('REPLOID_GENESIS_LEVEL', modeConfig.genesisLevel);
      localStorage.setItem('REPLOID_BLUEPRINT_PATH', 'none');
      setState(nextState);
      break;
    }

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

    case 'select-doppler-model': {
      const modelId = e.target.closest('[data-model]')?.dataset.model;
      if (modelId) {
        setNestedState('dopplerConfig', { model: modelId });
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

    case 'advanced-clear-vfs': {
      if (!confirm('Clear cached VFS files and rehydrate from the manifest?')) break;
      try {
        await clearVfsStore();
        const { manifest, text } = await loadVfsManifest();
        await seedVfsFromManifest(manifest, {
          preserveOnBoot: false,
          logger: console,
          manifestText: text
        });
      } catch (err) {
        console.error('[Boot] Failed to clear VFS cache:', err);
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

    case 'direct-key':
      setNestedState('directConfig', {
        apiKey: value,
        verifyState: VERIFY_STATE.UNVERIFIED
      });
      break;


    case 'direct-model':
      setNestedState('directConfig', { model: value });
      break;

    case 'advanced-preserve-vfs':
      localStorage.setItem('REPLOID_PRESERVE_ON_BOOT', value ? 'true' : 'false');
      setNestedState('advancedConfig', { preserveOnBoot: value });
      break;

    case 'include-host-within-self':
      setState({ includeHostWithinSelf: value });
      localStorage.setItem('REPLOID_INCLUDE_HOST_WITHIN_SELF', value ? 'true' : 'false');
      break;

    case 'advanced-security-enabled':
      setSecurityEnabled(value, { persist: true });
      setNestedState('advancedConfig', { securityEnabled: value });
      break;

    case 'advanced-genesis-level':
      localStorage.setItem('REPLOID_GENESIS_LEVEL', value);
      setNestedState('advancedConfig', { genesisLevel: value });
      {
        const currentMode = getState().mode;
        const inferredMode = getBootModeConfig(currentMode).genesisLevel === value
          ? currentMode
          : inferBootModeFromGenesis(value, currentMode);
        localStorage.setItem('REPLOID_MODE', inferredMode);
        setState({ mode: inferredMode });
      }
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

async function shouldResetAbsoluteZeroVfs(state) {
  if (!state.advancedConfig?.preserveOnBoot) {
    return true;
  }

  try {
    const [selfText, goalText, environmentText, promptText] = await Promise.all([
      readVfsFile('/.system/self.json'),
      readVfsFile('/.system/goal.txt'),
      readVfsFile('/.system/environment.txt'),
      readVfsFile('/.system/prompt.txt')
    ]);

    if (!selfText || goalText === null || environmentText === null) {
      return true;
    }
    if (promptText !== null) {
      return true;
    }

    const manifest = JSON.parse(selfText);
    if (manifest?.mode !== 'absolute_zero') {
      return true;
    }
    if (manifest.goalPath !== '/.system/goal.txt') {
      return true;
    }
    if (manifest.environmentPath !== '/.system/environment.txt') {
      return true;
    }
    if (!!manifest.hostIncluded !== !!state.includeHostWithinSelf) {
      return true;
    }

    const writableRoots = Array.isArray(manifest.writableRoots) ? manifest.writableRoots : [];
    const requiredRoots = ['/kernel', '/tools', '/.memory', '/artifacts', 'opfs:/artifacts'];
    if (requiredRoots.some((root) => !writableRoots.includes(root))) {
      return true;
    }

    if (state.includeHostWithinSelf && !writableRoots.includes('/host')) {
      return true;
    }
    if (!state.includeHostWithinSelf && writableRoots.includes('/host')) {
      return true;
    }

    return false;
  } catch (err) {
    console.warn('[Boot] Absolute Zero VFS inspection failed:', err);
    return true;
  }
}

async function doAwaken() {
  const state = getState();
  const goalPacket = formatGoalPacket(state.goal);
  if (!goalPacket) return;

  // Set loading state immediately
  setState({ isAwakening: true });

  try {
    let shouldClearVfs = !state.advancedConfig?.preserveOnBoot;
    if (state.mode === 'absolute_zero') {
      shouldClearVfs = await shouldResetAbsoluteZeroVfs(state);
    }

    if (shouldClearVfs) {
      console.log('[Boot] Clearing VFS before awaken...');
      await clearVfsStore();
      if (state.mode !== 'absolute_zero') {
        console.log('[Boot] Ensuring VFS hydration before awaken...');
        const { manifest, text } = await loadVfsManifest();
        const files = manifest?.files || [];
        await seedVfsFromManifest({ files }, {
          preserveOnBoot: false,
          logger: console,
          manifestText: text
        });
      }
    }
  } catch (err) {
    console.error('[Boot] VFS prep failed:', err);
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
  // Note: isAwakening stays true since the page will transition to agent UI
}

async function handleAwaken() {
  await doAwaken();
}

export { STEPS, getState, goToStep };
