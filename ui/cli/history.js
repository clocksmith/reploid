/**
 * @fileoverview Command History - IndexedDB-backed command history
 * Supports arrow key navigation and persistence across sessions.
 */

const History = {
  metadata: {
    id: 'History',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,  // Don't auto-init - initialized by CLIMode
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    const DB_NAME = 'reploid-cli-history';
    const STORE_NAME = 'commands';
    const MAX_HISTORY = 1000;

    let db = null;
    let history = [];
    let historyIndex = -1;
    let currentInput = '';

    const openDB = () => {
      return new Promise((resolve, reject) => {
        if (db) return resolve(db);
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = (event) => {
          const d = event.target.result;
          if (!d.objectStoreNames.contains(STORE_NAME)) {
            const store = d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp');
          }
        };

        request.onsuccess = (e) => {
          db = e.target.result;
          logger.info('[History] Database connected');
          resolve(db);
        };

        request.onerror = () => reject(new Error('Failed to open History DB'));
      });
    };

    const loadHistory = async () => {
      await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          history = (req.result || [])
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(item => item.command);
          historyIndex = history.length;
          logger.info(`[History] Loaded ${history.length} commands`);
          resolve();
        };
      });
    };

    const add = async (command) => {
      if (!command.trim()) return;

      // Don't add duplicates of the last command
      if (history.length > 0 && history[history.length - 1] === command) {
        historyIndex = history.length;
        return;
      }

      history.push(command);
      historyIndex = history.length;

      // Persist to IndexedDB
      await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.add({ command, timestamp: Date.now() });

        // Trim old entries if over limit
        if (history.length > MAX_HISTORY) {
          const index = store.index('timestamp');
          const cursorReq = index.openCursor();
          let deleted = 0;
          const toDelete = history.length - MAX_HISTORY;

          cursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor && deleted < toDelete) {
              cursor.delete();
              deleted++;
              cursor.continue();
            }
          };
        }

        tx.oncomplete = () => resolve();
      });
    };

    const navigateUp = () => {
      if (historyIndex === history.length) {
        currentInput = ''; // Save current input before navigating
      }

      if (historyIndex > 0) {
        historyIndex--;
        return history[historyIndex];
      }
      return history[0] || '';
    };

    const navigateDown = () => {
      if (historyIndex < history.length - 1) {
        historyIndex++;
        return history[historyIndex];
      } else {
        historyIndex = history.length;
        return currentInput;
      }
    };

    const reset = () => {
      historyIndex = history.length;
      currentInput = '';
    };

    const getAll = () => [...history];

    const clear = async () => {
      history = [];
      historyIndex = 0;

      await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).clear().onsuccess = () => {
          logger.info('[History] Cleared');
          resolve();
        };
      });
    };

    const search = (query) => {
      const lower = query.toLowerCase();
      return history.filter(cmd => cmd.toLowerCase().includes(lower));
    };

    const init = async () => {
      await loadHistory();

      // Listen for history navigation events
      EventBus.on('cli:history:up', ({ callback }) => {
        const cmd = navigateUp();
        if (callback) callback(cmd);
      });

      EventBus.on('cli:history:down', ({ callback }) => {
        const cmd = navigateDown();
        if (callback) callback(cmd);
      });

      return true;
    };

    return {
      init,
      add,
      navigateUp,
      navigateDown,
      reset,
      getAll,
      clear,
      search
    };
  }
};

export default History;
