import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let server, origin;
test.beforeAll(async () => {
  const root = path.resolve('self');
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>VFS storage contract</title>');
        return;
      }
      const file = path.resolve(root, pathname.replace(/^\/self\//, '').replace(/^\//, ''));
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
});

test('existing inline-key VFS files survive writes and connection replacement', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { default: VFS } = await import('/self/core/vfs.js');
    const { getScopedReploidVfsDbName } = await import('/self/instance.js');
    const opening = indexedDB.open(getScopedReploidVfsDbName(), 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('files', { keyPath: 'path' });
    const db = await new Promise((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ path: '/existing.txt', content: 'retained', size: 8, updated: 1, type: 'file' });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    db.close();
    let vfs = VFS.factory({});
    try {
      await vfs.init();
      const before = await vfs.read('/existing.txt');
      await vfs.write('/new.txt', 'Unicode: café \u{1F9EA}');
      await vfs.close();
      vfs = VFS.factory({});
      await vfs.init();
      return { before, existing: await vfs.read('/existing.txt'), added: await vfs.read('/new.txt'), files: await vfs.list() };
    } finally { await vfs.close(); }
  });
  expect(result).toEqual({ before: 'retained', existing: 'retained', added: 'Unicode: café \u{1F9EA}', files: ['/existing.txt', '/new.txt'] });
});

test('init opens storage once before any file operation and rejects after close', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { default: VFS } = await import('/self/core/vfs.js');
    const { getScopedReploidVfsDbName } = await import('/self/instance.js');
    const nativeOpen = IDBFactory.prototype.open;
    let opens = 0;
    IDBFactory.prototype.open = function(...args) { opens++; return nativeOpen.apply(this, args); };
    const vfs = VFS.factory({});
    try {
      const ready = await Promise.all([vfs.init(), vfs.init(), vfs.init()]);
      const exists = (await indexedDB.databases()).some(db => db.name === getScopedReploidVfsDbName());
      await vfs.close();
      let closedError = null;
      try { await vfs.init(); } catch (error) { closedError = error.message; }
      return { ready, exists, opens, closedError };
    } finally { IDBFactory.prototype.open = nativeOpen; await vfs.close(); }
  });
  expect(result.ready).toEqual([true, true, true]);
  expect(result.exists).toBe(true);
  expect(result.opens).toBe(1);
  expect(result.closedError).toContain('closed');
});

test('init surfaces a native database version failure before declaring readiness', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { default: VFS } = await import('/self/core/vfs.js');
    const { getScopedReploidVfsDbName } = await import('/self/instance.js');
    const opening = indexedDB.open(getScopedReploidVfsDbName(), 2);
    opening.onupgradeneeded = () => opening.result.createObjectStore('files', { keyPath: 'path' });
    const db = await new Promise((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    db.close();
    const vfs = VFS.factory({});
    try { await vfs.init(); return null; }
    catch (error) { return error.name; }
    finally { await vfs.close(); }
  });
  expect(result).toBe('VersionError');
});

test('an aborted write emits no committed change and closing one VFS leaves another usable', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { default: VFS } = await import('/self/core/vfs.js');
    const changes = [];
    const first = VFS.factory({ EventBus: { emit: (name, event) => changes.push({ name, event }) } });
    const second = VFS.factory({});
    const nativePut = IDBObjectStore.prototype.put;
    try {
      await Promise.all([first.init(), second.init()]);
      IDBObjectStore.prototype.put = function(...args) {
        const request = nativePut.apply(this, args);
        request.addEventListener('success', () => this.transaction.abort());
        return request;
      };
      let error = null;
      try { await first.write('/aborted.txt', 'must not commit'); } catch (failure) { error = failure.message; }
      IDBObjectStore.prototype.put = nativePut;
      const absent = !await second.exists('/aborted.txt');
      await first.close();
      await second.write('/live.txt', 'still usable');
      return { error, absent, changes, live: await second.read('/live.txt') };
    } finally {
      IDBObjectStore.prototype.put = nativePut;
      await Promise.all([first.close(), second.close()]);
    }
  });
  expect(result.error).toContain('abort');
  expect(result.absent).toBe(true);
  expect(result.changes).toEqual([]);
  expect(result.live).toBe('still usable');
});

test('Verification Worker permits only the extracted storage owner and preserves other rejections', async ({ page }) => {
  await page.goto(origin);
  const results = await page.evaluate(async () => {
    const storageOwner = '/vendor/reploid/adapters/browser.js';
    const verify = snapshot => new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 10000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
    });
    const directStorage = "export const open = () => indexedDB.open('storage');";
    return {
      storage: await verify({
        [storageOwner]: directStorage,
        '/vendor/reploid/adapters/neighbor.js': directStorage,
        '/vendor/reploid/adapters/browser.js/child.js': directStorage,
        '/tools/Storage.js': directStorage,
        '/apps/storage.js': directStorage
      }),
      otherAccess: await verify({ [storageOwner]: "export const read = () => localStorage.getItem('secret');" }),
      syntax: await verify({ [storageOwner]: 'export const incomplete =' })
    };
  });
  const rejectedStoragePaths = results.storage.details.patternViolations
    .filter(violation => violation.patternId === 'indexeddb').map(violation => violation.path).sort();
  expect(rejectedStoragePaths).toEqual([
    '/apps/storage.js', '/tools/Storage.js',
    '/vendor/reploid/adapters/browser.js/child.js', '/vendor/reploid/adapters/neighbor.js'
  ]);
  expect(results.otherAccess.passed).toBe(false);
  expect(results.otherAccess.errors.join('\n')).toContain('localStorage');
  expect(results.syntax.passed).toBe(false);
  expect(results.syntax.errors.join('\n')).toContain('Syntax Error');
});
