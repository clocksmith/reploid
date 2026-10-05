#!/usr/bin/env node
/**
 * Generates self/config/vfs-manifest.json from the browser tree under self/.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toCanonicalBrowserPath } from './browser-tree-paths.js';
import { buildHostingFileSet } from './hosting-file-set.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SELF_DIR = path.join(ROOT, 'self');
const OUTPUT_PATH = path.join(SELF_DIR, 'config', 'vfs-manifest.json');

async function main() {
  const files = await buildHostingFileSet({ selfDir: SELF_DIR });
  const relFiles = files.map(toCanonicalBrowserPath);
  const outputRel = toCanonicalBrowserPath(path.relative(SELF_DIR, OUTPUT_PATH));
  if (!relFiles.includes(outputRel)) {
    relFiles.push(outputRel);
  }
  relFiles.sort();

  const output = {
    version: 1,
    files: relFiles
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[vfs-manifest] Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[vfs-manifest] Failed to build manifest');
  console.error(err);
  process.exit(1);
});
