// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../self/host/sw-module-loader.js', import.meta.url), 'utf8');
const origin = 'https://reploid.test';

function createLoader(files = {}) {
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
      clients: { get: async () => ({ url: `${origin}/zero?instance=test` }) }
    }
  });
  vm.runInContext(source, context);
  context.readFromVFS = read;
  return {
    read,
    async request(path) {
      let response = null;
      handlers.get('fetch')({
        request: new Request(new URL(path, origin), { referrer: `${origin}/zero?instance=test` }),
        clientId: 'client',
        respondWith: (value) => { response = Promise.resolve(value); }
      });
      return response ? await response : null;
    }
  };
}

describe('lazy installed-library boot boundary', () => {
  it('redirects mirrored package imports without reading mutable VFS copies', async () => {
    const loader = createLoader({ '/self/vendor/reploid/index.js': 'untrusted override' });
    const response = await loader.request('/self/vendor/reploid/index.js?instance=test&v=release');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${origin}/vendor/reploid/index.js?instance=test&v=release`);
    expect(loader.read).not.toHaveBeenCalled();
  });

  it('leaves canonical package modules to native hosted loading', async () => {
    const loader = createLoader();
    expect(await loader.request('/vendor/reploid/config/defaults.json?instance=test')).toBeNull();
    expect(loader.read).not.toHaveBeenCalled();
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
