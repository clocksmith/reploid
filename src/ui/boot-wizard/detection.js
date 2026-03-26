/**
 * @fileoverview Connection Detection
 * Probes for available connections with proper error handling.
 */

import { getState, setNestedState } from './state.js';

const PROBE_TIMEOUT = 3000;
const GOAL_GENERATOR_SYSTEM_PROMPT = 'You are writing the initial goal for a browser-based autonomous coding agent pursuing recursive self-improvement. Output exactly one concrete, ambitious sentence of 16 to 24 words. No quotes, labels, numbering, or explanation.';
const GOAL_GENERATOR_USER_PROMPT = 'Generate one recursive self-improvement goal now.';
let goalGeneratorRuntimePromise = null;
let goalGeneratorEngine = null;
let goalGeneratorModelId = null;

const normalizeApiKey = (apiKey) => String(apiKey || '').trim();

const isLikelyInvalidApiKey = (apiKey) => {
  const value = normalizeApiKey(apiKey);
  if (!value) return true;
  if (value.length < 10 || value.length > 200) return true;
  if (/\s/.test(value)) return true;
  if (value.includes('[INFO]') || value.includes('[Boot]')) return true;
  if (value.includes('bench/workloads') || value.includes('.json')) return true;
  return false;
};

const countWords = (text) => String(text || '')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .length;

const normalizeGeneratedGoal = (text) => {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let value = lines[0] || '';
  value = value.replace(/^goal:\s*/i, '');
  value = value.replace(/^[0-9]+[.)]\s*/, '');
  value = value.replace(/^["'`]+|["'`]+$/g, '');
  value = value.replace(/\s+/g, ' ').trim();

  if (!value) return '';

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 24) {
    value = words.slice(0, 24).join(' ');
  }

  return value;
};

const getGoalGeneratorUserPrompt = (prompt = GOAL_GENERATOR_USER_PROMPT) => String(prompt || GOAL_GENERATOR_USER_PROMPT).trim();

const buildGoalGeneratorMessages = (prompt = GOAL_GENERATOR_USER_PROMPT) => ([
  { role: 'system', content: GOAL_GENERATOR_SYSTEM_PROMPT },
  { role: 'user', content: getGoalGeneratorUserPrompt(prompt) }
]);

const buildGeminiGoalBody = (prompt = GOAL_GENERATOR_USER_PROMPT, { includeGenerationConfig = true } = {}) => {
  const body = {
    systemInstruction: {
      parts: [{ text: GOAL_GENERATOR_SYSTEM_PROMPT }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: getGoalGeneratorUserPrompt(prompt) }]
    }]
  };

  if (includeGenerationConfig) {
    body.generationConfig = {
      maxOutputTokens: 48,
      temperature: 0.8
    };
  }

  return body;
};

const readResponsePayload = async (response) => {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return `HTTP ${response.status}`;
  }

  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(text);
    return data?.error?.message || data?.message || `HTTP ${response.status}`;
  } catch {
    return text.trim() || `HTTP ${response.status}`;
  }
};

const getDopplerProviderUrl = () => {
  const base = window.DOPPLER_BASE_URL || '/doppler';
  return `${base.replace(/\/$/, '')}/src/client/doppler-provider.js`;
};

const ensureGoalGeneratorRuntime = async () => {
  if (typeof window === 'undefined') {
    throw new Error('Browser runtime required for local goal generation');
  }

  if (window.webllm) return window.webllm;
  if (goalGeneratorRuntimePromise) return goalGeneratorRuntimePromise;

  goalGeneratorRuntimePromise = import('https://esm.run/@mlc-ai/web-llm')
    .then((mod) => {
      window.webllm = window.webllm || mod;
      return window.webllm;
    })
    .catch((err) => {
      goalGeneratorRuntimePromise = null;
      throw err;
    });

  return goalGeneratorRuntimePromise;
};

const generateViaBrowser = async (model, prompt = GOAL_GENERATOR_USER_PROMPT) => {
  if (!model) {
    throw new Error('Select a browser-local model first');
  }

  await ensureGoalGeneratorRuntime();

  if (!goalGeneratorEngine || goalGeneratorModelId !== model) {
    goalGeneratorEngine = await window.webllm.CreateMLCEngine(model, {
      context_window_size: 32768
    });
    goalGeneratorModelId = model;
  }

  const reply = await goalGeneratorEngine.chat.completions.create({
    messages: buildGoalGeneratorMessages(prompt),
    stream: false,
    temperature: 0.8
  });

  return reply?.choices?.[0]?.message?.content || '';
};

const generateViaProxy = async ({ url, provider, model, prompt = GOAL_GENERATOR_USER_PROMPT }) => {
  if (!url || !model) {
    throw new Error('Select a proxy URL and model first');
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      model,
      messages: buildGoalGeneratorMessages(prompt),
      stream: false,
      max_tokens: 48
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(await readResponsePayload(response));
  }

  const data = await response.json().catch(() => ({}));
  return data.content || data.choices?.[0]?.message?.content || data.response || '';
};

const generateViaDirect = async ({ provider, apiKey, model, baseUrl = null, prompt = GOAL_GENERATOR_USER_PROMPT }) => {
  const key = normalizeApiKey(apiKey);
  if (!provider || !model) {
    throw new Error('Select a provider and model first');
  }
  if (isLikelyInvalidApiKey(key)) {
    throw new Error('Enter a valid API key first');
  }

  const messages = buildGoalGeneratorMessages(prompt);
  const userPrompt = getGoalGeneratorUserPrompt(prompt);
  const configs = {
    anthropic: {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: {
        model,
        max_tokens: 48,
        system: GOAL_GENERATOR_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      },
      parse: (data) => data.content?.[0]?.text || ''
    },
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: {
        model,
        max_tokens: 48,
        messages
      },
      parse: (data) => data.choices?.[0]?.message?.content || ''
    },
    gemini: {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      headers: { 'Content-Type': 'application/json' },
      body: buildGeminiGoalBody(prompt),
      retryBody: buildGeminiGoalBody(prompt, { includeGenerationConfig: false }),
      parse: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    },
    other: baseUrl ? {
      url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: {
        model,
        max_tokens: 48,
        messages
      },
      parse: (data) => data.choices?.[0]?.message?.content || ''
    } : null
  };

  const config = configs[provider];
  if (!config) {
    throw new Error(provider === 'other' ? 'Base URL required' : 'Unknown provider');
  }

  const executeRequest = async (body) => {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const error = new Error(await readResponsePayload(response));
      error.status = response.status;
      throw error;
    }

    const data = await response.json().catch(() => ({}));
    return config.parse(data);
  };

  try {
    return await executeRequest(config.body);
  } catch (error) {
    if (provider === 'gemini' && config.retryBody && error?.status === 400) {
      return executeRequest(config.retryBody);
    }
    throw error;
  }
};

const generateCandidateGoal = async (state, rewritePrompt = null) => {
  const prompt = rewritePrompt || GOAL_GENERATOR_USER_PROMPT;

  if (state.connectionType === 'browser') {
    return generateViaBrowser(state.dopplerConfig?.model, prompt);
  }

  if (state.connectionType === 'proxy') {
    if (!state.proxyConfig?.provider && state.proxyConfig?.serverType !== 'ollama') {
      throw new Error('Select a proxy provider first');
    }
    return generateViaProxy({
      url: state.proxyConfig?.url,
      provider: state.proxyConfig?.serverType === 'ollama' ? 'ollama' : state.proxyConfig?.provider,
      model: state.proxyConfig?.model,
      prompt
    });
  }

  if (state.connectionType === 'direct') {
    return generateViaDirect({
      provider: state.directConfig?.provider,
      apiKey: state.directConfig?.apiKey,
      model: state.directConfig?.model,
      baseUrl: state.directConfig?.baseUrl,
      prompt
    });
  }

  throw new Error('Choose an inference provider first');
};

async function generateAndNormalizeGoal(state) {
  let raw = await generateCandidateGoal(state);
  let goal = normalizeGeneratedGoal(raw);

  if (countWords(goal) >= 16 && countWords(goal) <= 24) {
    return goal;
  }

  const rewritePrompt = `Rewrite this candidate into one recursive self-improvement goal sentence of 16 to 24 words. Return only the sentence.\n\n${goal || raw}`;
  raw = await generateCandidateGoal(state, rewritePrompt);
  goal = normalizeGeneratedGoal(raw);

  const words = countWords(goal);
  if (words < 16 || words > 24) {
    throw new Error('Generated goal did not fit the 16-24 word target');
  }

  return goal;
}
/**
 * Check if page is served over HTTPS
 */
export function checkHttps() {
  return window.location.protocol === 'https:';
}

/**
 * Check WebGPU support (synchronous)
 */
export function checkWebGPU() {
  const supported = !!navigator.gpu;
  setNestedState('detection', {
    webgpu: { supported, checked: true }
  });
  return supported;
}

/**
 * Check WebGPU memory estimate
 */
export async function estimateGPUMemory() {
  if (!navigator.gpu) return null;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;

    // Get limits - maxBufferSize gives a rough memory indication
    const limits = adapter.limits;
    const maxBuffer = limits.maxBufferSize || 0;

    // Very rough estimate: maxBufferSize / 4 gives ~available VRAM in bytes
    // This is a heuristic, not accurate
    const estimatedMB = Math.round(maxBuffer / (1024 * 1024 * 4));

    return {
      estimatedMB,
      isLowMemory: estimatedMB < 4000,
      adapterInfo: adapter.info || {}
    };
  } catch (e) {
    return null;
  }
}

/**
 * Probe localhost for services
 * Returns: { detected, url, blocked, error }
 */
async function probeLocalhost(port, path, name) {
  const url = `http://localhost:${port}${path}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      mode: 'cors'
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { detected: true, url: `http://localhost:${port}`, blocked: false };
    }
    return { detected: false, url: null, blocked: false };

  } catch (error) {
    // Check for specific error types
    if (error.name === 'AbortError') {
      return { detected: false, url: null, blocked: false, error: 'timeout' };
    }

    // TypeError with "Failed to fetch" can indicate:
    // - CORS blocked
    // - Mixed content blocked (HTTPS -> HTTP)
    // - Private network access blocked
    if (error.name === 'TypeError') {
      const isHttps = checkHttps();
      const isMixedContent = isHttps; // HTTP request from HTTPS page
      const isPrivateNetwork = error.message?.includes('network') ||
                               error.message?.includes('blocked');

      return {
        detected: false,
        url: null,
        blocked: isMixedContent || isPrivateNetwork,
        error: isMixedContent ? 'mixed_content' : 'network_blocked'
      };
    }

    return { detected: false, url: null, blocked: false, error: error.message };
  }
}

/**
 * Probe for Ollama on localhost:11434
 */
export async function probeOllama() {
  const result = await probeLocalhost(11434, '/api/tags', 'Ollama');

  let models = [];
  if (result.detected) {
    try {
      const response = await fetch(`${result.url}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT)
      });
      if (response.ok) {
        const data = await response.json();
        models = (data.models || []).map(m => ({
          id: m.name || m.model,
          name: m.name || m.model,
          size: m.size
        }));
      }
    } catch (e) {
      console.warn('[Detection] Failed to list Ollama models:', e);
    }
  }

  setNestedState('detection', {
    ollama: {
      detected: result.detected,
      url: result.url,
      models,
      checked: true,
      blocked: result.blocked,
      error: result.error
    }
  });

  return { ...result, models };
}

/**
 * Probe for proxy server on localhost:8000 or 8080
 */
export async function probeProxy() {
  // Try 8000 first (default dev port), then 8080
  let result = await probeLocalhost(8000, '/api/health', 'Proxy');

  if (!result.detected) {
    result = await probeLocalhost(8080, '/api/health', 'Proxy');
    if (result.detected) {
      result.url = 'http://localhost:8080';
    }
  }

  let configuredProviders = [];
  if (result.detected) {
    try {
      const response = await fetch(`${result.url}/api/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT)
      });
      if (response.ok) {
        const data = await response.json();
        configuredProviders = data.providers || [];
      }
    } catch (e) {
      console.warn('[Detection] Failed to get proxy config:', e);
    }
  }

  setNestedState('detection', {
    proxy: {
      detected: result.detected,
      url: result.url,
      configuredProviders,
      checked: true,
      blocked: result.blocked,
      error: result.error
    }
  });

  return { ...result, configuredProviders };
}

/**
 * Check Doppler availability
 */
export async function checkDoppler() {
  const state = getState();
  if (!state.detection.webgpu.supported) {
    setNestedState('detection', {
      doppler: { supported: false, checked: true, models: [] }
    });
    return { supported: false };
  }

  try {
    const providerUrl = getDopplerProviderUrl();
    const preflight = await fetch(providerUrl, {
      method: 'GET',
      cache: 'no-store'
    }).catch(() => null);
    if (!preflight?.ok) {
      setNestedState('detection', {
        doppler: { supported: false, checked: true, models: [] }
      });
      return { supported: false };
    }

    const { DopplerProvider } = await import('@simulatte/doppler/provider');
    const available = await DopplerProvider.init();

    if (available) {
      const capabilities = DopplerProvider.getCapabilities();
      const cachedModels = await DopplerProvider.getModels();

      const models = cachedModels.map(modelId => ({
        id: modelId,
        name: modelId,
        cached: true
      }));

      setNestedState('detection', {
        doppler: {
          supported: true,
          checked: true,
          models,
          capabilities
        }
      });

      return { supported: true, models, capabilities };
    }
  } catch (e) {
    console.warn('[Detection] Doppler not available:', e);
  }

  setNestedState('detection', {
    doppler: { supported: false, checked: true, models: [] }
  });
  return { supported: false };
}

/**
 * Run all detections
 * @param {Object} options
 * @param {boolean} options.skipLocalScan - Skip localhost probing
 * @param {Function} options.onProgress - Progress callback
 */
export async function runDetection(options = {}) {
  const { skipLocalScan = false, onProgress } = options;

  // Set HTTPS status
  const isHttps = checkHttps();
  setNestedState('detection', { isHttps, scanSkipped: skipLocalScan });

  // Check WebGPU (synchronous)
  const webgpuSupported = checkWebGPU();
  onProgress?.({ step: 'webgpu', done: true, result: webgpuSupported });

  // Run other checks in parallel
  const checks = [];
  // Doppler check (depends on WebGPU)
  if (webgpuSupported) {
    checks.push(
      checkDoppler().then(r => {
        onProgress?.({ step: 'doppler', done: true, result: r.supported });
        return r;
      })
    );
  }

  // Local scans (if not skipped)
  if (!skipLocalScan) {
    checks.push(
      probeOllama().then(r => {
        onProgress?.({ step: 'ollama', done: true, result: r.detected, blocked: r.blocked });
        return r;
      })
    );

    checks.push(
      probeProxy().then(r => {
        onProgress?.({ step: 'proxy', done: true, result: r.detected, blocked: r.blocked });
        return r;
      })
    );
  } else {
    setNestedState('detection', {
      ollama: { detected: false, checked: false, models: [] },
      proxy: { detected: false, checked: false, configuredProviders: [] }
    });
  }

  await Promise.all(checks);

  return getState().detection;
}

/**
 * Test API key validity
 * @param {string} provider - Provider name
 * @param {string} apiKey - API key
 * @param {string} [baseUrl] - Custom base URL for 'other' provider
 */
export async function testApiKey(provider, apiKey, baseUrl = null) {
  const key = normalizeApiKey(apiKey);
  if (isLikelyInvalidApiKey(key)) {
    return { success: false, error: 'Invalid API key format' };
  }

  const endpoints = {
    anthropic: {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
    },
    openai: {
      url: 'https://api.openai.com/v1/models',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`
      }
    },
    gemini: {
      url: `https://generativelanguage.googleapis.com/v1/models?key=${key}`,
      method: 'GET',
      headers: {}
    },
    other: baseUrl ? {
      // For custom providers, use OpenAI-compatible /v1/models endpoint
      url: `${baseUrl.replace(/\/$/, '')}/models`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`
      }
    } : null
  };

  const config = endpoints[provider];
  if (!config) {
    return { success: false, error: provider === 'other' ? 'Base URL required' : 'Unknown provider' };
  }

  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body: config.body,
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      // For OpenAI/Gemini, we get model list back
      if (provider !== 'anthropic') {
        const data = await response.json();
        const models = provider === 'gemini'
          ? data.models?.map(m => ({ id: m.name, name: m.displayName || m.name }))
          : data.data?.map(m => ({ id: m.id, name: m.id }));
        return { success: true, models };
      }
      return { success: true };
    }

    if (response.status === 401) {
      return { success: false, error: 'Invalid API key' };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      error: errorData.error?.message || `HTTP ${response.status}`
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Connection timed out' };
    }
    return { success: false, error: error.message };
  }
}

export async function generateGoalPrompt() {
  const state = getState();
  return generateAndNormalizeGoal(state);
}

/**
 * Test proxy connection
 */
export async function testProxyConnection(url) {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        providers: data.providers || []
      };
    }

    return { success: false, error: `HTTP ${response.status}` };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Connection timed out' };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Test local server connection (Ollama)
 */
export async function testLocalConnection(url) {
  try {
    const response = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      const models = (data.models || []).map(m => ({
        id: m.name || m.model,
        name: m.name || m.model
      }));
      return { success: true, models };
    }

    return { success: false, error: `HTTP ${response.status}` };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Connection timed out' };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Test model via proxy - sends a minimal completion request
 */
export async function testProxyModel(url, provider, model) {
  try {
    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (response.ok) {
      return { success: true };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      error: errorData.error?.message || `HTTP ${response.status}`
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timed out' };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Test model via direct API - sends a minimal completion request
 */
export async function testDirectModel(provider, apiKey, model, baseUrl = null) {
  const configs = {
    anthropic: {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: {
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }]
      }
    },
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: {
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }]
      }
    },
    gemini: {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents: [{ parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: 1 }
      }
    },
    other: baseUrl ? {
      url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: {
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }]
      }
    } : null
  };

  const config = configs[provider];
  if (!config) {
    return { success: false, error: 'Unknown provider' };
  }

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(config.body),
      signal: AbortSignal.timeout(15000)
    });

    if (response.ok) {
      return { success: true };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      error: errorData.error?.message || `HTTP ${response.status}`
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timed out' };
    }
    return { success: false, error: error.message };
  }
}
