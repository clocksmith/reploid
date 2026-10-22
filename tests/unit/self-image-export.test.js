import { describe, expect, it, vi } from 'vitest';

import { exportSelfImage, materializeSelfImage, validateSelfImageExport, validateSourceManifest } from '../../self/image/export.js';
import { createSelfImageManifest, sha256Text, validateSelfImageManifest } from '../../self/image/manifest.js';

const sourceManifestPath = '/config/self-source-manifest.json';
const fixtureSources = {
  '/self/boot-spec.js': 'export const boot = true;\n',
  '/self/kernel/index.html': '<!doctype html><html><head><title>X</title></head><body><div id="app"></div><script type="module" src="/kernel/boot.js"></script></body></html>',
  '/self/kernel/boot.js': 'import { start } from "../host/start-app.js"; start();\n',
  '/self/host/seed-vfs.js': 'export const seed = true;\n',
  '/self/host/start-app.js': 'export const start = () => "ready";\n',
  '/self/host/vfs-bootstrap.js': 'export const bootstrap = true;\n',
  '/self/host/sw-module-loader.js': 'self.addEventListener("fetch", () => {});\n',
  '/self/image/export.js': 'export const image = true;\n',
  '/self/image/manifest.js': 'export const manifest = true;\n',
  '/core/tool-runner.js': 'export const run = () => "source preserved: λ";\n',
  '/tools/CreateTool.js': 'export const create = true;\n',
  '/config/self-source-catalog.json': '{}',
  '/config/vfs-manifest.json': '{"version":1,"files":["config/credentials.json","artifacts/session.json"]}'
};

function makeFixture({ level = 'spark', surface } = {}) {
  const seedFiles = [...Object.keys(fixtureSources), sourceManifestPath].map((path) => path.slice(1));
  const sourceManifest = {
    schema: 'reploid/self-source/v1',
    version: 1,
    level,
    files: seedFiles.map((path) => path.startsWith('self/') ? path.slice('self/'.length) : path),
    seedFiles,
    prerequisites: ['Serve these assets over HTTPS or localhost.', 'Configure a model provider separately.']
  };
  if (surface !== undefined) sourceManifest.surface = surface;
  return new Map([
    ...Object.entries(fixtureSources),
    [sourceManifestPath, JSON.stringify(sourceManifest)],
    ['/config/self-source-catalog.json', JSON.stringify({
      schema: 'reploid/self-source-catalog/v1', version: 1, profiles: { [level]: sourceManifest }
    })],
    ['/self/identity.json', '{"privateKey":"not source"}'],
    ['/config/credentials.json', '{"apiKey":"not source"}'],
    ['/artifacts/session.json', '{"messages":["not source"]}'],
    ['/self/tools/Count.js', 'export const tool = { call: () => 2 };\n']
  ]);
}

function makeDeps(files) {
  return {
    VFS: { list: async () => [...files.keys()] },
    readFile: async ({ path }) => {
      if (!files.has(path)) throw new Error(`Missing VFS source: ${path}`);
      return { path, content: files.get(path) };
    }
  };
}

const exportFixture = (files = makeFixture(), args = {}) => exportSelfImage(args, makeDeps(files));
const clone = (value) => JSON.parse(JSON.stringify(value));

async function rehash(image) {
  image.manifest = await createSelfImageManifest({
    paths: Object.keys(image.files),
    bootSpec: image.boot,
    readText: async (path) => image.files[path]
  });
  return image;
}

describe('Source-only self-image export', () => {
  it('exports only the declared closure, preserves text and replaces the host inventory with exact seed paths', async () => {
    const source = makeFixture();
    const result = await exportFixture(source);
    expect(result.files['/self/core/tool-runner.js']).toBe(source.get('/core/tool-runner.js'));
    expect(result.files['/self/kernel/boot.js']).toBe(source.get('/self/kernel/boot.js'));
    expect(result.files['/self/config/self-source-manifest.json']).toBe(source.get(sourceManifestPath));
    expect(result.files).not.toHaveProperty('/self/identity.json');
    expect(result.files).not.toHaveProperty('/self/config/credentials.json');
    expect(result.files).not.toHaveProperty('/self/artifacts/session.json');
    expect(result.files).not.toHaveProperty('/self/tools/Count.js');
    expect(JSON.parse(result.files['/self/config/vfs-manifest.json']).files).toEqual(
      JSON.parse(source.get(sourceManifestPath)).seedFiles
    );
    const verified = await validateSelfImageExport(result);
    expect(verified.fileCount).toBe(Object.keys(fixtureSources).length + 1);
    const entry = result.manifest.files.find((file) => file.path === '/self/core/tool-runner.js');
    expect(entry.bytes).toBe(new TextEncoder().encode(source.get('/core/tool-runner.js')).length);
  });

  it('materializes host paths once, then reseeds and exports an identical descendant without the original VFS', async () => {
    const ancestor = await exportFixture();
    const host = await materializeSelfImage(ancestor);
    expect(host.files['/kernel/boot.js']).toBe(fixtureSources['/self/kernel/boot.js']);
    expect(host.files).not.toHaveProperty('/self/kernel/boot.js');
    expect(host.files['/x']).toBe(fixtureSources['/self/kernel/index.html']);
    const page = new DOMParser().parseFromString(host.files['/index.html'], 'text/html');
    expect(page.querySelector('script[type="module"]').getAttribute('src')).toBe('/kernel/boot.js');
    const location = { pathname: '/index.html', search: '?instance=copy', hash: '#source' };
    const history = { replaceState: (...args) => { history.call = args; } };
    new Function('location', 'history', page.querySelector('script').textContent)(location, history);
    expect(history.call).toEqual([null, '', '/x?instance=copy#source']);
    const importedScripts = [];
    new Function('self', 'importScripts', host.files['/sw.js'])(
      { location: { href: 'http://localhost/sw.js?v=copy' } },
      (path) => importedScripts.push(path)
    );
    expect(importedScripts).toEqual(['/host/sw-module-loader.js?v=copy']);

    // A fresh host can reconstruct the original mixed root/self VFS storage layout.
    const freshVfs = new Map();
    for (const path of JSON.parse(host.files['/config/vfs-manifest.json']).files) {
      const webPath = `/${path.startsWith('self/') ? path.slice('self/'.length) : path}`;
      expect(host.files).toHaveProperty(webPath);
      freshVfs.set(`/${path}`, host.files[webPath]);
    }
    const descendant = await exportFixture(freshVfs);
    expect(descendant.files).toEqual(ancestor.files);
    expect(descendant.manifest.files).toEqual(ancestor.manifest.files);
    expect(host.prerequisites).toContain('Configure a model provider separately.');
  });

  it('preserves the historical fieldless upgraded image route to Zero without copying browser settings', async () => {
    const files = makeFixture();
    const source = JSON.parse(files.get(sourceManifestPath));
    source.level = 'reflection';
    files.set(sourceManifestPath, JSON.stringify(source));
    const catalog = JSON.parse(files.get('/config/self-source-catalog.json'));
    catalog.profiles.reflection = source;
    files.set('/config/self-source-catalog.json', JSON.stringify(catalog));
    const image = await exportFixture(files);
    const host = await materializeSelfImage(image);
    expect(host.files['/zero']).toBe(fixtureSources['/self/kernel/index.html']);
    const page = new DOMParser().parseFromString(host.files['/index.html'], 'text/html');
    const location = { pathname: '/', search: '?instance=upgraded', hash: '#source' };
    const history = { replaceState: (...args) => { history.call = args; } };
    new Function('location', 'history', page.querySelector('script').textContent)(location, history);
    expect(history.call).toEqual([null, '', '/zero?instance=upgraded#source']);
    expect(JSON.parse(host.files['/config/self-source-manifest.json']).level).toBe('reflection');
  });

  it.each([
    ['zero', 'spark', '/zero'],
    ['x', 'spark', '/x'],
    ['x', 'reflection', '/x'],
    ['x', 'cognition', '/x'],
    ['x', 'substrate', '/x'],
    ['x', 'full', '/x']
  ])('materializes the declared %s surface at %s level', async (surface, level, route) => {
    const image = await exportFixture(makeFixture({ surface, level }));
    // Route identity belongs to hashed source, never unbound export metadata.
    image.surface = surface === 'zero' ? 'x' : 'zero';
    const host = await materializeSelfImage(image);
    const descriptor = JSON.parse(host.files['/config/self-source-manifest.json']);
    expect(descriptor).toMatchObject({ surface, level });
    expect(JSON.parse(host.files['/config/self-source-catalog.json']).profiles[level]).toEqual(descriptor);
    const page = new DOMParser().parseFromString(host.files['/index.html'], 'text/html');
    for (const pathname of ['/', '/index.html']) {
      const location = { pathname, search: '?instance=copy', hash: '#source' };
      const history = { replaceState: vi.fn() };
      new Function('location', 'history', page.querySelector('script').textContent)(location, history);
      expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', `${route}?instance=copy#source`);
    }
  });

  it('includes installed source tools only when explicitly requested, and keeps them after reseeding', async () => {
    const image = await exportFixture(makeFixture(), { includeTools: true });
    expect(image.files['/self/tools/Count.js']).toBe('export const tool = { call: () => 2 };\n');
    const sourceManifest = JSON.parse(image.files['/self/config/self-source-manifest.json']);
    const index = sourceManifest.files.indexOf('tools/Count.js');
    expect(sourceManifest.seedFiles[index]).toBe('self/tools/Count.js');
    const host = await materializeSelfImage(image);
    expect(host.files['/tools/Count.js']).toBe(image.files['/self/tools/Count.js']);
    expect(JSON.parse(host.files['/config/vfs-manifest.json']).files).toContain('self/tools/Count.js');
    const catalog = JSON.parse(host.files['/config/self-source-catalog.json']);
    expect(catalog.profiles.spark).toEqual(sourceManifest);
    vi.resetModules();
    vi.doMock('../../self/config/self-source-catalog.json', () => ({ default: catalog }));
    try {
      // Exercise the real route-aware selector with the descendant's exported catalog.
      const { pickBootSeedFiles } = await import('../../self/config/boot-seed.js');
      const bootFiles = pickBootSeedFiles(JSON.parse(host.files['/config/vfs-manifest.json']).files, 'x_home');
      expect(bootFiles).toContain('self/tools/Count.js');
      const freshVfs = new Map(bootFiles.map((path) => [
        `/${path}`, host.files[`/${path.startsWith('self/') ? path.slice('self/'.length) : path}`]
      ]));
      const descendant = await exportFixture(freshVfs, { includeTools: true });
      expect(descendant.files).toEqual(image.files);
    } finally {
      vi.doUnmock('../../self/config/self-source-catalog.json');
      vi.resetModules();
    }
  });

  it.each([
    ['CreateTool', 'spark', 'x_home'],
    ['WriteFile', 'reflection', 'x_home']
  ])('exports the active installed %s replacement and preserves it through descendant reseeding', async (name, level, bootProfile) => {
    const original = 'export default () => "inactive original";\n';
    const replacement = 'export default () => "active installed replacement";\n';
    const files = makeFixture();
    const source = JSON.parse(files.get(sourceManifestPath));
    source.level = level;
    source.surface = 'x';
    const logicalPath = `tools/${name}.js`;
    if (!source.files.includes(logicalPath)) {
      source.files.push(logicalPath);
      source.seedFiles.push(logicalPath);
    }
    files.set(`/${logicalPath}`, original);
    files.set(`/self/${logicalPath}`, replacement);
    files.set(sourceManifestPath, JSON.stringify(source));
    const initialCatalog = JSON.parse(files.get('/config/self-source-catalog.json'));
    initialCatalog.profiles[level] = source;
    files.set('/config/self-source-catalog.json', JSON.stringify(initialCatalog));

    const image = await exportFixture(files, { includeTools: true });
    expect(image.files[`/self/${logicalPath}`]).toBe(replacement);
    const exported = JSON.parse(image.files['/self/config/self-source-manifest.json']);
    expect(exported.files.filter(path => path === logicalPath)).toHaveLength(1);
    expect(exported.seedFiles[exported.files.indexOf(logicalPath)]).toBe(`self/${logicalPath}`);
    expect(exported.seedFiles).not.toContain(logicalPath);
    const host = await materializeSelfImage(image);
    expect(host.files[`/${logicalPath}`]).toBe(replacement);
    const catalog = JSON.parse(host.files['/config/self-source-catalog.json']);
    expect(catalog.profiles[level]).toEqual(exported);

    vi.resetModules();
    vi.doMock('../../self/config/self-source-catalog.json', () => ({ default: catalog }));
    vi.doMock('../../self/config/self-source-manifest.json', () => ({ default: exported }));
    try {
      const { pickBootSeedFiles } = await import('../../self/config/boot-seed.js');
      const bootFiles = pickBootSeedFiles(JSON.parse(host.files['/config/vfs-manifest.json']).files, bootProfile);
      expect(bootFiles).toContain(`self/${logicalPath}`);
      expect(bootFiles).not.toContain(logicalPath);
      const descendantVfs = new Map(bootFiles.map(path => [
        `/${path}`, host.files[`/${path.startsWith('self/') ? path.slice('self/'.length) : path}`]
      ]));
      expect(descendantVfs.get(`/self/${logicalPath}`)).toBe(replacement);
      expect(descendantVfs.has(`/${logicalPath}`)).toBe(false);
      const descendant = await exportFixture(descendantVfs, { includeTools: true });
      expect(descendant.files).toEqual(image.files);
      expect(descendant.manifest.files).toEqual(image.manifest.files);
    } finally {
      vi.doUnmock('../../self/config/self-source-catalog.json');
      vi.doUnmock('../../self/config/self-source-manifest.json');
      vi.resetModules();
    }
  });

  it('rejects a missing VFS source instead of hashing an empty substitute', async () => {
    const files = makeFixture();
    files.delete('/self/kernel/boot.js');
    await expect(exportFixture(files)).rejects.toThrow('Missing VFS source: /self/kernel/boot.js');
  });

  it('rejects same-length tampering and incorrect byte lengths before materializing', async () => {
    const image = await exportFixture();
    image.files['/self/kernel/boot.js'] = image.files['/self/kernel/boot.js'].replace('start', 'other');
    await expect(materializeSelfImage(image)).rejects.toThrow('hash mismatch');
    const wrongSize = await exportFixture();
    wrongSize.manifest.files[0].bytes += 1;
    await expect(validateSelfImageExport(wrongSize)).rejects.toThrow('byte length mismatch');
  });

  it('rejects tampered source surface bytes before using their route', async () => {
    const image = await exportFixture(makeFixture({ surface: 'zero' }));
    const path = '/self/config/self-source-manifest.json';
    image.files[path] = image.files[path].replace('"surface":"zero"', '"surface":"x"   ');
    const entry = image.manifest.files.find(file => file.path === path);
    expect(new TextEncoder().encode(image.files[path]).length).toBe(entry.bytes);
    await expect(materializeSelfImage(image)).rejects.toThrow('hash mismatch');
  });

  it('rejects a missing declared dependency even when its hash entry is also removed', async () => {
    const image = await exportFixture();
    delete image.files['/self/core/tool-runner.js'];
    await rehash(image);
    await expect(materializeSelfImage(image)).rejects.toThrow('Missing declared source: /self/core/tool-runner.js');
  });

  it('rejects an incomplete boot declaration even after all remaining contents are rehashed', async () => {
    const image = await exportFixture();
    const source = JSON.parse(image.files['/self/config/self-source-manifest.json']);
    const index = source.files.indexOf('host/seed-vfs.js');
    source.files.splice(index, 1);
    source.seedFiles.splice(index, 1);
    image.files['/self/config/self-source-manifest.json'] = JSON.stringify(source);
    image.files['/self/config/vfs-manifest.json'] = JSON.stringify({ version: 1, files: source.seedFiles });
    delete image.files['/self/host/seed-vfs.js'];
    await rehash(image);
    await expect(materializeSelfImage(image)).rejects.toThrow('Missing boot source: /self/host/seed-vfs.js');
  });

  it.each([
    ['unaligned', (source) => source.seedFiles.pop(), 'aligned files and seedFiles'],
    ['invalid prerequisites', (source) => { source.prerequisites = 'not an array'; }, 'Invalid self-source manifest'],
    ['duplicate', (source) => { source.files.push(source.files[0]); source.seedFiles.push(source.seedFiles[0]); }, 'Duplicate self-source path'],
    ['mismatched', (source) => { source.seedFiles[0] = 'other/boot-spec.js'; }, 'does not match seed path'],
    ['traversal', (source) => { source.files[0] = '../escape.js'; }, 'Invalid canonical self-image path'],
    ['encoded traversal', (source) => { source.files[0] = '%2e%2e/escape.js'; }, 'Invalid canonical self-image path']
  ])('rejects %s source declarations', async (_label, mutate, message) => {
    const files = makeFixture();
    const source = JSON.parse(files.get(sourceManifestPath));
    mutate(source);
    files.set(sourceManifestPath, JSON.stringify(source));
    await expect(exportFixture(files)).rejects.toThrow(message);
  });

  it.each([null, '', 'Zero', 'X', 'other', '/x', 0, false, [], {}])(
    'rejects an invalid explicit source surface %j', async (surface) => {
      await expect(exportFixture(makeFixture({ surface }))).rejects.toThrow('Invalid self-source surface');
    }
  );

  it('rejects an explicitly undefined surface instead of treating it as absent', () => {
    const source = JSON.parse(makeFixture().get(sourceManifestPath));
    source.surface = undefined;
    expect(() => validateSourceManifest(source)).toThrow('Invalid self-source surface');
  });

  it.each(['reflection', 'cognition', 'substrate', 'full'])(
    'rejects a new Zero source with the upgraded %s level', async (level) => {
      await expect(exportFixture(makeFixture({ surface: 'zero', level }))).rejects.toThrow('Zero requires the spark level');
    }
  );

  it('rejects unmanifested or undeclared extra content and a broadened seed inventory', async () => {
    const image = await exportFixture();
    image.files['/self/private.json'] = '{}';
    await expect(validateSelfImageExport(image)).rejects.toThrow('Unmanifested self-image source');
    await rehash(image);
    await expect(validateSelfImageExport(image)).rejects.toThrow('Undeclared self-image source');
    const broadened = await exportFixture();
    const vfs = JSON.parse(broadened.files['/self/config/vfs-manifest.json']);
    vfs.files.push('private.json');
    broadened.files['/self/config/vfs-manifest.json'] = JSON.stringify(vfs);
    await rehash(broadened);
    await expect(validateSelfImageExport(broadened)).rejects.toThrow('does not match the declared seed closure');
  });

  it('rejects a stale selected catalog even when its source hashes are valid', async () => {
    const image = await exportFixture(makeFixture(), { includeTools: true });
    const catalog = JSON.parse(image.files['/self/config/self-source-catalog.json']);
    catalog.profiles.spark = JSON.parse(makeFixture().get(sourceManifestPath));
    image.files['/self/config/self-source-catalog.json'] = JSON.stringify(catalog);
    await rehash(image);
    await expect(materializeSelfImage(image)).rejects.toThrow('catalog profile does not match');
  });

  it.each([
    ['zero', 'x'],
    ['x', 'zero'],
    ['x', undefined],
    [undefined, 'x']
  ])('rejects a source/catalog surface mismatch (%s / %s) after rehashing', async (surface, catalogSurface) => {
    const image = await exportFixture(makeFixture({ surface }));
    const path = '/self/config/self-source-catalog.json';
    const catalog = JSON.parse(image.files[path]);
    catalog.profiles.spark.surface = catalogSurface;
    image.files[path] = JSON.stringify(catalog);
    await rehash(image);
    await expect(materializeSelfImage(image)).rejects.toThrow('catalog profile does not match');
  });

  it('rejects duplicate integrity entries and metadata-only materialization', async () => {
    const image = await exportFixture();
    image.manifest.files.push(clone(image.manifest.files[0]));
    await expect(validateSelfImageManifest(image)).rejects.toThrow('Duplicate self-image path');
    const metadata = await exportFixture(makeFixture(), { includeContent: false });
    expect(metadata.files).toBeUndefined();
    await expect(materializeSelfImage(metadata)).rejects.toThrow('contents are required');
  });

  it('uses the standard SHA-256 text digest', async () => {
    expect(await sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
