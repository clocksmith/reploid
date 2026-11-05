/**
 * The served browser tree: one URL namespace composed from source roots.
 *
 * Each root holds its files at their served path: self/core/vfs.js and
 * apps/poolday/ui/pool-home/index.js are served at /core/vfs.js and
 * /ui/pool-home/index.js. A served path has exactly one source. Module
 * specifiers in source are ordinary relative paths between source files, so
 * Node, bundlers and editors resolve them directly. Serving rewrites only the
 * specifiers that cross roots into their served-relative form; every other byte
 * is served unchanged.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Agent substrate, code both surfaces load, and the Poolday product. */
export const BROWSER_ROOTS = Object.freeze(['self', 'shared', 'apps/poolday']);

const posix = path.posix;
const toPosix = value => String(value).split(path.sep).join('/');

async function walk(root, relative = '') {
  let entries;
  try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT' && !relative) return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const name = posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Browser assets must be regular files: ${name}`);
  }
  return files;
}

/** The root that contains a repository-relative path, or null. */
export function rootOf(sourcePath, roots = BROWSER_ROOTS) {
  const normalized = toPosix(sourcePath).replace(/^\.\//, '');
  return [...roots].sort((a, b) => b.length - a.length)
    .find(root => normalized.startsWith(root + '/')) || null;
}

/** The served path of a repository-relative source path, or null outside the roots. */
export function servedPathOf(sourcePath, roots = BROWSER_ROOTS) {
  const normalized = toPosix(sourcePath).replace(/^\.\//, '');
  const root = rootOf(normalized, roots);
  return root ? normalized.slice(root.length + 1) : null;
}

const SPECIFIER_SUFFIX = /[?#].*$/;
const relativeUrl = (fromServed, toServed) => {
  const relative = posix.relative(posix.dirname(fromServed), toServed);
  return relative.startsWith('../') ? relative : `./${relative}`;
};

function references(tree) {
  const found = new Map();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string' && /^\.\.?\//.test(node.value)) {
      found.set(node.start, { start: node.start + 1, end: node.end - 1, value: node.value });
    }
    if (node.type === 'ImportExpression' && node.source?.type === 'TemplateLiteral'
      && node.source.expressions.length === 0 && /^\.\.?\//.test(node.source.quasis[0].value.cooked)) {
      const quasi = node.source.quasis[0];
      found.set(quasi.start, { start: quasi.start, end: quasi.end, value: quasi.value.cooked });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && value.type) visit(value);
    }
  };
  visit(tree);
  return [...found.values()].sort((a, b) => a.start - b.start);
}

/**
 * Rewrites relative specifiers and literal asset paths that resolve into another
 * root to their served-relative form. Returns the input unchanged when nothing
 * crosses a root, including scripts that do not parse as modules.
 */
export function toServedModuleSource(code, sourcePath, roots = BROWSER_ROOTS) {
  const source = toPosix(sourcePath);
  const ownRoot = rootOf(source, roots);
  if (!ownRoot) throw new Error(`Not a browser source path: ${sourcePath}`);
  const served = source.slice(ownRoot.length + 1);
  // A specifier must climb above the file's own root to reach another one.
  if (!code.includes('../'.repeat(served.split('/').length))) return code;
  let tree;
  try { tree = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch { return code; }
  let output = '', cursor = 0;
  for (const reference of references(tree)) {
    const suffix = reference.value.match(SPECIFIER_SUFFIX)?.[0] || '';
    const target = posix.normalize(posix.join(posix.dirname(source), reference.value.slice(0, reference.value.length - suffix.length)));
    const targetRoot = rootOf(target, roots);
    if (!targetRoot || targetRoot === ownRoot) continue;
    output += code.slice(cursor, reference.start) + relativeUrl(served, target.slice(targetRoot.length + 1)) + suffix;
    cursor = reference.end;
  }
  return cursor ? output + code.slice(cursor) : code;
}

const isModuleSource = name => /\.m?js$/.test(name);

/** Index the served tree, refusing a served path with more than one source. */
export async function openBrowserTree({ repoRoot = REPOSITORY_ROOT, roots = BROWSER_ROOTS } = {}) {
  const sources = new Map();
  for (const root of roots) {
    for (const name of await walk(path.join(repoRoot, root))) {
      const source = `${root}/${name}`;
      if (sources.has(name)) throw new Error(`Served path ${name} has two sources: ${sources.get(name)} and ${source}`);
      sources.set(name, source);
    }
  }
  const files = [...sources.keys()].sort();
  const crossesRoots = roots.length > 1;
  return Object.freeze({
    repoRoot, roots, files,
    has: served => sources.has(served),
    /** Repository-relative source path of a served path. */
    source: served => sources.get(served) || null,
    absolute(served) {
      const source = sources.get(served);
      if (!source) throw new Error(`Not in the served browser tree: ${served}`);
      return path.join(repoRoot, source);
    },
    owner: served => (sources.has(served) ? rootOf(sources.get(served), roots) : null),
    /** The bytes served for a path. */
    async read(served) {
      const bytes = await fs.readFile(this.absolute(served));
      if (!crossesRoots || !isModuleSource(served)) return bytes;
      const code = bytes.toString('utf8');
      const rewritten = toServedModuleSource(code, sources.get(served), roots);
      return rewritten === code ? bytes : Buffer.from(rewritten, 'utf8');
    }
  });
}

/** A tree of one directory, for callers and fixtures that supply a single public root. */
export function openDirectoryTree(directory) {
  const resolved = path.resolve(directory);
  return openBrowserTree({ repoRoot: path.dirname(resolved), roots: [path.basename(resolved)] });
}

/**
 * Express-compatible static serving for the composed tree. Files resolve per
 * request, so files added during development are served without a restart;
 * module sources are rewritten as Hosting packages them.
 */
export function serveBrowserTree({ repoRoot = REPOSITORY_ROOT, roots = BROWSER_ROOTS, prefix = '', setHeaders } = {}) {
  const cache = new Map();
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let served;
    try { served = decodeURIComponent(req.path).replace(/^\/+/, ''); }
    catch { return next(); }
    if (prefix) served = posix.join(prefix, served);
    if (!served || served.endsWith('/') || served.split('/').some(part => part === '..' || part.startsWith('.'))) return next();
    for (const root of roots) {
      const absolute = path.join(repoRoot, root, served);
      let stat;
      try { stat = await fs.stat(absolute); } catch { continue; }
      if (!stat.isFile()) return next();
      if (!isModuleSource(served)) {
        setHeaders?.(res, absolute);
        return res.sendFile(absolute, error => { if (error && !res.headersSent) next(error.status === 404 ? undefined : error); });
      }
      const key = `${absolute}:${stat.mtimeMs}:${stat.size}`;
      let body = cache.get(absolute)?.key === key ? cache.get(absolute).body : null;
      if (!body) {
        const code = await fs.readFile(absolute, 'utf8');
        body = Buffer.from(toServedModuleSource(code, `${root}/${served}`, roots), 'utf8');
        cache.set(absolute, { key, body });
      }
      res.type('text/javascript');
      setHeaders?.(res, absolute);
      return req.method === 'HEAD' ? res.end() : res.send(body);
    }
    return next();
  };
}
