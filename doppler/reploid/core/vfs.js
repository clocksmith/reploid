/**
 * @fileoverview Virtual File System (VFS)
 * IndexedDB-backed storage.
 *
 * BREAKING: Uses 'reploid-vfs-v2'. Previous v1 data is ignored.
 */

const VFS = {
  metadata: {
    id: 'VFS',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'EventBus?'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger, Errors } = Utils;

    const DB_NAME = 'reploid-vfs-v2';
    const STORE_FILES = 'files';
    let db = null;

    const openDB = () => {
      return new Promise((resolve, reject) => {
        if (db) return resolve(db);

        logger.debug('[VFS] Opening IndexedDB...');

        // Timeout to detect blocked IndexedDB (e.g., another tab holding connection)
        const timeout = setTimeout(() => {
          logger.error('[VFS] IndexedDB open timed out after 10s. Try closing other tabs or clearing IndexedDB.');
          reject(new Errors.StateError('VFS DB open timed out - close other tabs and reload'));
        }, 10000);

        const request = indexedDB.open(DB_NAME, 1);

        request.onblocked = () => {
          clearTimeout(timeout);
          logger.error('[VFS] IndexedDB blocked - another tab may have an open connection');
          reject(new Errors.StateError('VFS DB blocked - close other tabs'));
        };

        request.onupgradeneeded = (event) => {
          logger.debug('[VFS] IndexedDB upgrade needed');
          const d = event.target.result;
          if (!d.objectStoreNames.contains(STORE_FILES)) {
            d.createObjectStore(STORE_FILES, { keyPath: 'path' });
          }
        };

        request.onsuccess = (e) => {
          clearTimeout(timeout);
          db = e.target.result;
          logger.info('[VFS] Database connected');
          resolve(db);
        };

        request.onerror = (e) => {
          clearTimeout(timeout);
          logger.error('[VFS] IndexedDB open error:', e.target.error);
          reject(new Errors.StateError('Failed to open VFS DB: ' + (e.target.error?.message || 'unknown error')));
        };
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

      // Check if file exists to determine operation type
      const previous = await stat(cleanPath);
      const fileExists = !!previous;
      const operation = fileExists ? 'update' : 'write';
      const beforeSize = previous?.size || 0;

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
        store.put(entry).onsuccess = () => {
          // Emit event for HMR
          if (EventBus) {
            EventBus.emit('vfs:file_changed', {
              path: cleanPath,
              operation,
              size: content.length,
              beforeSize,
              afterSize: content.length,
              timestamp: Date.now()
            });
          }
          resolve(true);
        };
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
      const previous = await stat(cleanPath);
      const beforeSize = previous?.size || 0;
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_FILES], 'readwrite');
        const req = tx.objectStore(STORE_FILES).delete(cleanPath);
        req.onsuccess = () => {
          logger.info(`[VFS] Deleted ${cleanPath}`);

          // Emit event for HMR
          if (EventBus) {
            EventBus.emit('vfs:file_changed', {
              path: cleanPath,
              operation: 'delete',
              beforeSize,
              afterSize: 0,
              timestamp: Date.now()
            });
          }

          resolve(true);
        };
        req.onerror = () => {
          logger.error(`[VFS] Delete failed: ${cleanPath}`);
          reject(new Errors.ArtifactError(`Delete failed: ${cleanPath}`));
        };
      });
    };

    const list = async (dir = '/') => {
      await openDB();
      const cleanDir = normalize(dir);
      const prefix = cleanDir.endsWith('/') ? cleanDir : cleanDir + '/';

      return new Promise((resolve) => {
        const tx = db.transaction([STORE_FILES], 'readonly');
        const store = tx.objectStore(STORE_FILES);

        // Try to use IndexedDB key range for O(log n + m) instead of O(n) scan
        // IDBKeyRange may not be available in test environments
        const IDB = typeof IDBKeyRange !== 'undefined' ? IDBKeyRange : null;

        if (IDB) {
          try {
            // Create key range: [prefix, prefix + '\uffff')
            // '\uffff' is highest Unicode char, so this captures all strings starting with prefix
            const range = IDB.bound(prefix, prefix + '\uffff', false, true);
            const req = store.getAllKeys(range);

            req.onsuccess = () => {
              resolve(req.result || []);
            };
            req.onerror = () => {
              // Fallback to full scan if key range fails
              const fallbackReq = store.getAllKeys();
              fallbackReq.onsuccess = () => {
                const all = fallbackReq.result || [];
                resolve(all.filter(p => p.startsWith(prefix)));
              };
            };
            return;
          } catch (e) {
            // Fall through to fallback
          }
        }

        // Fallback: full scan with filter
        const req = store.getAllKeys();
        req.onsuccess = () => {
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

    /**
     * Export all VFS contents as a single JSON object
     * @returns {Promise<Object>} { files: { path: content, ... }, meta: { ... } }
     */
    const exportAll = async () => {
      await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_FILES], 'readonly');
        const store = tx.objectStore(STORE_FILES);
        const req = store.getAll();
        req.onsuccess = () => {
          const files = {};
          const entries = req.result || [];
          for (const entry of entries) {
            files[entry.path] = {
              content: entry.content,
              size: entry.size,
              updated: entry.updated
            };
          }
          resolve({
            files,
            meta: {
              exportedAt: Date.now(),
              version: '2.0',
              fileCount: entries.length
            }
          });
        };
        req.onerror = () => reject(new Errors.ArtifactError('Export failed'));
      });
    };

    /**
     * Import all files from exported JSON
     * @param {Object} data - { files: { path: { content, ... }, ... } }
     * @param {boolean} [clearFirst=false] - Clear VFS before import
     * @returns {Promise<number>} Number of files imported
     */
    const importAll = async (data, clearFirst = false) => {
      if (!data?.files || typeof data.files !== 'object') {
        throw new Errors.ValidationError('Invalid import data: missing files object');
      }

      await openDB();

      if (clearFirst) {
        await clear();
      }

      const paths = Object.keys(data.files);
      let imported = 0;

      for (const path of paths) {
        const entry = data.files[path];
        const content = typeof entry === 'string' ? entry : entry.content;
        if (content !== undefined) {
          await write(path, content);
          imported++;
        }
      }

      logger.info(`[VFS] Imported ${imported} files`);
      return imported;
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
      clear,
      exportAll,
      importAll
    };
  }
};

export default VFS;
