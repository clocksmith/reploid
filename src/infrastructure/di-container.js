/**
 * @fileoverview Dependency Injection Container
 * Handles module registration, resolution, and lifecycle.
 */

const DIContainer = {
  metadata: {
    id: 'DIContainer',
    version: '1.0.0',
    genesis: { introduced: 'seed' },
    dependencies: ['Utils'],
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const _modules = new Map();
    const _instances = new Map();
    const _stack = new Set(); // For circular dependency checks

    const register = (mod) => {
      if (!mod.metadata?.id) throw new Error('Invalid module registration');
      _modules.set(mod.metadata.id, mod);
    };

    const resolve = async (id) => {
      if (_instances.has(id)) return _instances.get(id);

      const mod = _modules.get(id);
      if (!mod) throw new Error(`Module not found: ${id}`);

      if (_stack.has(id)) throw new Error(`Circular dependency: ${id}`);
      _stack.add(id);

      try {
        const reqs = mod.metadata.dependencies || [];
        const inj = {};

        for (const req of reqs) {
          const optional = req.endsWith('?');
          const name = optional ? req.slice(0, -1) : req;
          try {
            inj[name] = await resolve(name);
          } catch (e) {
            if (!optional) throw e;
            logger.warn(`[DI] Optional dep ${name} missing for ${id}`);
          }
        }

        logger.info(`[DI] Initializing ${id}`);
        const instance = mod.factory(inj);

        if (mod.metadata.async && instance.init) {
          await instance.init();
        }

        _instances.set(id, instance);
        return instance;

      } finally {
        _stack.delete(id);
      }
    };

    return { register, resolve };
  }
};

export default DIContainer;
