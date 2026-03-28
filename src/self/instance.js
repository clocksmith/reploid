/**
 * @fileoverview Instance scoping helpers for same-origin multi-peer Reploids.
 */

export const REPLOID_INSTANCE_QUERY_PARAM = 'instance';
export const REPLOID_FRESH_IDENTITY_QUERY_PARAM = 'freshIdentity';
export const REPLOID_INSTANCE_STORAGE_PREFIX = 'REPLOID_INSTANCE';
export const REPLOID_INSTANCE_SEPARATOR = '::';
export const REPLOID_DEFAULT_VFS_DB_NAME = 'reploid-vfs-v0';

const INSTANCE_ID_MAX_LENGTH = 64;

const getStorageTarget = (storage) => (
  storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null
);

export function sanitizeReploidInstanceId(value) {
  const sanitized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, INSTANCE_ID_MAX_LENGTH);
  return sanitized || null;
}

export function createReploidInstanceId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') {
    return sanitizeReploidInstanceId(cryptoApi.randomUUID());
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return sanitizeReploidInstanceId(
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    );
  }

  return sanitizeReploidInstanceId(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

export function getReploidInstanceIdFromUrl(input = globalThis.location?.href || '') {
  if (!input) return null;

  try {
    const base = globalThis.location?.origin || 'http://localhost';
    const url = input instanceof URL ? input : new URL(String(input), base);
    return sanitizeReploidInstanceId(url.searchParams.get(REPLOID_INSTANCE_QUERY_PARAM));
  } catch {
    return null;
  }
}

export function hasRequestedFreshIdentity(input = globalThis.location?.href || '') {
  if (!input) return false;

  try {
    const base = globalThis.location?.origin || 'http://localhost';
    const url = input instanceof URL ? input : new URL(String(input), base);
    const value = String(url.searchParams.get(REPLOID_FRESH_IDENTITY_QUERY_PARAM) || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'fresh' || value === 'yes';
  } catch {
    return false;
  }
}

export function clearRequestedFreshIdentity(win = globalThis.window) {
  if (!win?.location) return false;

  try {
    const url = new URL(win.location.href);
    if (!url.searchParams.has(REPLOID_FRESH_IDENTITY_QUERY_PARAM)) {
      return false;
    }
    url.searchParams.delete(REPLOID_FRESH_IDENTITY_QUERY_PARAM);
    win.history?.replaceState?.(win.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}

export function ensureReploidWindowInstance(win = globalThis.window) {
  if (!win?.location) return null;

  const existing = sanitizeReploidInstanceId(win.REPLOID_INSTANCE_ID);
  if (existing) return existing;

  let instanceId = getReploidInstanceIdFromUrl(win.location.href);
  if (!instanceId) {
    instanceId = createReploidInstanceId(win.crypto || globalThis.crypto);
  }

  try {
    const url = new URL(win.location.href);
    if (url.searchParams.get(REPLOID_INSTANCE_QUERY_PARAM) !== instanceId) {
      url.searchParams.set(REPLOID_INSTANCE_QUERY_PARAM, instanceId);
      win.history?.replaceState?.(win.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // Ignore URL mutation failures.
  }

  win.REPLOID_INSTANCE_ID = instanceId;
  return instanceId;
}

export function getCurrentReploidInstanceId(fallback = null) {
  return sanitizeReploidInstanceId(globalThis.window?.REPLOID_INSTANCE_ID)
    || getReploidInstanceIdFromUrl(globalThis.window?.location?.href || globalThis.location?.href || '')
    || fallback;
}

export function getCurrentReploidInstanceLabel(fallback = 'default') {
  return getCurrentReploidInstanceId() || String(fallback || 'default');
}

export function getReploidInstanceStoragePrefix(instanceId = getCurrentReploidInstanceId()) {
  const id = sanitizeReploidInstanceId(instanceId);
  return id ? `${REPLOID_INSTANCE_STORAGE_PREFIX}_${id}${REPLOID_INSTANCE_SEPARATOR}` : '';
}

export function getScopedReploidStorageKey(baseKey, instanceId = getCurrentReploidInstanceId()) {
  const key = String(baseKey || '');
  const prefix = getReploidInstanceStoragePrefix(instanceId);
  return prefix ? `${prefix}${key}` : key;
}

export function getScopedReploidVfsDbName(instanceId = getCurrentReploidInstanceId()) {
  const id = sanitizeReploidInstanceId(instanceId);
  return id ? `${REPLOID_DEFAULT_VFS_DB_NAME}--${id}` : REPLOID_DEFAULT_VFS_DB_NAME;
}

export function createScopedReploidStorage(storage = globalThis.localStorage, instanceId = getCurrentReploidInstanceId()) {
  const target = getStorageTarget(storage);
  const prefix = getReploidInstanceStoragePrefix(instanceId);

  const getNamespacedKey = (key) => {
    const baseKey = String(key || '');
    return prefix ? `${prefix}${baseKey}` : baseKey;
  };

  const iterateKeys = () => {
    if (!target || typeof target.length !== 'number' || typeof target.key !== 'function') {
      return [];
    }
    const keys = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key) keys.push(key);
    }
    return keys;
  };

  return {
    raw: target,
    prefix,
    instanceId: sanitizeReploidInstanceId(instanceId),
    getNamespacedKey,
    getItem(key, options = {}) {
      if (!target) return null;
      const namespacedKey = getNamespacedKey(key);
      const value = target.getItem(namespacedKey);
      if (value !== null || options.legacyFallback === false || namespacedKey === String(key)) {
        return value;
      }
      return target.getItem(String(key));
    },
    setItem(key, value) {
      if (!target) return;
      target.setItem(getNamespacedKey(key), String(value));
    },
    removeItem(key, options = {}) {
      if (!target) return;
      const namespacedKey = getNamespacedKey(key);
      target.removeItem(namespacedKey);
      if (options.removeLegacy === true && namespacedKey !== String(key)) {
        target.removeItem(String(key));
      }
    },
    keys() {
      if (!target) return [];
      if (!prefix) return iterateKeys();
      return iterateKeys().filter((key) => key.startsWith(prefix));
    },
    clearNamespace(options = {}) {
      if (!target) return [];
      const preserve = typeof options.preserve === 'function' ? options.preserve : () => false;
      const removed = [];
      for (const key of this.keys()) {
        if (preserve(key)) continue;
        target.removeItem(key);
        removed.push(key);
      }
      return removed;
    }
  };
}

export function getCurrentReploidStorage(storage = globalThis.localStorage) {
  return createScopedReploidStorage(storage, getCurrentReploidInstanceId());
}

export function getCurrentReploidSessionStorage(storage = globalThis.sessionStorage) {
  return createScopedReploidStorage(storage, getCurrentReploidInstanceId());
}

export function getCurrentReploidPeerQuery() {
  const instanceId = getCurrentReploidInstanceId();
  return instanceId ? { [REPLOID_INSTANCE_QUERY_PARAM]: instanceId } : {};
}

export function createReploidPeerUrl(pathname = globalThis.window?.location?.pathname || '/', options = {}) {
  const origin = globalThis.window?.location?.origin || globalThis.location?.origin || 'http://localhost';
  const current = new URL(globalThis.window?.location?.href || `${origin}/`, origin);
  const url = new URL(String(pathname || '/'), origin);
  const dopplerBase = current.searchParams.get('dopplerBase');
  const instanceId = options.reuseCurrentInstance === true
    ? getCurrentReploidInstanceId()
    : sanitizeReploidInstanceId(options.instanceId);

  if (dopplerBase) {
    url.searchParams.set('dopplerBase', dopplerBase);
  }
  if (instanceId) {
    url.searchParams.set(REPLOID_INSTANCE_QUERY_PARAM, instanceId);
  }
  if (options.freshIdentity === true) {
    url.searchParams.set(REPLOID_FRESH_IDENTITY_QUERY_PARAM, '1');
  }

  return url.toString();
}

export default {
  REPLOID_DEFAULT_VFS_DB_NAME,
  REPLOID_FRESH_IDENTITY_QUERY_PARAM,
  REPLOID_INSTANCE_QUERY_PARAM,
  clearRequestedFreshIdentity,
  createReploidInstanceId,
  createReploidPeerUrl,
  createScopedReploidStorage,
  ensureReploidWindowInstance,
  getCurrentReploidInstanceId,
  getCurrentReploidInstanceLabel,
  getCurrentReploidPeerQuery,
  getCurrentReploidSessionStorage,
  getCurrentReploidStorage,
  getReploidInstanceIdFromUrl,
  getReploidInstanceStoragePrefix,
  getScopedReploidStorageKey,
  getScopedReploidVfsDbName,
  hasRequestedFreshIdentity,
  sanitizeReploidInstanceId
};
