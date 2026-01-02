/**
 * @fileoverview Genesis Configuration Loader
 * Loads and validates genesis-levels.json, resolves module inheritance.
 */

/**
 * Load genesis configuration from server.
 * @returns {Promise<Object>} Genesis config object
 */
export async function loadGenesisConfig() {
  const response = await fetch('../config/genesis-levels.json');
  if (!response.ok) {
    throw new Error('Failed to load genesis configuration');
  }
  return response.json();
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
 * @returns {string[]} Array of module names
 */
export function resolveModules(levelName, genesisConfig) {
  const resolve = (name, visited = new Set()) => {
    if (visited.has(name)) {
      throw new Error(`Circular extends detected: ${[...visited, name].join(' -> ')}`);
    }
    visited.add(name);

    const level = genesisConfig.levels[name];
    if (!level) return [];

    const parentModules = level.extends ? resolve(level.extends, visited) : [];
    return [...parentModules, ...level.modules];
  };

  return resolve(levelName);
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
