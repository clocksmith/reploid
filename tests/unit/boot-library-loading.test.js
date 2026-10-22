// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../self/host/sw-module-loader.js', import.meta.url), 'utf8');
const origin = 'https://reploid.test';

function createLoader(files = {}, surface = 'zero', clients = null) {
  const handlers = new Map();
  const read = vi.fn(async (path) => files[path] ?? null);
  const context = vm.createContext({
    URL, Request, Response, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    importScripts() {},
    fetch: vi.fn(async () => new Response('export const loaded = true;')),
    self: {
      location: { origin },
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: clients || { get: async () => ({ url: `${origin}/${surface}?instance=test` }) }
    }
  });
  vm.runInContext(source, context);
  context.readFromVFS = read;
  return {
    read,
    fetch: context.fetch,
    async request(path, requestOptions = {}) {
      let response = null;
      handlers.get('fetch')({
        request: new Request(new URL(path, origin), { referrer: `${origin}/${surface}?instance=test`, ...requestOptions }),
        clientId: 'client',
        respondWith: (value) => { response = Promise.resolve(value); }
      });
      return response ? await response : null;
    }
  };
}

describe('lazy installed-library boot boundary', () => {
  it.each(['x', 'zero'])('loads the shared startup helper from the trusted host on %s', async surface => {
    const loader = createLoader({ '/self/host/reploid-launch.js': 'mutable VFS copy' }, surface);
    expect(await loader.request('/host/reploid-launch.js')).toBeNull();
    expect(loader.read).not.toHaveBeenCalled();
    const undeclared = await loader.request('/host/undeclared.js');
    expect(undeclared.status).toBe(404);
    expect(undeclared.headers.get('x-vfs-miss')).toBe('true');
  });

  it.each(['x', 'zero'])('loads the declared file-tool dependency from its host source on %s', async surface => {
    const loader = createLoader({}, surface);
    const response = await loader.request('/host/file-access.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('export const loaded = true;');
    const existing = createLoader({ '/host/file-access.js': 'export const fromVfs = true;' }, surface);
    expect(await (await existing.request('/host/file-access.js')).text()).toBe('export const fromVfs = true;');
  });

  it('redirects mirrored package imports without reading mutable VFS copies', async () => {
    const loader = createLoader({ '/self/vendor/reploid/index.js': 'untrusted override' });
    const response = await loader.request('/self/vendor/reploid/index.js?instance=test&v=release');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${origin}/vendor/reploid/index.js?instance=test&v=release`);
    expect(loader.read).not.toHaveBeenCalled();
  });

  it('reads canonical package source from the agent-owned VFS', async () => {
    const loader = createLoader({ '/vendor/reploid/config/defaults.json': '{\"owned\":true}' });
    const response = await loader.request('/vendor/reploid/config/defaults.json?instance=test');
    expect(await response.json()).toEqual({ owned: true });
    expect(response.headers.get('x-vfs-source')).toBe('true');
  });

  it.each(['export', 'manifest'])('loads the owned image %s module through its canonical browser alias', async name => {
    const source = `export const ${name === 'export' ? 'exportSelfImage' : 'manifest'} = true;`;
    const loader = createLoader({ [`/self/image/${name}.js`]: source }, 'x');
    const response = await loader.request(`/image/${name}.js?instance=test&v=release`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-vfs-source')).toBe('true');
    expect(response.headers.get('x-vfs-mirror-fallback')).toBe(`/self/image/${name}.js`);
    expect(await response.text()).toBe(source);
    const missing = await createLoader({}, 'x').request(`/image/${name}.js?instance=test`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-vfs-miss')).toBe('true');
  });

  it.each(['verification-worker.js', 'vendor/acorn.js'])('serves verifier %s only from its explicit instance VFS', async file => {
    const path = `/core/${file}`;
    const loader = createLoader({ [path]: '// VFS-owned verifier' }, 'zero');
    const response = await loader.request(`${path}?surface=x&instance=descendant`, {
      referrer: `${origin}/core/verification-worker.js?surface=x&instance=descendant`
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-vfs-source')).toBe('true');
    expect(loader.read).toHaveBeenCalledWith(path, 'reploid-vfs-v0--x--descendant');
    const missing = await createLoader({}, 'zero').request(`${path}?surface=x&instance=descendant`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-vfs-miss')).toBe('true');
  });

  it.each(['x', 'zero'])('keeps default and named %s verifier requests separate with both windows open', async surface => {
    const clients = {
      get: vi.fn(async () => ({ url: `${origin}/core/verification-worker.js?surface=${surface}` })),
      matchAll: vi.fn(async () => [
        { url: `${origin}/${surface}` }, { url: `${origin}/${surface}?instance=other` }
      ])
    };
    const loader = createLoader({}, surface, clients);
    loader.read.mockImplementation(async (_path, dbName) => `// ${dbName}`);
    for (const path of ['/core/verification-worker.js', '/core/vendor/acorn.js']) {
      const referrer = `${origin}/core/verification-worker.js?surface=${surface}`;
      const [defaultResponse, namedResponse] = await Promise.all([
        loader.request(`${path}?surface=${surface}`, { referrer }),
        loader.request(`${path}?surface=${surface}&instance=other`, { referrer })
      ]);
      expect(await defaultResponse.text()).toBe(`// reploid-vfs-v0--${surface}`);
      expect(await namedResponse.text()).toBe(`// reploid-vfs-v0--${surface}--other`);
      const missing = await createLoader({}, surface, clients).request(`${path}?surface=${surface}`, { referrer });
      expect(missing.status).toBe(404);
      expect(missing.headers.get('x-vfs-miss')).toBe('true');
    }
    expect(clients.get).not.toHaveBeenCalled();
    expect(clients.matchAll).not.toHaveBeenCalled();
  });

  it.each(['x', 'zero'])('serves only exact in-scope %s verifier aliases from default/named VFS', async surface => {
    const clients = {
      get: vi.fn(async () => ({ url: `${origin}/${surface}/__verifier__/worker.js` })),
      matchAll: vi.fn(async () => [
        { url: `${origin}/${surface}` }, { url: `${origin}/${surface}?instance=other` }
      ])
    };
    const loader = createLoader({}, surface, clients);
    loader.read.mockImplementation(async (path, dbName) => `// ${dbName}${path}`);
    const assets = [['worker.js', '/core/verification-worker.js'], ['acorn.js', '/core/vendor/acorn.js']];
    for (const [name, sourcePath] of assets) {
      const alias = `/${surface}/__verifier__/${name}`;
      for (const instance of [null, 'other']) {
        // Route, not a contradictory query or unrelated referrer, owns surface.
        const query = `?surface=${surface === 'x' ? 'zero' : 'x'}${instance ? `&instance=${instance}` : ''}`;
        const options = { referrer: `${origin}/zero?instance=unrelated` };
        const response = await loader.request(`${alias}${query}`, options);
        const db = `reploid-vfs-v0--${surface}${instance ? `--${instance}` : ''}`;
        expect(await response.text()).toBe(`// ${db}${sourcePath}`);
        expect(response.headers.get('x-vfs-source')).toBe('true');
        expect(loader.read).toHaveBeenCalledWith(sourcePath, db);
        const missing = createLoader({}, surface, clients);
        const miss = await missing.request(`${alias}${query}&bootstrapper=1`, {
          ...options, headers: { 'x-reploid-vfs-bypass': '1' }
        });
        expect(miss.status).toBe(404);
        expect(miss.headers.get('x-vfs-miss')).toBe('true');
        expect(missing.fetch).not.toHaveBeenCalled();
      }
    }
    expect(clients.get).not.toHaveBeenCalled();
    expect(clients.matchAll).not.toHaveBeenCalled();
    expect(loader.fetch).not.toHaveBeenCalled();
  });

  it.each(['/x/__verifier__/other.js', '/zero/__verifier__/acorn.js/extra.js', '/other/__verifier__/worker.js'])('does not create a general virtual route for %s', async path => {
    const loader = createLoader();
    expect(await loader.request(`${path}?surface=x&instance=other`)).toBeNull();
    expect(loader.read).not.toHaveBeenCalled();
    expect(loader.fetch).not.toHaveBeenCalled();
  });

  it('does not grant explicit surface/default ownership to unrelated asset URLs', async () => {
    const path = '/core/agent-context.js';
    const loader = createLoader({ [path]: '// existing source' }, 'zero');
    await loader.request(`${path}?surface=x`, { referrer: `${origin}/zero?instance=other` });
    expect(loader.read).toHaveBeenCalledWith(path, 'reploid-vfs-v0--zero--other');
  });

  it('keeps an existing image URL VFS entry authoritative over the owned alias', async () => {
    const loader = createLoader({ '/image/export.js': 'current', '/self/image/export.js': 'alias' }, 'x');
    expect(await (await loader.request('/image/export.js?instance=test')).text()).toBe('current');
  });

  it('redirects only allowlisted missing application dependencies', async () => {
    const loader = createLoader();
    for (const path of ['config/reploid-library.json', 'core/agent-context.js']) {
      const response = await loader.request(`/self/${path}?instance=test&v=release`);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`${origin}/${path}?instance=test&v=release`);
    }
  });

  it('preserves existing canonical VFS application modules before network fallback', async () => {
    const loader = createLoader({ '/core/agent-context.js': 'export const context = true;' });
    const response = await loader.request('/self/core/agent-context.js?instance=test');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-vfs-mirror-fallback')).toBe('/core/agent-context.js');
    expect(await response.text()).toBe('export const context = true;');
  });

  it('keeps undeclared JavaScript misses closed', async () => {
    const loader = createLoader();
    const response = await loader.request('/self/ui/undeclared.js?instance=test');
    expect(response.status).toBe(404);
    expect(response.headers.get('x-vfs-miss')).toBe('true');
  });

  it('does not redirect another origin', async () => {
    const loader = createLoader();
    expect(await loader.request('https://outside.test/self/vendor/reploid/index.js')).toBeNull();
    expect(loader.read).not.toHaveBeenCalled();
  });
});
