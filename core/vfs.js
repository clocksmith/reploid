/**
 * @fileoverview Virtual File System (VFS)
 * IndexedDB-backed storage.
 *
 * BREAKING: Uses 'reploid-vfs-v2'. Previous v1 data is ignored.
 */

const VFS = {
  metadata: {
    id: 'VFS',
    version: '2.0.0',
    dependencies: ['Utils'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger, Errors } = Utils;

    const DB_NAME = 'reploid-vfs-v2';
    const STORE_FILES = 'files';
    let db = null;

    const openDB = () => {
      return new Promise((resolve, reject) => {
        if (db) return resolve(db);
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = (event) => {
          const d = event.target.result;
          if (!d.objectStoreNames.contains(STORE_FILES)) {
            d.createObjectStore(STORE_FILES, { keyPath: 'path' });
          }
        };

        request.onsuccess = (e) => {
          db = e.target.result;
          logger.info('[VFS] Database connected');
          resolve(db);
        };
        request.onerror = () => reject(new Errors.StateError('Failed to open VFS DB'));
      });
    };

    const normalize = (path) => {
      if (!path || typeof path !== 'string') throw new Errors.ValidationError('Invalid path');
      let clean = path.trim().replace(/\\/g, '/');
      return clean.startsWith('/') ? clean : '/' + clean;
    };

    // --- API ---

    const init = async () => { await openDB(); return true; };

    const write = async (path, content) => {
      await openDB();
      const cleanPath = normalize(path);
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_FILES], 'readwrite');
        const store = tx.objectStore(STORE_FILES);
        const entry = {
          path: cleanPath,
          content,
          size: content.length,
          updated: Date.now(),
          type: 'file'
        };
        store.put(entry).onsuccess = () => resolve(true);
        tx.onerror = () => reject(new Errors.ArtifactError(`Write failed: ${cleanPath}`));
      });
    };

    const read = async (path) => {
      await openDB();
      const cleanPath = normalize(path);
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_FILES], 'readonly');
        const req = tx.objectStore(STORE_FILES).get(cleanPath);
        req.onsuccess = () => {
          req.result ? resolve(req.result.content) : reject(new Errors.ArtifactError(`File not found: ${cleanPath}`));
        };
        req.onerror = () => reject(new Errors.ArtifactError(`Read failed: ${cleanPath}`));
      });
    };

    const remove = async (path) => {
      await openDB();
      const cleanPath = normalize(path);
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_FILES], 'readwrite');
        tx.objectStore(STORE_FILES).delete(cleanPath).onsuccess = () => {
          logger.info(`[VFS] Deleted ${cleanPath}`);
          resolve(true);
        };
      });
    };

    const list = async (dir = '/') => {
      await openDB();
      const cleanDir = normalize(dir);
      const prefix = cleanDir.endsWith('/') ? cleanDir : cleanDir + '/';
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_FILES], 'readonly');
        const req = tx.objectStore(STORE_FILES).getAllKeys();
        req.onsuccess = () => {
          // Filter by prefix (simulating directory structure)
          const all = req.result || [];
          resolve(all.filter(p => p.startsWith(prefix)));
        };
      });
    };

    const stat = async (path) => {
      await openDB();
      const cleanPath = normalize(path);
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_FILES], 'readonly');
        const req = tx.objectStore(STORE_FILES).get(cleanPath);
        req.onsuccess = () => {
          if (req.result) {
            resolve({
              path: req.result.path,
              size: req.result.size,
              updated: req.result.updated,
              type: req.result.type
            });
          } else {
            resolve(null);
          }
        };
      });
    };

    const exists = async (path) => {
      const meta = await stat(path);
      return !!meta;
    };

    const isEmpty = async () => {
      await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_FILES], 'readonly');
        const req = tx.objectStore(STORE_FILES).count();
        req.onsuccess = () => resolve(req.result === 0);
      });
    };

    // Virtual mkdir - VFS is flat, so this is mostly for API compatibility
    // useful if we later add directory metadata
    const mkdir = async (path) => {
      logger.debug(`[VFS] mkdir ${path} (virtual)`);
      return true;
    };

    const clear = async () => {
      await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_FILES], 'readwrite');
        tx.objectStore(STORE_FILES).clear().onsuccess = () => resolve(true);
      });
    };

    return {
      init,
      read,
      write,
      delete: remove,
      list,
      stat,
      exists,
      isEmpty,
      mkdir,
      clear
    };
  }
};

export default VFS;
