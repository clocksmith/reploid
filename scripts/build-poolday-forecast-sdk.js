#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'sdk/poolday-forecast');
const check = process.argv.includes('--check');
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const bundle = await build({ absWorkingDir: root, entryPoints: ['sdk/poolday-forecast/index.js'], bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true, legalComments: 'inline' });
const files = new Map([['dist/index.js', bundle.outputFiles[0].contents],
  ['dist/index.d.ts', await fs.readFile(path.join(target, 'index.d.ts'))], ['LICENSE', await fs.readFile(path.join(root, 'LICENSE'))]]);
const sources = [];
for (const name of [...Object.keys(bundle.metafile.inputs), 'sdk/poolday-forecast/index.d.ts',
  'sdk/poolday-forecast/package.json', 'scripts/build-poolday-forecast-sdk.js', 'LICENSE', 'package-lock.json'].sort()) {
  const bytes = await fs.readFile(path.join(root, name));
  sources.push({ path: name, hash: sha(bytes), sizeBytes: bytes.length });
  files.set('source/' + name, bytes);
}
files.set('provenance.json', Buffer.from(JSON.stringify({ schema: 'reploid.sdk-provenance/v1',
  sourceHash: sha(Buffer.from(JSON.stringify(sources))), toolchain: { esbuild: esbuildVersion, node: process.version },
  command: 'node scripts/build-poolday-forecast-sdk.js', sources,
  output: { path: 'dist/index.js', hash: sha(bundle.outputFiles[0].contents) } }, null, 2) + '\n'));
for (const [name, bytes] of files) {
  const filename = path.join(target, name);
  if (check) {
    if (!Buffer.from(bytes).equals(await fs.readFile(filename))) throw new Error('Stale forecast SDK artifact: ' + name);
  } else { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, bytes); }
}
process.stdout.write(JSON.stringify({ checked: check, sources: sources.length, bundleBytes: bundle.outputFiles[0].contents.length }) + '\n');
