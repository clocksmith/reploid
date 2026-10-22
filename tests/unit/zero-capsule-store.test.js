import { afterEach, describe, expect, it, vi } from 'vitest';
import { openZeroStore } from '../../self/zero/store.js';
import { getScopedReploidVfsDbName } from '../../self/instance.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Narrow IDB transport double: serialized transactions, request events, atomic
// commit/abort and connection cleanup. It is not evidence about browser IndexedDB.
function indexedDatabase({ delayOpen = false } = {}) {
  const states = new Map(), connections = [], requests = [], transactions = [];
  const database = { beforeCommit: null, states, connections, requests, transactions };
  database.open = vi.fn((name, version) => {
    const request = {};
    const succeed = () => {
      const fresh = !states.has(name);
      if (fresh) states.set(name, { files: new Map(), queue: [], hasStore: false });
      const state = states.get(name);
      const connection = { close: vi.fn(),
        objectStoreNames: { contains: storeName => storeName === 'files' && state.hasStore },
        createObjectStore: vi.fn((storeName, options) => {
          expect(storeName).toBe('files'); expect(options).toEqual({ keyPath: 'path' }); state.hasStore = true;
        }),
        transaction: vi.fn((storeName, mode) => {
          expect(storeName).toBe('files'); expect(state.hasStore).toBe(true);
          const operations = [];
          let draft, stopped = false;
          const finish = (event, error) => {
            if (stopped) return;
            stopped = true;
            if (event === 'complete' && mode === 'readwrite') state.files = draft;
            tx.error = error;
            state.queue.splice(state.queue.indexOf(pump), 1);
            tx['on' + event]?.();
            queueMicrotask(() => state.queue[0]?.());
          };
          const tx = { mode, abort: vi.fn(() => finish('abort', new DOMException('Aborted', 'AbortError'))) };
          const requestFor = action => {
            const item = {};
            operations.push(() => { item.result = action(); item.onsuccess?.(); });
            return item;
          };
          const files = {
            get: path => requestFor(() => draft.get(path)),
            getAllKeys: () => requestFor(() => [...draft.keys()]),
            count: () => requestFor(() => draft.size),
            put: record => requestFor(() => { draft.set(record.path, structuredClone(record)); return record.path; }),
            add: record => requestFor(() => {
              if (draft.has(record.path)) throw new DOMException('Duplicate path', 'ConstraintError');
              draft.set(record.path, structuredClone(record)); return record.path;
            }),
            delete: path => requestFor(() => draft.delete(path))
          };
          tx.objectStore = () => files;
          const pump = () => {
            if (stopped || state.queue[0] !== pump) return;
            draft ??= new Map(state.files);
            if (operations.length) {
              try { operations.shift()(); }
              catch (error) { finish('abort', error); }
              queueMicrotask(pump);
            } else {
              const hook = mode === 'readwrite' ? database.beforeCommit : null;
              if (hook) database.beforeCommit = null;
              Promise.resolve(hook?.(tx)).then(() => finish('complete'));
            }
          };
          state.queue.push(pump);
          transactions.push(tx);
          queueMicrotask(pump);
          return tx;
        }) };
      connections.push(connection);
      request.result = connection;
      if (fresh) request.onupgradeneeded?.({ oldVersion: 0, newVersion: version });
      request.onsuccess?.();
    };
    requests.push({ request, succeed });
    if (!delayOpen) queueMicrotask(succeed);
    return request;
  });
  return database;
}

const originalUrl = window.location.href;
const originalInstance = window.REPLOID_INSTANCE_ID;
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  window.history.replaceState(null, '', originalUrl);
  if (originalInstance === undefined) delete window.REPLOID_INSTANCE_ID;
  else window.REPLOID_INSTANCE_ID = originalInstance;
});

describe('Zero store IDB transport and namespace contract', () => {
  it('reopens the existing scoped database without replacing owned records or metadata', async () => {
    const database = indexedDatabase();
    window.history.replaceState(null, '', '/zero?instance=owned-instance');
    delete window.REPLOID_INSTANCE_ID;
    const name = getScopedReploidVfsDbName('owned-instance', 'zero');
    const owned = { path: '/state/owned.json', content: 'old conversation', size: 16,
      updated: 123, type: 'file', privateMetadata: 'retain' };
    database.states.set(name, { files: new Map([[owned.path, owned]]), queue: [], hasStore: true });
    const store = await openZeroStore({ database });
    expect(database.open).toHaveBeenCalledExactlyOnceWith(name, 1);
    expect(await store.read('/state/owned.json')).toBe(owned.content);
    await expect(store.seed({ '/zero/boot.js': 'new seed' })).rejects.toThrow('Existing VFS is preserved');
    expect([...database.states.get(name).files.values()]).toEqual([owned]);
    expect(database.connections[0].createObjectStore).not.toHaveBeenCalled();
    store.close();
    const reopened = await openZeroStore({ database });
    expect(await reopened.read('/state/owned.json')).toBe(owned.content);
    expect([...database.states.get(name).files.values()]).toEqual([owned]);
    reopened.close();
  });

  it('isolates named instances and surface namespaces while retaining legacy record shape', async () => {
    const database = indexedDatabase();
    const names = [getScopedReploidVfsDbName('one', 'zero'), getScopedReploidVfsDbName('two', 'zero'),
      getScopedReploidVfsDbName('one', 'x')];
    const stores = await Promise.all(names.map(name => openZeroStore({ name, database })));
    for (let index = 0; index < stores.length; index++) await stores[index].write('/state.txt', `state-${index}`);
    for (let index = 0; index < stores.length; index++) {
      expect(await stores[index].read('/state.txt')).toBe(`state-${index}`);
      expect(database.states.get(names[index]).files.get('/state.txt')).toEqual({ path: '/state.txt',
        content: `state-${index}`, size: 7, updated: expect.any(Number), type: 'file' });
      stores[index].close();
    }
    expect(database.states.size).toBe(3);
  });

  it('uses existing self aliases, keeps tool paths distinct, and lists only directory-boundary matches', async () => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'aliases', database });
    await store.write('/self/zero/main.js', 'capsule');
    await store.write('/self/tools/Read.js', 'owned tool');
    await store.write('/tools/Read.js', 'host tool');
    await store.write('/zero/sub/a.js', 'child');
    await store.write('/zero-other/a.js', 'other prefix');
    await store.write('/zero', 'exact path');
    expect(await store.read('/zero/main.js')).toBe('capsule');
    expect(await store.read('/self/zero/main.js')).toBe('capsule');
    expect(await store.read('/self/tools/Read.js')).toBe('owned tool');
    expect(await store.read('/tools/Read.js')).toBe('host tool');
    expect(await store.list('/self/zero/')).toEqual(['/zero', '/zero/main.js', '/zero/sub/a.js']);
    expect(await store.list('/self/tools/')).toEqual(['/self/tools/Read.js']);
    expect(await store.list()).toEqual(['/self/tools/Read.js', '/tools/Read.js', '/zero', '/zero-other/a.js', '/zero/main.js', '/zero/sub/a.js']);
    expect(await store.exists('/absent')).toBe(false);
    await store.delete('/self/zero/main.js');
    expect(await store.read('/zero/main.js')).toBeNull();
    expect(await store.exists('/self/tools/Read.js')).toBe(true);
    store.close();
  });

  it('commits a fresh seed once, and serializes a racing second seed without overwriting either owner', async () => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'race', database });
    const other = await openZeroStore({ name: 'race', database });
    const first = { '/zero/source.json': 'source descriptor', '/zero/main.js': 'first main' };
    const results = await Promise.allSettled([store.seed(first), other.seed({ '/zero/main.js': 'replacement' })]);
    expect(results[0]).toEqual({ status: 'fulfilled', value: true });
    expect(results[1].status).toBe('rejected');
    expect(results[1].reason.message).toContain('Existing VFS is preserved');
    expect(await store.list()).toEqual(Object.keys(first).sort());
    expect(await other.read('/zero/main.js')).toBe('first main');
    store.close(); other.close();
  });

  it('does not resolve or expose any seed records before the transaction commit boundary', async () => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'atomic', database });
    const reached = deferred(), release = deferred();
    database.beforeCommit = () => { reached.resolve(); return release.promise; };
    let settled = false;
    const seed = store.seed({ '/a': 'one', '/b': 'two' }).then(value => { settled = true; return value; });
    await reached.promise;
    expect(settled).toBe(false);
    expect(database.states.get('atomic').files.size).toBe(0);
    release.resolve();
    await expect(seed).resolves.toBe(true);
    expect(settled).toBe(true);
    expect(await store.list()).toEqual(['/a', '/b']);
    store.close();
  });

  it.each([
    null,
    { '/valid': 'staged first', '/bad/../path': 'invalid path' },
    { '/valid': 'staged first', '/bad': 1 },
    { '/valid': 'staged first', '/bad': null },
    { '/valid': 'staged first', '/self/valid': 'alias collision' }
  ])('aborts malformed or colliding seed input with no partial commit: %j', async entries => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'invalid-seed', database });
    await expect(store.seed(entries)).rejects.toBeInstanceOf(Error);
    expect(await store.list()).toEqual([]);
    expect(database.states.get('invalid-seed').files.size).toBe(0);
    await expect(store.seed({ '/valid': 'retry after rejection' })).resolves.toBe(true);
    expect(await store.read('/valid')).toBe('retry after rejection');
    store.close();
  });

  it('does not open a transaction for an already aborted write', async () => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'aborted', database });
    const controller = new AbortController(), reason = new Error('Cancelled before start');
    controller.abort(reason);
    await expect(store.write('/state', 'unwanted', { signal: controller.signal })).rejects.toBe(reason);
    expect(database.transactions).toHaveLength(0);
    expect(database.states.get('aborted').files.size).toBe(0);
    store.close();
  });

  it('aborts deletion before commit without removing saved work', async () => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'abort-delete', database });
    await store.write('/state', 'preserved');
    const controller = new AbortController(), reached = deferred(), release = deferred();
    database.beforeCommit = () => { reached.resolve(); return release.promise; };
    const deletion = store.delete('/state', { signal: controller.signal });
    const rejected = expect(deletion).rejects.toThrow();
    await reached.promise;
    controller.abort();
    await rejected;
    release.resolve();
    expect(await store.read('/state')).toBe('preserved');
    store.close();
  });

  it('aborts after request success but before commit, preserving prior state and removing the signal listener', async () => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'abort-boundary', database });
    await store.write('/state', 'previous state');
    const controller = new AbortController(), reason = new Error('Cancelled at commit');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reached = deferred(), release = deferred();
    database.beforeCommit = () => { reached.resolve(); return release.promise; };
    const writing = store.write('/state', 'must not commit', { signal: controller.signal });
    const rejected = expect(writing).rejects.toBe(reason);
    await reached.promise;
    controller.abort(reason);
    await rejected;
    release.resolve();
    expect(await store.read('/state')).toBe('previous state');
    expect(database.transactions[1].abort).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    store.close();
  });

  it('removes cancellation listeners on successful commit so late abort cannot undo saved state', async () => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'committed', database });
    const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener');
    await store.write('/state', 'committed', { signal: controller.signal });
    controller.abort(new Error('Too late'));
    expect(database.transactions[0].abort).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(await store.read('/state')).toBe('committed');
    store.close();
  });

  it.each(['relative', '', '/a/../b', '/a/./b', '/a//b', '/a/', '/a\\b', '/a%2fb', '/a?query', '/a#fragment', '/a b', '/a\u0000b'])
    ('rejects unsafe paths across read, write, delete and list without changing existing data: %j', async path => {
      const database = indexedDatabase(), store = await openZeroStore({ name: 'paths', database });
      await store.write('/owned', 'keep');
      await expect(store.read(path)).rejects.toThrow('Invalid VFS path');
      await expect(store.write(path, 'replace')).rejects.toThrow('Invalid VFS path');
      await expect(store.delete(path)).rejects.toThrow('Invalid VFS path');
      if (path !== '/a/') await expect(store.list(path)).rejects.toThrow('Invalid VFS path');
      else expect(await store.list(path)).toEqual([]);
      expect(await store.list()).toEqual(['/owned']);
      expect(await store.read('/owned')).toBe('keep');
      store.close();
    });

  it('closes on version change and rejects further operations without creating transactions', async () => {
    const database = indexedDatabase(), store = await openZeroStore({ name: 'version-change', database });
    database.connections[0].onversionchange();
    expect(database.connections[0].close).toHaveBeenCalledOnce();
    for (const operation of [() => store.read('/a'), () => store.list(), () => store.write('/a', 'b'),
      () => store.delete('/a'), () => store.seed({ '/a': 'b' })]) await expect(operation()).rejects.toThrow('VFS is closed');
    expect(database.transactions).toHaveLength(0);
  });

  it('rejects when IndexedDB is unavailable', async () => {
    await expect(openZeroStore({ database: null })).rejects.toThrow('IndexedDB is required');
  });

  it.each(['timeout', 'blocked', 'error'])('rejects %s opening and closes a late successful connection', async event => {
    vi.useFakeTimers();
    const database = indexedDatabase({ delayOpen: true });
    const opening = openZeroStore({ name: 'late-open', database });
    const rejected = expect(opening).rejects.toThrow(event === 'timeout' ? 'VFS open timed out' : event === 'blocked' ? 'VFS is blocked' : 'Disk unavailable');
    const { request, succeed } = database.requests[0];
    if (event === 'timeout') await vi.advanceTimersByTimeAsync(10000);
    else if (event === 'blocked') request.onblocked();
    else { request.error = new Error('Disk unavailable'); request.onerror(); }
    await rejected;
    succeed();
    expect(database.connections[0].close).toHaveBeenCalledOnce();
    expect(database.transactions).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
