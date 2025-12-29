/**
 * @fileoverview Boot Wizard State Machine
 * Manages step flow, config persistence, and validation state.
 */

// Wizard steps in order
export const STEPS = {
  START: 'start',           // Check saved config
  DETECT: 'detect',         // Probe connections
  CHOOSE: 'choose',         // Choose connection type
  API_CONFIG: 'api_config', // API key entry
  PROXY_CONFIG: 'proxy_config',
  LOCAL_CONFIG: 'local_config',
  DOPPLER_CONFIG: 'doppler_config',
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

// Default wizard state
const defaultState = {
  currentStep: STEPS.START,

  // Detection results
  detection: {
    webgpu: { supported: false, checked: false },
    proxy: { detected: false, url: null, checked: false, blocked: false },
    ollama: { detected: false, models: [], checked: false },
    doppler: { supported: false, models: [], capabilities: null, checked: false },
    isHttps: false,
    scanSkipped: false
  },

  // Selected connection type
  connectionType: null, // 'browser' | 'api' | 'proxy' | 'local'

  // Provider configurations
  apiConfig: {
    provider: null,     // 'anthropic' | 'openai' | 'gemini' | 'other'
    apiKey: null,
    baseUrl: null,      // For 'other' provider
    rememberKey: false,
    model: null,
    verifyState: VERIFY_STATE.UNVERIFIED,
    verifyError: null
  },

  proxyConfig: {
    url: null,
    model: null,
    verifyState: VERIFY_STATE.UNVERIFIED,
    verifyError: null
  },

  localConfig: {
    url: null,
    model: null,
    verifyState: VERIFY_STATE.UNVERIFIED,
    verifyError: null
  },

  dopplerConfig: {
    model: null,
    downloadProgress: null,
    verifyState: VERIFY_STATE.UNVERIFIED
  },

  // Whether to also use Doppler for substrate access
  enableDopplerSubstrate: false,

  // Selected goal
  goal: null,

  // Genesis level (auto or manual)
  genesisLevel: 'auto'
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
  state = { ...defaultState };
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
  try {
    const savedModels = localStorage.getItem('SELECTED_MODELS');
    const savedGoal = localStorage.getItem('REPLOID_GOAL');

    if (!savedModels) return null;

    const models = JSON.parse(savedModels);
    if (!models || models.length === 0) return null;

    const primary = models[0];
    const savedKey = localStorage.getItem(`REPLOID_KEY_${primary.provider?.toUpperCase()}`);
    const hasKey = primary.apiKey || savedKey;

    return {
      models,
      primaryProvider: primary.provider,
      primaryModel: primary.name || primary.id,
      primaryHostType: primary.hostType,
      hasSavedKey: !!hasKey,
      savedKey: savedKey,
      savedGoal,
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
  let connectionType = 'api';
  if (hostType === 'browser-local' || primary.provider === 'doppler') {
    connectionType = 'browser';
  } else if (hostType === 'proxy-cloud' || primary.provider === 'proxy') {
    connectionType = 'proxy';
  } else if (hostType === 'proxy-local' || primary.provider === 'ollama') {
    connectionType = 'local';
  }

  // Hydrate the appropriate config
  const updates = { connectionType };

  if (connectionType === 'api') {
    updates.apiConfig = {
      provider: primary.provider,
      model: primary.id || primary.name,
      apiKey: apiKey || saved.savedKey || null,
      rememberKey: !!saved.savedKey,
      verifyState: saved.savedKey ? VERIFY_STATE.UNVERIFIED : VERIFY_STATE.UNVERIFIED,
      verifyError: null
    };
  } else if (connectionType === 'proxy') {
    updates.proxyConfig = {
      url: primary.proxyUrl || saved.proxyUrl,
      model: primary.id || primary.name,
      verifyState: VERIFY_STATE.UNVERIFIED,
      verifyError: null
    };
  } else if (connectionType === 'local') {
    updates.localConfig = {
      url: primary.localUrl || saved.localUrl || 'http://localhost:11434',
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

  if (saved.savedGoal) {
    updates.goal = saved.savedGoal;
  }

  setState(updates);
}

/**
 * Save current config to localStorage
 */
export function saveConfig() {
  const { apiConfig, proxyConfig, localConfig, dopplerConfig, connectionType, goal } = state;

  const models = [];

  // Build model list based on connection type
  if (connectionType === 'api' && apiConfig.model) {
    const model = {
      id: apiConfig.model,
      name: apiConfig.model,
      provider: apiConfig.provider,
      hostType: 'browser-cloud'
    };

    // Only store key if user opted in
    if (apiConfig.rememberKey && apiConfig.apiKey) {
      localStorage.setItem(`REPLOID_KEY_${apiConfig.provider.toUpperCase()}`, apiConfig.apiKey);
    }

    models.push(model);
  }

  if (connectionType === 'proxy' && proxyConfig.model) {
    models.push({
      id: proxyConfig.model,
      name: proxyConfig.model,
      provider: 'proxy',
      hostType: 'proxy-cloud',
      proxyUrl: proxyConfig.url
    });
  }

  if (connectionType === 'local' && localConfig.model) {
    models.push({
      id: localConfig.model,
      name: localConfig.model,
      provider: 'ollama',
      hostType: 'proxy-local',
      localUrl: localConfig.url
    });
  }

  if ((connectionType === 'browser' || state.enableDopplerSubstrate) && dopplerConfig.model) {
    models.push({
      id: dopplerConfig.model,
      name: dopplerConfig.model,
      provider: 'doppler',
      hostType: 'browser-local'
    });
  }

  if (models.length > 0) {
    localStorage.setItem('SELECTED_MODELS', JSON.stringify(models));
  }

  if (goal) {
    localStorage.setItem('REPLOID_GOAL', goal);
  }
}

/**
 * Clear all saved config and keys
 */
export function forgetDevice() {
  const keysToRemove = [
    'SELECTED_MODELS',
    'REPLOID_GOAL',
    'REPLOID_KEY_ANTHROPIC',
    'REPLOID_KEY_OPENAI',
    'REPLOID_KEY_GEMINI',
    'CONSENSUS_TYPE',
    'REPLOID_GENESIS_LEVEL',
    'REPLOID_PERSONA_ID',
    'REPLOID_BLUEPRINT_PATH'
  ];

  keysToRemove.forEach(key => localStorage.removeItem(key));
  resetWizard();
}

/**
 * Get the primary connection's verify state
 */
export function getPrimaryVerifyState() {
  const { connectionType, apiConfig, proxyConfig, localConfig, dopplerConfig } = state;

  switch (connectionType) {
    case 'api': return apiConfig.verifyState;
    case 'proxy': return proxyConfig.verifyState;
    case 'local': return localConfig.verifyState;
    case 'browser': return dopplerConfig.verifyState;
    default: return VERIFY_STATE.UNVERIFIED;
  }
}

/**
 * Check if current config is ready to awaken
 */
export function canAwaken() {
  const { connectionType, apiConfig, proxyConfig, localConfig, dopplerConfig } = state;

  switch (connectionType) {
    case 'api':
      return apiConfig.provider && apiConfig.model;
    case 'proxy':
      return proxyConfig.url && proxyConfig.model;
    case 'local':
      return localConfig.url && localConfig.model;
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
  const { connectionType, apiConfig, enableDopplerSubstrate, detection } = state;

  // Determine reasoning capability
  let reasoning = 'low';
  if (connectionType === 'api') {
    const provider = apiConfig.provider;
    if (['anthropic', 'openai', 'gemini'].includes(provider)) {
      reasoning = 'high';
    }
  } else if (connectionType === 'local' || connectionType === 'proxy') {
    reasoning = 'medium';
  }

  // Determine substrate access
  const hasSubstrateAccess = connectionType === 'browser' || enableDopplerSubstrate;

  return {
    reasoning,
    substrate: hasSubstrateAccess,
    // For goal filtering
    canDoSubstrateRSI: hasSubstrateAccess,
    canDoBehavioralRSI: reasoning === 'high' || reasoning === 'medium',
    canDoComplexReasoning: reasoning === 'high'
  };
}
