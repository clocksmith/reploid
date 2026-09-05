#!/usr/bin/env node
/** Read-only source-bound registry audit. Every unresolved issue fails the command. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildInventory } from './build-module-inventory.js';
import { buildBlueprintRegistry, renderBlueprintInventory } from './build-blueprint-registry.js';
import { buildModuleRegistry } from './build-module-registry.js';

const filename = fileURLToPath(import.meta.url);
const SELF_DIR = path.resolve(path.dirname(filename), '../self');
const SEVERITY = { high: 0, medium: 1, low: 2 };

/**
 * Detect circular dependencies using DFS
 */
function findCircularDeps(modules) {
  const issues = [];
  const visited = new Set();
  const stack = new Set();

  function dfs(moduleId, path = []) {
    if (stack.has(moduleId)) {
      const cycleStart = path.indexOf(moduleId);
      const cycle = [...path.slice(cycleStart), moduleId];
      issues.push({ type: 'circular_dep', severity: 'high', cycle });
      return;
    }
    if (visited.has(moduleId)) return;

    visited.add(moduleId);
    stack.add(moduleId);
    path.push(moduleId);

    const mod = modules[moduleId];
    if (mod?.dependencies) {
      for (const dep of mod.dependencies) {
        if (!dep.optional) {
          dfs(dep.id, [...path]);
        }
      }
    }

    stack.delete(moduleId);
  }

  for (const moduleId of Object.keys(modules)) {
    dfs(moduleId);
  }

  return issues;
}

/**
 * Find modules that depend on non-existent modules
 */
function findMissingDeps(modules) {
  const issues = [];
  const moduleIds = new Set(Object.keys(modules));

  for (const [moduleId, mod] of Object.entries(modules)) {
    for (const dep of mod.dependencies || []) {
      if (!moduleIds.has(dep.id) && !dep.optional) {
        issues.push({
          type: 'missing_dep',
          severity: 'high',
          module: moduleId,
          missing: dep.id
        });
      }
    }
  }

  return issues;
}

/**
 * Find modules in registry but not in any genesis level
 */
function findOrphanModules(modules, genesisLevels) {
  const issues = [];
  const levelModules = new Set();

  for (const level of Object.values(genesisLevels.levels || {})) {
    for (const mod of level.modules || []) {
      levelModules.add(mod);
    }
  }

  for (const moduleId of Object.keys(modules)) {
    if (!levelModules.has(moduleId)) {
      issues.push({
        type: 'orphan_module',
        severity: 'medium',
        module: moduleId
      });
    }
  }

  return issues;
}


export function registryExitCode(report) {
  return report.issues.length ? 1 : 0;
}

export async function auditRegistry({ selfDir = SELF_DIR } = {}) {
  const load = async (name) => JSON.parse(await fs.readFile(path.join(selfDir, 'config', name + '.json'), 'utf8'));
  const [genesis, blueprints, registry, vfs, inventory, actual] = await Promise.all([
    load('genesis-levels'), load('blueprint-registry'), load('module-registry'),
    load('vfs-manifest'), load('module-inventory'), buildInventory({ selfDir })
  ]);
  const modules = registry.modules;
  const issues = [
    ...findCircularDeps(modules),
    ...findMissingDeps(modules),
    ...findOrphanModules(modules, genesis)
  ];
  const add = (type, details, severity = 'medium') => issues.push({ type, severity, ...details });
  for (const [name, value] of Object.entries({ blueprints, registry, vfs, inventory })) {
    if (value.version !== 1) add('unsupported_registry_version', { registry: name, version: value.version ?? null });
  }
  const actualByPath = new Map(actual.modules.map((entry) => [entry.path, entry]));
  const seen = new Set();
  for (const entry of inventory.modules) {
    if (seen.has(entry.path)) add('duplicate_inventory_file', { file: entry.path });
    seen.add(entry.path);
    if (!actualByPath.has(entry.path)) add('missing_source_file', { file: entry.path });
    else if (!isDeepStrictEqual(entry, actualByPath.get(entry.path))) add('stale_inventory_entry', { file: entry.path });
  }
  for (const file of actualByPath.keys()) {
    if (!seen.has(file)) add('uninventoried_source_file', { file });
  }
  const vfsFiles = new Set();
  for (const file of vfs.files) {
    if (vfsFiles.has(file)) add('duplicate_vfs_file', { file });
    vfsFiles.add(file);
    if (file.endsWith('.js') && !actualByPath.has(file)) add('vfs_missing_source', { file });
  }
  for (const file of actualByPath.keys()) {
    if (!vfsFiles.has(file)) add('source_missing_from_vfs', { file });
  }

  let declared;
  try {
    declared = await buildBlueprintRegistry({ selfDir, inventory: actual });
    const { generatedAt, ...recorded } = blueprints;
    if (!isDeepStrictEqual(recorded, declared.registry)) add('stale_blueprint_registry', {});
    const sitemap = await fs.readFile(path.join(selfDir, 'blueprints/canonical-inventory.md'), 'utf8');
    if (sitemap !== renderBlueprintInventory(declared.declarations)) add('stale_blueprint_inventory', {});
  } catch (error) {
    add('invalid_blueprint_declaration', { message: error.message });
  }
  try {
    const expected = await buildModuleRegistry({ selfDir, genesis, blueprintRegistry: declared?.registry || blueprints });
    const { generatedAt, ...recorded } = registry;
    if (!isDeepStrictEqual(recorded, expected)) add('stale_module_registry', {});
  } catch (error) {
    add('invalid_module_source', { message: error.message });
  }

  const levelOwners = new Map();
  for (const [levelName, level] of Object.entries(genesis.levels || {})) {
    for (const id of level.modules || []) {
      if (!(id in modules)) add('unregistered_genesis_module', { module: id });
      if (levelOwners.has(id)) add('duplicate_genesis_module', { module: id });
      levelOwners.set(id, levelName);
    }
  }
  const moduleFiles = new Set(Object.values(modules).flatMap((entry) => entry.files || []));
  for (const file of moduleFiles) {
    if (!actualByPath.has(file)) add('module_missing_source', { file });
  }
  const blueprintFiles = new Set((declared?.registry.features || []).flatMap((entry) => entry.files));
  // These are inventory categories, not ignored errors. Every file above must
  // still exist, match its recorded hash/imports/owner, and be shipped by VFS.
  const classifications = {
    inventoriedHelpers: [...actualByPath.keys()].filter((file) => !moduleFiles.has(file) && !blueprintFiles.has(file)).sort(),
    modulesWithoutArchitecturalBlueprint: Object.entries(modules).filter(([, entry]) => entry.blueprint === null).map(([id]) => id).sort()
  };
  issues.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    schema: 'reploid.registry-audit/v1',
    counts: {
      sourceFiles: actual.modules.length, modules: Object.keys(modules).length,
      blueprintDeclarations: declared?.declarations.length ?? null,
      executableOwners: declared?.registry.features.length ?? null,
      unresolved: issues.length
    },
    classifications, issues
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--json')) throw new Error('Usage: validate-registry.js [--json]');
  const report = await auditRegistry();
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const issue of report.issues) console.log('[validate] ' + issue.severity + ': ' + JSON.stringify(issue));
    console.log('[validate] ' + JSON.stringify(report.counts));
    console.log('[validate] Inventoried helpers: ' + report.classifications.inventoriedHelpers.length
      + '; modules without an architectural blueprint: ' + report.classifications.modulesWithoutArchitecturalBlueprint.length);
  }
  process.exitCode = registryExitCode(report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) main().catch((error) => {
  console.error('[validate] Failed:', error.message);
  process.exitCode = 1;
});
