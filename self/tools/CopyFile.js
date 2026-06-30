/**
 * @fileoverview CopyFile - Copy readable VFS content into a writable root.
 */

import { assertNoPathTraversal, assertWritableVfsPath, normalizeVfsPath } from '../config/vfs-policy.js';

const normalizePath = (rawPath, label) => {
  return normalizeVfsPath(rawPath, label);
};

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const sourcePath = normalizePath(args.source || args.from || args.src, 'source');
  const targetPath = normalizePath(args.target || args.to || args.dest || args.path, 'target');
  assertNoPathTraversal(sourcePath);
  assertWritableVfsPath(targetPath, 'CopyFile');

  const overwrite = args.overwrite !== false;
  const targetExists = await VFS.exists(targetPath).catch(() => false);
  if (targetExists && !overwrite) {
    throw new Error('Target file exists and overwrite is false');
  }

  const content = await VFS.read(sourcePath);
  await VFS.write(targetPath, content);

  EventBus?.emit?.('artifact:created', { path: targetPath, sourcePath });
  if (AuditLogger?.logEvent) {
    await AuditLogger.logEvent('FILE_COPY', {
      sourcePath,
      targetPath,
      bytesWritten: String(content).length,
      targetExisted: targetExists
    }, 'INFO');
  }

  return {
    success: true,
    sourcePath,
    targetPath,
    bytesWritten: String(content).length,
    targetExisted: targetExists
  };
}

export const tool = {
  name: 'CopyFile',
  description: 'Copy a VFS file into /shadow, /artifacts, or /cycles.',
  inputSchema: {
    type: 'object',
    required: ['source', 'target'],
    properties: {
      source: { type: 'string', description: 'Readable source VFS path.' },
      target: { type: 'string', description: 'Writable target VFS path.' },
      overwrite: { type: 'boolean', description: 'Allow replacing an existing target. Defaults true.' }
    }
  },
  call
};

export default call;
