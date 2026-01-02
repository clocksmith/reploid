#!/usr/bin/env node
/**
 * Verifies module system invariants: hydration, blueprints, and genesis levels.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

const GENESIS_PATH = path.join(SRC_DIR, 'config', 'genesis-levels.json');
const MANIFEST_PATH = path.join(SRC_DIR, 'config', 'vfs-manifest.json');
const BLUEPRINT_REGISTRY_PATH = path.join(SRC_DIR, 'config', 'blueprint-registry.json');
const BLUEPRINT_DIR = path.join(SRC_DIR, 'blueprints');

const toPosix = (p) => p.split(path.sep).join('/');

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractMetadataId(content) {
  const match = content.match(/\bmetadata\b\s*[:=]\s*\{/);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  const block = content.slice(start, i - 1);
  const idMatch = block.match(/\bid\b\s*:\s*['"]([^'"]+)['"]/);
  return idMatch ? idMatch[1] : null;
}

function extractGenesisLevel(content) {
  const match = content.match(/genesis:\s*\{\s*introduced:\s*'([^']+)'\s*\}/);
  return match ? match[1] : null;
}

function parseBlueprintId(filename) {
  const match = filename.match(/^(0x[0-9A-Fa-f]{6})/);
  return match ? match[1] : null;
}

async function main() {
  const errors = [];

  const allFiles = await walkFiles(SRC_DIR);
  const allRelFiles = allFiles.map((file) => toPosix(path.relative(SRC_DIR, file)));
  const allRelSet = new Set(allRelFiles);

  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  const manifestSet = new Set(manifestFiles);

  for (const file of allRelSet) {
    if (!manifestSet.has(file)) {
      errors.push(`VFS manifest missing: ${file}`);
    }
  }
  for (const file of manifestSet) {
    if (!allRelSet.has(file)) {
      errors.push(`VFS manifest has extra entry: ${file}`);
    }
  }

  const jsFiles = allRelFiles.filter((file) =>
    file.endsWith('.js') && !file.startsWith('blueprints/')
  );
  const jsSet = new Set(jsFiles);

  const registry = JSON.parse(await fs.readFile(BLUEPRINT_REGISTRY_PATH, 'utf8'));
  const features = Array.isArray(registry.features) ? registry.features : [];

  const fileCoverage = new Map();

  for (const feature of features) {
    const blueprintEntries = Array.isArray(feature.blueprints) ? feature.blueprints : [];
    for (const entry of blueprintEntries) {
      const bpPath = entry?.path;
      const bpId = entry?.id;
      if (!bpPath || !bpId) {
        errors.push(`Blueprint entry missing id/path in feature ${feature.id || 'unknown'}`);
        continue;
      }
      if (!allRelSet.has(bpPath)) {
        errors.push(`Blueprint path missing: ${bpPath}`);
      }
      const fileId = parseBlueprintId(path.basename(bpPath));
      if (!fileId || fileId.toLowerCase() !== bpId.toLowerCase()) {
        errors.push(`Blueprint id mismatch for ${bpPath}: expected ${bpId}`);
      }
    }

    const files = Array.isArray(feature.files) ? feature.files : [];
    for (const file of files) {
      if (!jsSet.has(file)) {
        errors.push(`Blueprint registry references unknown JS file: ${file}`);
        continue;
      }
      if (fileCoverage.has(file)) {
        errors.push(`Blueprint registry lists file multiple times: ${file}`);
      } else {
        fileCoverage.set(file, feature.id || 'unknown');
      }
    }
  }

  for (const file of jsSet) {
    if (!fileCoverage.has(file)) {
      errors.push(`Blueprint registry missing JS file: ${file}`);
    }
  }

  const genesis = JSON.parse(await fs.readFile(GENESIS_PATH, 'utf8'));
  const levels = genesis.levels || {};
  const moduleFiles = genesis.moduleFiles || {};

  const moduleToLevel = new Map();
  for (const [levelName, level] of Object.entries(levels)) {
    const modules = Array.isArray(level.modules) ? level.modules : [];
    for (const mod of modules) {
      if (moduleToLevel.has(mod)) {
        errors.push(`Module appears in multiple levels: ${mod}`);
      } else {
        moduleToLevel.set(mod, levelName);
      }
    }
  }

  for (const [moduleName, levelName] of moduleToLevel.entries()) {
    const files = moduleFiles[moduleName];
    if (!files || files.length === 0) {
      errors.push(`Module missing moduleFiles entry: ${moduleName}`);
      continue;
    }
    const entryFile = files[0];
    if (!allRelSet.has(entryFile)) {
      errors.push(`Module entry file missing: ${moduleName} -> ${entryFile}`);
      continue;
    }
    const content = await fs.readFile(path.join(SRC_DIR, entryFile), 'utf8');
    const metadataId = extractMetadataId(content);
    if (!metadataId) {
      errors.push(`Module entry missing metadata.id: ${entryFile}`);
    } else if (metadataId !== moduleName) {
      errors.push(`Module id mismatch for ${entryFile}: expected ${moduleName}, got ${metadataId}`);
    }
    const genesisLevel = extractGenesisLevel(content);
    if (!genesisLevel) {
      errors.push(`Module entry missing metadata.genesis.introduced: ${entryFile}`);
    } else if (genesisLevel !== levelName) {
      errors.push(`Genesis level mismatch for ${entryFile}: expected ${levelName}, got ${genesisLevel}`);
    }
  }

  for (const moduleName of Object.keys(moduleFiles)) {
    if (!moduleToLevel.has(moduleName)) {
      errors.push(`moduleFiles entry not assigned to any level: ${moduleName}`);
    }
  }

  for (const [levelName, level] of Object.entries(levels)) {
    if (!level.extends) continue;
    const resolved = new Set();
    let current = levelName;
    while (current) {
      const lvl = levels[current];
      if (!lvl) break;
      (lvl.modules || []).forEach((mod) => resolved.add(mod));
      current = lvl.extends || null;
    }

    const parentLevel = levels[level.extends];
    const parentModules = new Set(parentLevel?.modules || []);
    for (const mod of parentModules) {
      if (!resolved.has(mod)) {
        errors.push(`Level ${levelName} does not include parent module: ${mod}`);
      }
    }
    if (resolved.size === parentModules.size) {
      errors.push(`Level ${levelName} is not a strict superset of ${level.extends}`);
    }
  }

  if (errors.length > 0) {
    console.error('[verify-module-system] Errors:');
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  }

  console.log('[verify-module-system] All checks passed');
}

main().catch((err) => {
  console.error('[verify-module-system] Failed to run checks');
  console.error(err);
  process.exit(1);
});
