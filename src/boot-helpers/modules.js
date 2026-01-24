/**
 * @fileoverview Module Registration
 * Parallel loading and registration of modules into DI container.
 */

/**
 * Resolve module file path.
 * Module paths in genesis-levels.json are relative to src/ (e.g., "core/vfs.js").
 * Since this file is in src/boot-helpers/, we need to go up one level.
 * @param {string} filePath - Relative file path from src/
 * @returns {string} Resolved path for import
 */
const resolveModulePath = (filePath) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return filePath;
  }
  // Paths are relative to src/, but we're in src/boot-helpers/, so go up one level
  return `../${filePath}`;
};

/**
 * Load a single module definition.
 * @param {string} moduleName - Module name
 * @param {Object} moduleFiles - Module file mappings
 * @returns {Promise<Object|null>} Module definition or null
 */
async function loadModuleDefinition(moduleName, moduleFiles) {
  const files = moduleFiles[moduleName];
  if (!files || files.length === 0) return null;

  const entryFile = files[0];
  const mod = await import(resolveModulePath(entryFile));
  return mod.default || mod;
}

/**
 * Load external dependencies required by modules.
 * @param {string[]} resolvedModules - List of module names
 * @param {Object} moduleFiles - Module file mappings
 * @param {Function} logger - Logger function
 * @returns {Promise<void>}
 */
export async function loadExternalDependencies(resolvedModules, moduleFiles, logger) {
  // Check if any module requires Transformers.js
  const needsTransformers = resolvedModules.some(mod =>
    ['SemanticMemory', 'TransformersClient', 'EmbeddingStore'].includes(mod)
  );

  if (needsTransformers) {
    logger.info('[Boot] Loading Transformers.js for semantic capabilities...');
    try {
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
      env.backends.onnx.wasm.proxy = false;
      window.transformers = { pipeline, env };
      logger.info('[Boot] Transformers.js loaded');
    } catch (e) {
      logger.warn('[Boot] Failed to load Transformers.js:', e.message);
    }
  } else {
    logger.info('[Boot] Skipping Transformers.js (not needed for this genesis level)');
  }
}

/**
 * Register all modules in parallel.
 * @param {string[]} resolvedModules - List of module names to register
 * @param {Object} genesisConfig - Genesis configuration
 * @param {Object} container - DI container
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
export async function registerModules(resolvedModules, genesisConfig, container, logger) {
  const moduleFiles = genesisConfig?.moduleFiles || {};

  logger.info(`[Boot] Registering ${resolvedModules.length} modules (parallel)...`);

  // Load all module definitions in parallel
  const loadPromises = resolvedModules.map(async (moduleName) => {
    try {
      const definition = await loadModuleDefinition(moduleName, moduleFiles);
      return { moduleName, definition, error: null };
    } catch (err) {
      return { moduleName, definition: null, error: err };
    }
  });

  const results = await Promise.all(loadPromises);

  // Register modules (must be sequential for DI container)
  for (const { moduleName, definition, error } of results) {
    if (error) {
      logger.error(`[Boot] Failed to load module "${moduleName}":`, error);
      continue;
    }
    if (!definition) {
      logger.warn(`[Boot] Module "${moduleName}" not found in config`);
      continue;
    }
    if (!definition.metadata?.id) {
      logger.warn(`[Boot] Module "${moduleName}" has no metadata.id, skipping`);
      continue;
    }
    container.register(definition);
  }

  logger.info('[Boot] Module registration complete');
}
