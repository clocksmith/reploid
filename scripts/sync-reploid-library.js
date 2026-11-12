#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetName = /\.(?:js|json|ts)$/;

export async function syncReploidLibrary({ root = repoRoot, check = false } = {}) {
  const packageRoot = path.join(root, 'packages/reploid');
  const sourceRoot = path.join(packageRoot, 'src');
  const outputRoot = path.join(root, 'shared/vendor/reploid');
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const assets = new Map();
  const records = [];

  async function collect(relative = '') {
    const entries = await readdir(path.join(sourceRoot, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) { await collect(name); continue; }
      if (!entry.isFile() || !assetName.test(entry.name)) continue;
      const bytes = await readFile(path.join(sourceRoot, name));
      assets.set(name, bytes);
      records.push({ path: name.split(path.sep).join('/'), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await collect();
  assets.set('package-assets.json', Buffer.from(JSON.stringify({
    schema: 'reploid.application-library-assets/v1', package: manifest.name,
    version: manifest.version, exports: manifest.exports, files: records
  }, null, 2) + '\n'));

  if (check) {
    const differences = [];
    async function inspect(relative = '') {
      let entries;
      try { entries = await readdir(path.join(outputRoot, relative), { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const name = path.join(relative, entry.name);
        if (entry.isDirectory()) { await inspect(name); continue; }
        if (!assets.has(name)) differences.push(`unexpected: ${name}`);
        else if (!entry.isFile()) differences.push(`not a regular file: ${name}`);
      }
    }
    await inspect();
    for (const [name, expected] of assets) {
      try {
        if (!(await readFile(path.join(outputRoot, name))).equals(expected)) {
          differences.push(`changed: ${name}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        differences.push(`missing: ${name}`);
      }
    }
    if (differences.length) {
      throw new Error(`Application library assets are stale:\n${differences.join('\n')}\n`
        + 'Run npm run sync:library; inspect unexpected files before removing them.');
    }
  } else {
    for (const [name, bytes] of assets) {
      const target = path.join(outputRoot, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  return records.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('Usage: sync-reploid-library.js [--check]');
  const check = args.includes('--check');
  const count = await syncReploidLibrary({ check });
  process.stdout.write(`${check ? 'Verified' : 'Generated'} application library assets: ${count} files\n`);
}
