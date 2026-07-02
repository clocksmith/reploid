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
const LAB_RUNTIME_ROUTES = new Set(['/0', '/x']);
const LAB_RUNTIME_ASSET_PATHS = new Set([
  '/blueprint-index.json',
  '/index.html',
  '/kernel/boot.js',
  '/styles/boot.css',
  '/styles/rd.css',
  '/styles/rd-components.css',
  '/styles/rd-primitives.css',
  '/styles/rd-tokens.css',
  '/styles/zero.css',
  '/ui/toast.js'
]);
const LAB_RUNTIME_ASSET_PREFIXES = [
  '/boot-helpers/',
  '/blueprints/',
  '/capabilities/',
  '/config/',
  '/core/',
  '/entry/',
  '/host/',
  '/infrastructure/',
  '/lab/',
  '/personas/',
  '/prompts/',
  '/self/',
  '/shadow/',
  '/styles/proto/',
  '/tools/',
  '/ui/components/',
  '/ui/dashboard/',
  '/ui/panels/',
  '/ui/proto/',
  '/ui/shared/',
  '/ui/zero/'
];
const SELF_BOOTSTRAP_PATHS = new Set([
  '/index.html',
  '/kernel/index.html',
  '/kernel/boot.js',
  '/boot-spec.js',
  '/instance.js',
  '/identity.js',
  '/reward-policy.js',
  '/swarm.js',
  '/core/utils.js',
  '/entry/start-app.js',
  '/host/seed-vfs.js',
  '/host/start-app.js',
  '/host/start-reploid.js',
  '/host/vfs-bootstrap.js',
  '/host/sw-module-loader.js',
  '/sw.js'
]);
const NETWORK_FALLBACK_PATHS = new Set([
  '/capsule/index.js',
  '/cloud-access.js',
  '/cloud-access-status.js',
  '/cloud-access-windows.js',
  '/bridge.js',
  '/dream-instance.js',
  '/environment.js',
  '/identity.js',
  '/key-unsealer.js',
  '/manifest.js',
  '/receipt.js',
  '/reward-policy.js',
  '/runtime.js',
  '/swarm.js',
  '/tool-runner.js'
]);
const NETWORK_FALLBACK_PREFIXES = [
  '/capabilities/communication/',
  '/config/',
  '/core/',
  '/infrastructure/',
  '/lab/',
  '/capsule/',
  '/pool/',
  '/ui/pool-home/',
  '/ui/reploid-home/',
  '/ui/boot-home/',
  '/ui/boot-wizard/'
];
const SELF_MIRROR_SOURCE_PREFIXES = [
  { targetPrefix: '/self/config/', sourcePrefix: '/config/' },
  { targetPrefix: '/self/lab/', sourcePrefix: '/lab/' },
  { targetPrefix: '/self/styles/proto/', sourcePrefix: '/styles/proto/' },
  { targetPrefix: '/self/styles/', sourcePrefix: '/styles/' },
  { targetPrefix: '/self/ui/components/', sourcePrefix: '/ui/components/' },
  { targetPrefix: '/self/ui/panels/', sourcePrefix: '/ui/panels/' },
  { targetPrefix: '/self/ui/proto/', sourcePrefix: '/ui/proto/' },
  { targetPrefix: '/self/ui/', sourcePrefix: '/ui/' },
  { targetPrefix: '/self/ui/zero/', sourcePrefix: '/ui/zero/' }
];

try {
  importScripts('/core/import-rewrite.js');
} catch (error) {
  console.warn('[SW] Shared import rewrite helper unavailable:', error?.message || error);
}

// Open IndexedDB connections to VFS databases keyed by instance.
const vfsDBMap = new Map();
const vfsDBOpening = new Map();
const clientInstanceMap = new Map();
const invalidationTokens = new Map();

function normalizeRoutePath(pathname = '/') {
  const normalized = String(pathname || '/').replace(/\/+$/, '') || '/';
  return normalized;
}

function isLabRuntimeRoutePath(pathname = '/') {
  return LAB_RUNTIME_ROUTES.has(normalizeRoutePath(pathname));
}

function isLabRuntimeAssetPath(pathname = '/') {
  return LAB_RUNTIME_ASSET_PATHS.has(pathname)
    || LAB_RUNTIME_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getUrlPath(value) {
  if (!value) return null;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function isLabRuntimeUrl(value) {
  const pathname = getUrlPath(value);
  return !!pathname && (isLabRuntimeRoutePath(pathname) || isLabRuntimeAssetPath(pathname));
}

function shouldHandleLabRuntimeFetch(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (isLabRuntimeRoutePath(url.pathname)) return true;
  if (!isLabRuntimeAssetPath(url.pathname)) return false;
  if (isLabRuntimeUrl(request.referrer)) return true;
  return url.searchParams.has(INSTANCE_QUERY_PARAM)
    || url.searchParams.get('bootstrapper') === '1';
}

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

function getInvalidationKey(dbName, path) {
  return `${dbName}:${path || '*'}`;
}

function getInvalidationToken(dbName, path) {
  return invalidationTokens.get(getInvalidationKey(dbName, path))
    || invalidationTokens.get(getInvalidationKey(dbName, '*'))
    || null;
}

function markInvalidated(dbName, path = null) {
  const token = Date.now().toString(36);
  invalidationTokens.set(getInvalidationKey(dbName, path || '*'), token);
  return token;
}

async function resolveRequestInstanceId(event, request, url) {
  const direct = getInstanceIdFromUrl(url?.href || url);
  if (direct) return direct;

  const referrerId = getInstanceIdFromUrl(request?.referrer);
  if (referrerId) return referrerId;

  const clientId = event.clientId || event.resultingClientId;
  const mapped = clientId ? sanitizeInstanceId(clientInstanceMap.get(clientId)) : null;
  if (mapped) return mapped;

  if (!clientId) return null;

  try {
    const client = await self.clients.get(clientId);
    const clientInstanceId = getInstanceIdFromUrl(client?.url);
    if (clientInstanceId) return clientInstanceId;
  } catch {
    // Fall through to same-origin window discovery.
  }

  try {
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });
    const instanceIds = new Set();
    for (const client of clients) {
      const clientInstanceId = getInstanceIdFromUrl(client?.url);
      if (clientInstanceId) {
        instanceIds.add(clientInstanceId);
      }
    }
    if (instanceIds.size === 1) {
      return Array.from(instanceIds)[0];
    }
  } catch {
    return null;
  }

  return null;
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

function shouldFallbackToNetwork(path) {
  return NETWORK_FALLBACK_PATHS.has(path)
    || NETWORK_FALLBACK_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function getSelfMirrorSourcePath(path) {
  const match = SELF_MIRROR_SOURCE_PREFIXES.find((entry) => path.startsWith(entry.targetPrefix));
  if (!match) return null;
  return `${match.sourcePrefix}${path.slice(match.targetPrefix.length)}`;
}

async function readFromVFSWithMirrorFallback(path, dbName) {
  const content = await readFromVFS(path, dbName);
  if (content !== null) {
    return { content, path, mirrorFallback: false };
  }

  const sourcePath = getSelfMirrorSourcePath(path);
  if (!sourcePath || sourcePath === path) return null;
  const sourceContent = await readFromVFS(sourcePath, dbName);
  if (sourceContent === null) return null;
  return {
    content: sourceContent,
    path,
    sourcePath,
    mirrorFallback: true
  };
}

function rewriteModuleImports(content, requestUrl, instanceId, dbName, vfsPath) {
  if (!requestUrl.pathname.endsWith('.js') && !requestUrl.pathname.endsWith('.mjs')) {
    return content;
  }

  const version = requestUrl.searchParams.get('v')
    || getInvalidationToken(dbName, vfsPath)
    || getInvalidationToken(dbName, '*');
  if (!version) return content;

  const rewriter = self.REPLOID_IMPORT_REWRITE;
  if (!rewriter?.rewriteModuleImports) return content;

  return rewriter.rewriteModuleImports(content, {
    baseUrl: requestUrl,
    origin: self.location.origin,
    version,
    instanceId,
    instanceParam: INSTANCE_QUERY_PARAM
  });
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

  if (!shouldHandleLabRuntimeFetch(event.request, url)) {
    return;
  }

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
    || url.pathname === '/config/boot-seed.js'
  ) {
    return;
  }

  // Keep the cold-boot nucleus on an immutable network path so an empty VFS
  // can still hydrate itself from the canonical /self namespace.
  if (SELF_BOOTSTRAP_PATHS.has(url.pathname)) {
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
    const vfsResult = await readFromVFSWithMirrorFallback(vfsPath, dbName);
    const content = vfsResult?.content ?? null;

    if (content !== null) {
      if (shouldLog) console.log(`[SW] Serving from VFS: ${vfsPath}`);
      const getMimeType = (path) => {
        if (path.endsWith('.json')) return 'application/json; charset=utf-8';
        if (path.endsWith('.wgsl') || path.endsWith('.md')) return 'text/plain; charset=utf-8';
        if (path.endsWith('.css')) return 'text/css; charset=utf-8';
        if (path.endsWith('.html')) return 'text/html; charset=utf-8';
        return 'application/javascript; charset=utf-8';
      };

      const responseContent = rewriteModuleImports(content, url, instanceId, dbName, vfsPath);
      return new Response(responseContent, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(vfsPath),
          'X-VFS-Source': 'true',
          ...(vfsResult.mirrorFallback ? { 'X-VFS-Mirror-Fallback': vfsResult.sourcePath } : {}),
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

    if (shouldFallbackToNetwork(vfsPath)) {
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
  const { type, data } = event.data || {};
  if (!type) return;

  switch (type) {
    case 'REGISTER_INSTANCE': {
      const instanceId = sanitizeInstanceId(data?.instanceId);
      const clientId = event.source?.id;
      const registered = !!(instanceId && clientId);
      if (instanceId && clientId) {
        clientInstanceMap.set(clientId, instanceId);
      }
      if (event.ports[0]) event.ports[0].postMessage({ success: registered });
      break;
    }

    case 'INVALIDATE_MODULE': {
      // Clear cache for specific module to force reload
      const instanceId = sanitizeInstanceId(data?.instanceId);
      const dbName = getVfsDbName(instanceId);
      const path = typeof data?.path === 'string' ? data.path : null;
      const token = markInvalidated(dbName, path);
      console.log(`[SW] Invalidating module cache: ${path || '*'} (${dbName})`);
      caches.delete(CACHE_NAME).catch(() => {});
      if (event.ports[0]) event.ports[0].postMessage({ success: true, token });
      break;
    }

    case 'INVALIDATE_ALL': {
      // Clear all module caches
      const instanceId = sanitizeInstanceId(data?.instanceId);
      const dbName = getVfsDbName(instanceId);
      const token = markInvalidated(dbName, null);
      console.log('[SW] Invalidating all module caches');
      caches.delete(CACHE_NAME).catch(() => {});
      if (event.ports[0]) event.ports[0].postMessage({ success: true, token });
      break;
    }

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
