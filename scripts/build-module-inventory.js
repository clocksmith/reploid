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

export async function buildInventory({ selfDir = SELF_DIR } = {}) {
  const files = await walkFiles(selfDir);
  const modules = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const relativePath = toCanonicalBrowserPath(path.relative(selfDir, filePath));
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

export async function synchronizeInventory({ selfDir = SELF_DIR, checkOnly = false } = {}) {
  const inventory = await buildInventory({ selfDir });
  const outputPath = path.join(selfDir, 'config', 'module-inventory.json');
  if (checkOnly) {
    let existing;
    try {
      existing = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    } catch {
      throw new Error('Module inventory is missing or invalid');
    }
    if (JSON.stringify(existing.modules) !== JSON.stringify(inventory.modules)) {
      throw new Error('Module inventory is stale');
    }
    console.log(`[module-inventory] ${inventory.modules.length} source modules are current`);
  } else {
    await fs.writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    console.log(`[module-inventory] Wrote ${outputPath} with ${inventory.modules.length} modules`);
  }
  return inventory;
}

async function main() {
  await synchronizeInventory({ checkOnly });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main().catch((error) => {
  console.error('[module-inventory] Failed to build inventory');
  console.error(error);
  process.exit(1);
});
