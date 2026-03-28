/**
 * @fileoverview Boot Wizard State Machine
 * Manages step flow, config persistence, and validation state.
 */

import { normalizeOverrides } from '../../config/module-resolution.js';
import {
  DEFAULT_BOOT_MODE,
  getDefaultGenesisLevelForMode,
  normalizeBootMode
} from '../../config/boot-modes.js';
import {
  DEFAULT_REPLOID_ENVIRONMENT_TEMPLATE_ID,
  findReploidEnvironmentTemplateId,
  getDefaultReploidEnvironment
} from '../../config/reploid-environments.js';
import { getSecurityState } from '../../core/security-config.js';
import { getCurrentReploidStorage as getReploidStorage } from '../../self/instance.js';
import { getReploidLaunchState } from './reploid-inference.js';

// Wizard steps in order
export const STEPS = {
  START: 'start',           // Check saved config
  DETECT: 'detect',         // Probe connections
  CHOOSE: 'choose',         // Choose connection type
  DIRECT_CONFIG: 'direct_config',   // Direct cloud API (keys in browser)
  PROXY_CONFIG: 'proxy_config',     // Proxy server (keys on server or local)
  DOPPLER_CONFIG: 'doppler_config', // Browser WebGPU model
  GOAL: 'goal',             // Goal selection
  AWAKEN: 'awaken'          // Final initialization
};

// Connection verification states
export const VERIFY_STATE = {
  UNVERIFIED: 'unverified',
  TESTING: 'testing',
  VERIFIED: 'verified',
  FAILED: 'failed'
};

// Provider test endpoints
export const PROVIDER_TEST_ENDPOINTS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    note: 'Sends minimal request (~10 tokens)',
    body: {
      model: 'claude-3-haiku-20240307',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }]
    }
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    method: 'GET',
    note: 'Free endpoint, returns model list'
  },
  gemini: {
    // Key goes in query param
    url: 'https://generativelanguage.googleapis.com/v1/models',
    method: 'GET',
    keyInQuery: true,
    note: 'Free endpoint, returns model list'
  }
};

const getStoredMode = () => {
  if (typeof window !== 'undefined' && typeof window.getReploidRouteMode === 'function') {
    const routeMode = normalizeBootMode(window.getReploidRouteMode(), '');
    if (routeMode) return routeMode;
  }
  return DEFAULT_BOOT_MODE;
};

const getRouteLockedMode = () => {
  if (typeof window === 'undefined' || typeof window.getReploidRouteMode !== 'function') {
    return null;
  }
  return normalizeBootMode(window.getReploidRouteMode(), '');
};

const getStoredAdvancedConfig = () => {
  const storedMode = getStoredMode();
  const defaultGenesisLevel = getDefaultGenesisLevelForMode(storedMode);
  const securityState = getSecurityState();
  const storage = getReploidStorage();
  if (!storage.raw) {
    return {
      preserveOnBoot: false,
      genesisLevel: defaultGenesisLevel,
      moduleOverrides: {},
      hitlApprovalMode: 'autonomous',
      hitlEveryNSteps: 5,
      securityEnabled: securityState.enabled
    };
  }

  let moduleOverrides = {};
  try {
    const raw = storage.getItem('REPLOID_MODULE_OVERRIDES');
    if (raw) {
      moduleOverrides = normalizeOverrides(JSON.parse(raw));
    }
  } catch (e) {
    moduleOverrides = {};
  }

  let hitlApprovalMode = 'autonomous';
  let hitlEveryNSteps = 5;
  try {
    const raw = storage.getItem('REPLOID_HITL_CONFIG');
    if (raw) {
      const parsed = JSON.parse(raw);
      const mode = parsed?.approvalMode;
      if (mode === 'autonomous' || mode === 'hitl' || mode === 'every_n') {
        hitlApprovalMode = mode;
      }
      const steps = parseInt(parsed?.everyNSteps, 10);
      if (!Number.isNaN(steps) && steps >= 1 && steps <= 100) {
        hitlEveryNSteps = steps;
      }
    }
  } catch (e) {
    hitlApprovalMode = 'autonomous';
    hitlEveryNSteps = 5;
  }

  return {
    preserveOnBoot: storage.getItem('REPLOID_PRESERVE_ON_BOOT') === 'true',
    genesisLevel: defaultGenesisLevel,
    moduleOverrides,
    hitlApprovalMode,
    hitlEveryNSteps,
    securityEnabled: securityState.enabled
  };
};

const getStoredGoal = () => {
  const storage = getReploidStorage();
  if (!storage.raw) {
    return '';
  }

  const stored = storage.getItem('REPLOID_GOAL');
  return stored ? String(stored) : '';
};

const getStoredEnvironment = () => {
  const storage = getReploidStorage();
  if (!storage.raw) {
    return getDefaultReploidEnvironment();
  }

  const stored = storage.getItem('REPLOID_ENVIRONMENT');
  return stored ? String(stored) : getDefaultReploidEnvironment();
};

const getStoredEnvironmentTemplateId = () => {
  const fallback = DEFAULT_REPLOID_ENVIRONMENT_TEMPLATE_ID;
  const storage = getReploidStorage();
  if (!storage.raw) {
    return fallback;
  }

  const storedText = getStoredEnvironment();
  const storedTemplate = storage.getItem('REPLOID_ENVIRONMENT_TEMPLATE');
  if (!storedTemplate) {
    return findReploidEnvironmentTemplateId(storedText) || fallback;
  }
  return findReploidEnvironmentTemplateId(storedText) === storedTemplate
    ? storedTemplate
    : (findReploidEnvironmentTemplateId(storedText) || null);
};

const getStoredSwarmEnabled = () => {
  const storage = getReploidStorage();
  if (!storage.raw) {
    return false;
  }
  return storage.getItem('REPLOID_SWARM_ENABLED') === 'true';
};

// Default wizard state
const defaultState = {
  currentStep: STEPS.START,
  mode: getStoredMode(),
  routeLockedMode: getRouteLockedMode(),

  // Detection results
  detection: {
    scanning: false,
    webgpu: { supported: false, checked: false },
    proxy: { detected: false, url: null, checked: false, blocked: false },
    ollama: { detected: false, models: [], checked: false },
    doppler: { supported: false, models: [], capabilities: null, checked: false },
    isHttps: false,
    scanSkipped: false
  },

  // Selected connection type
  connectionType: null, // 'browser' | 'direct' | 'proxy'

  // Direct API configuration (keys in browser)
  directConfig: {
    provider: null,     // 'anthropic' | 'openai' | 'gemini' | 'other'
    apiKey: null,
    baseUrl: null,      // For 'other' provider
    rememberKey: false,
    model: null,
    verifyState: VERIFY_STATE.UNVERIFIED,
    verifyError: null,
    modelVerifyState: VERIFY_STATE.UNVERIFIED,
    modelVerifyError: null
  },

  accessConfig: {
    accessCode: '',
    error: null
  },

  // Proxy server configuration (keys on server or local models)
  proxyConfig: {
    url: null,
    serverType: null,   // 'reploid' | 'ollama' | 'openai-compatible' (auto-detected)
    provider: null,     // For reploid proxy: which provider to use
    model: null,
    availableProviders: [], // From proxy /api/health
    availableModels: [],    // From Ollama /api/tags or proxy
    verifyState: VERIFY_STATE.UNVERIFIED,
    verifyError: null,
    modelVerifyState: VERIFY_STATE.UNVERIFIED,
    modelVerifyError: null
  },

  dopplerConfig: {
    model: null,
    downloadProgress: null,
    verifyState: VERIFY_STATE.UNVERIFIED
  },

  // Goal selection
  goal: getStoredGoal(),
  environment: getStoredEnvironment(),
  selectedEnvironmentTemplate: getStoredEnvironmentTemplateId(),
  swarmEnabled: getStoredSwarmEnabled(),
  selectedGoalCategory: null,
  goalShuffleSeed: 0,
  goalGenerator: {
    status: 'idle', // idle | generating | error | ready
    error: null
  },

  // Advanced options
  advancedOpen: false,
  advancedConfig: getStoredAdvancedConfig(),
  moduleConfig: {
    loading: false,
    error: null,
    genesis: null,
    registry: null
  },
  bootPayload: {
    loading: false,
    loaded: false,
    error: null,
    bootFiles: [],
    bootTree: '',
    manifestFiles: [],
    rootSummary: []
  },
  selfPreview: {
    loadingSelf: false,
    loadedSelf: false,
    loadingBootstrapper: false,
    loadedBootstrapper: false,
    error: null,
    contents: {}
  },
  seedOverrides: {},
  seedDrafts: {},
  editingSeedPath: null,
  selectedSelfPath: '/self/self.json',
  moduleOverrideSearch: '',
  moduleOverrideFilter: 'all',

  // Genesis level (auto or manual)
  genesisLevel: getDefaultGenesisLevelForMode(getStoredMode())
};

// Current state (module-level singleton)
let state = { ...defaultState };
let listeners = [];

/**
 * Get current wizard state
 */
export function getState() {
  return state;
}

/**
 * Update wizard state (partial update)
 */
export function setState(updates) {
  state = { ...state, ...updates };
  notifyListeners();
}

/**
 * Update nested state
 */
export function setNestedState(key, updates) {
  state = {
    ...state,
    [key]: { ...state[key], ...updates }
  };
  notifyListeners();
}

/**
 * Subscribe to state changes
 */
export function subscribe(listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

function notifyListeners() {
  listeners.forEach(l => l(state));
}

/**
 * Reset wizard to initial state
 */
export function resetWizard() {
  const storedMode = getStoredMode();
  state = {
    ...defaultState,
    mode: storedMode,
    routeLockedMode: getRouteLockedMode(),
    genesisLevel: getDefaultGenesisLevelForMode(storedMode),
    advancedOpen: false,
    advancedConfig: getStoredAdvancedConfig(),
    goal: getStoredGoal(),
    environment: getStoredEnvironment(),
    selectedEnvironmentTemplate: getStoredEnvironmentTemplateId(),
    swarmEnabled: getStoredSwarmEnabled(),
    selectedGoalCategory: null,
    goalShuffleSeed: 0,
    goalGenerator: {
      status: 'idle',
      error: null
    },
    accessConfig: {
      accessCode: '',
      error: null
    },
    moduleOverrideSearch: '',
    moduleOverrideFilter: 'all',
    moduleConfig: {
      loading: false,
      error: null,
      genesis: null,
      registry: null
    },
    bootPayload: {
      loading: false,
      loaded: false,
      error: null,
      bootFiles: [],
      bootTree: '',
      manifestFiles: [],
      rootSummary: []
    },
    selfPreview: {
      loadingSelf: false,
      loadedSelf: false,
      loadingBootstrapper: false,
      loadedBootstrapper: false,
      error: null,
      contents: {}
    },
    seedOverrides: {},
    seedDrafts: {},
    editingSeedPath: null,
    selectedSelfPath: '/self/self.json'
  };
  notifyListeners();
}

/**
 * Navigate to a step
 */
export function goToStep(step) {
  setState({ currentStep: step });
}

/**
 * Check if we have a saved config that can be resumed
 */
export function checkSavedConfig() {
  const storage = getReploidStorage();
  try {
    const savedModels = storage.getItem('SELECTED_MODELS');

    if (!savedModels) return null;

    const models = JSON.parse(savedModels);
    if (!models || models.length === 0) return null;

    const primary = models[0];
    const savedKey = storage.getItem(`REPLOID_KEY_${primary.provider?.toUpperCase()}`);
    const hasKey = primary.apiKey || savedKey;

    return {
      models,
      primaryProvider: primary.provider,
      primaryModel: primary.name || primary.id,
      primaryHostType: primary.hostType,
      hasSavedKey: !!hasKey,
      savedKey: savedKey,
      proxyUrl: primary.proxyUrl,
      localUrl: primary.localUrl
    };
  } catch (e) {
    console.warn('[Wizard] Failed to load saved config:', e);
    return null;
  }
}

/**
 * Hydrate state from saved config for resume
 */
export function hydrateSavedConfig(saved, apiKey = null) {
  if (!saved || !saved.models || saved.models.length === 0) return;

  const primary = saved.models[0];
  const hostType = primary.hostType || '';

  // Determine connection type from hostType
  let connectionType = 'direct';
  if (hostType === 'browser-local' || primary.provider === 'doppler') {
    connectionType = 'browser';
  } else if (hostType === 'proxy-cloud' || primary.provider === 'proxy' ||
             hostType === 'proxy-local' || primary.provider === 'ollama') {
    connectionType = 'proxy';
  }

  // Hydrate the appropriate config
  const updates = { connectionType };

  if (connectionType === 'direct') {
    updates.directConfig = {
      provider: primary.provider,
      model: primary.id || primary.name,
      apiKey: apiKey || saved.savedKey || null,
      rememberKey: !!saved.savedKey,
      verifyState: saved.savedKey ? VERIFY_STATE.UNVERIFIED : VERIFY_STATE.UNVERIFIED,
      verifyError: null
    };
  } else if (connectionType === 'proxy') {
    const isOllama = hostType === 'proxy-local' || primary.provider === 'ollama';
    updates.proxyConfig = {
      url: primary.proxyUrl || primary.localUrl || saved.proxyUrl || saved.localUrl || 'http://localhost:8000',
      serverType: isOllama ? 'ollama' : 'reploid',
      provider: primary.provider,
      model: primary.id || primary.name,
      verifyState: VERIFY_STATE.UNVERIFIED,
      verifyError: null
    };
  } else if (connectionType === 'browser') {
    updates.dopplerConfig = {
      model: primary.id || primary.name,
      downloadProgress: null,
      verifyState: VERIFY_STATE.VERIFIED // Local is always verified
    };
  }

  setState(updates);
}

/**
 * Save current config to localStorage
 */
export function saveConfig() {
  const { directConfig, proxyConfig, dopplerConfig, connectionType, mode, advancedConfig } = state;
  const storage = getReploidStorage();

  const models = [];

  storage.setItem('REPLOID_MODE', normalizeBootMode(mode));
  storage.setItem(
    'REPLOID_GENESIS_LEVEL',
    advancedConfig?.genesisLevel || getDefaultGenesisLevelForMode(mode)
  );

  // Build model list based on connection type
  if (connectionType === 'direct' && directConfig.model) {
    const model = {
      id: directConfig.model,
      name: directConfig.model,
      provider: directConfig.provider,
      hostType: 'browser-cloud',
      apiKey: directConfig.apiKey // Include API key in model config
    };

    // Always store API key in localStorage (needed for agent to work)
    if (directConfig.apiKey) {
      storage.setItem(`REPLOID_KEY_${directConfig.provider.toUpperCase()}`, directConfig.apiKey);
    }

    models.push(model);
  }

  if (connectionType === 'proxy' && proxyConfig.model) {
    const isOllama = proxyConfig.serverType === 'ollama';
    models.push({
      id: proxyConfig.model,
      name: proxyConfig.model,
      provider: isOllama ? 'ollama' : (proxyConfig.provider || 'proxy'),
      hostType: isOllama ? 'proxy-local' : 'proxy-cloud',
      proxyUrl: proxyConfig.url
    });
  }

  if (connectionType === 'browser' && dopplerConfig.model) {
    models.push({
      id: dopplerConfig.model,
      name: dopplerConfig.model,
      provider: 'doppler',
      queryMethod: 'browser',
      hostType: 'browser-local'
    });
  }

  if (models.length > 0) {
    storage.setItem('SELECTED_MODELS', JSON.stringify(models));
  }

  const goal = (state.goal || '').trim();
  if (goal) {
    storage.setItem('REPLOID_GOAL', goal);
  } else {
    storage.removeItem('REPLOID_GOAL', { removeLegacy: true });
  }
  const environment = String(state.environment || '').trim();
  if (environment) {
    storage.setItem('REPLOID_ENVIRONMENT', environment);
  } else {
    storage.removeItem('REPLOID_ENVIRONMENT', { removeLegacy: true });
  }
  if (state.selectedEnvironmentTemplate) {
    storage.setItem('REPLOID_ENVIRONMENT_TEMPLATE', state.selectedEnvironmentTemplate);
  } else {
    storage.removeItem('REPLOID_ENVIRONMENT_TEMPLATE', { removeLegacy: true });
  }
  storage.setItem(
    'REPLOID_SWARM_ENABLED',
    state.swarmEnabled ? 'true' : 'false'
  );
  storage.removeItem('REPLOID_GOAL_CRITERIA', { removeLegacy: true });
}

/**
 * Clear all saved config and keys
 */
export function forgetDevice() {
  const storage = getReploidStorage();
  const keysToRemove = [
    'SELECTED_MODELS',
    'REPLOID_KEY_ANTHROPIC',
    'REPLOID_KEY_OPENAI',
    'REPLOID_KEY_GEMINI',
    'CONSENSUS_TYPE',
    'REPLOID_MODE',
    'REPLOID_GENESIS_LEVEL',
    'REPLOID_PERSONA_ID',
    'REPLOID_BLUEPRINT_PATH',
    'REPLOID_PRESERVE_ON_BOOT',
    'REPLOID_HITL_CONFIG',
    'REPLOID_SECURITY_MODE',
    'REPLOID_GOAL',
    'REPLOID_ENVIRONMENT',
    'REPLOID_ENVIRONMENT_TEMPLATE',
    'REPLOID_SWARM_ENABLED',
    'REPLOID_GOAL_CRITERIA'
  ];

  keysToRemove.forEach((key) => storage.removeItem(key, { removeLegacy: true }));
  resetWizard();
}

/**
 * Get the primary connection's verify state
 */
export function getPrimaryVerifyState() {
  const { connectionType, directConfig, proxyConfig, dopplerConfig } = state;

  switch (connectionType) {
    case 'direct': return directConfig.verifyState;
    case 'proxy': return proxyConfig.verifyState;
    case 'browser': return dopplerConfig.verifyState;
    default: return VERIFY_STATE.UNVERIFIED;
  }
}

/**
 * Check if current config is ready to awaken
 */
export function canAwaken() {
  const { mode, routeLockedMode, connectionType, directConfig, proxyConfig, dopplerConfig } = state;

  if (mode === 'reploid' && routeLockedMode === 'reploid') {
    return getReploidLaunchState(state).canAwaken;
  }

  if (mode === 'zero') {
    return connectionType === 'browser' && !!dopplerConfig.model;
  }

  switch (connectionType) {
    case 'direct':
      return !!(
        directConfig.provider &&
        directConfig.model &&
        directConfig.apiKey &&
        (directConfig.provider !== 'other' || directConfig.baseUrl)
      );
    case 'proxy':
      return proxyConfig.url && proxyConfig.model;
    case 'browser':
      return dopplerConfig.model;
    default:
      return false;
  }
}

/**
 * Get capability level based on current config
 */
export function getCapabilityLevel() {
  const { connectionType, directConfig, proxyConfig, dopplerConfig } = state;

  // Determine reasoning capability
  let reasoning = 'low';
  if (connectionType === 'direct') {
    const provider = directConfig.provider;
    if (['anthropic', 'openai', 'gemini'].includes(provider)) {
      reasoning = 'high';
    }
  } else if (connectionType === 'proxy') {
    // Proxy can be high if using cloud APIs, medium for local models
    const provider = proxyConfig.provider;
    if (['gemini', 'openai', 'anthropic'].includes(provider)) {
      reasoning = 'high';
    } else {
      reasoning = 'medium';
    }
  }

  const hasDopplerModel = !!dopplerConfig?.model;
  const hasModelAccess = connectionType === 'browser';
  const hasDopplerAccess = hasDopplerModel && connectionType === 'browser';

  return {
    reasoning,
    model: hasModelAccess,
    doppler: hasDopplerAccess,
    // Capability hints for UI gating
    canDoModelRSI: hasModelAccess,
    canDoDopplerEvolution: hasDopplerAccess,
    canDoBehavioralRSI: reasoning === 'high' || reasoning === 'medium',
    canDoComplexReasoning: reasoning === 'high'
  };
}
