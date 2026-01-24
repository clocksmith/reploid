/**
 * @fileoverview REPLOID Boot Orchestrator
 * Slim entry point that coordinates the boot sequence.
 */

import {
  loadGenesisConfig,
  loadModuleRegistry,
  getGenesisLevel,
  getModuleOverrides,
  resolveModules,
  getLevelConfig
} from './config.js';
import { AWAKEN_REQUIRED_MODULES, getMissingModules } from '../config/module-resolution.js';
import { loadExternalDependencies, registerModules } from './modules.js';
import { resetSession } from './vfs-hydrate.js';
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

  // Initialize iframe bridge
  initIframeBridge(logger);

  // Load configuration
  const genesisConfig = await loadGenesisConfig();
  const genesisLevel = getGenesisLevel(genesisConfig);
  const levelConfig = getLevelConfig(genesisLevel, genesisConfig);
  const moduleRegistry = await loadModuleRegistry();
  const moduleOverrides = getModuleOverrides();
  const resolvedModules = resolveModules(genesisLevel, genesisConfig, moduleRegistry, moduleOverrides);

  logger.info(`[Boot] Genesis level: ${levelConfig.name} (${resolvedModules.length} modules)`);
  const missingModules = getMissingModules(AWAKEN_REQUIRED_MODULES, resolvedModules);
  if (missingModules.length > 0) {
    throw new Error(`Genesis configuration missing required modules: ${missingModules.join(', ')}. ` +
      'Select a higher genesis level or update module overrides.');
  }

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

  // VFS is seeded in bootstrap before boot runs

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

// Re-export error UI for use in entry/start-app.js
export { renderErrorUI };
