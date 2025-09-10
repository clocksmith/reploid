// A standalone, promise-based VFS implementation for IndexedDB,
// designed to be used by the boot.js script during genesis.
const BootIdbVfs = (config) => {
  const DB_NAME = config.VFS_PREFIX + 'REPLOID_IDB_V2';
  const STORE_NAME = 'artifacts';
  const DB_VERSION = 1;
  let db;

  const initDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = (event) => reject(new Error("Boot VFS: IndexedDB could not be opened."));
      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'path' });
        }
      };
    });
  };

  const getDB = async () => {
    if (!db) await initDB();
    return db;
  };

  const getStore = async (mode) => {
    const currentDb = await getDB();
    const transaction = currentDb.transaction(STORE_NAME, mode);
    return transaction.objectStore(STORE_NAME);
  };

  const write = async (path, content) => {
    try {
        const store = await getStore('readwrite');
        const request = store.put({ path, content });
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(new Error(`IDB write failed for ${path}: ${event.target.error}`));
        });
    } catch(e) {
        console.error(`Boot VFS write failed for ${path}`, e);
        return false;
    }
  };

  const read = async (path) => {
    try {
        const store = await getStore('readonly');
        const request = store.get(path);
        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                const result = event.target.result;
                resolve(result ? result.content : null);
            };
            request.onerror = (event) => reject(new Error(`IDB read failed for ${path}: ${event.target.error}`));
        });
    } catch(e) {
        console.error(`Boot VFS read failed for ${path}`, e);
        return null;
    }
  };

  const clear = async () => {
    try {
        const store = await getStore('readwrite');
        const request = store.clear();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(new Error(`IDB clear failed: ${event.target.error}`));
        });
    } catch (e) {
        console.error(`Boot VFS clear failed`, e);
        return false;
    }
  };

  return {
    write,
    read,
    clear,
  };
};