/**
 * @fileoverview Substrate Loader
 * Dynamically loads modules and widgets from VFS.
 * MOVED from core/ to capabilities/system/ as part of RSI L3 Architecture.
 */

const SubstrateLoader = {
  metadata: {
    id: 'SubstrateLoader',
    version: '2.0.0',
    dependencies: ['Utils', 'VFS'],
    type: 'capability' // Changed from 'core' to 'capability'
  },

  factory: (deps) => {
    const { Utils, VFS } = deps;
    const { logger } = Utils;

    const loadModule = async (path) => {
      if (!(await VFS.exists(path))) throw new Error(`Module not found: ${path}`);

      const code = await VFS.read(path);
      const blob = new Blob([code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);

      try {
        const module = await import(url);
        logger.info(`[Substrate] Loaded module: ${path}`);
        return module;
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    const loadWidget = async (path, containerId) => {
      const module = await loadModule(path);
      if (!module.default || !module.default.render) {
        throw new Error('Invalid widget: missing render()');
      }

      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = ''; // Clear previous
        const element = module.default.render();
        container.appendChild(element);
        logger.info(`[Substrate] Rendered widget ${path} to ${containerId}`);
      }
    };

    return { loadModule, loadWidget };
  }
};

export default SubstrateLoader;