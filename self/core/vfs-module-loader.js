/**
 * @fileoverview VFS Module Loader
 * Loads ESM modules from VFS using blob URLs with optional verification.
 * Supports caching, verification, retry logic, and import rewriting.
 */

import { isSecurityEnabled } from './security-config.js';

const moduleCache = new Map();
const loadingPromises = new Map(); // Prevent duplicate concurrent loads

// Statistics for monitoring
const stats = {
  loads: 0,
  cacheHits: 0,
  cacheMisses: 0,
  verificationPasses: 0,
  verificationFailures: 0,
  errors: 0
};

/**
 * Get cached module if valid
 */
const getCached = (path, code, forceReload) => {
  if (forceReload) return null;
  const cached = moduleCache.get(path);
  if (!cached || cached.code !== code) return null;
  stats.cacheHits++;
  return cached.module;
};

/**
 * Store module in cache
 */
const setCached = (path, code, mod) => {
  moduleCache.set(path, {
    code,
    module: mod,
    timestamp: Date.now(),
    size: code.length
  });
};

/**
 * Rewrite VFS imports to use blob URLs
 * Converts: import { foo } from '/tools/bar.js'
 * To inline blob URL that can be resolved
 */
const rewriteImports = (code, basePath, vfsResolver) => {
  if (!vfsResolver) return code;

  // Match import statements with VFS paths
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"](\/(tools|core|infrastructure|capabilities|ui)\/[^'"]+)['"]/g;

  return code.replace(importRegex, (match, importPath) => {
    // For now, keep original - full resolution requires async which complicates things
    // This is a placeholder for future enhancement
    return match;
  });
};

/**
 * Normalize module path
 */
const normalizePath = (path) => {
  if (!path.startsWith('/')) path = '/' + path;
  if (!path.endsWith('.js') && !path.endsWith('.mjs')) path += '.js';
  return path;
};

/**
 * Load an ES module from VFS
 * @param {Object} options - Load options
 * @param {Object} options.VFS - VFS instance (required)
 * @param {Function} options.logger - Logger instance
 * @param {Object} options.VerificationManager - Optional verification
 * @param {Object} options.EventBus - Optional event bus for load events
 * @param {string} options.path - VFS path to module (required)
 * @param {string} options.code - Optional pre-loaded code
 * @param {boolean} options.verify - Run verification (default: false)
 * @param {boolean} options.forceReload - Bypass cache (default: false)
 * @param {number} options.retries - Retry count on failure (default: 0)
 * @param {number} options.retryDelay - Delay between retries in ms (default: 100)
 * @returns {Promise<Object>} - The imported module
 */
export async function loadVfsModule(options) {
  const {
    VFS,
    logger,
    VerificationManager,
    EventBus,
    path: rawPath,
    code,
    verify = false,
    forceReload = false,
    retries = 0,
    retryDelay = 100
  } = options || {};

  if (!VFS) throw new Error('VFS is required');
  if (!rawPath || typeof rawPath !== 'string') throw new Error('Invalid module path');

  const path = normalizePath(rawPath);
  stats.loads++;

  // Prevent duplicate concurrent loads of same module
  if (loadingPromises.has(path) && !forceReload) {
    return loadingPromises.get(path);
  }

  const loadPromise = (async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Read module content
        const contents = code === undefined ? await VFS.read(path) : code;

        if (contents === null || contents === undefined) {
          throw new Error(`Module not found: ${path}`);
        }

        // Check cache
        const cached = getCached(path, contents, forceReload);
        if (cached) {
          if (EventBus) EventBus.emit('vfs:module_loaded', { path, cached: true });
          return cached;
        }
        stats.cacheMisses++;

        // Verification
        if (verify && VerificationManager && isSecurityEnabled()) {
          const result = await VerificationManager.verifyProposal({ [path]: contents });
          if (!result?.passed) {
            stats.verificationFailures++;
            const errors = result?.errors?.length ? `: ${result.errors.join('; ')}` : '';
            const err = new Error(`Verification failed for ${path}${errors}`);
            err.verificationResult = result;
            throw err;
          }
          stats.verificationPasses++;
          if (result?.warnings?.length && logger) {
            logger.warn(`[VFSLoader] Verification warnings for ${path}: ${result.warnings.join('; ')}`);
          }
        }

        // Create blob URL and import
        const blob = new Blob([contents], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);

        try {
          const mod = await import(url);
          setCached(path, contents, mod);

          if (logger) logger.debug(`[VFSLoader] Loaded: ${path}`);
          if (EventBus) EventBus.emit('vfs:module_loaded', { path, cached: false, size: contents.length });

          return mod;
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        lastError = err;
        stats.errors++;

        if (attempt < retries) {
          if (logger) logger.warn(`[VFSLoader] Retry ${attempt + 1}/${retries} for ${path}: ${err.message}`);
          await new Promise(r => setTimeout(r, retryDelay));
        }
      }
    }

    // All retries failed
    if (EventBus) EventBus.emit('vfs:module_error', { path, error: lastError.message });
    throw lastError;
  })();

  loadingPromises.set(path, loadPromise);

  try {
    return await loadPromise;
  } finally {
    loadingPromises.delete(path);
  }
}

/**
 * Clear module cache
 * @param {string|null} path - Specific path to clear, or null for all
 */
export function clearVfsModuleCache(path = null) {
  if (!path) {
    moduleCache.clear();
    return { cleared: 'all' };
  }
  const normalizedPath = normalizePath(path);
  const existed = moduleCache.has(normalizedPath);
  moduleCache.delete(normalizedPath);
  return { cleared: normalizedPath, existed };
}

/**
 * Get cache statistics
 * @returns {Object} Cache and load statistics
 */
export function getVfsModuleStats() {
  const cacheEntries = Array.from(moduleCache.entries()).map(([path, entry]) => ({
    path,
    size: entry.size,
    timestamp: entry.timestamp
  }));

  return {
    ...stats,
    cacheSize: moduleCache.size,
    cacheTotalBytes: cacheEntries.reduce((sum, e) => sum + (e.size || 0), 0),
    cacheEntries
  };
}

/**
 * Check if module is cached
 * @param {string} path - Module path
 * @returns {boolean}
 */
export function isModuleCached(path) {
  return moduleCache.has(normalizePath(path));
}

/**
 * Preload multiple modules
 * @param {Object} options - Base options (VFS, logger, etc.)
 * @param {string[]} paths - Array of paths to preload
 * @returns {Promise<Object>} Results map { path: module | error }
 */
export async function preloadModules(options, paths) {
  const results = {};

  await Promise.all(paths.map(async (path) => {
    try {
      results[path] = await loadVfsModule({ ...options, path });
    } catch (err) {
      results[path] = { error: err.message };
    }
  }));

  return results;
}

/**
 * Reset statistics (for testing)
 */
export function resetVfsModuleStats() {
  stats.loads = 0;
  stats.cacheHits = 0;
  stats.cacheMisses = 0;
  stats.verificationPasses = 0;
  stats.verificationFailures = 0;
  stats.errors = 0;
}
