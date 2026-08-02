#!/usr/bin/env node
/**
 * Generates a machine-readable inventory of browser source modules.
 *
 * This is intentionally not an architecture-specification generator. A source
 * file belongs in this inventory unless a maintained decision blueprint names
 * a cross-cutting invariant, protocol, or failure boundary.
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { toCanonicalBrowserPath } from './browser-tree-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SELF_DIR = path.join(ROOT, 'self');
const OUTPUT_PATH = path.join(SELF_DIR, 'config', 'module-inventory.json');
const checkOnly = process.argv.includes('--check');

const sha256 = (content) => `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;

async function walkFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'blueprints' || entry.name === 'node_modules') continue;
      files.push(...await walkFiles(filePath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(filePath);
    }
  }
  return files;
}

function importSpecifiers(content) {
  const specifiers = new Set();
  const pattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match = null;
  while ((match = pattern.exec(content)) !== null) specifiers.add(match[1]);
  return [...specifiers].sort();
}

function ownerFor(pathname) {
  const [owner = 'root'] = pathname.split('/');
  return owner;
}

async function buildInventory() {
  const files = await walkFiles(SELF_DIR);
  const modules = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const relativePath = toCanonicalBrowserPath(path.relative(SELF_DIR, filePath));
    modules.push({
      path: relativePath,
      owner: ownerFor(relativePath),
      sha256: sha256(content),
      imports: importSpecifiers(content)
    });
  }
  modules.sort((left, right) => left.path.localeCompare(right.path));
  return { version: 1, modules };
}

async function main() {
  const inventory = await buildInventory();
  if (checkOnly) {
    let existing = null;
    try {
      existing = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
    } catch {
      console.error('[module-inventory] inventory is missing or invalid');
      process.exit(1);
    }
    if (JSON.stringify(existing.modules) !== JSON.stringify(inventory.modules)) {
      console.error('[module-inventory] inventory is stale');
      process.exit(1);
    }
    console.log(`[module-inventory] ${inventory.modules.length} source modules are current`);
    return;
  }
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  console.log(`[module-inventory] Wrote ${OUTPUT_PATH} with ${inventory.modules.length} modules`);
}

main().catch((error) => {
  console.error('[module-inventory] Failed to build inventory');
  console.error(error);
  process.exit(1);
});
