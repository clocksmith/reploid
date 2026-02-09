/**
 * Reploid-specific Doppler adapter.
 *
 * Doppler ships `@doppler/core` (engine) and `@doppler/core/provider` (generic browser facade).
 * Reploid wraps those into Reploid's provider contract (chat/stream/status + LoRA + KV prefill)
 * and exposes Reploid-only "toolbox" surfaces (bench harness).
 */

async function loadBenchHarness() {
  // Keep this lazy: most sessions never touch the harness.
  return import('@doppler/core/inference/browser-harness.js');
}

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
    loadRuntimeConfigFromUrl: async (...args) => (await loadBenchHarness()).loadRuntimeConfigFromUrl(...args),
    applyRuntimeConfigFromUrl: async (...args) => (await loadBenchHarness()).applyRuntimeConfigFromUrl(...args),
    loadRuntimePreset: async (...args) => (await loadBenchHarness()).loadRuntimePreset(...args),
    applyRuntimePreset: async (...args) => (await loadBenchHarness()).applyRuntimePreset(...args),
    initializeBrowserHarness: async (...args) => (await loadBenchHarness()).initializeBrowserHarness(...args),
    saveBrowserReport: async (...args) => (await loadBenchHarness()).saveBrowserReport(...args),
    runBrowserHarness: async (...args) => (await loadBenchHarness()).runBrowserHarness(...args),
    runBrowserSuite: async (...args) => (await loadBenchHarness()).runBrowserSuite(...args),
    runBrowserManifest: async (...args) => (await loadBenchHarness()).runBrowserManifest(...args),
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

