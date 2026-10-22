/** Source-only Zero capsules. Hashes establish byte integrity, not activation authority. */

const SOURCE_PATH = '/zero/source.json';
const encoder = new TextEncoder();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
const required = ['zero/index.html', 'zero/boot.js', 'zero/store.js', 'zero/image.js',
  'zero/style.css', 'core/verification-worker.js', 'core/vendor/acorn.js',
  'core/vendor/ACORN-LICENSE.txt', 'host/sw-module-loader.js', 'core/import-rewrite.js', 'sw.js'];
// Data files need an explicit static-source contract. A matching hash alone does
// not make saved settings, conversations, receipts or credentials exportable.
const sourceAssets = new Set(['instance.js', 'sw.js', 'zero/config.json', 'zero/source.json',
  'config/file-tool-schemas.json', 'vendor/reploid/config/defaults.json',
  'vendor/reploid/config/request-overrides.json', 'vendor/reploid/rules/routing.rules.json',
  'core/vendor/ACORN-LICENSE.txt']);
const codePath = /^(?:zero|core|config|host|providers|vendor\/reploid)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.m?js$/;
const presentationPath = /^zero\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:html|css|svg)$/;
const installedPath = /^self\/tools\/[A-Z][A-Za-z0-9]*\.js$/;
const privatePath = /(?:^|\/)(?:state|artifacts|recordings?|receipts?|credentials?|secrets?|private|settings|sessions?|history|logs|memory)(?:\/|\.|$)/i;

function sourcePath(path) {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid Zero source path: ${path}`);
  }
  if (!installedPath.test(path) && (privatePath.test(path)
    || !(sourceAssets.has(path) || codePath.test(path) || presentationPath.test(path)))) {
    throw new Error(`Not exportable Zero source: ${path}`);
  }
  return path;
}

function fields(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}

function records(entries) {
  if (!Array.isArray(entries)) throw new Error('Missing Zero source records');
  const seen = new Set();
  return entries.map(entry => {
    if (!fields(entry, ['path', 'bytes', 'sha256']) || !Number.isSafeInteger(entry.bytes)
      || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Invalid Zero source record');
    }
    sourcePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`Duplicate Zero source: ${entry.path}`);
    seen.add(entry.path);
    return { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 };
  });
}

export function validateZeroSource(value) {
  if (!fields(value, ['schema', 'version', 'files', 'boot', 'prerequisites'])
    || value.schema !== 'reploid.zero.source/v1' || value.version !== 1
    || !fields(value.boot, ['main', 'agent', 'ui', 'config'])
    || !Array.isArray(value.prerequisites) || value.prerequisites.some(item => typeof item !== 'string')) {
    throw new Error('Invalid Zero source descriptor');
  }
  const files = records(value.files), paths = new Set(files.map(entry => entry.path));
  for (const key of ['main', 'agent', 'ui', 'config']) {
    if (!own(value.boot, key) || !paths.has(sourcePath(value.boot[key]))) throw new Error(`Missing Zero boot source: ${key}`);
  }
  for (const path of required) if (!paths.has(path)) throw new Error(`Missing Zero source: ${path}`);
  if (paths.has(SOURCE_PATH.slice(1))) throw new Error('Zero source descriptor cannot hash itself');
  return { schema: value.schema, version: 1, files, boot: { ...value.boot }, prerequisites: [...value.prerequisites] };
}

export async function hashZeroSource(content) {
  if (typeof content !== 'string') throw new Error('Zero source must be text');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(content));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function record(path, content) {
  return { path, bytes: encoder.encode(content).length, sha256: await hashZeroSource(content) };
}

async function check(entry, content) {
  if (typeof content !== 'string') throw new Error(`Missing Zero source: ${entry.path}`);
  if (encoder.encode(content).length !== entry.bytes || await hashZeroSource(content) !== entry.sha256) {
    throw new Error(`Zero source integrity mismatch: ${entry.path}`);
  }
}

async function read(VFS, path) {
  const content = await VFS.read(path);
  if (typeof content !== 'string') throw new Error(`Missing Zero source: ${path}`);
  return content;
}

export async function exportZeroImage(VFS, { includeTools = false } = {}) {
  const sourceText = await read(VFS, SOURCE_PATH);
  const source = validateZeroSource(JSON.parse(sourceText));
  const files = {}, installed = new Map();
  if (includeTools) {
    const { verifiedToolSource } = await import('./tools.js');
    for (const path of (await VFS.list('/self/tools/')).sort()) {
      if (!installedPath.test(path.slice(1))) continue;
      try {
        const checked = await verifiedToolSource(VFS, path);
        if (checked) installed.set(path.slice(1), checked.code);
      } catch { /* Unactivated or changed installations never become exported authority. */ }
    }
  }
  let changed = false;
  for (const entry of source.files) {
    const content = installed.has(entry.path) ? installed.get(entry.path) : await read(VFS, `/${entry.path}`);
    if (installed.has(entry.path)) {
      const next = await record(entry.path, content);
      changed ||= next.sha256 !== entry.sha256 || next.bytes !== entry.bytes;
      Object.assign(entry, next);
      installed.delete(entry.path);
    } else await check(entry, content);
    files[`/${entry.path}`] = content;
  }
  for (const [path, content] of installed) {
    files[`/${path}`] = content;
    source.files.push(await record(path, content));
    changed = true;
  }
  source.files.sort((left, right) => left.path.localeCompare(right.path));
  files[SOURCE_PATH] = changed ? serialize(source) : sourceText;
  const manifest = [];
  for (const path of Object.keys(files).sort()) manifest.push(await record(path.slice(1), files[path]));
  const image = { schema: 'reploid.zero.image/v1', version: 1, manifest, files };
  await validateZeroImage(image);
  return image;
}

export async function validateZeroImage(image) {
  if (!fields(image, ['schema', 'version', 'manifest', 'files'])
    || image.schema !== 'reploid.zero.image/v1' || image.version !== 1
    || !fields(image.files, Object.keys(image.files || {}))) throw new Error('Invalid Zero image');
  // Copy everything before hashing; callers cannot replace bytes while validation awaits.
  const files = { ...image.files }, manifest = records(image.manifest);
  const paths = new Set(manifest.map(entry => `/${entry.path}`));
  for (const path of Object.keys(files)) if (!paths.has(path)) throw new Error(`Undeclared Zero source: ${path}`);
  for (const entry of manifest) await check(entry, files[`/${entry.path}`]);
  if (!own(files, SOURCE_PATH)) throw new Error('Missing Zero source descriptor');
  const source = validateZeroSource(JSON.parse(files[SOURCE_PATH]));
  if (paths.size !== source.files.length + 1) throw new Error('Zero image does not match its source closure');
  for (const entry of source.files) await check(entry, files[`/${entry.path}`]);
  return { source, files, fileCount: paths.size, bytes: manifest.reduce((sum, entry) => sum + entry.bytes, 0) };
}

export async function materializeZeroImage(image) {
  const { source, files } = await validateZeroImage(image);
  const html = files['/zero/index.html'];
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('Zero entry HTML is missing its head element');
  files['/index.html'] = html;
  return { schema: 'reploid.zero.host/v1', version: 1, prerequisites: source.prerequisites, files };
}
