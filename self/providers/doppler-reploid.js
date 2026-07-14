/**
 * Reploid-specific Doppler adapter.
 *
 * Doppler owns model loading and model handles. Reploid adapts those public
 * handles into its chat/stream/status + LoRA + KV-prefill provider contract.
 */

import {
  DOPPLER_MODULE_URL,
  DOPPLER_TOOLING_URL
} from '../config/doppler-local-models.js';

async function loadBenchHarness() {
  return import(DOPPLER_TOOLING_URL);
}

const generationOptionsFromModel = (model = {}) => Object.fromEntries(Object.entries({
  maxTokens: model.maxTokens ?? model.maxOutputTokens,
  temperature: model.temperature,
  topK: model.topK,
  topP: model.topP,
  stopSequences: model.stopSequences,
  useChatTemplate: model.useChatTemplate
}).filter(([, value]) => value !== undefined));

const configError = (Errors, message) => {
  const ConfigError = Errors?.ConfigError || Error;
  return new ConfigError(message);
};

export function createDopplerPublicProviderAdapter(dopplerModule, { Errors = null } = {}) {
  const runtime = dopplerModule?.doppler || dopplerModule?.dr || dopplerModule?.default || null;
  const load = dopplerModule?.load || runtime?.load?.bind(runtime);
  if (typeof load !== 'function') {
    throw configError(Errors, 'Doppler public module does not expose load');
  }

  let initialized = false;
  let handle = null;
  let loadedModelId = null;
  const hasWebGPU = () => typeof navigator !== 'undefined' && !!navigator.gpu;
  const requireHandle = () => {
    if (!handle?.loaded) throw configError(Errors, 'Doppler model is not loaded');
    return handle;
  };

  return {
    async init() {
      initialized = true;
      return hasWebGPU();
    },
    getCapabilities() {
      return {
        available: hasWebGPU(),
        initialized,
        currentModelId: loadedModelId,
        deviceInfo: handle?.deviceInfo || null
      };
    },
    async loadModel(modelId, modelUrl = null, onProgress = null, localPath = null) {
      if (localPath && !modelUrl) {
        throw configError(Errors, 'Doppler 0.4.9 browser loads require a registry id or model URL');
      }
      const source = modelUrl ? { url: modelUrl } : modelId;
      handle = await load(source, {
        ...(globalThis.REPLOID_DOPPLER_LOAD_OPTIONS || {}),
        ...(onProgress ? { onProgress } : {})
      });
      loadedModelId = modelId;
      return handle;
    },
    async chat(messages, options = {}) {
      return requireHandle().chatText(messages, generationOptionsFromModel(options));
    },
    async *stream(messages, options = {}) {
      for await (const token of requireHandle().chat(messages, generationOptionsFromModel(options))) {
        yield token;
      }
    },
    async prefillKV(prompt, options = {}) {
      const prefill = requireHandle().advanced?.prefillKV;
      if (typeof prefill !== 'function') {
        throw configError(Errors, 'Doppler model handle does not expose KV prefill');
      }
      return prefill(prompt, generationOptionsFromModel(options));
    },
    async loadLoRAAdapter(adapter) {
      return requireHandle().loadLoRA(adapter);
    },
    async unloadLoRAAdapter() {
      return requireHandle().unloadLoRA();
    },
    getActiveLoRA() {
      return handle?.activeLoRA || null;
    },
    getCurrentModelId() {
      return loadedModelId;
    },
    getPipeline() {
      return handle;
    },
    async getModels() {
      return typeof runtime?.listModels === 'function' ? runtime.listModels() : [];
    },
    async getAvailableModels() {
      return typeof runtime?.listModels === 'function' ? runtime.listModels() : [];
    },
    async destroy() {
      if (handle) await handle.unload();
      handle = null;
      loadedModelId = null;
      initialized = false;
    }
  };
}

const callTooling = async (method, args) => {
  const tooling = await loadBenchHarness();
  if (typeof tooling?.[method] !== 'function') {
    throw new Error(`Doppler 0.4.9 tooling does not expose ${method}`);
  }
  return tooling[method](...args);
};

export function createReploidDopplerProvider(baseProvider, { Errors }) {
  if (!baseProvider) {
    throw new Error('createReploidDopplerProvider requires a base DopplerProvider');
  }

  const ensureReady = async () => {
    const caps = typeof baseProvider.getCapabilities === 'function'
      ? baseProvider.getCapabilities()
      : null;

    if (!caps?.initialized) {
      await baseProvider.init();
    }

    const updatedCaps = typeof baseProvider.getCapabilities === 'function'
      ? baseProvider.getCapabilities()
      : null;
    if (updatedCaps && !updatedCaps.available) {
      throw new Errors.ConfigError('Doppler not available - WebGPU may not be supported');
    }

    return baseProvider;
  };

  const resolveModelId = (modelConfig) => modelConfig?.modelId || modelConfig?.id || null;

  const ensureModelLoaded = async (modelConfig, onProgress) => {
    const provider = await ensureReady();
    const modelId = resolveModelId(modelConfig);

    if (!modelId) {
      throw new Errors.ConfigError('Doppler model id is required');
    }

    const caps = typeof provider.getCapabilities === 'function'
      ? provider.getCapabilities()
      : null;
    const currentModel = caps?.currentModelId ?? (typeof provider.getCurrentModelId === 'function'
      ? provider.getCurrentModelId()
      : null);

    if (currentModel !== modelId) {
      await provider.loadModel(
        modelId,
        modelConfig?.modelUrl ?? null,
        onProgress ?? null,
        modelConfig?.localPath ?? null
      );
    }

    return { provider, modelId };
  };

  const chat = async (messages, modelConfig, requestId) => {
    const { provider, modelId } = await ensureModelLoaded(modelConfig);
    const result = await provider.chat(messages, modelConfig);
    const content = result?.content ?? '';

    return {
      requestId,
      content,
      raw: content,
      usage: result?.usage,
      model: modelId,
      timestamp: Date.now(),
      provider: 'doppler'
    };
  };

  const stream = async (messages, modelConfig, onUpdate, requestId) => {
    const { provider, modelId } = await ensureModelLoaded(modelConfig, onUpdate);
    let fullContent = '';

    for await (const token of provider.stream(messages, modelConfig)) {
      if (!token) continue;
      fullContent += token;
      if (onUpdate) onUpdate(token);
    }

    return {
      requestId,
      content: fullContent,
      raw: fullContent,
      model: modelId,
      timestamp: Date.now(),
      provider: 'doppler'
    };
  };

  const prefillKV = async (prompt, modelConfig, options = {}) => {
    if (!modelConfig) {
      throw new Errors.ConfigError('Model config required for KV prefill');
    }
    const { provider } = await ensureModelLoaded(modelConfig);
    if (typeof provider.prefillKV !== 'function') {
      throw new Errors.ConfigError('Doppler provider does not support KV prefill');
    }
    return provider.prefillKV(prompt, options);
  };

  const loadLoRAAdapter = async (adapter) => {
    const provider = await ensureReady();
    if (typeof provider.loadLoRAAdapter !== 'function') {
      throw new Errors.ConfigError('Doppler provider does not support LoRA adapters');
    }
    return provider.loadLoRAAdapter(adapter);
  };

  const unloadLoRAAdapter = async () => {
    const provider = await ensureReady();
    if (typeof provider.unloadLoRAAdapter !== 'function') {
      throw new Errors.ConfigError('Doppler provider does not support LoRA adapters');
    }
    return provider.unloadLoRAAdapter();
  };

  const getActiveLoRA = () => {
    if (typeof baseProvider.getActiveLoRA !== 'function') return null;
    return baseProvider.getActiveLoRA();
  };

  const status = () => baseProvider.getCapabilities?.() || { available: false };

  const loadModel = async (modelId, modelUrl, onProgress, localPath) => {
    const provider = await ensureReady();
    return provider.loadModel(
      modelId,
      modelUrl ?? null,
      onProgress ?? null,
      localPath ?? null
    );
  };

  const bench = {
    loadRuntimeConfigFromUrl: (...args) => callTooling('loadRuntimeConfigFromUrl', args),
    applyRuntimeConfigFromUrl: (...args) => callTooling('applyRuntimeConfigFromUrl', args),
    loadRuntimePreset: (...args) => callTooling('loadRuntimePreset', args),
    applyRuntimePreset: (...args) => callTooling('applyRuntimePreset', args),
    initializeBrowserHarness: (...args) => callTooling('initializeBrowserHarness', args),
    saveBrowserReport: (...args) => callTooling('saveBrowserReport', args),
    runBrowserHarness: (...args) => callTooling('runBrowserHarness', args),
    runBrowserSuite: (...args) => callTooling('runBrowserSuite', args),
    runBrowserManifest: (...args) => callTooling('runBrowserManifest', args)
  };

  return {
    name: 'doppler',
    chat,
    stream,
    status,
    loadModel,
    prefillKV,
    loadLoRAAdapter,
    unloadLoRAAdapter,
    getActiveLoRA,
    getCapabilities: () => baseProvider.getCapabilities?.(),
    getModels: baseProvider.getModels?.bind(baseProvider),
    getAvailableModels: baseProvider.getAvailableModels?.bind(baseProvider),
    getPipeline: baseProvider.getPipeline?.bind(baseProvider),
    getCurrentModelId: baseProvider.getCurrentModelId?.bind(baseProvider),
    bench,
    destroy: baseProvider.destroy?.bind(baseProvider),
  };
}

class DopplerConfigError extends Error {}

let publicAdapter = null;
let publicAdapterPromise = null;

const ensurePublicAdapter = async () => {
  if (publicAdapter) return publicAdapter;
  if (!publicAdapterPromise) {
    publicAdapterPromise = import(DOPPLER_MODULE_URL)
      .then((module) => createDopplerPublicProviderAdapter(module, {
        Errors: { ConfigError: DopplerConfigError }
      }))
      .then((value) => {
        publicAdapter = value;
        return value;
      })
      .catch((error) => {
        publicAdapterPromise = null;
        throw error;
      });
  }
  return publicAdapterPromise;
};

export const DopplerProvider = {
  init: async () => (await ensurePublicAdapter()).init(),
  getCapabilities: () => publicAdapter?.getCapabilities() || {
    available: typeof navigator !== 'undefined' && !!navigator.gpu,
    initialized: false,
    currentModelId: null
  },
  loadModel: async (...args) => (await ensurePublicAdapter()).loadModel(...args),
  chat: async (...args) => (await ensurePublicAdapter()).chat(...args),
  async *stream(...args) {
    yield* (await ensurePublicAdapter()).stream(...args);
  },
  prefillKV: async (...args) => (await ensurePublicAdapter()).prefillKV(...args),
  loadLoRAAdapter: async (...args) => (await ensurePublicAdapter()).loadLoRAAdapter(...args),
  unloadLoRAAdapter: async (...args) => (await ensurePublicAdapter()).unloadLoRAAdapter(...args),
  getActiveLoRA: () => publicAdapter?.getActiveLoRA() || null,
  getCurrentModelId: () => publicAdapter?.getCurrentModelId() || null,
  getPipeline: () => publicAdapter?.getPipeline() || null,
  getModels: async () => (await ensurePublicAdapter()).getModels(),
  getAvailableModels: async () => (await ensurePublicAdapter()).getAvailableModels(),
  async destroy() {
    if (publicAdapter) await publicAdapter.destroy();
    publicAdapter = null;
    publicAdapterPromise = null;
  }
};
