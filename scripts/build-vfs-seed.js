#!/usr/bin/env node
/**
 * Generates src/config/vfs-seed.json with full file contents.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const OUTPUT_PATH = path.join(SRC_DIR, 'config', 'vfs-seed.json');

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

async function main() {
  const files = await walkFiles(SRC_DIR);
  const relFiles = files.map((file) => toPosix(path.relative(SRC_DIR, file)));
  const outputRel = toPosix(path.relative(SRC_DIR, OUTPUT_PATH));

  const filtered = relFiles
    .filter((file) => file !== outputRel)
    .sort();

  const payload = {};
  for (const rel of filtered) {
    const content = await fs.readFile(path.join(SRC_DIR, rel), 'utf8');
    const vfsPath = rel.startsWith('/') ? rel : `/${rel}`;
    payload[vfsPath] = content;
  }

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: payload
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[vfs-seed] Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[vfs-seed] Failed to build seed bundle');
  console.error(err);
  process.exit(1);
});
