/**
 * @fileoverview EditFile - Targeted text modifications (VFS or OPFS)
 * Supports literal match/replace operations with optional counts.
 * Emits audit:core_write events for L3 substrate changes (/core/, /infrastructure/)
 */

const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const OPFS_PREFIX = 'opfs:';
const VFS_PREFIX = 'vfs:';
const OPFS_ALLOWLIST_PREFIXES = ['/doppler-models/adapters/'];

const normalizePath = (rawPath, backendOverride) => {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Missing "path" argument');
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

const getTextBytes = (content) => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(content).length;
  }
  return content.length;
};

const buildOperations = (args) => {
  if (Array.isArray(args.operations) && args.operations.length > 0) {
    return args.operations;
  }
  if (Array.isArray(args.patch) && args.patch.length > 0) {
    return args.patch.map((entry) => ({
      match: entry.find,
      replacement: entry.replace ?? '',
      count: entry.count
    }));
  }
  return [];
};

async function call(args = {}, deps = {}) {
  const { VFS, AuditLogger, EventBus, ToolRunner } = deps;
  if (!VFS) return 'VFS unavailable';

  const { backend, path } = normalizePath(args.path || args.file, args.backend);
  assertSafePath(path);

  if (backend === 'opfs') {
    assertOpfsAllowed(path);
  }

  const operations = buildOperations(args);
  const hasContent = typeof args.content === 'string';
  if (!hasContent && operations.length === 0) {
    throw new Error('Provide content or at least one operation');
  }

  const create = args.create === true;
  let existed = true;
  let content = '';

  if (backend === 'opfs') {
    try {
      const handle = await getOpfsFileHandle(path, { createDirs: false, createFile: false });
      const file = await handle.getFile();
      if (file.size > TEXT_LIMIT_BYTES) {
        throw new Error(`File exceeds text limit (${TEXT_LIMIT_BYTES} bytes)`);
      }
      content = await file.text();
    } catch (error) {
      if (error?.name === 'NotFoundError') {
        existed = false;
      } else {
        throw error;
      }
    }
  } else {
    try {
      content = await VFS.read(path);
    } catch (error) {
      existed = false;
    }
  }

  if (!existed && !create) {
    throw new Error('File does not exist and create is false');
  }

  const beforeLength = content.length;
  let changed = false;
  const results = [];

  if (hasContent) {
    content = args.content;
    changed = true;
  } else {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i] || {};
      const match = op.match;
      const replacement = op.replacement ?? '';
      if (!match) throw new Error(`Operation #${i + 1} missing "match"`);
      if (match.length === 0) throw new Error(`Operation #${i + 1} cannot use empty match string`);

      const count = typeof op.count === 'number' ? op.count : 1;
      const maxReplacements = count <= 0 ? Infinity : count;

      let replacements = 0;
      let startIndex = 0;

      while (replacements < maxReplacements) {
        const idx = content.indexOf(match, startIndex);
        if (idx === -1) break;

        content = content.slice(0, idx) + replacement + content.slice(idx + match.length);
        replacements++;
        changed = true;
        startIndex = idx + replacement.length;
      }

      results.push({
        matchPreview: match.length > 60 ? match.slice(0, 57) + '...' : match,
        replacementPreview: replacement.length > 60 ? replacement.slice(0, 57) + '...' : replacement,
        replacements
      });
    }
  }

  const bytesWritten = getTextBytes(content);
  if (bytesWritten > TEXT_LIMIT_BYTES) {
    throw new Error(`Content exceeds text limit (${TEXT_LIMIT_BYTES} bytes)`);
  }

  if (changed || !existed) {
    if (backend === 'opfs') {
      const handle = await getOpfsFileHandle(path, { createDirs: true, createFile: true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    } else {
      await VFS.write(path, content);
    }

    if (backend === 'vfs') {
      const isCore = path.startsWith('/core/') || path.startsWith('/infrastructure/');
      if (isCore && AuditLogger) {
        await AuditLogger.logCoreWrite({
          path,
          operation: 'EditFile',
          existed,
          bytesWritten,
          bytesBefore: beforeLength
        });
      }

      if (isCore && EventBus) {
        EventBus.emit('tool:core_write', {
          path,
          operation: 'EditFile',
          operationCount: results.reduce((sum, r) => sum + r.replacements, 0)
        });
      }
    }
  }

  let toolReload = null;
  if (backend === 'vfs' && path.startsWith('/tools/') && path.endsWith('.js') && ToolRunner?.refresh) {
    try {
      await ToolRunner.refresh();
      toolReload = 'tools reloaded';
    } catch (err) {
      toolReload = `tools reload failed: ${err.message}`;
    }
  }

  return {
    path,
    backend,
    bytesWritten,
    changed,
    existed,
    operations: results,
    toolReload
  };
}

export const tool = {
  name: "EditFile",
  description: "Apply literal match/replacement edits to a text file (VFS or OPFS).",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Path to edit (vfs:/ or opfs:/). Default backend is VFS.' },
      backend: { type: 'string', description: 'Optional backend override (vfs or opfs)' },
      content: { type: 'string', description: 'Full replacement content (text only)' },
      patch: {
        type: 'array',
        description: 'Patch operations with find/replace',
        items: {
          type: 'object',
          required: ['find'],
          properties: {
            find: { type: 'string' },
            replace: { type: 'string' },
            count: { type: 'number' }
          }
        }
      },
      operations: {
        type: 'array',
        description: 'Legacy operations array',
        items: {
          type: 'object',
          required: ['match'],
          properties: {
            match: { type: 'string' },
            replacement: { type: 'string' },
            count: { type: 'number' }
          }
        }
      },
      create: { type: 'boolean', description: 'Create file if missing (default false)' }
    }
  },
  call
};

export default call;
