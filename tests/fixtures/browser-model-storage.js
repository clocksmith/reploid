/**
 * An in-memory stand-in for the browser storage the host's model-file cache uses (apps/poolday/host/work-model-files.js):
 * an OPFS directory tree (navigator.storage.getDirectory), the storage estimate and Web Locks. No GPU, no browser.
 */
const notFound = () => Object.assign(new Error('Not found'), { name: 'NotFoundError' });

function directory() {
  const files = new Map(), folders = new Map();
  return {
    files,
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!folders.has(name)) { if (!create) throw notFound(); folders.set(name, directory()); }
      return folders.get(name);
    },
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name)) { if (!create) throw notFound(); files.set(name, { bytes: new Uint8Array(0), lastModified: Date.now() }); }
      const entry = files.get(name);
      return { kind: 'file', getFile: async () => ({ size: entry.bytes.byteLength, lastModified: entry.lastModified, arrayBuffer: async () => entry.bytes.slice().buffer }),
        createWritable: async () => { let pending = new Uint8Array(0);
          return { write: async bytes => { pending = new Uint8Array(bytes); }, close: async () => { entry.bytes = pending; entry.lastModified = Date.now(); }, abort: async () => {} }; } };
    },
    async removeEntry(name) { if (!files.delete(name) && !folders.delete(name)) throw notFound(); },
    async *entries() {
      for (const name of [...files.keys()]) yield [name, await this.getFileHandle(name)];
      for (const [name, folder] of folders) yield [name, { kind: 'directory', ...folder }];
    }
  };
}

/** The stand-in `navigator` (for vi.stubGlobal) and its OPFS root, so a test can read or corrupt stored files. */
export function browserModelStorage({ quota = 1e12 } = {}) {
  const root = directory();
  const locks = { request: async (name, options, callback) => (callback ?? options)() };
  return { root, navigator: { storage: { getDirectory: async () => root, estimate: async () => ({ quota, usage: 0 }) }, locks } };
}
