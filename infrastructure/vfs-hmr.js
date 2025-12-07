/**
 * @fileoverview VFS Hot Module Replacement
 * Enables live reloading of modules when agent modifies code in VFS.
 * Works in conjunction with Service Worker to serve updated modules.
 */

const VFSHMR = {
  metadata: {
    id: 'VFSHMR',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'VFS'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS } = deps;
    const { logger } = Utils;

    let _isEnabled = true;
    let _moduleCache = new Map(); // path -> module reference
    let _dependencyGraph = new Map(); // path -> Set of dependent paths
    let _reloadCallbacks = new Map(); // path -> callback

    const init = async () => {
      logger.info('[VFS-HMR] Initializing Hot Module Replacement...');

      // Listen for VFS file changes
      EventBus.on('vfs:file_changed', handleFileChange);

      // Check if Service Worker is active
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        logger.info('[VFS-HMR] Service Worker active, HMR enabled');
      } else {
        logger.warn('[VFS-HMR] Service Worker not active, HMR disabled');
        _isEnabled = false;
      }

      return true;
    };

    /**
     * Handle VFS file changes
     */
    const handleFileChange = async (event) => {
      if (!_isEnabled) return;

      const { path, operation } = event;

      // Only handle JavaScript modules
      if (!path.endsWith('.js')) return;

      logger.info(`[VFS-HMR] File changed: ${path} (${operation})`);

      try {
        if (operation === 'write' || operation === 'update') {
          await reloadModule(path);
        } else if (operation === 'delete') {
          await unloadModule(path);
        }
      } catch (error) {
        logger.error(`[VFS-HMR] Failed to reload ${path}:`, error);
        EventBus.emit('hmr:error', { path, error: error.message });
      }
    };

    /**
     * Reload a module and all its dependents
     */
    const reloadModule = async (path) => {
      logger.info(`[VFS-HMR] Reloading module: ${path}`);

      // Invalidate Service Worker cache for this module
      await invalidateServiceWorkerCache(path);

      // Get all dependent modules
      const dependents = _dependencyGraph.get(path) || new Set();

      // Execute reload callback if registered
      const callback = _reloadCallbacks.get(path);
      if (callback) {
        try {
          await callback();
          logger.info(`[VFS-HMR] Executed reload callback for ${path}`);
        } catch (error) {
          logger.error(`[VFS-HMR] Reload callback failed for ${path}:`, error);
        }
      }

      // Re-import the module with cache busting
      try {
        const timestamp = Date.now();
        const moduleUrl = path + '?hmr=' + timestamp;

        // Dynamic import with cache busting
        const newModule = await import(moduleUrl);

        // Store in cache
        _moduleCache.set(path, newModule);

        EventBus.emit('hmr:module_reloaded', { path, timestamp });
        logger.info(`[VFS-HMR] Module reloaded: ${path}`);

        // Reload dependents recursively
        for (const dependentPath of dependents) {
          logger.info(`[VFS-HMR] Reloading dependent: ${dependentPath}`);
          await reloadModule(dependentPath);
        }
      } catch (error) {
        logger.error(`[VFS-HMR] Failed to import ${path}:`, error);
        throw error;
      }
    };

    /**
     * Unload a module
     */
    const unloadModule = async (path) => {
      logger.info(`[VFS-HMR] Unloading module: ${path}`);

      _moduleCache.delete(path);
      _reloadCallbacks.delete(path);
      _dependencyGraph.delete(path);

      await invalidateServiceWorkerCache(path);

      EventBus.emit('hmr:module_unloaded', { path });
    };

    /**
     * Invalidate Service Worker cache for a module
     */
    const invalidateServiceWorkerCache = async (path) => {
      if (!navigator.serviceWorker.controller) return;

      try {
        // Send message to Service Worker to invalidate cache
        const messageChannel = new MessageChannel();

        const response = await new Promise((resolve, reject) => {
          messageChannel.port1.onmessage = (event) => {
            if (event.data.success) {
              resolve(event.data);
            } else {
              reject(new Error('Cache invalidation failed'));
            }
          };

          navigator.serviceWorker.controller.postMessage({
            type: 'INVALIDATE_MODULE',
            data: { path }
          }, [messageChannel.port2]);

          // Timeout after 1 second
          setTimeout(() => reject(new Error('Timeout')), 1000);
        });

        logger.debug(`[VFS-HMR] Cache invalidated for ${path}`);
      } catch (error) {
        logger.warn(`[VFS-HMR] Failed to invalidate SW cache for ${path}:`, error.message);
      }
    };

    /**
     * Register a reload callback for a module
     * Useful for modules that need custom cleanup/reinitialization
     */
    const onReload = (path, callback) => {
      _reloadCallbacks.set(path, callback);
      logger.debug(`[VFS-HMR] Registered reload callback for ${path}`);
    };

    /**
     * Register module dependency
     * @param {string} modulePath - The module that imports
     * @param {string} dependencyPath - The module being imported
     */
    const registerDependency = (modulePath, dependencyPath) => {
      if (!_dependencyGraph.has(dependencyPath)) {
        _dependencyGraph.set(dependencyPath, new Set());
      }
      _dependencyGraph.get(dependencyPath).add(modulePath);

      logger.debug(`[VFS-HMR] Registered dependency: ${dependencyPath} -> ${modulePath}`);
    };

    /**
     * Clear all HMR state
     */
    const clear = () => {
      _moduleCache.clear();
      _dependencyGraph.clear();
      _reloadCallbacks.clear();
      logger.info('[VFS-HMR] Cache cleared');
    };

    /**
     * Get HMR statistics
     */
    const getStats = () => {
      return {
        enabled: _isEnabled,
        cachedModules: _moduleCache.size,
        dependencies: _dependencyGraph.size,
        callbacks: _reloadCallbacks.size,
        serviceWorkerActive: navigator.serviceWorker?.controller ? true : false
      };
    };

    /**
     * Enable/disable HMR
     */
    const setEnabled = (enabled) => {
      _isEnabled = enabled;
      logger.info(`[VFS-HMR] ${enabled ? 'Enabled' : 'Disabled'}`);
    };

    /**
     * Force reload all modules
     */
    const reloadAll = async () => {
      logger.info('[VFS-HMR] Reloading all modules...');

      const paths = Array.from(_moduleCache.keys());

      for (const path of paths) {
        try {
          await reloadModule(path);
        } catch (error) {
          logger.error(`[VFS-HMR] Failed to reload ${path}:`, error);
        }
      }

      logger.info(`[VFS-HMR] Reloaded ${paths.length} modules`);
    };

    return {
      init,
      onReload,
      registerDependency,
      reloadModule,
      reloadAll,
      clear,
      getStats,
      setEnabled
    };
  }
};

export default VFSHMR;
