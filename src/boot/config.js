/**
 * @fileoverview Genesis Configuration Loader
 * Loads and validates genesis-levels.json, resolves module inheritance.
 */

import { applyModuleOverrides, normalizeOverrides, resolveBaseModules } from '../config/module-resolution.js';
import { readVfsFile } from './vfs-bootstrap.js';

const readJsonFromVfs = async (path) => {
  const content = await readVfsFile(path);
  if (!content) {
    throw new Error(`Missing VFS config: ${path}`);
  }
  return JSON.parse(content);
};

/**
 * Load genesis configuration from server.
 * @returns {Promise<Object>} Genesis config object
 */
export async function loadGenesisConfig() {
  return readJsonFromVfs('/config/genesis-levels.json');
}

/**
 * Load module registry from server.
 * @returns {Promise<Object|null>} Module registry or null when unavailable
 */
export async function loadModuleRegistry() {
  try {
    return await readJsonFromVfs('/config/module-registry.json');
  } catch {
    return null;
  }
}

/**
 * Read module overrides from localStorage.
 * @returns {Object} Normalized module overrides
 */
export function getModuleOverrides() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('REPLOID_MODULE_OVERRIDES');
    if (!raw) return {};
    return normalizeOverrides(JSON.parse(raw));
  } catch (e) {
    return {};
  }
}

/**
 * Get the active genesis level from localStorage.
 * @param {Object} genesisConfig - Full genesis config
 * @returns {string} Valid genesis level name
 */
export function getGenesisLevel(genesisConfig) {
  const validLevels = Object.keys(genesisConfig.levels || {});
  const defaultLevel = genesisConfig.defaultLevel || validLevels[0] || 'tabula';
  let level = localStorage.getItem('REPLOID_GENESIS_LEVEL');

  if (!level || !validLevels.includes(level)) {
    if (level) {
      console.warn(`[Boot] Unknown genesis level: ${level}, falling back to ${defaultLevel}`);
    }
    level = defaultLevel;
    if (localStorage.getItem('REPLOID_GENESIS_LEVEL') !== level) {
      localStorage.setItem('REPLOID_GENESIS_LEVEL', level);
    }
  }

  return level;
}

/**
 * Resolve the extends chain to get full module list.
 * @param {string} levelName - Genesis level name
 * @param {Object} genesisConfig - Full genesis config
 * @param {Object|null} moduleRegistry - Module registry data
 * @param {Object|null} overrides - Module override map
 * @returns {string[]} Array of module names
 */
export function resolveModules(levelName, genesisConfig, moduleRegistry = null, overrides = null) {
  const baseModules = resolveBaseModules(levelName, genesisConfig);
  const normalized = normalizeOverrides(overrides);
  if (!moduleRegistry || Object.keys(normalized).length === 0) {
    return baseModules;
  }

  const resolution = applyModuleOverrides(baseModules, moduleRegistry, normalized);
  return resolution.resolved;
}

/**
 * Get level configuration object.
 * @param {string} levelName - Genesis level name
 * @param {Object} genesisConfig - Full genesis config
 * @returns {Object} Level configuration
 */
export function getLevelConfig(levelName, genesisConfig) {
  const config = genesisConfig.levels[levelName];
  if (!config) {
    const validLevels = Object.keys(genesisConfig.levels);
    throw new Error(`Genesis level "${levelName}" not found. Available: ${validLevels.join(', ')}`);
  }
  return config;
}

/**
 * Build the set of core tools for a genesis level.
 * @param {Object} genesisConfig - Full genesis config
 * @param {string} level - Genesis level name
 * @returns {Set<string>} Set of tool names
 */
export function buildCoreToolSet(genesisConfig, level) {
  const getToolName = (toolPath) => toolPath.split('/').pop().replace(/\.js$/, '');
  const core = new Set();

  const sharedTools = genesisConfig?.sharedFiles?.tools || [];
  for (const toolPath of sharedTools) {
    core.add(getToolName(toolPath));
  }

  const levelTools = genesisConfig?.levelFiles?.[level]?.tools || [];
  for (const toolPath of levelTools) {
    core.add(getToolName(toolPath));
  }

  return core;
}
