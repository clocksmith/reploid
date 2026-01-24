/**
 * @fileoverview Minimal VFS bootstrap helpers (IndexedDB only).
 * Used before DI/VFS module is available.
 */

const DB_NAME = 'reploid-vfs-v0';
const STORE_FILES = 'files';
const OPEN_TIMEOUT_MS = 10000;
const DEFAULT_FETCH_CONCURRENCY = 6;
const VFS_BYPASS_HEADER = 'x-reploid-vfs-bypass';

let dbPromise = null;

const normalizePath = (path) => {
  if (!path || typeof path !== 'string') throw new Error('Invalid VFS path');
  let clean = path.trim().replace(/\\/g, '/');
  if (!clean.startsWith('/')) clean = '/' + clean;
  return clean;
};

const toWebPath = (file) => {
  const base = (typeof document !== 'undefined' && document.baseURI)
    ? document.baseURI
    : (typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/');
  const raw = String(file || '');
  if (raw.startsWith('/')) {
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : new URL(base).origin;
    return new URL(raw, origin).toString();
  }
  const relative = raw.replace(/^\/+/, '');
  return new URL(relative, base).toString();
};

const openVfsDb = () => {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is required for VFS boot');
  }
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

export async function clearVfsStore() {
  const db = await openVfsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    tx.objectStore(STORE_FILES).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Failed to clear VFS'));
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

export async function loadVfsManifest() {
  const normalizeManifestFiles = (manifest) => {
    if (!manifest?.files || !Array.isArray(manifest.files)) return [];
    const files = [];
    for (const entry of manifest.files) {
      if (typeof entry === 'string') {
        files.push(entry);
        continue;
      }
      if (entry && typeof entry.path === 'string') {
        files.push(entry.path);
        continue;
      }
      if (entry && typeof entry.url === 'string') {
        files.push(entry.url);
      }
    }
    return files;
  };

  const fetchManifest = async (path) => {
    const response = await fetch(path, {
      cache: 'no-store',
      headers: { [VFS_BYPASS_HEADER]: '1' }
    });
    if (!response.ok) {
      if (path.includes('doppler')) return { files: [] }; // Doppler optional
      throw new Error(`Failed to load VFS manifest (${response.status})`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Invalid VFS manifest JSON');
    }
  };

  const [reploidManifest, dopplerManifest] = await Promise.all([
    fetchManifest('/src/config/vfs-manifest.json'),
    fetchManifest('/doppler/config/vfs-manifest.json').catch(() => ({ files: [] }))
  ]);

  if (!reploidManifest?.files || !Array.isArray(reploidManifest.files)) {
    throw new Error('VFS manifest missing files list');
  }

  const reploidFiles = normalizeManifestFiles(reploidManifest);
  const dopplerFiles = normalizeManifestFiles(dopplerManifest)
    .filter((file) => !file.startsWith('/src/boot-helpers/'));

  // Merge manifests
  const manifest = {
    files: [...new Set([
      ...reploidFiles,
      ...dopplerFiles.map((file) => {
        const normalized = file.startsWith('/') ? file : `/${file}`;
        return normalized.startsWith('/doppler/')
          ? normalized
          : `/doppler${normalized}`;
      })
    ])]
  };

  return { manifest, text: JSON.stringify(manifest) };
}

export async function seedVfsFromManifest(manifest, options = {}) {
  const {
    preserveOnBoot = false,
    logger = console,
    manifestText = null,
    chunkSize = 200,
    fetchConcurrency = DEFAULT_FETCH_CONCURRENCY
  } = options;

  let skip = null;
  if (preserveOnBoot) {
    const keys = await listVfsKeys();
    skip = new Set(keys);
  }

  const shouldSkip = (path) => skip && skip.has(path);
  if (!manifest?.files || !Array.isArray(manifest.files)) {
    throw new Error('VFS manifest missing files list');
  }

  const manifestPath = 'config/vfs-manifest.json';
  const manifestVfsPath = normalizePath(manifestPath);
  const files = manifest.files;
  const manifestInList = files.includes(manifestPath);

  const entries = [];
  if (manifestText && !shouldSkip(manifestVfsPath)) {
    entries.push({ path: manifestVfsPath, content: manifestText });
  }

  const filesToFetch = [];
  for (const file of files) {
    if (manifestText && file === manifestPath) continue;
    const vfsPath = normalizePath(file);
    if (shouldSkip(vfsPath)) continue;
    filesToFetch.push(file);
  }

  const fetchFile = async (file) => {
    const webPath = toWebPath(file);
    const response = await fetch(webPath, {
      cache: 'no-store',
      headers: { [VFS_BYPASS_HEADER]: '1' }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${webPath} (${response.status})`);
    }
    const content = await response.text();
    return { path: normalizePath(file), content };
  };

  if (filesToFetch.length > 0) {
    const fetched = [];
    const concurrency = Math.min(fetchConcurrency, filesToFetch.length);
    let index = 0;

    const worker = async () => {
      while (index < filesToFetch.length) {
        const file = filesToFetch[index];
        index += 1;
        fetched.push(await fetchFile(file));
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    entries.push(...fetched);
  }

  let written = 0;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const slice = entries.slice(i, i + chunkSize);
    await writeEntries(slice);
    written += slice.length;
  }

  const total = files.length + (manifestText && !manifestInList ? 1 : 0);
  logger.info(`[Bootstrap] Hydrated ${written} VFS files`);
  return {
    total,
    written,
    skipped: total - written
  };
}
