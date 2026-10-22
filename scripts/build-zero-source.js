#!/usr/bin/env node
/** Freeze only compact Zero's reachable source and its explicit browser support. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../self');
export const ZERO_SOURCE_ENTRIES = Object.freeze([
  'zero/index.html', 'zero/boot.js', 'zero/store.js', 'zero/main.js', 'zero/ui.js',
  'zero/style.css', 'zero/config.json', 'zero/agent.js', 'zero/provider.js', 'zero/tools.js', 'zero/image.js',
  // Classic worker URLs, platform registration and optional loader arguments are not ESM imports.
  'core/verification-worker.js', 'core/vendor/acorn.js', 'core/vendor/ACORN-LICENSE.txt',
  'host/sw-module-loader.js', 'core/import-rewrite.js', 'sw.js'
]);
const readSource = source => readFile(path.join(root, source), 'utf8');

function resolveSource(specifier, source) {
  if (typeof specifier !== 'string' || (!specifier.startsWith('.') && !specifier.startsWith('/'))
    || specifier.startsWith('//') || /[\\%]/.test(specifier)) {
    throw new Error(`Undeclared Zero dependency ${specifier} in ${source}`);
  }
  const bare = specifier.split(/[?#]/, 1)[0];
  const target = path.posix.normalize(bare.startsWith('/') ? bare.slice(1) : path.posix.join(path.posix.dirname(source), bare));
  if (target.startsWith('../') || target === '..') throw new Error(`Zero dependency escapes its root: ${specifier}`);
  return target.startsWith('self/') ? target.slice(5) : target;
}

const assetSpecifier = value => /^[a-zA-Z][\w+.-]*:/.test(value) || value.startsWith('/') || value.startsWith('.') ? value : `./${value}`;
const literal = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value
  : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null;

export async function collectZeroSource(entries, read = readSource) {
  const pending = [...entries], sources = new Map();
  const add = (specifier, source) => pending.push(resolveSource(specifier, source));
  function visit(node, source) {
    if (!node || typeof node !== 'object') return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      add(node.source.value, source);
    }
    if (node.type === 'ImportExpression' && literal(node.source) !== null) add(literal(node.source), source);
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'importScripts') {
      for (const arg of node.arguments) if (literal(arg) !== null) add(literal(arg), source);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => visit(value, source));
      else if (child && typeof child === 'object') visit(child, source);
    }
  }
  while (pending.length) {
    const source = pending.shift();
    if (sources.has(source)) continue;
    if (!/^[\w-][\w./-]*$/.test(source) || source.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Invalid Zero dependency path: ${source}`);
    }
    if (/^(?:lab\/|kernel\/|boot-helpers\/)|^infrastructure\/di-container\.js$|^host\/(?:start-app|seed-vfs|vfs-bootstrap)\.js$/.test(source)) {
      throw new Error(`Compact Zero reaches legacy boot/DI source: ${source}`);
    }
    if (/^config\/(?:self-source-(?:manifest|catalog)|vfs-manifest)\.json$/.test(source)) {
      throw new Error(`Compact Zero reaches legacy inventory: ${source}`);
    }
    if (source === 'zero/source.json') continue; // Descriptor is hashed by the export envelope, never itself.
    const content = await read(source);
    if (typeof content !== 'string') throw new Error(`Missing Zero source: ${source}`);
    sources.set(source, content);
    if (/\.[cm]?js$/.test(source)) visit(parse(content, { ecmaVersion: 'latest', sourceType: 'module' }), source);
    if (source.endsWith('.css')) {
      for (const match of content.matchAll(/(?:@import\s+['"]([^'"]+)['"]|url\(\s*['"]?([^'"\s)]+)['"]?\s*\))/g)) {
        const asset = match[1] || match[2];
        if (!asset.startsWith('data:') && !asset.startsWith('#')) add(assetSpecifier(asset), source);
      }
    }
    if (source.endsWith('.html')) {
      for (const tag of content.matchAll(/<(?:script|link|img)\b[^>]*>/gi)) {
        const asset = tag[0].match(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/i)?.[1];
        if (asset && !asset.startsWith('data:')) add(assetSpecifier(asset), source);
      }
      for (const script of content.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        visit(parse(script[1], { ecmaVersion: 'latest', sourceType: 'module' }), source);
      }
    }
  }
  return new Map([...sources].sort(([left], [right]) => left.localeCompare(right)));
}

export async function buildZeroSource(read = readSource) {
  const sources = await collectZeroSource(ZERO_SOURCE_ENTRIES, read);
  return {
    schema: 'reploid.zero.source/v1', version: 1,
    files: [...sources].map(([path, content]) => ({ path, bytes: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex') })),
    boot: { main: 'zero/main.js', agent: 'zero/agent.js', ui: 'zero/ui.js', config: 'zero/config.json' },
    prerequisites: ['A browser with IndexedDB, Web Workers and ES modules on an HTTPS or localhost static host.',
      'Hosted inference requires the existing /zero/gemini backend, Firebase Auth and App Check, and their external gstatic Firebase 10.14.1 SDKs; these are not exported browser source.',
      'Local inference requires the existing external-brain mailbox server and a separately connected reasoning controller; these are not exported browser source.',
      'Imported tool sources require fresh verification and activation before execution.']
  };
}

async function main() {
  const descriptor = await buildZeroSource(), text = `${JSON.stringify(descriptor, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (await readSource('zero/source.json') !== text) throw new Error('Stale compact Zero source: zero/source.json');
  } else await writeFile(path.join(root, 'zero/source.json'), text);
  console.log(`[zero-source] ${descriptor.files.length} files, ${descriptor.files.reduce((sum, entry) => sum + entry.bytes, 0)} bytes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
