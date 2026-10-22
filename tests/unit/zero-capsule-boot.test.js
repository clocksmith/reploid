import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { bootZero, connectZeroWorker, prepareZero } from '../../self/zero/boot.js';

const SOURCE = '/zero/source.json';
const hash = text => createHash('sha256').update(text).digest('hex');
const boot = { main: 'zero/main.js', agent: 'zero/agent.js', ui: 'zero/ui.js', config: 'zero/config.json' };
const dependencies = ['zero/index.html', 'zero/boot.js', 'zero/store.js', 'zero/image.js',
  'zero/style.css', 'core/verification-worker.js', 'core/vendor/acorn.js',
  'core/vendor/ACORN-LICENSE.txt', 'host/sw-module-loader.js', 'core/import-rewrite.js', 'sw.js'];

function image(config = { schema: 'reploid.zero.boot/v1', ...boot }) {
  const files = Object.fromEntries([...dependencies, ...Object.values(boot)]
    .map(path => ['/' + path, `// source: ${path}, caf\u00e9\n`]));
  files['/' + boot.config] = JSON.stringify(config);
  const source = { schema: 'reploid.zero.source/v1', version: 1, boot, prerequisites: [],
    files: Object.entries(files).map(([path, content]) => ({ path: path.slice(1),
      bytes: new TextEncoder().encode(content).length, sha256: hash(content) })) };
  files[SOURCE] = JSON.stringify(source);
  return { files, source, config };
}

function memoryStore(entries = {}) {
  const files = new Map(Object.entries(entries));
  return { files, read: vi.fn(async path => files.get(path) ?? null),
    list: vi.fn(async () => [...files.keys()]), close: vi.fn(),
    seed: vi.fn(async values => {
      if (files.size) throw new Error('Existing VFS is preserved; seed refused');
      for (const [path, content] of Object.entries(values)) files.set(path, content);
    }) };
}

function browser() {
  const mount = document.createElement('main');
  const saved = new Map();
  const win = { document: { getElementById: vi.fn(() => mount) },
    location: new URL('https://zero.example/zero?instance=Saved_A'),
    sessionStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    navigator: { serviceWorker: {} }, REPLOID_BUILD_VERSION: 'legacy-build' };
  return { win, mount };
}

function worker({ controlled = true } = {}) {
  const active = { postMessage: vi.fn() };
  const registration = { active };
  const serviceWorker = new EventTarget();
  serviceWorker.controller = controlled ? active : { postMessage: vi.fn() };
  serviceWorker.register = vi.fn(async () => registration);
  vi.spyOn(serviceWorker, 'addEventListener');
  vi.spyOn(serviceWorker, 'removeEventListener');
  const channels = [];
  vi.stubGlobal('MessageChannel', class {
    constructor() {
      this.port1 = { close: vi.fn(), onmessage: null };
      this.port2 = { close: vi.fn() };
      channels.push(this);
    }
  });
  return { active, registration, serviceWorker, channels };
}

async function flush() { for (let index = 0; index < 5; index++) await Promise.resolve(); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Zero capsule preparation', () => {
  it('checks every fresh byte before passing one complete source image to atomic seed', async () => {
    const f = image(), store = memoryStore();
    const read = vi.fn(async path => {
      expect(store.files.size).toBe(0);
      expect(store.seed).not.toHaveBeenCalled();
      return f.files[path];
    });
    const result = await prepareZero(store, read);
    expect(result).toEqual({ source: f.source, config: f.config, version: hash(f.files[SOURCE]), legacy: false });
    expect(read.mock.calls.map(([path]) => path)).toEqual([SOURCE, ...f.source.files.map(entry => '/' + entry.path)]);
    expect(store.seed).toHaveBeenCalledExactlyOnceWith(f.files);
    expect(Object.fromEntries(store.files)).toEqual(f.files);
  });

  it('hash-checks returning owned source without network or replacement and preserves private state', async () => {
    const f = image(), original = { ...f.files, '/state/conversation.json': 'owned conversation' };
    const store = memoryStore(original), read = vi.fn();
    expect(await prepareZero(store, read)).toMatchObject({ legacy: false, version: hash(f.files[SOURCE]) });
    expect(store.read.mock.calls.map(([path]) => path)).toEqual([SOURCE, ...f.source.files.map(entry => '/' + entry.path)]);
    expect(read).not.toHaveBeenCalled();
    expect(store.seed).not.toHaveBeenCalled();
    expect(Object.fromEntries(store.files)).toEqual(original);
  });

  it.each(['fresh', 'returning'])('rejects same-length corruption in %s source before mutation', async mode => {
    const f = image();
    f.files['/zero/main.js'] = f.files['/zero/main.js'].replace('source', 'forged');
    const store = memoryStore(mode === 'returning' ? f.files : {}), before = [...store.files];
    const read = vi.fn(async path => f.files[path]);
    await expect(prepareZero(store, read)).rejects.toThrow('Zero source changed or missing: /zero/main.js');
    expect([...store.files]).toEqual(before);
    expect(store.seed).not.toHaveBeenCalled();
    if (mode === 'returning') expect(read).not.toHaveBeenCalled();
  });

  it.each(['fresh', 'returning'])('rejects missing %s bytes without installing any source', async mode => {
    const f = image(); delete f.files['/zero/main.js'];
    const store = memoryStore(mode === 'returning' ? f.files : {}), before = [...store.files];
    await expect(prepareZero(store, async path => f.files[path])).rejects.toThrow('/zero/main.js');
    expect([...store.files]).toEqual(before);
    expect(store.seed).not.toHaveBeenCalled();
  });

  it('rejects incorrect UTF-8 length even when the content hash matches', async () => {
    const f = image(), entry = f.source.files.find(item => item.path === 'zero/main.js');
    entry.bytes = f.files['/zero/main.js'].length;
    f.files[SOURCE] = JSON.stringify(f.source);
    const store = memoryStore();
    await expect(prepareZero(store, async path => f.files[path])).rejects.toThrow('/zero/main.js');
    expect(store.seed).not.toHaveBeenCalled();
    expect(store.files.size).toBe(0);
  });

  it.each(['{', '{}'])('rejects malformed saved descriptors without fetching or overwriting: %s', async text => {
    const store = memoryStore({ [SOURCE]: text, '/owned.txt': 'keep' }), read = vi.fn();
    await expect(prepareZero(store, read)).rejects.toBeInstanceOf(Error);
    expect(read).not.toHaveBeenCalled();
    expect(store.seed).not.toHaveBeenCalled();
    expect(Object.fromEntries(store.files)).toEqual({ [SOURCE]: text, '/owned.txt': 'keep' });
  });

  it('rejects a hash-valid boot configuration that selects a different capsule', async () => {
    const f = image({ schema: 'reploid.zero.boot/v1', ...boot, main: 'zero/other.js' });
    const store = memoryStore();
    await expect(prepareZero(store, async path => f.files[path])).rejects.toThrow('configuration does not match');
    expect(store.seed).not.toHaveBeenCalled();
  });

  it('recognizes any unknown nonempty namespace as legacy without network or writes', async () => {
    const original = { '/unknown-owned-source.js': 'original source', '/state/work.txt': 'saved work' };
    const store = memoryStore(original), read = vi.fn();
    await expect(prepareZero(store, read)).resolves.toEqual({ legacy: true });
    expect(read).not.toHaveBeenCalled();
    expect(store.seed).not.toHaveBeenCalled();
    expect(Object.fromEntries(store.files)).toEqual(original);
  });

  it('preserves a competing writer that wins after the initial empty check', async () => {
    const f = image(), store = memoryStore();
    const last = '/' + f.source.files.at(-1).path;
    const read = async path => {
      if (path === last) store.files.set('/racing-owner.txt', 'do not erase');
      return f.files[path];
    };
    await expect(prepareZero(store, read)).rejects.toThrow('Existing VFS is preserved');
    expect(store.seed).toHaveBeenCalledOnce();
    expect(Object.fromEntries(store.files)).toEqual({ '/racing-owner.txt': 'do not erase' });
  });
});

describe('Zero capsule boot caller and error rendering', () => {
  it('opens the selected instance, registers it, and gives saved main the verified host ports', async () => {
    const f = image(), store = memoryStore(f.files), { win, mount } = browser();
    const order = [], result = { dispose: vi.fn() };
    const openStore = vi.fn(async () => { order.push('open'); expect(win.REPLOID_INSTANCE_ID).toBe('saved_a'); return store; });
    const connect = vi.fn(async () => { order.push('connect'); expect(win.getReploidMode()).toBe('zero'); });
    const main = vi.fn(async ports => { order.push('main'); expect(ports.store).toBe(store); expect(ports.mount).toBe(mount); return result; });
    const load = vi.fn(async () => { order.push('load'); return { main }; });
    const read = vi.fn();
    expect(await bootZero({ win, openStore, connect, load, read })).toBe(result);
    const query = `?instance=saved_a&v=${hash(f.files[SOURCE])}`;
    expect(order).toEqual(['open', 'connect', 'load', 'main']);
    expect(connect).toHaveBeenCalledExactlyOnceWith('saved_a', win.navigator.serviceWorker);
    expect(load).toHaveBeenCalledExactlyOnceWith('/zero/main.js' + query);
    expect(main).toHaveBeenCalledExactlyOnceWith({ store, mount, source: f.source, config: f.config,
      version: hash(f.files[SOURCE]), legacy: false, query });
    expect(read).not.toHaveBeenCalled();
    expect(store.close).not.toHaveBeenCalled();
  });

  it('routes an unknown saved namespace to legacy startup after closing the capsule handle', async () => {
    const { win } = browser(), original = { '/owned.js': 'existing source' }, store = memoryStore(original);
    const read = vi.fn(), connect = vi.fn();
    const load = vi.fn(async () => { expect(store.close).toHaveBeenCalledOnce(); });
    await expect(bootZero({ win, openStore: async () => store, read, connect, load })).resolves.toEqual({ legacy: true });
    expect(load).toHaveBeenCalledExactlyOnceWith('/kernel/boot.js?v=legacy-build');
    expect(connect).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(store.seed).not.toHaveBeenCalled();
    expect(Object.fromEntries(store.files)).toEqual(original);
  });

  it('uses the default network port with bypass and no-store for fresh source', async () => {
    const f = image(), { win } = browser(), store = memoryStore();
    const fetch = vi.fn(async path => ({ ok: true, text: async () => f.files[path] }));
    vi.stubGlobal('fetch', fetch);
    await bootZero({ win, openStore: async () => store, connect: async () => {}, load: async () => ({ main: async () => 'ready' }) });
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([SOURCE, ...f.source.files.map(entry => '/' + entry.path)]);
    for (const [, options] of fetch.mock.calls) expect(options).toEqual({ cache: 'no-store', headers: { 'x-reploid-vfs-bypass': '1' } });
    expect(Object.fromEntries(store.files)).toEqual(f.files);
  });

  it.each(['open', 'prepare', 'connect', 'load', 'main'])('catches actual %s failure, renders inert error text, and rethrows the original error', async stage => {
    const { win, mount } = browser(), store = memoryStore(image().files);
    const failure = new Error('Failure <img src=x onerror=unsafe()>');
    const fail = async () => { throw failure; };
    const main = vi.fn(stage === 'main' ? fail : async () => 'ready');
    const load = vi.fn(stage === 'load' ? fail : async () => ({ main }));
    const connect = vi.fn(stage === 'connect' ? fail : async () => {});
    if (stage === 'prepare') store.read.mockImplementation(fail);
    await expect(bootZero({ win, openStore: stage === 'open' ? fail : async () => store, connect, load })).rejects.toBe(failure);
    expect(mount.textContent).toBe(`Zero could not start: ${failure.message}`);
    expect(mount.getAttribute('role')).toBe('alert');
    expect(mount.querySelector('img')).toBeNull();
    expect(store.close).toHaveBeenCalledTimes(stage === 'open' ? 0 : 1);
    if (['open', 'prepare'].includes(stage)) expect(connect).not.toHaveBeenCalled();
    if (['open', 'prepare', 'connect'].includes(stage)) expect(load).not.toHaveBeenCalled();
    if (stage !== 'main') expect(main).not.toHaveBeenCalled();
  });

  it('renders a network HTTP failure without seeding or continuing to worker setup', async () => {
    const { win, mount } = browser(), store = memoryStore(), connect = vi.fn(), load = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(bootZero({ win, openStore: async () => store, connect, load })).rejects.toThrow('Missing Zero source: /zero/source.json (503)');
    expect(mount.getAttribute('role')).toBe('alert');
    expect(store.files.size).toBe(0);
    expect(store.seed).not.toHaveBeenCalled();
    expect(store.close).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});

describe('Zero service-worker instance registration', () => {
  it('waits for this registration to control the page, then waits for a positive instance acknowledgement', async () => {
    vi.useFakeTimers();
    const f = worker({ controlled: false });
    let settled = false;
    const connecting = connectZeroWorker('owned-instance', f.serviceWorker).then(() => { settled = true; });
    await flush();
    expect(f.serviceWorker.register).toHaveBeenCalledExactlyOnceWith('/sw.js?v=zero-capsule-v1', { scope: '/zero', updateViaCache: 'none' });
    expect(f.active.postMessage).not.toHaveBeenCalled();
    f.serviceWorker.dispatchEvent(new Event('controllerchange'));
    await flush();
    expect(f.channels).toHaveLength(0);
    f.serviceWorker.controller = f.active;
    f.serviceWorker.dispatchEvent(new Event('controllerchange'));
    await flush();
    expect(f.active.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'REGISTER_INSTANCE',
      data: { instanceId: 'owned-instance', surfaceId: 'zero' } }, [f.channels[0].port2]);
    expect(settled).toBe(false);
    f.channels[0].port1.onmessage({ data: { success: true } });
    await connecting;
    expect(settled).toBe(true);
    expect(f.channels[0].port1.close).toHaveBeenCalledOnce();
    expect(f.serviceWorker.removeEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, {}, { success: false }, { success: 'true' }])('rejects a nonpositive acknowledgement: %j', async acknowledgement => {
    vi.useFakeTimers();
    const f = worker(), connecting = connectZeroWorker('owned-instance', f.serviceWorker);
    const rejected = expect(connecting).rejects.toThrow('instance registration failed');
    await flush();
    f.channels[0].port1.onmessage({ data: acknowledgement });
    await rejected;
    expect(f.channels[0].port1.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a different controlling worker without sending instance data to it', async () => {
    vi.useFakeTimers();
    const f = worker({ controlled: false }), stranger = f.serviceWorker.controller;
    const connecting = connectZeroWorker('private-instance', f.serviceWorker);
    const rejected = expect(connecting).rejects.toThrow('did not take control');
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(stranger.postMessage).not.toHaveBeenCalled();
    expect(f.active.postMessage).not.toHaveBeenCalled();
    expect(f.channels).toHaveLength(0);
    expect(f.serviceWorker.removeEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the reply port when instance acknowledgement never arrives', async () => {
    vi.useFakeTimers();
    const f = worker(), connecting = connectZeroWorker('owned-instance', f.serviceWorker);
    const rejected = expect(connecting).rejects.toThrow('instance registration timed out');
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(f.channels[0].port1.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up immediately when sending instance registration throws', async () => {
    vi.useFakeTimers();
    const f = worker(), failure = new Error('Worker detached during registration');
    f.active.postMessage.mockImplementationOnce(() => { throw failure; });
    await expect(connectZeroWorker('owned-instance', f.serviceWorker)).rejects.toBe(failure);
    expect(f.channels[0].port1.close).toHaveBeenCalledOnce();
    expect(f.channels[0].port2.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed when service workers are absent or registration is denied', async () => {
    await expect(connectZeroWorker('owned-instance', null)).rejects.toThrow('Service Worker is required');
    const failure = new Error('Registration denied'), f = worker();
    f.serviceWorker.register.mockRejectedValueOnce(failure);
    await expect(connectZeroWorker('owned-instance', f.serviceWorker)).rejects.toBe(failure);
    expect(f.active.postMessage).not.toHaveBeenCalled();
    expect(f.channels).toHaveLength(0);
  });
});
