/**
 * @fileoverview Service Worker Module Loader
 * Intercepts ES6 module imports and serves from VFS when available.
 * Enables REPLOID to run entirely from IndexedDB with hot-reloading.
 */

const CACHE_NAME = 'reploid-modules-v2';
const VFS_DB_NAME = 'reploid-vfs-v2';
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
      console.warn('[SW] VFS DB blocked - another connection may be open');
      reject(new Error('VFS DB blocked'));
    };

    request.onsuccess = () => {
      clearTimeout(timeout);
      vfsDB = request.result;
      vfsDBOpening = false;

      // Handle database close events (e.g., when deleted elsewhere)
      vfsDB.onclose = () => {
        console.log('[SW] VFS DB connection closed');
        vfsDB = null;
      };

      vfsDB.onversionchange = () => {
        console.log('[SW] VFS DB version change - closing connection');
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
    console.log('[SW] VFS DB connection closed manually');
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

// Check if file exists in VFS
async function existsInVFS(path) {
  try {
    const content = await readFromVFS(path);
    return content !== null;
  } catch {
    return false;
  }
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

  // Only intercept JavaScript module requests
  if (!url.pathname.endsWith('.js')) {
    return; // Let browser handle non-JS requests
  }

  // Only intercept requests from our origin
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never intercept critical files - always fetch from network
  const alwaysNetwork = [
    '/boot.js',
    '/sw-module-loader.js',
    '/ui/proto.js',
    '/ui/proto/index.js',
    '/ui/proto/template.js',
    '/ui/proto/workers.js',
    '/ui/proto/vfs.js',
    '/ui/proto/schemas.js',
    '/ui/proto/telemetry.js',
    '/ui/proto/utils.js',
    '/ui/toast.js',
    '/ui/components/inline-chat.js'
  ];
  if (alwaysNetwork.some(f => url.pathname.endsWith(f))) {
    return; // Let browser fetch from network
  }

  event.respondWith(handleModuleRequest(event.request, url));
});

async function handleModuleRequest(request, url) {
  const pathname = url.pathname;

  // Convert URL path to VFS path
  // /reploid/core/vfs.js -> /core/vfs.js
  let vfsPath = pathname;
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
    // Check if file exists in VFS
    const inVFS = await existsInVFS(vfsPath);

    if (inVFS) {
      if (shouldLog) console.log(`[SW] Serving from VFS: ${vfsPath}`);
      const content = await readFromVFS(vfsPath);

      // Return as JavaScript module with proper MIME type
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'X-VFS-Source': 'true',
          'Cache-Control': 'no-cache' // Don't cache VFS modules (for hot-reload)
        }
      });
    } else {
      if (shouldLog) console.log(`[SW] Not in VFS, fetching from network: ${pathname}`);
      // Fallback to network if not in VFS
      return fetch(request);
    }
  } catch (error) {
    console.error(`[SW] Error loading module ${vfsPath}:`, error);

    // Fallback to network on error
    try {
      return fetch(request);
    } catch (networkError) {
      return new Response(`// Module load failed: ${vfsPath}\nconsole.error('Failed to load module from VFS or network');`, {
        status: 500,
        headers: { 'Content-Type': 'application/javascript' }
      });
    }
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
