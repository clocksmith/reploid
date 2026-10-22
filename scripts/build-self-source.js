#!/usr/bin/env node
/** Build the exact source closure for the minimal lab and its opt-in upgrades. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { resolveBaseModules } from '../self/config/module-resolution.js';
import { getToolNamesForMode } from '../self/config/tool-surfaces.js';
import { toCanonicalBrowserPath } from './browser-tree-paths.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selfRoot = path.join(root, 'self');
const levels = ['spark', 'reflection', 'cognition', 'substrate', 'full'];
const baseEntries = [
  'kernel/index.html', 'kernel/boot.js', 'favicon.svg',
  'host/seed-vfs.js', 'host/start-app.js', 'host/sw-module-loader.js',
  'boot-helpers/index.js', 'ui/zero-home/index.js', 'ui/zero/index.js',
  'providers/external-brain.js', 'image/export.js', 'image/manifest.js',
  'config/genesis-levels.json', 'config/module-registry.json',
  'config/vfs-manifest.json', 'config/self-source-manifest.json',
  'config/self-source-catalog.json', 'config/file-tool-schemas.json',
  'personas/config.json', 'prompts/kernel.md',
  // Classic Worker/importScripts edges are not static ES-module imports.
  'core/verification-worker.js', 'core/vendor/acorn.js', 'core/vendor/ACORN-LICENSE.txt',
  'styles/rd.css', 'styles/boot.css', 'styles/zero.css'
];
const readSource = source => readFile(path.join(selfRoot, source), 'utf8');

export async function collectSelfSource(entries, read = readSource) {
  const pending = [...entries], seen = new Set();
  const add = (specifier, source) => {
    if (typeof specifier !== 'string') return;
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      throw new Error(`Undeclared self-source dependency ${specifier} in ${source}`);
    }
    const target = path.posix.normalize(specifier.startsWith('/')
      ? specifier.slice(1) : path.posix.join(path.posix.dirname(source), specifier));
    if (target.startsWith('../')) throw new Error(`Self-source escapes its root: ${target}`);
    pending.push(target);
  };
  const visit = (node, source) => {
    if (!node || typeof node !== 'object') return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)
        && node.source) add(node.source.value, source);
    // Selected entrypoints and DI modules declare dynamic edges above. Unselected
    // providers/upgrades are not dependencies of the active image.
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, source));
      else if (value && typeof value === 'object') visit(value, source);
    }
  };
  while (pending.length) {
    const source = pending.shift();
    if (seen.has(source)) continue;
    seen.add(source);
    const content = await read(source);
    if (/\.[cm]?js$/.test(source)) visit(parse(content, { ecmaVersion: 'latest', sourceType: 'module' }), source);
    if (source.endsWith('.css')) {
      for (const match of content.matchAll(/@import\s+['"]([^'"]+)['"]/g)) add(match[1], source);
    }
  }
  return [...seen].sort();
}

async function build() {
  const genesis = JSON.parse(await readSource('config/genesis-levels.json'));
  const catalog = { schema: 'reploid/self-source-catalog/v1', version: 1, profiles: {} };
  for (const level of levels) {
    const modules = resolveBaseModules(level, genesis).filter(id => level !== 'spark' || id !== 'ErrorStore');
    const tools = getToolNamesForMode(level === 'spark' ? 'x' : 'zero', { upgradeLevel: level });
    const files = await collectSelfSource([
      ...baseEntries, ...modules.flatMap(id => genesis.moduleFiles[id]), ...tools.map(name => `tools/${name}.js`)
    ]);
    catalog.profiles[level] = {
      schema: 'reploid/self-source/v1', version: 1, level,
      prerequisites: ['A browser with IndexedDB and ES modules on a same-origin HTTP(S) static host.',
        'An explicitly configured inference endpoint. Optional local model runtimes require a separate opt-in installation.'],
      files, seedFiles: files.map(toCanonicalBrowserPath)
    };
  }
  const dopplerFiles = await collectSelfSource(['providers/doppler-reploid.js']);
  catalog.optionalSources = { doppler: { files: dopplerFiles, seedFiles: dopplerFiles.map(toCanonicalBrowserPath) } };
  const outputs = [
    ['config/self-source-catalog.json', catalog],
    ['config/self-source-manifest.json', catalog.profiles.spark]
  ];
  for (const [file, value] of outputs) {
    const text = JSON.stringify(value, null, 2) + '\n';
    if (process.argv.includes('--check')) {
      if (await readSource(file) !== text) throw new Error(`Stale self-source closure: ${file}`);
    } else await writeFile(path.join(selfRoot, file), text);
  }
  console.log(`[self-source] ${Object.entries(catalog.profiles).map(([name, profile]) => `${name}: ${profile.files.length}`).join(', ')}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch(error => { console.error(error); process.exitCode = 1; });
}
