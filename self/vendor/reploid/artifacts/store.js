import { snapshotJson } from '../config/index.js';

export function createMemoryStore() {
  const entries = new Map();
  let closed = false;
  const check = () => { if (closed) throw new Error('Store is closed'); };
  return Object.freeze({
    async get(key) { check(); return entries.has(key) ? snapshotJson(entries.get(key)) : null; },
    async set(key, value) { check(); entries.set(String(key), snapshotJson(value)); },
    async delete(key) { check(); return entries.delete(String(key)); },
    async keys(prefix = '') { check(); return [...entries.keys()].filter(key => key.startsWith(prefix)).sort(); },
    async close() { closed = true; entries.clear(); }
  });
}

export function createVfs({ store, now = Date.now, emit = () => {} }) {
  if (!store?.get || !store?.set || !store?.keys) throw new TypeError('VFS requires a store port');
  const normalize = path => {
    if (typeof path !== 'string' || !path.trim()) throw new TypeError('VFS path is required');
    const value = '/' + path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (value.split('/').some(part => part === '..' || part === '.')) throw new TypeError('VFS path traversal is not allowed');
    return value;
  };
  const changed = event => {
    emit('vfs:file_changed', event);
    emit('vfs:file-changed', event);
  };
  const stat = async path => {
    const entry = await store.get(normalize(path));
    return entry ? { path: entry.path, size: entry.size, updated: entry.updated, type: 'file' } : null;
  };
  const write = async (path, content) => {
    const key = normalize(path);
    if (typeof content !== 'string') throw new TypeError('VFS stores text; use an artifact store for binary data');
    const previous = await stat(key);
    const updated = now();
    await store.set(key, { path: key, content, size: content.length, updated, type: 'file' });
    changed({ path: key, operation: previous ? 'update' : 'write', size: content.length,
      beforeSize: previous?.size || 0, afterSize: content.length, timestamp: updated });
    return true;
  };
  const read = async path => {
    const entry = await store.get(normalize(path));
    if (!entry) throw new Error(`File not found: ${path}`);
    return entry.content;
  };
  const list = async (path = '/') => {
    const prefix = normalize(path).replace(/\/$/, '') + '/';
    return store.keys(prefix);
  };
  return Object.freeze({
    init: async () => true, read, write, list, stat,
    exists: async path => !!await stat(path),
    async delete(path) {
      const key = normalize(path), previous = await stat(key);
      await store.delete(key);
      changed({ path: key, operation: 'delete', beforeSize: previous?.size || 0, afterSize: 0, timestamp: now() });
      return true;
    },
    isEmpty: async () => (await store.keys('/')).length === 0,
    mkdir: async path => { normalize(path); return true; },
    async clear() { for (const path of await store.keys('/')) await store.delete(path); return true; },
    async exportAll() {
      const files = {};
      for (const path of await store.keys('/')) {
        const entry = await store.get(path);
        files[path] = { content: entry.content, size: entry.size, updated: entry.updated };
      }
      return { files, meta: { exportedAt: now(), version: '2.0', fileCount: Object.keys(files).length } };
    },
    async importAll(data, clearFirst = false) {
      if (!data?.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new TypeError('Invalid VFS import');
      const entries = Object.entries(data.files).map(([path, entry]) => {
        const content = typeof entry === 'string' ? entry : entry.content;
        if (typeof content !== 'string') throw new TypeError('Invalid VFS import content');
        return [normalize(path), content];
      });
      if (clearFirst) for (const path of await store.keys('/')) await store.delete(path);
      for (const [path, content] of entries) await write(path, content);
      return entries.length;
    }
  });
}
