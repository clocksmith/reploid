/**
 * @fileoverview Minimal VFS bootstrap helpers (IndexedDB only).
 * Used before DI/VFS module is available.
 */

import { toSourceWebPath } from '../boot-spec.js';
import { getCurrentReploidInstanceId, getScopedReploidVfsDbName } from '../instance.js';

const DB_NAME = 'reploid-vfs-v0';
const STORE_FILES = 'files';
const OPEN_TIMEOUT_MS = 10000;
const DEFAULT_FETCH_CONCURRENCY = 6;
const VFS_BYPASS_HEADER = 'x-reploid-vfs-bypass';

const dbPromises = new Map();

export function getVfsDatabaseName(instanceId = getCurrentReploidInstanceId()) {
  return getScopedReploidVfsDbName(instanceId || null) || DB_NAME;
}

const getDopplerBaseUrl = () => {
  if (typeof window === 'undefined') return null;
  const direct = window.DOPPLER_BASE_URL;
  if (direct && typeof direct === 'string') return direct;
  try {
    const stored = window.localStorage?.getItem('DOPPLER_BASE_URL');
    if (stored && typeof stored === 'string') return stored;
  } catch {
    return null;
  }
  return null;
};

const buildDopplerUrl = (path) => {
  const base = getDopplerBaseUrl();
  if (!base) return null;
  const cleanBase = base.replace(/\/$/, '');
  const cleanPath = String(path || '').replace(/^\/doppler/, '');
  return `${cleanBase}${cleanPath}`;
};

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
  const sourcePath = toSourceWebPath(raw.startsWith('/') ? raw : `/${raw}`);
  if (raw.startsWith('/doppler')) {
    const dopplerUrl = buildDopplerUrl(raw);
    if (dopplerUrl) return dopplerUrl;
  }
  if (sourcePath.startsWith('/')) {
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : new URL(base).origin;
    return new URL(sourcePath, origin).toString();
  }
  const relative = sourcePath.replace(/^\/+/, '');
  return new URL(relative, base).toString();
};

const openVfsDb = (instanceId = getCurrentReploidInstanceId()) => {
  const dbName = getVfsDatabaseName(instanceId);
  if (dbPromises.has(dbName)) return dbPromises.get(dbName);
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is required for VFS boot');
  }
  const dbPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      dbPromises.delete(dbName);
      reject(new Error('VFS DB open timed out'));
    }, OPEN_TIMEOUT_MS);

    const request = indexedDB.open(dbName, 1);

    request.onblocked = () => {
      clearTimeout(timeout);
      dbPromises.delete(dbName);
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
      const db = request.result;
      db.onclose = () => {
        dbPromises.delete(dbName);
      };
      db.onversionchange = () => {
        db.close();
        dbPromises.delete(dbName);
      };
      resolve(db);
    };

    request.onerror = () => {
      clearTimeout(timeout);
      dbPromises.delete(dbName);
      reject(request.error || new Error('Failed to open VFS DB'));
    };
  });

  dbPromises.set(dbName, dbPromise);
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

const emitSeedProgress = (onProgress, payload) => {
  const progress = {
    timestamp: Date.now(),
    ...payload
  };
  if (typeof onProgress === 'function') {
    try {
      onProgress(progress);
    } catch {
      // Progress hooks must never break boot hydration.
    }
  }
  if (typeof window !== 'undefined') {
    window.REPLOID_VFS_SEED_PROGRESS = progress;
    if (progress.scope === 'full') {
      window.REPLOID_VFS_FULL_SEED_PROGRESS = progress;
    }
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('reploid:vfs-seed-progress', { detail: progress }));
    }
  }
  return progress;
};

export async function ensureVfsFileMirrors(mirrors = [], options = {}) {
  const {
    overwrite = false,
    onProgress = null,
    progressScope = 'mirrors',
    logger = console
  } = options;
  const entries = Array.isArray(mirrors) ? mirrors : [];
  let written = 0;
  let skipped = 0;
  let missing = 0;

  emitSeedProgress(onProgress, {
    scope: progressScope,
    phase: 'mirror:start',
    label: 'Preparing self-owned runtime mirrors.',
    total: entries.length,
    current: 0
  });

  for (const mirror of entries) {
    const sourcePath = normalizePath(mirror?.sourcePath || mirror?.source);
    const targetPath = normalizePath(mirror?.targetPath || mirror?.target);
    const existingTarget = await readVfsFile(targetPath);
    if (existingTarget !== null && !overwrite) {
      skipped += 1;
      emitSeedProgress(onProgress, {
        scope: progressScope,
        phase: 'mirror:skip',
        label: `Preserved ${targetPath}`,
        total: entries.length,
        current: written + skipped + missing,
        path: targetPath
      });
      continue;
    }

    const sourceContent = await readVfsFile(sourcePath);
    if (sourceContent === null) {
      missing += 1;
      logger.warn?.(`[Bootstrap] Mirror source missing: ${sourcePath}`);
      emitSeedProgress(onProgress, {
        scope: progressScope,
        phase: 'mirror:missing',
        label: `Missing source ${sourcePath}`,
        total: entries.length,
        current: written + skipped + missing,
        path: sourcePath
      });
      continue;
    }

    await writeVfsFile(targetPath, sourceContent);
    written += 1;
    emitSeedProgress(onProgress, {
      scope: progressScope,
      phase: 'mirror:write',
      label: `Mirrored ${targetPath}`,
      total: entries.length,
      current: written + skipped + missing,
      path: targetPath
    });
  }

  const result = { total: entries.length, written, skipped, missing };
  emitSeedProgress(onProgress, {
    scope: progressScope,
    phase: 'mirror:done',
    label: 'Self-owned runtime mirrors ready.',
    total: entries.length,
    current: entries.length,
    ...result
  });
  return result;
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

export async function loadVfsManifest(options = {}) {
  const { includeDoppler = false } = options;
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
    fetchManifest('/config/vfs-manifest.json'),
    includeDoppler
      ? fetchManifest(buildDopplerUrl('/doppler/config/vfs-manifest.json') || '/doppler/config/vfs-manifest.json')
          .catch(() => ({ files: [] }))
      : Promise.resolve({ files: [] })
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
    fetchConcurrency = DEFAULT_FETCH_CONCURRENCY,
    skipVfsPaths = null,
    onProgress = null,
    progressScope = 'seed',
    progressLabel = 'VFS hydration'
  } = options;

  let skip = null;
  if (preserveOnBoot) {
    const keys = await listVfsKeys();
    skip = new Set(keys);
  }

  const normalizeSkipVfsPaths = (paths) => {
    if (!paths) return null;
    if (paths instanceof Set) {
      const out = new Set();
      for (const p of paths) out.add(normalizePath(p));
      return out;
    }
    if (Array.isArray(paths)) return new Set(paths.map((p) => normalizePath(p)));
    return null;
  };
  const skipExplicit = normalizeSkipVfsPaths(skipVfsPaths);

  const shouldSkip = (path) =>
    ((skip && skip.has(path)) || (skipExplicit && skipExplicit.has(path)));
  if (!manifest?.files || !Array.isArray(manifest.files)) {
    throw new Error('VFS manifest missing files list');
  }

  const manifestPath = 'config/vfs-manifest.json';
  const manifestVfsPath = normalizePath(manifestPath);
  const files = manifest.files;
  const manifestInList = files.includes(manifestPath);
  const total = files.length + (manifestText && !manifestInList ? 1 : 0);

  emitSeedProgress(onProgress, {
    scope: progressScope,
    phase: 'start',
    label: `${progressLabel}: preparing ${total} file(s).`,
    total,
    current: 0,
    fetched: 0,
    written: 0,
    skipped: 0
  });

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
    let fetchedCount = 0;

    const worker = async () => {
      while (index < filesToFetch.length) {
        const file = filesToFetch[index];
        index += 1;
        const entry = await fetchFile(file);
        fetched.push(entry);
        fetchedCount += 1;
        emitSeedProgress(onProgress, {
          scope: progressScope,
          phase: 'fetch',
          label: `${progressLabel}: fetched ${fetchedCount}/${filesToFetch.length}.`,
          total,
          current: entries.length + fetchedCount,
          fetched: fetchedCount,
          written: 0,
          skipped: total - entries.length - filesToFetch.length,
          path: entry.path
        });
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
    emitSeedProgress(onProgress, {
      scope: progressScope,
      phase: 'write',
      label: `${progressLabel}: wrote ${written}/${entries.length}.`,
      total,
      current: written,
      fetched: filesToFetch.length,
      written,
      skipped: total - entries.length
    });
  }

  logger.info(`[Bootstrap] Hydrated ${written} VFS files`);
  emitSeedProgress(onProgress, {
    scope: progressScope,
    phase: 'done',
    label: `${progressLabel}: hydrated ${written} file(s).`,
    total,
    current: total,
    fetched: filesToFetch.length,
    written,
    skipped: total - written
  });
  return {
    total,
    written,
    skipped: total - written
  };
}
