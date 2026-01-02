#!/usr/bin/env node
/**
 * Generates src/config/blueprint-registry.json and stubs for missing blueprints.
 * Uses src/MODULE_SYSTEM_AUDIT.md as the initial blueprint map.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const BLUEPRINT_DIR = path.join(SRC_DIR, 'blueprints');
const AUDIT_PATH = path.join(SRC_DIR, 'MODULE_SYSTEM_AUDIT.md');
const OUTPUT_PATH = path.join(SRC_DIR, 'config', 'blueprint-registry.json');

const toPosix = (p) => p.split(path.sep).join('/');

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'blueprints') continue;
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseAuditTable(text) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('| File Path |')) {
      start = i;
      break;
    }
  }
  if (start === -1) return new Map();
  const map = new Map();
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (cells.length < 7) continue;
    const filePath = cells[0];
    const blueprint = cells[6];
    if (filePath) {
      map.set(filePath, blueprint);
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

function parseBlueprintId(filename) {
  const match = filename.match(/^(0x[0-9A-Fa-f]{6})/);
  return match ? match[1] : null;
}

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

async function writeBlueprintStub(id, slug, relFile) {
  const name = `${id}-${slug}.md`;
  const outPath = path.join(BLUEPRINT_DIR, name);

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
    `*Last updated: December 2025*\n`;

  await fs.writeFile(outPath, content, 'utf8');
  return name;
}

async function main() {
  const auditRaw = await fs.readFile(AUDIT_PATH, 'utf8');
  const auditMap = parseAuditTable(auditRaw);
  const existingBlueprints = await loadBlueprintIndex();

  const jsFiles = await walkFiles(SRC_DIR);
  const relFiles = jsFiles.map((file) => toPosix(path.relative(SRC_DIR, file))).sort();

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
    const auditBlueprint = auditMap.get(relFile);
    let blueprintId = null;

    if (auditBlueprint && auditBlueprint !== 'NO' && auditBlueprint !== '-') {
      blueprintId = auditBlueprint;
    } else {
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

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[blueprint-registry] Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[blueprint-registry] Failed to build registry');
  console.error(err);
  process.exit(1);
});
