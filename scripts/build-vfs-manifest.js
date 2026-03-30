#!/usr/bin/env node
/**
 * Generates self/config/vfs-manifest.json from the browser tree under self/.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toCanonicalBrowserPath, toPosix } from './browser-tree-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SELF_DIR = path.join(ROOT, 'self');
const OUTPUT_PATH = path.join(SELF_DIR, 'config', 'vfs-manifest.json');

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

async function main() {
  const files = await walkFiles(SELF_DIR);
  const relFiles = files.map((file) => toCanonicalBrowserPath(path.relative(SELF_DIR, file)));
  const outputRel = toCanonicalBrowserPath(path.relative(SELF_DIR, OUTPUT_PATH));
  if (!relFiles.includes(outputRel)) {
    relFiles.push(outputRel);
  }
  relFiles.sort();

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
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
