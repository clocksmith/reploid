/**
 * @fileoverview Module resolution helpers for genesis levels and overrides.
 */

export const GENESIS_LEVEL_ORDER = ['tabula', 'spark', 'reflection', 'cognition', 'substrate', 'full'];

export const AWAKEN_REQUIRED_MODULES = [
  'VFS',
  'StateManager',
  'ToolRunner',
  'SchemaRegistry',
  'TelemetryTimeline',
  'AgentLoop',
  'LLMClient'
];

export function resolveBaseModules(levelName, genesisConfig) {
  const resolve = (name, visited = new Set()) => {
    if (visited.has(name)) {
      throw new Error(`Circular extends detected: ${[...visited, name].join(' -> ')}`);
    }
    visited.add(name);

    const level = genesisConfig?.levels?.[name];
    if (!level) return [];

    const parentModules = level.extends ? resolve(level.extends, visited) : [];
    return [...parentModules, ...(level.modules || [])];
  };

  return resolve(levelName);
}

export function normalizeOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return {};
  const normalized = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value === 'on' || value === 'off') {
      normalized[key] = value;
    }
  }
  return normalized;
}

export function serializeModuleOverrides(overrides) {
  const normalized = normalizeOverrides(overrides);
  const ordered = {};
  for (const key of Object.keys(normalized).sort()) {
    ordered[key] = normalized[key];
  }
  return JSON.stringify(ordered);
}

const getRegistryEntry = (registry, moduleName) => {
  if (!registry) return null;
  if (registry.modules && registry.modules[moduleName]) return registry.modules[moduleName];
  return registry[moduleName] || null;
};

const getRequiredDeps = (registry, moduleName) => {
  const entry = getRegistryEntry(registry, moduleName);
  const deps = Array.isArray(entry?.dependencies) ? entry.dependencies : [];
  return deps
    .filter(dep => dep && dep.id && !dep.optional)
    .map(dep => dep.id);
};

export function applyModuleOverrides(baseModules, moduleRegistry, overrides) {
  const baseSet = new Set(baseModules || []);
  const normalized = normalizeOverrides(overrides);
  const forcedOn = new Set(Object.keys(normalized).filter((key) => normalized[key] === 'on'));
  const forcedOff = new Set(Object.keys(normalized).filter((key) => normalized[key] === 'off'));
  const desired = new Set([...baseSet, ...forcedOn]);

  const resolved = new Set(desired);
  let changed = true;
  while (changed) {
    changed = false;

    for (const mod of Array.from(resolved)) {
      if (forcedOff.has(mod)) {
        resolved.delete(mod);
        changed = true;
        continue;
      }

      const deps = getRequiredDeps(moduleRegistry, mod);
      for (const dep of deps) {
        if (forcedOff.has(dep)) {
          resolved.delete(mod);
          changed = true;
          break;
        }
        if (!resolved.has(dep)) {
          resolved.add(dep);
          changed = true;
        }
      }
    }

    for (const mod of Array.from(resolved)) {
      const deps = getRequiredDeps(moduleRegistry, mod);
      const missing = deps.filter(dep => !resolved.has(dep));
      if (missing.length > 0) {
        resolved.delete(mod);
        changed = true;
      }
    }
  }

  const added = new Set([...resolved].filter(mod => !baseSet.has(mod)));
  const removed = new Set([...baseSet].filter(mod => !resolved.has(mod)));
  const missingDeps = {};
  for (const mod of desired) {
    const deps = getRequiredDeps(moduleRegistry, mod);
    const missing = deps.filter(dep => !resolved.has(dep));
    if (missing.length > 0) {
      missingDeps[mod] = missing;
    }
  }

  return {
    resolved: Array.from(resolved),
    added: Array.from(added),
    removed: Array.from(removed),
    forcedOn: Array.from(forcedOn),
    forcedOff: Array.from(forcedOff),
    missingDeps
  };
}

export function getMissingModules(requiredModules, resolvedModules) {
  const resolvedSet = new Set(resolvedModules || []);
  return (requiredModules || []).filter((name) => !resolvedSet.has(name));
}
