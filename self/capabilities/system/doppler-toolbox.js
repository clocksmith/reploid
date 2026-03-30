/**
 * @fileoverview Doppler Toolbox
 * Auxiliary Doppler operations for tools and system capabilities.
 */

const DopplerToolbox = {
  metadata: {
    id: 'DopplerToolbox',
    version: '1.0.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils', 'ProviderRegistry'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, ProviderRegistry } = deps;
    const { Errors } = Utils;

    const ensureProvider = async () => {
      if (!ProviderRegistry) {
        throw new Errors.ConfigError('ProviderRegistry not available');
      }
      return ProviderRegistry.getProvider('doppler');
    };

    const callProviderMethod = async (path, label, args) => {
      const provider = await ensureProvider();
      let target = provider;
      for (const key of path) {
        target = target?.[key];
      }
      if (typeof target !== 'function') {
        throw new Errors.ConfigError(`Doppler provider does not support ${label}`);
      }
      return target(...args);
    };

    const prefillKV = async (prompt, modelConfig, options = {}) => {
      if (!modelConfig) {
        throw new Errors.ConfigError('Model config required for KV prefill');
      }
      return callProviderMethod(['prefillKV'], 'KV prefill', [prompt, modelConfig, options]);
    };

    const loadLoRAAdapter = async (adapter) => {
      return callProviderMethod(['loadLoRAAdapter'], 'LoRA adapters', [adapter]);
    };

    const unloadLoRAAdapter = async () => {
      return callProviderMethod(['unloadLoRAAdapter'], 'LoRA adapters', []);
    };

    const getActiveLoRA = async () => {
      const provider = await ensureProvider();
      return typeof provider.getActiveLoRA === 'function'
        ? provider.getActiveLoRA()
        : null;
    };

    const embeddings = async (...args) => {
      const provider = await ensureProvider();
      const embedFn = provider?.embed || provider?.embeddings;
      if (typeof embedFn !== 'function') {
        throw new Errors.ConfigError('Doppler provider does not expose embeddings');
      }
      return embedFn(...args);
    };

    const getCapabilities = async () => {
      const provider = await ensureProvider();
      if (typeof provider.getCapabilities === 'function') {
        return provider.getCapabilities();
      }
      if (typeof provider.status === 'function') {
        return provider.status();
      }
      return { available: true };
    };

    const getStatus = async (options = {}) => {
      return ProviderRegistry.getStatus('doppler', options);
    };

    const bench = {
      loadRuntimeConfigFromUrl: async (...args) => {
        return callProviderMethod(['bench', 'loadRuntimeConfigFromUrl'], 'bench.loadRuntimeConfigFromUrl', args);
      },
      applyRuntimeConfigFromUrl: async (...args) => {
        return callProviderMethod(['bench', 'applyRuntimeConfigFromUrl'], 'bench.applyRuntimeConfigFromUrl', args);
      },
      loadRuntimePreset: async (...args) => {
        return callProviderMethod(['bench', 'loadRuntimePreset'], 'bench.loadRuntimePreset', args);
      },
      applyRuntimePreset: async (...args) => {
        return callProviderMethod(['bench', 'applyRuntimePreset'], 'bench.applyRuntimePreset', args);
      },
      initializeBrowserHarness: async (...args) => {
        return callProviderMethod(['bench', 'initializeBrowserHarness'], 'bench.initializeBrowserHarness', args);
      },
      saveBrowserReport: async (...args) => {
        return callProviderMethod(['bench', 'saveBrowserReport'], 'bench.saveBrowserReport', args);
      },
      runBrowserHarness: async (...args) => {
        return callProviderMethod(['bench', 'runBrowserHarness'], 'bench.runBrowserHarness', args);
      },
      runBrowserSuite: async (...args) => {
        return callProviderMethod(['bench', 'runBrowserSuite'], 'bench.runBrowserSuite', args);
      },
      runBrowserManifest: async (...args) => {
        return callProviderMethod(['bench', 'runBrowserManifest'], 'bench.runBrowserManifest', args);
      }
    };

    return {
      prefillKV,
      loadLoRAAdapter,
      unloadLoRAAdapter,
      getActiveLoRA,
      embeddings,
      getCapabilities,
      getStatus,
      bench,
      getProvider: ensureProvider
    };
  }
};

export default DopplerToolbox;
