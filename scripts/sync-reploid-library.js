#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'packages/reploid');
const sourceRoot = path.join(packageRoot, 'src');
const outputRoot = path.join(root, 'self/vendor/reploid');
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const records = [];

async function copy(relative = '') {
  const entries = await readdir(path.join(sourceRoot, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) { await copy(name); continue; }
    if (!entry.isFile() || !/\.(?:js|json|ts)$/.test(entry.name)) continue;
    const bytes = await readFile(path.join(sourceRoot, name));
    const target = path.join(outputRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    records.push({ path: name.split(path.sep).join('/'), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
await copy();
await writeFile(path.join(outputRoot, 'package-assets.json'), JSON.stringify({
  schema: 'reploid.application-library-assets/v1', package: manifest.name,
  version: manifest.version, exports: manifest.exports, files: records
}, null, 2) + '\n');
process.stdout.write(`Generated application library assets: ${records.length} files\n`);
