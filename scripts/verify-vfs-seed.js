#!/usr/bin/env node
/**
 * Verifies that config/vfs-seed.json matches current src/ contents.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const SEED_PATH = path.join(SRC_DIR, 'config', 'vfs-seed.json');

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
  const errors = [];
  const seedRaw = await fs.readFile(SEED_PATH, 'utf8');
  const seed = JSON.parse(seedRaw);
  const seedFiles = seed?.files;

  if (!seedFiles || typeof seedFiles !== 'object') {
    throw new Error('vfs-seed.json missing files map');
  }

  const allFiles = await walkFiles(SRC_DIR);
  const relFiles = allFiles.map((file) => toPosix(path.relative(SRC_DIR, file)));
  const seedRelPath = toPosix(path.relative(SRC_DIR, SEED_PATH));

  const expected = relFiles
    .filter((file) => file !== seedRelPath)
    .sort();

  const expectedSet = new Set(expected.map((file) => `/${file}`));
  const seedPaths = Object.keys(seedFiles);

  for (const vfsPath of seedPaths) {
    if (!expectedSet.has(vfsPath)) {
      errors.push(`Seed has extra entry: ${vfsPath}`);
    }
  }

  for (const rel of expected) {
    const vfsPath = `/${rel}`;
    if (!(vfsPath in seedFiles)) {
      errors.push(`Seed missing entry: ${vfsPath}`);
      continue;
    }
    const diskContent = await fs.readFile(path.join(SRC_DIR, rel), 'utf8');
    const seedContent = seedFiles[vfsPath];
    if (seedContent !== diskContent) {
      errors.push(`Seed content mismatch: ${vfsPath}`);
    }
  }

  if (errors.length > 0) {
    console.error('[verify-vfs-seed] Errors:');
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  }

  console.log('[verify-vfs-seed] Seed bundle matches src/');
}

main().catch((err) => {
  console.error('[verify-vfs-seed] Failed to run checks');
  console.error(err);
  process.exit(1);
});
