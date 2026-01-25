/**
 * @fileoverview Provider Registry
 * Central registry for LLM providers with lazy loader support.
 */

const ProviderRegistry = {
  metadata: {
    id: 'ProviderRegistry',
    version: '1.0.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils', 'VFS?'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS } = deps;
    const { logger, Errors } = Utils;

    const _providers = new Map();
    const _loaders = new Map();
    const _loading = new Map();
    let _dopplerVfsChecked = false;

    const normalizeId = (id) => (id || '').toLowerCase().trim();

    const registerProvider = (id, provider, options = {}) => {
      const cleanId = normalizeId(id);
      if (!cleanId) throw new Errors.ValidationError('Provider id required');
      if (!provider) throw new Errors.ValidationError(`Provider "${cleanId}" is missing`);

      if (_providers.has(cleanId) && !options.override) {
        logger.warn(`[ProviderRegistry] Provider already registered: ${cleanId}`);
        return false;
      }

      _providers.set(cleanId, provider);
      if (options.clearLoader) {
        _loaders.delete(cleanId);
      }
      return true;
    };

    const registerProviderLoader = (id, loader, options = {}) => {
      const cleanId = normalizeId(id);
      if (!cleanId) throw new Errors.ValidationError('Provider id required');
      if (typeof loader !== 'function') {
        throw new Errors.ValidationError(`Provider loader missing for "${cleanId}"`);
      }

      if (_loaders.has(cleanId) && !options.override) {
        logger.warn(`[ProviderRegistry] Provider loader already registered: ${cleanId}`);
        return false;
      }

      _loaders.set(cleanId, loader);
      if (options.clearProvider) {
        _providers.delete(cleanId);
      }
      return true;
    };

    const hasProvider = (id) => {
      const cleanId = normalizeId(id);
      return _providers.has(cleanId) || _loaders.has(cleanId);
    };

    const listProviders = () => {
      const ids = new Set([..._providers.keys(), ..._loaders.keys()]);
      return Array.from(ids);
    };

    const getLoadedProvider = (id) => {
      const cleanId = normalizeId(id);
      return _providers.get(cleanId) || null;
    };

    const getProvider = async (id, options = {}) => {
      const cleanId = normalizeId(id);
      if (!cleanId) throw new Errors.ValidationError('Provider id required');

      if (_providers.has(cleanId)) {
        return _providers.get(cleanId);
      }

      if (_loading.has(cleanId)) {
        return _loading.get(cleanId);
      }

      const loader = _loaders.get(cleanId);
      if (!loader) {
        throw new Errors.ConfigError(`Provider not registered: ${cleanId}`);
      }

      const loadPromise = (async () => {
        try {
          const provider = await loader(options);
          if (!provider) {
            throw new Errors.ConfigError(`Provider loader returned empty provider: ${cleanId}`);
          }
          _providers.set(cleanId, provider);
          return provider;
        } finally {
          _loading.delete(cleanId);
        }
      })();

      _loading.set(cleanId, loadPromise);
      return loadPromise;
    };

    const getStatus = async (id, options = {}) => {
      const cleanId = normalizeId(id);
      const loaded = _providers.get(cleanId);
      if (loaded) {
        return typeof loaded.status === 'function'
          ? loaded.status()
          : { available: true };
      }

      if (!options.forceLoad) {
        return { available: false, initialized: false };
      }

      const provider = await getProvider(cleanId, options);
      return typeof provider.status === 'function'
        ? provider.status()
        : { available: true };
    };

    const ensureDopplerModules = async () => {
      if (_dopplerVfsChecked || !VFS) return true;
      const entry = await VFS.stat('/doppler/src/client/doppler-provider.js').catch(() => null);
      if (!entry) {
        throw new Errors.ConfigError(
          'Doppler provider not present in VFS. Seed VFS from /doppler/config/vfs-manifest.json or host /doppler assets.'
        );
      }
      _dopplerVfsChecked = true;
      return true;
    };

    const buildDopplerProvider = (baseProvider) => {
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
        const currentModel = caps?.currentModelId;
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
        getDopplerStorageInfo: baseProvider.getDopplerStorageInfo?.bind(baseProvider),
        getPipeline: baseProvider.getPipeline?.bind(baseProvider),
        getCurrentModelId: baseProvider.getCurrentModelId?.bind(baseProvider),
        extractTextModelConfig: baseProvider.extractTextModelConfig?.bind(baseProvider),
        readOPFSFile: baseProvider.readOPFSFile?.bind(baseProvider),
        writeOPFSFile: baseProvider.writeOPFSFile?.bind(baseProvider),
        fetchArrayBuffer: baseProvider.fetchArrayBuffer?.bind(baseProvider),
        runtime: baseProvider.runtime,
        conversion: baseProvider.conversion,
        bench: baseProvider.bench,
        destroy: baseProvider.destroy?.bind(baseProvider)
      };
    };

    const loadDopplerProvider = async () => {
      if (typeof window === 'undefined') {
        throw new Errors.ConfigError('Doppler provider requires a browser environment');
      }

      await ensureDopplerModules();

      let module;
      try {
        module = await import('@clocksmith/doppler/provider');
      } catch (err) {
        throw new Errors.ConfigError(`Failed to import Doppler provider: ${err.message}`);
      }

      const baseProvider = module?.DopplerProvider || module?.default;
      if (!baseProvider) {
        throw new Errors.ConfigError('Doppler provider export missing');
      }

      return buildDopplerProvider(baseProvider);
    };

    registerProviderLoader('doppler', loadDopplerProvider);

    return {
      registerProvider,
      registerProviderLoader,
      hasProvider,
      listProviders,
      getProvider,
      getLoadedProvider,
      getStatus
    };
  }
};

export default ProviderRegistry;
