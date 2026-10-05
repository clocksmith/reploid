/** Select byte-preserving browser assets from the canonical self/ tree. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';

export async function walkFiles(root, relative = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Hosting assets must be regular files: ${name}`);
  }
  return files.sort();
}

function moduleReferences(source) {
  const references = new Set();
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)
      && typeof node.source?.value === 'string') references.add(node.source.value);
    if (node.type === 'Literal' && typeof node.value === 'string'
      && /^\.\.?\//.test(node.value) && /\.(json|wgsl)$/.test(node.value)) references.add(node.value);
    // Runtime JSON and shader URLs also occur as new URL('./asset', import.meta.url).
    if (node.type === 'NewExpression' && node.callee?.name === 'URL'
      && typeof node.arguments[0]?.value === 'string'
      && /\.(js|json|wgsl)$/.test(node.arguments[0].value)) references.add(node.arguments[0].value);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(tree);
  return references;
}

export async function collectModuleClosure({ root, entries, available }) {
  available ||= new Set(await walkFiles(root));
  const selected = new Set();
  const queue = [...entries];
  while (queue.length) {
    const name = queue.pop();
    if (selected.has(name)) continue;
    if (!available.has(name)) throw new Error(`Missing browser dependency: ${name}`);
    selected.add(name);
    if (!name.endsWith('.js')) continue;
    const source = await fs.readFile(path.join(root, name), 'utf8');
    for (const reference of moduleReferences(source)) {
      if (!reference.startsWith('.')) continue;
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), reference));
      if (dependency.startsWith('../')) throw new Error(`Browser dependency escapes package: ${name} -> ${reference}`);
      queue.push(dependency);
    }
  }
  return selected;
}

export async function buildHostingFileSet({ selfDir }) {
  const allFiles = await walkFiles(selfDir);
  const selected = new Set(allFiles.filter(name => !name.startsWith('vendor/doppler/')
    && !name.endsWith('.d.ts') && path.posix.basename(name) !== 'CATSCAN.md'));
  const pin = JSON.parse(await fs.readFile(path.join(selfDir, 'config/doppler-package.json'), 'utf8'));
  const pool = JSON.parse(await fs.readFile(path.join(selfDir, 'pool/pool-config.json'), 'utf8'));
  const entriesByVersion = new Map();
  const addEntry = url => {
    const match = /^\/vendor\/doppler\/([^/]+)\/(.+)$/.exec(url);
    if (!match) throw new Error(`Doppler Hosting entry must be origin-relative: ${url}`);
    if (match[1] !== pin.version) throw new Error(`Doppler consumer differs from the pinned package: ${url}`);
    if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(match[1])) throw new Error(`Invalid Doppler Hosting version: ${match[1]}`);
    if (!entriesByVersion.has(match[1])) entriesByVersion.set(match[1], new Set());
    entriesByVersion.get(match[1]).add(match[2]);
  };
  for (const entry of ['src/index.js', 'src/partitions.js', 'src/tooling-exports.browser.js', 'src/tooling-exports/storage.js']) {
    addEntry(`/vendor/doppler/${pin.version}/${entry}`);
  }
  addEntry(pool.browserRuntime.dopplerModuleUrl);
  addEntry(pool.browserRuntime.dopplerStorageModuleUrl);
  for (const [version, entries] of entriesByVersion) {
    const prefix = `vendor/doppler/${version}/`;
    const root = path.join(selfDir, prefix);
    const files = await walkFiles(root);
    // Kernel and policy selection is dynamic and hardware-dependent. Retain its
    // complete data and implementation family, rather than one machine's trace.
    for (const name of files) {
      if (name.startsWith('src/gpu/') && name.endsWith('.wgsl')) entries.add(name);
      if (/^src\/config\/(runtime|platforms|kernels)\//.test(name) && name.endsWith('.json')) entries.add(name);
      if (name.startsWith('src/gpu/') && name.endsWith('.js')) entries.add(name);
    }
    const closure = await collectModuleClosure({ root, entries, available: new Set(files) });
    for (const name of closure) selected.add(prefix + name);
    selected.add(prefix + 'LICENSE');
  }
  return [...selected].sort();
}
