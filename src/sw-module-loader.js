/**
 * @fileoverview Service Worker Module Loader
 * Intercepts ES6 module imports and serves from VFS when available.
 * Enables REPLOID to run entirely from IndexedDB with hot-reloading.
 */

const CACHE_NAME = 'reploid-modules-v0';
const VFS_DB_NAME = 'reploid-vfs-v0';
const VFS_STORE_NAME = 'files';

// Open IndexedDB connection to VFS
let vfsDB = null;
let vfsDBOpening = false;

async function openVFS() {
  // Return existing connection
  if (vfsDB) return vfsDB;

  // Prevent concurrent open attempts
  if (vfsDBOpening) {
    // Wait for the pending open to complete
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (vfsDB) {
          clearInterval(check);
          resolve(vfsDB);
        }
      }, 50);
    });
  }

  vfsDBOpening = true;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      vfsDBOpening = false;
      reject(new Error('VFS DB open timed out in service worker'));
    }, 5000);

    const request = indexedDB.open(VFS_DB_NAME, 1);

    request.onerror = () => {
      clearTimeout(timeout);
      vfsDBOpening = false;
      reject(request.error);
    };

    request.onblocked = () => {
      clearTimeout(timeout);
      vfsDBOpening = false;
      reject(new Error('VFS DB blocked'));
    };

    request.onsuccess = () => {
      clearTimeout(timeout);
      vfsDB = request.result;
      vfsDBOpening = false;

      // Handle database close events (e.g., when deleted elsewhere)
      vfsDB.onclose = () => {
        vfsDB = null;
      };

      vfsDB.onversionchange = () => {
        vfsDB.close();
        vfsDB = null;
      };

      resolve(vfsDB);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(VFS_STORE_NAME)) {
        db.createObjectStore(VFS_STORE_NAME, { keyPath: 'path' });
      }
    };
  });
}

// Close VFS connection (called before reset)
function closeVFS() {
  if (vfsDB) {
    vfsDB.close();
    vfsDB = null;
  }
}

// Read file from VFS
async function readFromVFS(path) {
  const db = await openVFS();

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
  ) {
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

  event.respondWith(handleModuleRequest(event.request, url));
});

async function handleModuleRequest(request, url) {
  const pathname = url.pathname;

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
    const content = await readFromVFS(vfsPath);

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
