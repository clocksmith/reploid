#!/usr/bin/env node
/**
 * Generates src/config/blueprint-registry.json by scanning:
 * 1. Existing blueprint-registry.json (preserves known mappings)
 * 2. Blueprint .md files (parses "Affected Artifacts" references)
 * 3. All .js files in src/
 *
 * No longer depends on MODULE_SYSTEM_AUDIT.md
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const BLUEPRINT_DIR = path.join(SRC_DIR, 'blueprints');
const REGISTRY_PATH = path.join(SRC_DIR, 'config', 'blueprint-registry.json');

const toPosix = (p) => p.split(path.sep).join('/');

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

function slugFromPath(relPath) {
  return relPath
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

async function writeBlueprintStub(id, slug, relFile) {
  const name = `${id}-${slug}.md`;
  const outPath = path.join(BLUEPRINT_DIR, name);

  // Check if file already exists
  try {
    await fs.access(outPath);
    return name; // Already exists
  } catch {
    // File doesn't exist, create it
  }

  const content = `# Blueprint ${id}: ${slug.replace(/-/g, ' ')}\n\n` +
    `**Objective:** Describe implementation for ${relFile}.\n\n` +
    `**Target Upgrade:** ${relFile}\n\n` +
    `**Affected Artifacts:** /${relFile}\n\n` +
    `---\n\n` +
    `### 1. Intent\n` +
    `Define the purpose and constraints for ${relFile}.\n\n` +
    `### 2. Architecture\n` +
    `Outline the main responsibilities, dependencies, and data flow.\n\n` +
    `### 3. Implementation Notes\n` +
    `Record design decisions, edge cases, and integration details.\n\n` +
    `### 4. Verification Checklist\n` +
    `- [ ] Behavior matches blueprint intent\n` +
    `- [ ] Dependencies are declared and available\n` +
    `- [ ] Tests or verification steps updated as needed\n\n` +
    `*Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}*\n`;

  await fs.writeFile(outPath, content, 'utf8');
  console.log(`[blueprint-registry] Created stub: ${name}`);
  return name;
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
  const jsFiles = await walkFiles(SRC_DIR);
  const relFiles = jsFiles.map((file) => toPosix(path.relative(SRC_DIR, file))).sort();

  // Find max existing blueprint ID
  let maxId = 0;
  for (const id of existingBlueprints.keys()) {
    const value = parseInt(id.slice(2), 16);
    if (value > maxId) maxId = value;
  }

  const assignNewId = () => {
    maxId += 1;
    return `0x${maxId.toString(16).padStart(6, '0')}`;
  };

  const fileToBlueprint = new Map();
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
    // Priority 3: Assign new ID
    else {
      blueprintId = assignNewId();
    }

    fileToBlueprint.set(relFile, blueprintId);

    if (!blueprintToFiles.has(blueprintId)) {
      blueprintToFiles.set(blueprintId, []);
    }
    blueprintToFiles.get(blueprintId).push(relFile);
  }

  const features = [];

  for (const [blueprintId, files] of blueprintToFiles.entries()) {
    let blueprintFile = existingBlueprints.get(blueprintId);

    if (!blueprintFile) {
      const slug = slugFromPath(files[0]);
      blueprintFile = await writeBlueprintStub(blueprintId, slug, files[0]);
      existingBlueprints.set(blueprintId, blueprintFile);
    }

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
