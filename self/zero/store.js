import { getScopedReploidVfsDbName } from '../instance.js';

const key = path => {
  if (typeof path !== 'string' || !path.startsWith('/') || /[\\%?#\s\u0000-\u001f]/.test(path)
    || path.split('/').slice(1).some(part => !part || part === '.' || part === '..')) {
    if (path === '/') return path;
    throw new Error('Invalid VFS path');
  }
  return path.startsWith('/self/') && path !== '/self/tools' && !path.startsWith('/self/tools/') ? path.slice(5) : path;
};

/** Uses the existing instance database; seeding is one empty-store-only transaction. */
export async function openZeroStore({ name = getScopedReploidVfsDbName(), database = globalThis.indexedDB } = {}) {
  if (!database) throw new Error('IndexedDB is required');
  const db = await new Promise((resolve, reject) => {
    const request = database.open(name, 1);
    let finished = false;
    const fail = reason => { finished = true; clearTimeout(timer); reject(reason); };
    const timer = setTimeout(() => fail(new Error('VFS open timed out')), 10000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files', { keyPath: 'path' });
    };
    request.onsuccess = () => { clearTimeout(timer); if (finished) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => fail(request.error || new Error('VFS is blocked'));
  });
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  const transact = (mode, operation, signal) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('VFS is closed'));
    if (signal?.aborted) return reject(signal.reason);
    const tx = db.transaction('files', mode), files = tx.objectStore('files');
    let result, error;
    const abort = () => { error = signal.reason; try { tx.abort(); } catch {} };
    signal?.addEventListener('abort', abort, { once: true });
    tx.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve(result); };
    tx.onabort = tx.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(error || tx.error || new Error('VFS transaction failed'));
    };
    try { operation(files, value => { result = value; }, reason => { error = reason; tx.abort(); }); }
    catch (reason) { error = reason; tx.abort(); }
  });
  const record = (path, content) => {
    if (typeof content !== 'string') throw new Error('VFS contents must be text');
    return { path: key(path), content, size: content.length, updated: Date.now(), type: 'file' };
  };
  const read = path => transact('readonly', (files, done) => {
    const request = files.get(key(path));
    request.onsuccess = () => done(request.result?.content ?? null);
  });
  const list = (prefix = '/') => transact('readonly', (files, done) => {
    const normalized = prefix === '/' ? '/' : key(prefix.replace(/\/$/, ''));
    const request = files.getAllKeys();
    request.onsuccess = () => done(request.result.filter(path => path === normalized || path.startsWith(normalized === '/' ? '/' : normalized + '/')).sort());
  });
  return {
    read, list,
    exists: async path => (await read(path)) !== null,
    write: (path, content, { signal } = {}) => transact('readwrite', files => files.put(record(path, content)), signal),
    delete: (path, { signal } = {}) => transact('readwrite', files => files.delete(key(path)), signal),
    seed: entries => transact('readwrite', (files, done, fail) => {
      const request = files.count();
      request.onsuccess = () => {
        if (request.result) return fail(new Error('Existing VFS is preserved; seed refused'));
        try {
          for (const [path, content] of Object.entries(entries)) files.add(record(path, content));
          done(true);
        } catch (error) { fail(error); }
      };
    }),
    close: () => { closed = true; db.close(); }
  };
}
