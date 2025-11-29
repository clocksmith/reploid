/**
 * @fileoverview IndexedDB Helper - Database initialization utility
 * Provides standardized IndexedDB setup with store/index configuration.
 *
 * NOTE: Cannot be used by bootstrap modules (vfs.js, event-bus.js, utils.js)
 * which must remain self-contained.
 */

const IndexedDBHelper = {
  metadata: {
    id: 'IndexedDBHelper',
    version: '1.0.0',
    dependencies: ['Utils'],
    async: false,
    type: 'utility'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;

    /**
     * Create a database helper for a specific database
     * @param {string} dbName - Database name
     * @param {number} version - Database version
     * @param {Array<Object>} storeConfigs - Store configurations
     * @param {string} storeConfigs[].name - Object store name
     * @param {string} storeConfigs[].keyPath - Key path for objects
     * @param {boolean} storeConfigs[].autoIncrement - Auto-increment keys
     * @param {Array<Object>} storeConfigs[].indexes - Index definitions
     * @param {string} storeConfigs[].indexes[].name - Index name
     * @param {string} storeConfigs[].indexes[].keyPath - Index key path
     * @param {boolean} storeConfigs[].indexes[].unique - Unique constraint
     * @returns {Object} Database helper with openDB, close methods
     */
    const createDBHelper = (dbName, version, storeConfigs) => {
      let db = null;
      let openPromise = null;

      const openDB = () => {
        // Return existing connection if open
        if (db) return Promise.resolve(db);

        // Return pending connection if opening
        if (openPromise) return openPromise;

        openPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, version);

          request.onupgradeneeded = (event) => {
            const database = event.target.result;

            for (const config of storeConfigs) {
              if (!database.objectStoreNames.contains(config.name)) {
                const storeOptions = { keyPath: config.keyPath };
                if (config.autoIncrement) {
                  storeOptions.autoIncrement = true;
                }

                const store = database.createObjectStore(config.name, storeOptions);

                // Create indexes
                if (config.indexes) {
                  for (const idx of config.indexes) {
                    store.createIndex(
                      idx.name,
                      idx.keyPath || idx.name,
                      { unique: !!idx.unique }
                    );
                  }
                }
              }
            }
          };

          request.onsuccess = (e) => {
            db = e.target.result;
            logger.info(`[IndexedDBHelper] Database '${dbName}' connected`);
            resolve(db);
          };

          request.onerror = () => {
            openPromise = null;
            reject(new Error(`Failed to open database: ${dbName}`));
          };
        });

        return openPromise;
      };

      const close = () => {
        if (db) {
          db.close();
          db = null;
          openPromise = null;
          logger.info(`[IndexedDBHelper] Database '${dbName}' closed`);
        }
      };

      /**
       * Run a transaction on specified stores
       * @param {string|string[]} storeNames - Store name(s)
       * @param {'readonly'|'readwrite'} mode - Transaction mode
       * @param {Function} callback - (stores) => result
       * @returns {Promise<any>} Transaction result
       */
      const transaction = async (storeNames, mode, callback) => {
        await openDB();
        const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
        const tx = db.transaction(stores, mode);

        // Get store objects
        const storeObjects = stores.length === 1
          ? tx.objectStore(stores[0])
          : stores.reduce((acc, name) => {
              acc[name] = tx.objectStore(name);
              return acc;
            }, {});

        return callback(storeObjects, tx);
      };

      /**
       * Get all records from a store
       * @param {string} storeName - Store name
       * @returns {Promise<Array>} All records
       */
      const getAll = async (storeName) => {
        return transaction(storeName, 'readonly', (store) => {
          return new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          });
        });
      };

      /**
       * Get a record by key
       * @param {string} storeName - Store name
       * @param {any} key - Record key
       * @returns {Promise<any>} Record or undefined
       */
      const get = async (storeName, key) => {
        return transaction(storeName, 'readonly', (store) => {
          return new Promise((resolve) => {
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
          });
        });
      };

      /**
       * Put a record (add or update)
       * @param {string} storeName - Store name
       * @param {any} value - Record value
       * @returns {Promise<any>} Record key
       */
      const put = async (storeName, value) => {
        return transaction(storeName, 'readwrite', (store) => {
          return new Promise((resolve, reject) => {
            const req = store.put(value);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(new Error('Put failed'));
          });
        });
      };

      /**
       * Delete a record by key
       * @param {string} storeName - Store name
       * @param {any} key - Record key
       * @returns {Promise<void>}
       */
      const remove = async (storeName, key) => {
        return transaction(storeName, 'readwrite', (store) => {
          return new Promise((resolve) => {
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          });
        });
      };

      /**
       * Clear all records from a store
       * @param {string} storeName - Store name
       * @returns {Promise<void>}
       */
      const clear = async (storeName) => {
        return transaction(storeName, 'readwrite', (store) => {
          return new Promise((resolve) => {
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          });
        });
      };

      return {
        openDB,
        close,
        transaction,
        getAll,
        get,
        put,
        remove,
        clear,
        get isOpen() { return !!db; }
      };
    };

    return { createDBHelper };
  }
};

export default IndexedDBHelper;
