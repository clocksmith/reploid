/**
 * @fileoverview ReadFile - Read content from VFS or OPFS
 */

const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const BINARY_LIMIT_BYTES = 256 * 1024 * 1024;
const OPFS_PREFIX = 'opfs:';
const VFS_PREFIX = 'vfs:';
const OPFS_ALLOWLIST_PREFIXES = ['/doppler-models/adapters/'];

const normalizePath = (rawPath, backendOverride) => {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Missing path argument');
  }

  const trimmed = rawPath.trim();
  let backend = backendOverride ? String(backendOverride).toLowerCase() : null;
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

const assertSafePath = (path) => {
  if (path.split('/').includes('..')) {
    throw new Error('Path traversal is not allowed');
  }
};

const assertOpfsAllowed = (path) => {
  const allowed = OPFS_ALLOWLIST_PREFIXES.some((prefix) => {
    const cleanPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return path === cleanPrefix.slice(0, -1) || path.startsWith(cleanPrefix);
  });
  if (!allowed) {
    throw new Error(`OPFS path not allowed: ${path}`);
  }
};

const resolveMode = (mode) => {
  const value = (mode || 'text').toString().toLowerCase();
  if (value !== 'text' && value !== 'binary') {
    throw new Error('Invalid mode. Use "text" or "binary".');
  }
  return value;
};

const resolveMaxBytes = (mode, maxBytes) => {
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

const getOpfsRoot = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('OPFS not available in this environment');
  }
  if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
    throw new Error('OPFS not available in service workers');
  }
  return navigator.storage.getDirectory();
};

const getOpfsFileHandle = async (path) => {
  const root = await getOpfsRoot();
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Invalid OPFS path');
  }

  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: false });
  }
  return dir.getFileHandle(parts[parts.length - 1], { create: false });
};

const toBase64 = (buffer) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  if (typeof btoa === 'function') {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  throw new Error('Base64 encoder not available');
};

const getTextBytes = (content) => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(content).length;
  }
  return content.length;
};

async function readFromVfs(path, args, maxBytes) {
  const { VFS } = args.deps;
  const stats = await VFS.stat(path);
  if (!stats) throw new Error(`File not found: ${path}`);

  const { startLine, endLine } = args;
  const hasRange = startLine !== undefined || endLine !== undefined;

  if (!hasRange && stats.size > maxBytes) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    throw new Error(`File too large (${sizeMB} MB). Use startLine/endLine to read a range.`);
  }

  const content = await VFS.read(path);
  if (!hasRange) {
    return {
      path,
      backend: 'vfs',
      encoding: 'utf-8',
      content,
      bytes: getTextBytes(content)
    };
  }

  const lines = content.split('\n');
  const start = Math.max(1, startLine || 1);
  const end = endLine ? Math.min(endLine, lines.length) : lines.length;
  const slice = lines.slice(start - 1, end).join('\n');

  return {
    path,
    backend: 'vfs',
    encoding: 'utf-8',
    content: slice,
    bytes: getTextBytes(slice),
    range: { startLine: start, endLine: end, totalLines: lines.length }
  };
}

async function readFromOpfs(path, mode, args, maxBytes) {
  const fileHandle = await getOpfsFileHandle(path);
  const file = await fileHandle.getFile();
  const size = file.size;

  if (mode === 'text') {
    if (size > maxBytes) {
      const sizeMB = (size / 1024 / 1024).toFixed(1);
      throw new Error(`File too large (${sizeMB} MB). Use binary mode with offset/length.`);
    }
    const content = await file.text();
    return {
      path,
      backend: 'opfs',
      encoding: 'utf-8',
      content,
      bytes: getTextBytes(content)
    };
  }

  const offset = args.offset ? Number(args.offset) : 0;
  const length = args.length !== undefined ? Number(args.length) : size - offset;

  if (!Number.isFinite(offset) || offset < 0) {
    throw new Error('Invalid offset');
  }
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('Invalid length');
  }
  if (offset + length > size) {
    throw new Error('Read range exceeds file size');
  }
  if (length > maxBytes) {
    throw new Error(`Read length exceeds maxBytes (${maxBytes} bytes)`);
  }

  const slice = file.slice(offset, offset + length);
  const buffer = await slice.arrayBuffer();
  const data = toBase64(buffer);
  return {
    path,
    backend: 'opfs',
    encoding: 'base64',
    data,
    bytes: length
  };
}

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const rawPath = args.path || args.file;
  const { backend, path } = normalizePath(rawPath, args.backend);
  assertSafePath(path);

  const mode = resolveMode(args.mode);
  const maxBytes = resolveMaxBytes(mode, args.maxBytes);

  if (backend === 'vfs') {
    if (mode !== 'text') {
      throw new Error('VFS supports text mode only');
    }
    if (args.offset !== undefined || args.length !== undefined) {
      throw new Error('offset/length are only supported in binary mode');
    }
    return readFromVfs(path, { ...args, deps }, maxBytes);
  }

  assertOpfsAllowed(path);
  if (mode === 'text' && (args.offset !== undefined || args.length !== undefined)) {
    throw new Error('offset/length are only supported in binary mode');
  }

  return readFromOpfs(path, mode, args, maxBytes);
}

export const tool = {
  name: "ReadFile",
  description: "Read contents of a file from VFS or OPFS. Use opfs:/ for binary assets and mode: \"binary\" for tensor data.",
  readOnly: true,
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Path to read (vfs:/ or opfs:/). Default backend is VFS.' },
      backend: { type: 'string', description: 'Optional backend override (vfs or opfs)' },
      mode: { type: 'string', enum: ['text', 'binary'], description: 'Read mode (default: text)' },
      maxBytes: { type: 'number', description: 'Maximum bytes to read' },
      offset: { type: 'number', description: 'Binary read offset (bytes)' },
      length: { type: 'number', description: 'Binary read length (bytes)' },
      startLine: { type: 'number', description: 'First line to read (1-indexed, inclusive). VFS only.' },
      endLine: { type: 'number', description: 'Last line to read (1-indexed, inclusive). VFS only.' }
    }
  },
  call
};

export default call;
