#!/usr/bin/env node
/**
 * Generates src/config/module-registry.json from module metadata.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const GENESIS_PATH = path.join(SRC_DIR, 'config', 'genesis-levels.json');
const BLUEPRINT_REGISTRY_PATH = path.join(SRC_DIR, 'config', 'blueprint-registry.json');
const OUTPUT_PATH = path.join(SRC_DIR, 'config', 'module-registry.json');

const toPosix = (p) => p.split(path.sep).join('/');

function extractMetadataBlock(content) {
  const match = content.match(/\bmetadata\b\s*:\s*\{/);
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
  return content.slice(start, i - 1);
}

function extractMetadataId(block) {
  if (!block) return null;
  const match = block.match(/\bid\b\s*:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function extractGenesisLevel(block) {
  if (!block) return null;
  const match = block.match(/\bgenesis\b\s*:\s*\{[\s\S]*?\bintroduced\b\s*:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function extractDependencies(block) {
  if (!block) return [];
  const match = block.match(/\bdependencies\b\s*:\s*\[/);
  if (!match) return [];
  const start = match.index + match[0].length - 1;
  let depth = 1;
  let i = start + 1;
  while (i < block.length && depth > 0) {
    const ch = block[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    i += 1;
  }
  const arrayText = block.slice(start + 1, i - 1);
  const deps = [];
  const regex = /['"]([^'"]+)['"]/g;
  let m;
  while ((m = regex.exec(arrayText)) !== null) {
    const raw = m[1];
    const optional = raw.endsWith('?');
    const id = optional ? raw.slice(0, -1) : raw;
    deps.push({ id, optional });
  }
  return deps;
}

async function loadBlueprintMap() {
  try {
    const registry = JSON.parse(await fs.readFile(BLUEPRINT_REGISTRY_PATH, 'utf8'));
    const map = new Map();
    const features = Array.isArray(registry.features) ? registry.features : [];
    for (const feature of features) {
      const blueprintPath = feature?.blueprints?.[0]?.path || null;
      const files = Array.isArray(feature.files) ? feature.files : [];
      for (const file of files) {
        if (!map.has(file)) {
          map.set(file, blueprintPath);
        }
      }
    }
    return map;
  } catch (err) {
    return new Map();
  }
}

async function main() {
  const genesis = JSON.parse(await fs.readFile(GENESIS_PATH, 'utf8'));
  const moduleFiles = genesis.moduleFiles || {};

  const moduleToLevel = new Map();
  for (const [levelName, level] of Object.entries(genesis.levels || {})) {
    const modules = Array.isArray(level.modules) ? level.modules : [];
    for (const mod of modules) {
      if (!moduleToLevel.has(mod)) {
        moduleToLevel.set(mod, levelName);
      }
    }
  }

  const blueprintMap = await loadBlueprintMap();
  const modules = {};

  for (const [moduleName, files] of Object.entries(moduleFiles)) {
    if (!files || files.length === 0) continue;
    const entryFile = files[0];
    const entryPath = path.join(SRC_DIR, entryFile);

    let metadataId = null;
    let introduced = null;
    let dependencies = [];

    try {
      const content = await fs.readFile(entryPath, 'utf8');
      const block = extractMetadataBlock(content);
      metadataId = extractMetadataId(block);
      introduced = extractGenesisLevel(block);
      dependencies = extractDependencies(block);
    } catch (err) {
      // Skip parse errors, fall back to config data
    }

    const blueprint = blueprintMap.get(entryFile) || null;

    modules[moduleName] = {
      id: metadataId || moduleName,
      entry: toPosix(entryFile),
      files: files.map(file => toPosix(file)),
      introduced: introduced || moduleToLevel.get(moduleName) || 'unknown',
      dependencies,
      blueprint
    };
  }

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    modules
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[module-registry] Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[module-registry] Failed to build registry');
  console.error(err);
  process.exit(1);
});
