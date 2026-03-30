/**
 * @fileoverview Service Worker Module Loader
 * Intercepts ES6 module imports and serves from VFS when available.
 * Enables REPLOID to run entirely from IndexedDB with hot-reloading.
 */

const CACHE_NAME = 'reploid-modules-v0';
const VFS_DB_NAME = 'reploid-vfs-v0';
const VFS_STORE_NAME = 'files';
const INSTANCE_QUERY_PARAM = 'instance';
const INSTANCE_ID_MAX_LENGTH = 64;
const SELF_BOOTSTRAP_PATHS = new Set([
  '/self/kernel/index.html',
  '/self/kernel/boot.js',
  '/self/boot-spec.js',
  '/self/instance.js',
  '/self/host/seed-vfs.js',
  '/self/host/vfs-bootstrap.js',
  '/self/host/sw-module-loader.js'
]);

// Open IndexedDB connections to VFS databases keyed by instance.
const vfsDBMap = new Map();
const vfsDBOpening = new Map();

function sanitizeInstanceId(value) {
  const sanitized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, INSTANCE_ID_MAX_LENGTH);
  return sanitized || null;
}

function getInstanceIdFromUrl(urlString) {
  if (!urlString) return null;
  try {
    const url = new URL(urlString, self.location.origin);
    return sanitizeInstanceId(url.searchParams.get(INSTANCE_QUERY_PARAM));
  } catch {
    return null;
  }
}

function getVfsDbName(instanceId) {
  const id = sanitizeInstanceId(instanceId);
  return id ? `${VFS_DB_NAME}--${id}` : VFS_DB_NAME;
}

async function resolveRequestInstanceId(event, request, url) {
  const direct = getInstanceIdFromUrl(url?.href || url);
  if (direct) return direct;

  const referrerId = getInstanceIdFromUrl(request?.referrer);
  if (referrerId) return referrerId;

  const clientId = event.clientId || event.resultingClientId;
  if (!clientId) return null;

  try {
    const client = await self.clients.get(clientId);
    return getInstanceIdFromUrl(client?.url);
  } catch {
    return null;
  }
}

async function openVFS(dbName) {
  if (vfsDBMap.has(dbName)) return vfsDBMap.get(dbName);

  if (vfsDBOpening.has(dbName)) {
    return vfsDBOpening.get(dbName);
  }

  const pending = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      vfsDBOpening.delete(dbName);
      reject(new Error('VFS DB open timed out in service worker'));
    }, 5000);

    const request = indexedDB.open(dbName, 1);

    request.onerror = () => {
      clearTimeout(timeout);
      vfsDBOpening.delete(dbName);
      reject(request.error);
    };

    request.onblocked = () => {
      clearTimeout(timeout);
      vfsDBOpening.delete(dbName);
      reject(new Error('VFS DB blocked'));
    };

    request.onsuccess = () => {
      clearTimeout(timeout);
      const db = request.result;
      vfsDBMap.set(dbName, db);
      vfsDBOpening.delete(dbName);

      // Handle database close events (e.g., when deleted elsewhere)
      db.onclose = () => {
        vfsDBMap.delete(dbName);
      };

      db.onversionchange = () => {
        db.close();
        vfsDBMap.delete(dbName);
      };

      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(VFS_STORE_NAME)) {
        db.createObjectStore(VFS_STORE_NAME, { keyPath: 'path' });
      }
    };
  });

  vfsDBOpening.set(dbName, pending);
  return pending;
}

function closeVFS(dbName = null) {
  if (dbName) {
    vfsDBMap.get(dbName)?.close();
    vfsDBMap.delete(dbName);
    return;
  }

  for (const [name, db] of vfsDBMap.entries()) {
    db.close();
    vfsDBMap.delete(name);
  }
}

// Read file from VFS
async function readFromVFS(path, dbName) {
  const db = await openVFS(dbName);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE_NAME, 'readonly');
    const store = tx.objectStore(VFS_STORE_NAME);
    const request = store.get(path);

    request.onsuccess = () => {
      if (request.result && request.result.content) {
        resolve(request.result.content);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

// Service Worker installation
self.addEventListener('install', (event) => {
  console.log('[SW] Installing module loader...');
  self.skipWaiting(); // Activate immediately
});

// Service Worker activation
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating module loader...');
  event.waitUntil(self.clients.claim()); // Take control immediately
});

// Intercept fetch requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip reserved paths that should bypass the VFS loader.
  if (
    url.pathname === '/doppler'
    || url.pathname.startsWith('/doppler/')
    || url.pathname === '/proto'
    || url.pathname.startsWith('/proto/')
    || url.pathname === '/dr'
    || url.pathname.startsWith('/dr/')
  ) {
    return;
  }

  // Skip boot loader and other network-only entrypoints.
  if (
    url.pathname === '/entry/seed-vfs.js'
    || url.pathname === '/app.js'
    || url.pathname === '/src/entry/seed-vfs.js'
    || url.pathname === '/src/app.js'
    || url.pathname === '/config/boot-seed.js'
    || url.pathname === '/src/config/boot-seed.js'
  ) {
    return;
  }

  // Keep the cold-boot nucleus on an immutable network path so an empty VFS
  // can still hydrate itself from the canonical /self namespace.
  if (SELF_BOOTSTRAP_PATHS.has(url.pathname)) {
    return;
  }

  if (url.pathname.startsWith('/src/')) {
    return;
  }

  if (url.searchParams.get('bootstrapper') === '1') {
    return;
  }

  // Allow explicit bypass for VFS seeding and diagnostics.
  if (event.request.headers.get('x-reploid-vfs-bypass') === '1') {
    return;
  }

  // Configurable extensions
  const VFS_EXTENSIONS = ['.js', '.json', '.wgsl', '.md', '.css', '.html'];
  if (!VFS_EXTENSIONS.some(ext => url.pathname.endsWith(ext))) {
    return; // Let browser handle other requests
  }

  // Only intercept requests from our origin
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(handleModuleRequest(event.request, url, event));
});

async function handleModuleRequest(request, url, event) {
  const pathname = url.pathname;
  const instanceId = await resolveRequestInstanceId(event, request, url);
  const dbName = getVfsDbName(instanceId);

  // Convert URL path to VFS path
  // /reploid/core/vfs.js -> /core/vfs.js
  let vfsPath = pathname;
  if (vfsPath.startsWith('/src/')) {
    vfsPath = vfsPath.substring(4); // Remove /src prefix
  }
  if (vfsPath.startsWith('/reploid/')) {
    vfsPath = vfsPath.substring(8); // Remove /reploid prefix
  }
  if (!vfsPath.startsWith('/')) {
    vfsPath = '/' + vfsPath;
  }

  // Only log module requests for debugging (reduce verbosity)
  const shouldLog = false; // Set to true for debugging module loading
  if (shouldLog) console.log(`[SW] Module request: ${pathname} -> VFS: ${vfsPath}`);

  try {
    const content = await readFromVFS(vfsPath, dbName);

    if (content !== null) {
      if (shouldLog) console.log(`[SW] Serving from VFS: ${vfsPath}`);
      const getMimeType = (path) => {
        if (path.endsWith('.json')) return 'application/json; charset=utf-8';
        if (path.endsWith('.wgsl') || path.endsWith('.md')) return 'text/plain; charset=utf-8';
        if (path.endsWith('.css')) return 'text/css; charset=utf-8';
        if (path.endsWith('.html')) return 'text/html; charset=utf-8';
        return 'application/javascript; charset=utf-8';
      };

      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(vfsPath),
          'X-VFS-Source': 'true',
          'Cache-Control': 'no-cache'
        }
      });
    }

    // Doppler is served as its own static app under /doppler/ and is not part of the
    // Reploid VFS hydration by default. If it's not present in VFS, fall back to network.
    if (vfsPath.startsWith('/doppler/')) {
      return fetch(request);
    }

    if (vfsPath.startsWith('/boot-helpers/')) {
      return fetch(request);
    }

    // First-load behavior: the SW can control the page before the VFS is hydrated.
    // For non-JS assets (especially CSS), fall back to network instead of returning
    // a JS "throw" payload with 404, which breaks boot styling.
    if (!pathname.endsWith('.js')) {
      return fetch(request);
    }

    console.error(`[SW] Missing module in VFS: ${vfsPath}`);
    return new Response(`// Missing module in VFS: ${vfsPath}\nthrow new Error('Module missing in VFS: ${vfsPath}');`, {
      status: 404,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'X-VFS-Miss': 'true'
      }
    });
  } catch (error) {
    console.error(`[SW] Error loading module ${vfsPath}:`, error);
    return new Response(`// Module load failed: ${vfsPath}\nconsole.error('Failed to load module from VFS');`, {
      status: 500,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
    });
  }
}

// Handle messages from main thread
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'INVALIDATE_MODULE':
      // Clear cache for specific module to force reload
      console.log(`[SW] Invalidating module cache: ${data.path}`);
      // Service worker will automatically serve fresh version from VFS on next request
      if (event.ports[0]) event.ports[0].postMessage({ success: true });
      break;

    case 'INVALIDATE_ALL':
      // Clear all module caches
      console.log('[SW] Invalidating all module caches');
      if (event.ports[0]) event.ports[0].postMessage({ success: true });
      break;

    case 'CLOSE_VFS':
      // Close VFS connection before database deletion
      console.log('[SW] Received CLOSE_VFS request');
      closeVFS();
      if (event.ports[0]) event.ports[0].postMessage({ success: true });
      break;

    case 'PING':
      // Health check
      if (event.ports[0]) event.ports[0].postMessage({ pong: true, timestamp: Date.now() });
      break;

    default:
      console.warn(`[SW] Unknown message type: ${type}`);
  }
});
