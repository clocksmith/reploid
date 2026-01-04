/**
 * @fileoverview Minimal VFS bootstrap helpers (IndexedDB only).
 * Used before DI/VFS module is available.
 */

const DB_NAME = 'reploid-vfs-v0';
const STORE_FILES = 'files';
const OPEN_TIMEOUT_MS = 10000;

let dbPromise = null;

const normalizePath = (path) => {
  if (!path || typeof path !== 'string') throw new Error('Invalid VFS path');
  let clean = path.trim().replace(/\\/g, '/');
  if (!clean.startsWith('/')) clean = '/' + clean;
  return clean;
};

const openVfsDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('VFS DB open timed out'));
    }, OPEN_TIMEOUT_MS);

    const request = indexedDB.open(DB_NAME, 1);

    request.onblocked = () => {
      clearTimeout(timeout);
      reject(new Error('VFS DB blocked'));
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'path' });
      }
    };

    request.onsuccess = () => {
      clearTimeout(timeout);
      resolve(request.result);
    };

    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error || new Error('Failed to open VFS DB'));
    };
  });

  return dbPromise;
};

export async function readVfsFile(path) {
  const db = await openVfsDb();
  const cleanPath = normalizePath(path);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const request = store.get(cleanPath);

    request.onsuccess = () => {
      resolve(request.result ? request.result.content : null);
    };
    request.onerror = () => reject(request.error || new Error(`Failed to read ${cleanPath}`));
  });
}

export async function writeVfsFile(path, content) {
  const db = await openVfsDb();
  const cleanPath = normalizePath(path);
  const entry = {
    path: cleanPath,
    content,
    size: content.length,
    updated: Date.now(),
    type: 'file'
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    store.put(entry);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error(`Failed to write ${cleanPath}`));
  });
}

export async function listVfsKeys() {
  const db = await openVfsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Failed to list VFS keys'));
  });
}

const writeEntries = async (entries) => {
  if (entries.length === 0) return;
  const db = await openVfsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    for (const entry of entries) {
      store.put({
        path: entry.path,
        content: entry.content,
        size: entry.content.length,
        updated: Date.now(),
        type: 'file'
      });
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Failed to seed VFS entries'));
  });
};

export async function loadSeedBundle() {
  const response = await fetch('config/vfs-seed.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load VFS seed bundle (${response.status})`);
  }
  const text = await response.text();
  let bundle = null;
  try {
    bundle = JSON.parse(text);
  } catch (err) {
    throw new Error('Invalid VFS seed bundle JSON');
  }
  return { bundle, text };
}

export async function seedVfsBundle(bundle, options = {}) {
  const {
    preserveOnBoot = false,
    logger = console,
    seedText = null,
    chunkSize = 200
  } = options;

  const files = bundle?.files;
  if (!files || typeof files !== 'object') {
    throw new Error('VFS seed bundle missing files');
  }

  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const cleanPath = normalizePath(path);
    entries.push({ path: cleanPath, content: content ?? '' });
  }
  if (seedText) {
    entries.push({ path: '/config/vfs-seed.json', content: seedText });
  }

  let skip = null;
  if (preserveOnBoot) {
    const keys = await listVfsKeys();
    skip = new Set(keys);
  }

  const writeQueue = preserveOnBoot
    ? entries.filter((entry) => !skip.has(entry.path))
    : entries;

  let written = 0;
  for (let i = 0; i < writeQueue.length; i += chunkSize) {
    const slice = writeQueue.slice(i, i + chunkSize);
    await writeEntries(slice);
    written += slice.length;
  }

  logger.info(`[Bootstrap] Seeded ${written} VFS files`);
  return {
    total: entries.length,
    written,
    skipped: entries.length - written
  };
}
