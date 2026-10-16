import { FILE_TEXT_LIMIT_BYTES as TEXT_LIMIT_BYTES, FILE_BINARY_LIMIT_BYTES as BINARY_LIMIT_BYTES } from '../config/vfs-policy.js';

export const OPFS_PREFIX = 'opfs:';
const VFS_PREFIX = 'vfs:';

export const normalizeFilePath = (rawPath, backendOverride, missingMessage = 'Missing path argument') => {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error(missingMessage);
  }

  const trimmed = rawPath.trim();
  let backend = backendOverride ? String(backendOverride).toLowerCase() : null;
  if (backend && backend !== 'vfs' && backend !== 'opfs') {
    throw new Error('Invalid backend. Use "vfs" or "opfs".');
  }
  let path = trimmed;

  if (trimmed.startsWith(OPFS_PREFIX)) {
    backend = 'opfs';
    path = trimmed.slice(OPFS_PREFIX.length);
  } else if (trimmed.startsWith(VFS_PREFIX)) {
    backend = 'vfs';
    path = trimmed.slice(VFS_PREFIX.length);
  }

  path = '/' + path.replace(/^\/+/, '');
  return { backend: backend || 'vfs', path };
};

export const resolveMode = (mode) => {
  const value = (mode || 'text').toString().toLowerCase();
  if (value !== 'text' && value !== 'binary') {
    throw new Error('Invalid mode. Use "text" or "binary".');
  }
  return value;
};

export const resolveMaxBytes = (mode, maxBytes) => {
  const limit = mode === 'binary' ? BINARY_LIMIT_BYTES : TEXT_LIMIT_BYTES;
  if (maxBytes === undefined || maxBytes === null) return limit;
  const value = Number(maxBytes);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('maxBytes must be a positive number');
  }
  if (value > limit) {
    throw new Error(`maxBytes exceeds limit (${limit} bytes)`);
  }
  return Math.floor(value);
};

export const getOpfsRoot = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('OPFS not available in this environment');
  }
  if (typeof globalThis.ServiceWorkerGlobalScope !== 'undefined' && self instanceof globalThis.ServiceWorkerGlobalScope) {
    throw new Error('OPFS not available in service workers');
  }
  return navigator.storage.getDirectory();
};

export const getOpfsFileHandle = async (path, options = {}) => {
  const root = await getOpfsRoot();
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Invalid OPFS path');
  }

  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: !!options.createDirs });
  }
  return dir.getFileHandle(parts[parts.length - 1], { create: !!options.createFile });
};
