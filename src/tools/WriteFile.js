/**
 * @fileoverview WriteFile - Write content to VFS or OPFS with guardrails
 */

let _securityModulePromise = null;
const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const BINARY_LIMIT_BYTES = 256 * 1024 * 1024;
const OPFS_PREFIX = 'opfs:';
const VFS_PREFIX = 'vfs:';
const OPFS_ALLOWLIST_PREFIXES = ['/doppler-models/adapters/'];

const loadSecurityModule = () => {
  if (_securityModulePromise) return _securityModulePromise;
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : (typeof self !== 'undefined' && self.location?.origin ? self.location.origin : null);
  if (!origin) {
    _securityModulePromise = Promise.resolve(null);
    return _securityModulePromise;
  }
  const url = new URL('/core/security-config.js', origin).toString();
  _securityModulePromise = import(url).catch(() => null);
  return _securityModulePromise;
};

const getSecurityEnabled = async () => {
  const mod = await loadSecurityModule();
  if (mod && typeof mod.isSecurityEnabled === 'function') {
    return !!mod.isSecurityEnabled();
  }
  return false;
};

const normalizePath = (rawPath, backendOverride) => {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Missing path argument');
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

const getOpfsFileHandle = async (path, options = {}) => {
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

const decodeBase64 = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(String(data), 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(String(data));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error('Base64 decoder not available');
};

const getTextBytes = (content) => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(content).length;
  }
  return content.length;
};

const computeSha256 = async (bytes) => {
  if (!crypto?.subtle) {
    throw new Error('SHA-256 not available in this environment');
  }
  const buffer = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger, VFSSandbox, VerificationManager, SubstrateLoader } = deps;
  if (!VFS) throw new Error('VFS not available');

  const rawPath = args.path || args.file;
  const { backend, path } = normalizePath(rawPath, args.backend);
  assertSafePath(path);

  const mode = resolveMode(args.mode);
  const maxBytes = resolveMaxBytes(mode, args.maxBytes);
  const create = args.create !== false;
  const overwrite = args.overwrite !== false;
  const autoLoad = args.autoLoad === true;

  if (backend === 'opfs') {
    assertOpfsAllowed(path);
    if (mode === 'text') {
      if (args.data !== undefined) {
        throw new Error('Binary data not allowed in text mode');
      }
      if (args.content === undefined) {
        throw new Error('Missing content argument');
      }
      const bytes = getTextBytes(args.content);
      if (bytes > maxBytes) {
        throw new Error(`Content exceeds maxBytes (${maxBytes} bytes)`);
      }

      let exists = true;
      try {
        await getOpfsFileHandle(path, { createDirs: false, createFile: false });
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          exists = false;
        } else {
          throw error;
        }
      }

      if (!exists && !create) {
        throw new Error('OPFS file does not exist and create is false');
      }
      if (exists && !overwrite) {
        throw new Error('OPFS file exists and overwrite is false');
      }

      const fileHandle = await getOpfsFileHandle(path, {
        createDirs: create,
        createFile: true
      });
      const writable = await fileHandle.createWritable();
      await writable.write(args.content);
      await writable.close();

      return { path, backend: 'opfs', bytesWritten: bytes };
    }

    if (args.content !== undefined) {
      throw new Error('Text content not allowed in binary mode');
    }
    if (args.data === undefined) {
      throw new Error('Missing data argument for binary write');
    }

    const bytes = decodeBase64(args.data);
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Data exceeds maxBytes (${maxBytes} bytes)`);
    }
    if (args.checksum) {
      const algo = (args.checksumAlgorithm || 'sha256').toLowerCase();
      if (algo !== 'sha256') {
        throw new Error(`Unsupported checksum algorithm: ${algo}`);
      }
      const digest = await computeSha256(bytes);
      if (digest.toLowerCase() !== String(args.checksum).toLowerCase()) {
        throw new Error('Checksum mismatch');
      }
    }

    let exists = true;
    try {
      await getOpfsFileHandle(path, { createDirs: false, createFile: false });
    } catch (error) {
      if (error?.name === 'NotFoundError') {
        exists = false;
      } else {
        throw error;
      }
    }

    if (!exists && !create) {
      throw new Error('OPFS file does not exist and create is false');
    }
    if (exists && !overwrite) {
      throw new Error('OPFS file exists and overwrite is false');
    }

    const fileHandle = await getOpfsFileHandle(path, {
      createDirs: create,
      createFile: true
    });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();

    return { path, backend: 'opfs', bytesWritten: bytes.byteLength };
  }

  if (mode !== 'text') {
    throw new Error('VFS supports text mode only');
  }

  const content = args.content;
  if (content === undefined) throw new Error('Missing content argument');

  const bytesWritten = getTextBytes(content);
  if (bytesWritten > maxBytes) {
    throw new Error(`Content exceeds maxBytes (${maxBytes} bytes)`);
  }

  const isCore = path.startsWith('/core/') || path.startsWith('/infrastructure/');
  const existed = await VFS.exists(path);
  if (!existed && !create) {
    throw new Error('VFS file does not exist and create is false');
  }
  if (existed && !overwrite) {
    throw new Error('VFS file exists and overwrite is false');
  }

  const beforeContent = existed ? await VFS.read(path).catch(() => null) : null;

  // Arena verification for core file changes (when enabled)
  let arenaGatingEnabled = false;
  try {
    arenaGatingEnabled = localStorage.getItem('REPLOID_ARENA_GATING') === 'true';
  } catch (e) { /* ignore */ }
  const securityEnabled = await getSecurityEnabled();

  if (isCore && arenaGatingEnabled && securityEnabled && VFSSandbox && VerificationManager) {
    try {
      const snapshot = await VFSSandbox.createSnapshot();
      try {
        await VFSSandbox.applyChanges({ [path]: content });
        const result = await VerificationManager.verifyProposal({ [path]: content });

        if (!result.passed) {
          const errorMsg = `Core modification blocked: ${result.errors?.join(', ') || 'verification failed'}`;
          if (AuditLogger) {
            await AuditLogger.logEvent('CORE_WRITE_BLOCKED', { path, errors: result.errors }, 'WARN');
          }
          if (EventBus) {
            EventBus.emit('tool:core_blocked', { path, errors: result.errors });
          }
          throw new Error(errorMsg);
        }
      } finally {
        await VFSSandbox.restoreSnapshot(snapshot);
      }
    } catch (err) {
      if (err.message.startsWith('Core modification blocked')) throw err;
      // Verification system error - log but proceed
      console.warn('[WriteFile] Arena verification error:', err.message);
    }
  }

  await VFS.write(path, content);

  // Emit event for UI
  if (EventBus) {
    EventBus.emit(existed ? 'vfs:write' : 'artifact:created', { path });
  }

  // Audit log - use logCoreWrite for L3 substrate changes
  if (AuditLogger) {
    if (isCore) {
      await AuditLogger.logCoreWrite({
        path,
        operation: 'WriteFile',
        existed,
        bytesWritten,
        arenaVerified: arenaGatingEnabled && securityEnabled
      });
    } else {
      await AuditLogger.logEvent('FILE_WRITE', {
        path,
        existed,
        bytesWritten,
        bytesBefore: beforeContent?.length || 0
      }, 'INFO');
    }
  }

  // Emit event for core writes (L3 substrate visibility)
  if (isCore && EventBus) {
    EventBus.emit('tool:core_write', {
      path,
      operation: 'WriteFile',
      existed,
      bytesWritten
    });
  }

  // Auto-load module if requested and file is .js
  let loadResult = '';
  if (autoLoad && path.endsWith('.js') && SubstrateLoader) {
    try {
      await SubstrateLoader.loadModule(path);
      loadResult = ' + hot-reloaded';
    } catch (err) {
      loadResult = ` (autoLoad failed: ${err.message})`;
    }
  } else if (autoLoad && !SubstrateLoader) {
    loadResult = ' (autoLoad skipped: SubstrateLoader not available)';
  }

  return {
    path,
    backend: 'vfs',
    bytesWritten,
    autoLoad: autoLoad || false,
    loadResult: loadResult || null
  };
}

export const tool = {
  name: "WriteFile",
  description: "Write content to VFS or OPFS. Use opfs:/ for binary assets and mode: \"binary\" for tensor data.",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Path to write (vfs:/ or opfs:/). Default backend is VFS.' },
      backend: { type: 'string', description: 'Optional backend override (vfs or opfs)' },
      mode: { type: 'string', enum: ['text', 'binary'], description: 'Write mode (default: text)' },
      content: { type: 'string', description: 'Text content to write' },
      data: { type: 'string', description: 'Base64 data for binary writes' },
      checksum: { type: 'string', description: 'Optional checksum for binary data' },
      checksumAlgorithm: { type: 'string', description: 'Checksum algorithm (default: sha256)' },
      maxBytes: { type: 'number', description: 'Maximum bytes to write' },
      create: { type: 'boolean', description: 'Create file if missing (default true)' },
      overwrite: { type: 'boolean', description: 'Overwrite file if it exists (default true)' },
      autoLoad: { type: 'boolean', description: 'If true and path is .js, hot-reload the module after writing', default: false }
    }
  },
  call
};

export default call;
