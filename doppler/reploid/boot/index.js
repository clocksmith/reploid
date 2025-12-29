/**
 * @fileoverview REPLOID Boot Orchestrator
 * Slim entry point that coordinates the boot sequence.
 */

import { loadGenesisConfig, getGenesisLevel, resolveModules, getLevelConfig } from './config.js';
import { loadExternalDependencies, registerModules } from './modules.js';
import { resetSession, seedCodeIntel, hydrateVFS } from './vfs-hydrate.js';
import { createGenesisSnapshot, initializeSwarm, resolveServices, setupExportFunctions } from './services.js';
import { initIframeBridge } from './iframe-bridge.js';
import { renderErrorUI } from './error-ui.js';

/**
 * Main boot sequence.
 * @param {Object} Utils - Utils module
 * @param {Object} DIContainer - DI Container module
 * @returns {Promise<Object>} Boot result with container and services
 */
export async function boot(Utils, DIContainer) {
  const logger = Utils.factory().logger;
  logger.info('[Boot] Starting REPLOID System...');

  // Check for full reset
  if (typeof window.shouldResetAll === 'function' && window.shouldResetAll()) {
    logger.info('[Boot] Full reset requested...');
    try {
      await window.performFullReset();
      localStorage.setItem('REPLOID_RESET_ALL', 'false');
    } catch (e) {
      logger.warn('[Boot] Full reset failed:', e.message);
    }
  }

  // Initialize iframe bridge
  initIframeBridge(logger);

  // Load configuration
  const genesisConfig = await loadGenesisConfig();
  const genesisLevel = getGenesisLevel(genesisConfig);
  const levelConfig = getLevelConfig(genesisLevel, genesisConfig);
  const resolvedModules = resolveModules(genesisLevel, genesisConfig);

  logger.info(`[Boot] Genesis level: ${levelConfig.name} (${resolvedModules.length} modules)`);

  // Create DI container
  const container = DIContainer.factory({ Utils: Utils.factory() });

  // Load external dependencies (Transformers.js etc.)
  await loadExternalDependencies(resolvedModules, genesisConfig.moduleFiles, logger);

  // Register modules (parallel loading)
  await registerModules(resolvedModules, genesisConfig, container, logger);

  // Initialize VFS
  const vfs = await container.resolve('VFS');

  // Reset session artifacts
  await resetSession(vfs, genesisConfig, genesisLevel, logger);

  // Seed essential files
  await seedCodeIntel(vfs, logger);

  // Hydrate VFS with source files
  await hydrateVFS(vfs, genesisConfig, resolvedModules, genesisLevel, logger);

  // Create genesis snapshot
  await createGenesisSnapshot(container, logger);

  // Initialize swarm if enabled
  await initializeSwarm(container, resolvedModules, logger);

  // Resolve core services and expose globals
  const services = await resolveServices(container, logger);

  // Setup import/export functions
  setupExportFunctions(container, logger);

  logger.info('[Boot] Core System Ready.');

  return {
    container,
    genesisConfig,
    genesisLevel,
    resolvedModules,
    ...services
  };
}

// Re-export error UI for use in boot.js
export { renderErrorUI };
