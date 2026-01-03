#!/usr/bin/env node
/**
 * Validates config JSON files for issues.
 * Prints issues to stdout, exits with code 1 if high severity issues found.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'src', 'config');

const SEVERITY = { high: 0, medium: 1, low: 2 };

async function loadJSON(filename) {
  const content = await fs.readFile(path.join(CONFIG_DIR, filename), 'utf8');
  return JSON.parse(content);
}

function log(type, severity, message) {
  console.log(`[validate] ${severity}: ${type} - ${message}`);
}

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

/**
 * Find files in VFS manifest not referenced by any module or blueprint
 */
function findOrphanFiles(vfsManifest, modules, blueprintRegistry) {
  const issues = [];
  const referencedFiles = new Set();

  // Collect files from modules
  for (const mod of Object.values(modules)) {
    for (const file of mod.files || []) {
      referencedFiles.add(file);
    }
  }

  // Collect files from blueprints
  for (const feature of blueprintRegistry.features || []) {
    for (const file of feature.files || []) {
      referencedFiles.add(file);
    }
    for (const bp of feature.blueprints || []) {
      if (bp.path) referencedFiles.add(bp.path);
    }
  }

  // Check VFS files
  for (const file of vfsManifest.files || []) {
    // Skip config files, tools, ui, boot - they're not modules
    if (file.startsWith('config/')) continue;
    if (file.startsWith('tools/')) continue;
    if (file.startsWith('ui/')) continue;
    if (file.startsWith('boot/')) continue;
    if (file.startsWith('blueprints/')) continue;
    if (file.startsWith('styles/')) continue;
    if (!file.endsWith('.js')) continue;

    if (!referencedFiles.has(file)) {
      issues.push({
        type: 'orphan_file',
        severity: 'low',
        file
      });
    }
  }

  return issues;
}

/**
 * Find modules without blueprint mappings
 */
function findMissingBlueprints(modules) {
  const issues = [];

  for (const [moduleId, mod] of Object.entries(modules)) {
    if (!mod.blueprint) {
      issues.push({
        type: 'missing_blueprint',
        severity: 'low',
        module: moduleId
      });
    }
  }

  return issues;
}

/**
 * Find blueprints referencing non-existent files
 */
async function findStaleBlueprints(blueprintRegistry) {
  const issues = [];
  const srcDir = path.join(ROOT, 'src');

  for (const feature of blueprintRegistry.features || []) {
    for (const file of feature.files || []) {
      try {
        await fs.access(path.join(srcDir, file));
      } catch {
        issues.push({
          type: 'stale_blueprint',
          severity: 'medium',
          blueprint: feature.id,
          file
        });
      }
    }
  }

  return issues;
}

async function main() {
  console.log('[validate] Loading config files...');

  const [genesisLevels, blueprintRegistry, moduleRegistry, vfsManifest] = await Promise.all([
    loadJSON('genesis-levels.json'),
    loadJSON('blueprint-registry.json'),
    loadJSON('module-registry.json'),
    loadJSON('vfs-manifest.json')
  ]);

  const modules = moduleRegistry.modules || {};
  const allIssues = [];

  console.log('[validate] Checking for circular dependencies...');
  allIssues.push(...findCircularDeps(modules));

  console.log('[validate] Checking for missing dependencies...');
  allIssues.push(...findMissingDeps(modules));

  console.log('[validate] Checking for orphan modules...');
  allIssues.push(...findOrphanModules(modules, genesisLevels));

  console.log('[validate] Checking for orphan files...');
  allIssues.push(...findOrphanFiles(vfsManifest, modules, blueprintRegistry));

  console.log('[validate] Checking for missing blueprints...');
  allIssues.push(...findMissingBlueprints(modules));

  console.log('[validate] Checking for stale blueprints...');
  allIssues.push(...await findStaleBlueprints(blueprintRegistry));

  // Sort by severity
  allIssues.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);

  console.log('');
  if (allIssues.length === 0) {
    console.log('[validate] No issues found.');
  } else {
    console.log(`[validate] Found ${allIssues.length} issues:\n`);
    for (const issue of allIssues) {
      switch (issue.type) {
        case 'circular_dep':
          log(issue.type, issue.severity, issue.cycle.join(' -> '));
          break;
        case 'missing_dep':
          log(issue.type, issue.severity, `${issue.module} depends on ${issue.missing}`);
          break;
        case 'orphan_module':
          log(issue.type, issue.severity, `${issue.module} not in any genesis level`);
          break;
        case 'orphan_file':
          log(issue.type, issue.severity, issue.file);
          break;
        case 'missing_blueprint':
          log(issue.type, issue.severity, `${issue.module} has no blueprint`);
          break;
        case 'stale_blueprint':
          log(issue.type, issue.severity, `${issue.blueprint} references missing ${issue.file}`);
          break;
        default:
          log(issue.type, issue.severity, JSON.stringify(issue));
      }
    }
  }

  const highCount = allIssues.filter(i => i.severity === 'high').length;
  if (highCount > 0) {
    console.log(`\n[validate] ${highCount} high severity issues. Exiting with code 1.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[validate] Failed:', err.message);
  process.exit(1);
});
