// Standardized Storage Module for REPLOID
// IndexedDB backend for persistent artifact storage

const Storage = {
  metadata: {
    id: 'Storage',
    version: '1.0.0',
    dependencies: ['config', 'logger', 'Errors'],
    async: false,
    type: 'service'
  },
  
  factory: (deps) => {
    // Validate dependencies
    const { config, logger, Errors } = deps;
    
    if (!config || !logger || !Errors) {
      throw new Error('Storage: Missing required dependencies');
    }
    
    const DB_NAME = config.VFS_PREFIX + 'REPLOID_IDB';
    const STORE_NAME = 'artifacts';
    const DB_VERSION = 1;
    let db;

  const initDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        logger.error("IndexedDB error", event.target.error);
        reject(new Errors.StorageError("IndexedDB could not be opened."));
      };

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
    if (!db) {
      await initDB();
    }
    return db;
  };

  const getStore = async (mode) => {
    const currentDb = await getDB();
    const transaction = currentDb.transaction(STORE_NAME, mode);
    return transaction.objectStore(STORE_NAME);
  };

  const getArtifactContent = async (path) => {
    try {
        const store = await getStore('readonly');
        const request = store.get(path);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result ? request.result.content : null);
            };
            request.onerror = (event) => {
                reject(new Errors.StorageError(`IDB read failed for ${path}`, { originalError: event.target.error }));
            };
        });
    } catch(e) {
        logger.error(`getArtifactContent failed for ${path}`, e);
        return null;
    }
  };

  const setArtifactContent = async (path, content) => {
    try {
        const store = await getStore('readwrite');
        const request = store.put({ path, content });
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(true);
            request.onerror = (event) => {
                reject(new Errors.StorageError(`IDB write failed for ${path}`, { originalError: event.target.error }));
            };
        });
    } catch(e) {
        logger.error(`setArtifactContent failed for ${path}`, e);
        return false;
    }
  };

  const deleteArtifactVersion = async (path) => {
    try {
        const store = await getStore('readwrite');
        const request = store.delete(path);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(true);
            request.onerror = (event) => {
                 reject(new Errors.StorageError(`IDB delete failed for ${path}`, { originalError: event.target.error }));
            };
        });
    } catch (e) {
        logger.error(`deleteArtifactVersion failed for ${path}`, e);
        return false;
    }
  };
  
    const getState = () => getArtifactContent(config.STATE_PATH);
    const saveState = (stateString) => setArtifactContent(config.STATE_PATH, stateString);
    const removeState = () => deleteArtifactVersion(config.STATE_PATH);
    
    // Public API
    return {
      api: {
        getArtifactContent,
        setArtifactContent,
        deleteArtifactVersion,
        getState,
        saveState,
        removeState,
      }
    };
  }
};

// Legacy compatibility wrapper
const StorageModule = (config, logger, Errors) => {
  const instance = Storage.factory({ config, logger, Errors });
  return instance.api;
};

// Export both formats
Storage;
StorageModule;