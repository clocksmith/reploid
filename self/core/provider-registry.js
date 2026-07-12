/**
 * @fileoverview Provider Registry
 * Central registry for LLM providers with lazy loader support.
 */

const ProviderRegistry = {
  metadata: {
    id: 'ProviderRegistry',
    version: '1.0.0',
    genesis: { introduced: 'capsule' },
    dependencies: ['Utils', 'VFS?'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger, Errors } = Utils;

    const _providers = new Map();
    const _loaders = new Map();
    const _loading = new Map();

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

    const loadDopplerProvider = async () => {
      if (typeof window === 'undefined') {
        throw new Errors.ConfigError('Doppler provider requires a browser environment');
      }

      let module;
      try {
        module = await import('../providers/doppler-reploid.js');
      } catch (err) {
        throw new Errors.ConfigError(`Failed to import Doppler provider: ${err.message}`);
      }

      const baseProvider = module?.DopplerProvider || module?.default;
      if (!baseProvider) {
        throw new Errors.ConfigError('Doppler provider export missing');
      }

      const { createReploidDopplerProvider } = await import('../providers/doppler-reploid.js');
      return createReploidDopplerProvider(baseProvider, { Errors });
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
