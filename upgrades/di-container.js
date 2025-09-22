// DI Container for REPLOID - Project Phoenix

const DIContainer = {
  metadata: {
    id: 'DIContainer',
    version: '1.0.0',
    dependencies: ['Utils'],
    async: false,
    type: 'service'
  },
  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;

    const _services = new Map();
    const _singletons = new Map();

    const register = (module) => {
      if (!module || !module.metadata || !module.metadata.id) {
        logger.error('[DIContainer] Invalid module registration attempt.', module);
        return;
      }
      logger.info(`[DIContainer] Registered module: ${module.metadata.id}`);
      _services.set(module.metadata.id, module);
    };

    const resolve = async (id) => {
      if (_singletons.has(id)) {
        return _singletons.get(id);
      }

      const module = _services.get(id);
      if (!module) {
        throw new Error(`[DIContainer] Service not found: ${id}`);
      }

      const dependencies = {};
      if (module.metadata.dependencies) {
        for (const depId of module.metadata.dependencies) {
          dependencies[depId] = await resolve(depId);
        }
      }

      logger.debug(`[DIContainer] Creating instance of: ${id}`);
      const instance = module.factory(dependencies);
      
      // Handle async initialization if required
      if (module.metadata.async && typeof instance.init === 'function') {
        await instance.init();
      }

      // The public API is under the 'api' property for services/ui modules
      const publicApi = (module.metadata.type === 'pure') ? instance : instance.api;

      _singletons.set(id, publicApi);
      return publicApi;
    };

    return {
        register,
        resolve,
    };
  }
};

DIContainer;