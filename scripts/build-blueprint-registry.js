#!/usr/bin/env node
/**
 * Generates self/config/blueprint-registry.json by scanning:
 * 1. Existing blueprint-registry.json (preserves known mappings)
 * 2. Blueprint .md files (parses "Affected Artifacts" references)
 * 3. All .js files in self/
 *
 * No longer depends on MODULE_SYSTEM_AUDIT.md
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toCanonicalBrowserPath } from './browser-tree-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SELF_DIR = path.join(ROOT, 'self');
const BLUEPRINT_DIR = path.join(SELF_DIR, 'blueprints');
const REGISTRY_PATH = path.join(SELF_DIR, 'config', 'blueprint-registry.json');

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'blueprints' || entry.name === 'node_modules') continue;
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseBlueprintId(filename) {
  const match = filename.match(/^(0x[0-9A-Fa-f]{6})/);
  return match ? match[1] : null;
}

/**
 * Load existing registry to preserve known file->blueprint mappings
 */
async function loadExistingRegistry() {
  try {
    const content = await fs.readFile(REGISTRY_PATH, 'utf8');
    const registry = JSON.parse(content);
    const fileToBlueprint = new Map();
    for (const feature of registry.features || []) {
      for (const file of feature.files || []) {
        fileToBlueprint.set(file, feature.id);
      }
    }
    return fileToBlueprint;
  } catch {
    return new Map();
  }
}

/**
 * Parse blueprint .md files for "Affected Artifacts" references
 */
async function parseBlueprintReferences() {
  const files = await fs.readdir(BLUEPRINT_DIR);
  const refs = new Map(); // blueprintId -> [file paths]

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const id = parseBlueprintId(file);
    if (!id) continue;

    const content = await fs.readFile(path.join(BLUEPRINT_DIR, file), 'utf8');

    // Extract file references from "Affected Artifacts" or "Target Upgrade" lines
    const artifactMatch = content.match(/\*\*Affected Artifacts:\*\*\s*([^\n]+)/i);
    const targetMatch = content.match(/\*\*Target Upgrade:\*\*\s*([^\n]+)/i);

    const paths = [];
    for (const match of [artifactMatch, targetMatch]) {
      if (match) {
        // Extract paths like /core/agent-loop.js or core/agent-loop.js
        const pathMatches = match[1].match(/\/?[\w\-\/]+\.js/g);
        if (pathMatches) {
          for (const p of pathMatches) {
            paths.push(p.replace(/^\//, '')); // Remove leading slash
          }
        }
      }
    }

    if (paths.length > 0) {
      refs.set(id, paths);
    }
  }

  return refs;
}

/**
 * Load blueprint index (id -> filename)
 */
async function loadBlueprintIndex() {
  const files = await fs.readdir(BLUEPRINT_DIR);
  const map = new Map();
  for (const file of files) {
    const id = parseBlueprintId(file);
    if (id) {
      map.set(id, file);
    }
  }
  return map;
}

async function main() {
  // Load existing mappings from multiple sources
  const existingRegistry = await loadExistingRegistry();
  const blueprintRefs = await parseBlueprintReferences();
  const existingBlueprints = await loadBlueprintIndex();

  // Build reverse map: file -> blueprintId from blueprint references
  const refFileToBlueprint = new Map();
  for (const [blueprintId, files] of blueprintRefs.entries()) {
    for (const file of files) {
      if (!refFileToBlueprint.has(file)) {
        refFileToBlueprint.set(file, blueprintId);
      }
    }
  }

  // Walk all JS files
  const jsFiles = await walkFiles(SELF_DIR);
  const relFiles = jsFiles.map((file) => toCanonicalBrowserPath(path.relative(SELF_DIR, file))).sort();

  const blueprintToFiles = new Map();

  for (const relFile of relFiles) {
    let blueprintId = null;

    // Priority 1: Existing registry mapping
    if (existingRegistry.has(relFile)) {
      blueprintId = existingRegistry.get(relFile);
    }
    // Priority 2: Blueprint file references
    else if (refFileToBlueprint.has(relFile)) {
      blueprintId = refFileToBlueprint.get(relFile);
    }
    // Unmapped source belongs in module-inventory.json. Only a maintained
    // architectural decision may add a blueprint mapping.
    else {
      continue;
    }

    if (!blueprintToFiles.has(blueprintId)) {
      blueprintToFiles.set(blueprintId, []);
    }
    blueprintToFiles.get(blueprintId).push(relFile);
  }

  const features = [];

  for (const [blueprintId, files] of blueprintToFiles.entries()) {
    let blueprintFile = existingBlueprints.get(blueprintId);

    if (!blueprintFile) continue;

    const name = blueprintFile
      .replace(/^0x[0-9A-Fa-f]{6}-/, '')
      .replace(/\.md$/, '');

    features.push({
      id: blueprintId,
      name,
      status: 'active',
      blueprints: [{
        id: blueprintId,
        path: `blueprints/${blueprintFile}`
      }],
      files: files.sort()
    });
  }

  features.sort((a, b) => a.id.localeCompare(b.id));

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    features
  };

  await fs.writeFile(REGISTRY_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[blueprint-registry] Wrote ${REGISTRY_PATH} with ${features.length} features`);
}

main().catch((err) => {
  console.error('[blueprint-registry] Failed to build registry');
  console.error(err);
  process.exit(1);
});
