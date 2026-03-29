/**
 * @fileoverview Env-backed inference service shared by the standalone signaling server.
 */

import nodeFetch from 'node-fetch';

const DEFAULT_LOCAL_MODEL_ENDPOINT = 'http://localhost:11434';
const DEFAULT_VLLM_ENDPOINT = 'http://localhost:8000';
const PROVIDER_PRIORITY = Object.freeze([
  'gemini',
  'openai',
  'anthropic',
  'groq',
  'ollama',
  'vllm'
]);

const PROVIDER_MODEL_ENV_KEYS = Object.freeze({
  gemini: ['GEMINI_MODEL'],
  openai: ['OPENAI_MODEL'],
  anthropic: ['ANTHROPIC_MODEL'],
  groq: ['GROQ_MODEL'],
  ollama: ['OLLAMA_MODEL'],
  vllm: ['VLLM_MODEL']
});

const normalizeString = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const firstDefined = (...values) => {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
};

const parseJsonMaybe = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

const toErrorMessage = (provider, payload, fallback) => {
  if (payload?.error?.message) return String(payload.error.message);
  if (payload?.error && typeof payload.error === 'string') return payload.error;
  if (payload?.message) return String(payload.message);
  return fallback || `Failed to generate with ${provider}`;
};

const assertMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  return messages.map((message) => ({
    role: String(message?.role || 'user').trim() || 'user',
    content: String(message?.content || '')
  }));
};

const resolveProviderDefaultModel = (provider, env) => {
  const providerKeys = PROVIDER_MODEL_ENV_KEYS[provider] || [];
  return firstDefined(...providerKeys.map((key) => env[key]));
};

export function resolveInferenceServiceConfig(options = {}) {
  const env = options.env || process.env;
  const explicitProvider = firstDefined(options.provider, env.REPLOID_SIGNALING_PROVIDER);
  const explicitModel = firstDefined(options.model, env.REPLOID_SIGNALING_MODEL);

  const providers = {
    gemini: {
      available: !!firstDefined(options.geminiApiKey, env.GEMINI_API_KEY),
      apiKey: firstDefined(options.geminiApiKey, env.GEMINI_API_KEY),
      defaultModel: resolveProviderDefaultModel('gemini', env)
    },
    openai: {
      available: !!firstDefined(options.openaiApiKey, env.OPENAI_API_KEY),
      apiKey: firstDefined(options.openaiApiKey, env.OPENAI_API_KEY),
      defaultModel: resolveProviderDefaultModel('openai', env)
    },
    anthropic: {
      available: !!firstDefined(options.anthropicApiKey, env.ANTHROPIC_API_KEY),
      apiKey: firstDefined(options.anthropicApiKey, env.ANTHROPIC_API_KEY),
      defaultModel: resolveProviderDefaultModel('anthropic', env)
    },
    groq: {
      available: !!firstDefined(options.groqApiKey, env.GROQ_API_KEY),
      apiKey: firstDefined(options.groqApiKey, env.GROQ_API_KEY),
      defaultModel: resolveProviderDefaultModel('groq', env)
    },
    ollama: {
      available: true,
      endpoint: firstDefined(options.localEndpoint, env.LOCAL_MODEL_ENDPOINT) || DEFAULT_LOCAL_MODEL_ENDPOINT,
      defaultModel: resolveProviderDefaultModel('ollama', env)
    },
    vllm: {
      available: true,
      endpoint: firstDefined(options.vllmEndpoint, env.VLLM_ENDPOINT) || DEFAULT_VLLM_ENDPOINT,
      defaultModel: resolveProviderDefaultModel('vllm', env)
    }
  };

  const availableProviders = PROVIDER_PRIORITY.filter((provider) => providers[provider]?.available);
  const selectedProvider = explicitProvider && providers[explicitProvider]?.available
    ? explicitProvider
    : availableProviders[0] || null;
  const selectedModel = firstDefined(
    explicitModel,
    selectedProvider ? providers[selectedProvider]?.defaultModel : null
  );

  return {
    provider: selectedProvider,
    model: selectedModel,
    availableProviders,
    providers,
    peerAvailable: !!selectedProvider && !!selectedModel
  };
}

export function createInferenceService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch || nodeFetch;
  const config = resolveInferenceServiceConfig(options);

  const getProxyStatus = () => ({
    proxyAvailable: true,
    hasApiKey: !!config.providers.gemini.apiKey,
    providers: {
      gemini: !!config.providers.gemini.apiKey,
      openai: !!config.providers.openai.apiKey,
      anthropic: !!config.providers.anthropic.apiKey,
      groq: !!config.providers.groq.apiKey,
      ollama: true,
      vllm: true
    },
    primaryProvider: config.provider,
    primaryModel: config.model,
    peerAvailable: config.peerAvailable,
    localEndpoint: config.providers.ollama.endpoint,
    vllmEndpoint: config.providers.vllm.endpoint
  });

  const resolveRequestTarget = (request = {}) => {
    const provider = firstDefined(request.provider, config.provider);
    if (!provider || !config.providers[provider]?.available) {
      throw new Error(provider ? `Provider is not configured: ${provider}` : 'No inference provider configured');
    }

    const model = firstDefined(request.model, provider === config.provider ? config.model : null, config.providers[provider].defaultModel);
    if (!model) {
      throw new Error(`No model configured for provider: ${provider}`);
    }

    return {
      provider,
      model,
      providerConfig: config.providers[provider]
    };
  };

  const createResult = (provider, model, content, usage = null) => ({
    content,
    raw: content,
    model,
    provider,
    timestamp: Date.now(),
    usage
  });

  const requestGemini = async (providerConfig, model, messages) => {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${providerConfig.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }]
          }))
        })
      }
    );

    const data = await parseJsonMaybe(response);
    if (!response.ok) {
      throw new Error(toErrorMessage('gemini', data, `Gemini API error (${response.status})`));
    }

    const content = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || '')
      .join('\n');

    return createResult('gemini', model, content, data?.usageMetadata || null);
  };

  const requestOpenAICompatible = async (provider, providerConfig, model, messages, endpoint, extraHeaders = {}) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false
      })
    });

    const data = await parseJsonMaybe(response);
    if (!response.ok) {
      throw new Error(toErrorMessage(provider, data, `${provider} API error (${response.status})`));
    }

    const content = data?.choices?.[0]?.message?.content || '';
    return createResult(provider, model, content, data?.usage || null);
  };

  const requestAnthropic = async (providerConfig, model, messages) => {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': providerConfig.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4096
      })
    });

    const data = await parseJsonMaybe(response);
    if (!response.ok) {
      throw new Error(toErrorMessage('anthropic', data, `Anthropic API error (${response.status})`));
    }

    const content = Array.isArray(data?.content)
      ? data.content
        .filter((entry) => entry?.type === 'text')
        .map((entry) => entry.text || '')
        .join('')
      : '';

    return createResult('anthropic', model, content, data?.usage || null);
  };

  const requestOllama = async (providerConfig, model, messages) => {
    const response = await fetchImpl(`${providerConfig.endpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false
      })
    });

    const data = await parseJsonMaybe(response);
    if (!response.ok) {
      throw new Error(toErrorMessage('ollama', data, `Ollama API error (${response.status})`));
    }

    const content = data?.message?.content || data?.response || '';
    return createResult('ollama', model, content, data?.eval_count || null);
  };

  const generate = async (request = {}) => {
    const messages = assertMessages(request.messages);
    const { provider, model, providerConfig } = resolveRequestTarget(request);

    switch (provider) {
      case 'gemini':
        return requestGemini(providerConfig, model, messages);
      case 'openai':
        return requestOpenAICompatible(
          'openai',
          providerConfig,
          model,
          messages,
          'https://api.openai.com/v1/chat/completions',
          { Authorization: `Bearer ${providerConfig.apiKey}` }
        );
      case 'anthropic':
        return requestAnthropic(providerConfig, model, messages);
      case 'groq':
        return requestOpenAICompatible(
          'groq',
          providerConfig,
          model,
          messages,
          'https://api.groq.com/openai/v1/chat/completions',
          { Authorization: `Bearer ${providerConfig.apiKey}` }
        );
      case 'vllm':
        return requestOpenAICompatible(
          'vllm',
          providerConfig,
          model,
          messages,
          `${providerConfig.endpoint}/v1/chat/completions`
        );
      case 'ollama':
        return requestOllama(providerConfig, model, messages);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  };

  return {
    getConfig: () => ({ ...config }),
    getProxyStatus,
    isPeerAvailable: () => config.peerAvailable,
    generate
  };
}

export default {
  createInferenceService,
  resolveInferenceServiceConfig
};
