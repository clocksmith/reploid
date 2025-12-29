/**
 * @fileoverview Connection Detection
 * Probes for available connections with proper error handling.
 */

import { getState, setNestedState } from './state.js';

const PROBE_TIMEOUT = 3000;

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
    console.warn('[Detection] GPU memory estimate failed:', e);
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
    const { DopplerProvider } = await import('@clocksmith/doppler/provider');
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
  const endpoints = {
    anthropic: {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
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
        'Authorization': `Bearer ${apiKey}`
      }
    },
    gemini: {
      url: `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
      method: 'GET',
      headers: {}
    },
    other: baseUrl ? {
      // For custom providers, use OpenAI-compatible /v1/models endpoint
      url: `${baseUrl.replace(/\/$/, '')}/models`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
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
