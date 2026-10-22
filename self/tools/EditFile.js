import { getTextBytes, assertOpfsPathAllowed } from '../host/file-access.js';
import fileToolSchemas from '../config/file-tool-schemas.json' with { type: 'json' };
import { normalizeFilePath, getOpfsFileHandle } from '../host/file-access.js';
import { FILE_TEXT_LIMIT_BYTES as TEXT_LIMIT_BYTES } from '../config/vfs-policy.js';
/**
 * @fileoverview EditFile - Targeted text modifications (VFS or OPFS)
 * Supports literal match/replace operations with optional counts.
 * Emits audit:core_write events for L3 substrate changes (/core/, /infrastructure/)
 */

import { assertNoPathTraversal, assertWritableVfsPath } from '../config/vfs-policy.js';

const OPFS_ALLOWLIST_PREFIXES = ['/doppler-models/adapters/'];

const assertOpfsAllowed = path => assertOpfsPathAllowed(path, OPFS_ALLOWLIST_PREFIXES);



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

  const { backend, path } = normalizeFilePath(args.path || args.file, args.backend, 'Missing "path" argument');
  assertNoPathTraversal(path);

  if (backend === 'opfs') {
    assertOpfsAllowed(path);
  } else {
    assertWritableVfsPath(path, 'EditFile');
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
  capabilities: ['vfs:write', 'tool:load'],
  name: "EditFile",
  description: "Apply literal match/replacement edits to a writable candidate/evidence text file (VFS or OPFS).",
  inputSchema: structuredClone(fileToolSchemas.EditFile),
  call
};

export default call;
