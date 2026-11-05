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
import { resolveBrowserTree } from './hosting-file-set.js';

const __filename = fileURLToPath(import.meta.url);
const checkOnly = process.argv.includes('--check');

const sha256 = (content) => `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;

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

export async function buildInventory({ selfDir, tree } = {}) {
  const source = await resolveBrowserTree({ selfDir, tree });
  const modules = [];
  // Served bytes and served-relative specifiers: the inventory does not depend on source roots.
  for (const served of source.files) {
    if (!served.endsWith('.js') || served.split('/').slice(0, -1).includes('blueprints')) continue;
    const content = (await source.read(served)).toString('utf8');
    const relativePath = toCanonicalBrowserPath(served);
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

export async function synchronizeInventory({ selfDir, tree, checkOnly = false } = {}) {
  const source = await resolveBrowserTree({ selfDir, tree });
  const inventory = await buildInventory({ tree: source });
  const outputPath = source.writable('config/module-inventory.json');
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
