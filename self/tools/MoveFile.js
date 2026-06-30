/**
 * @fileoverview MoveFile - Move files within writable VFS roots.
 */

import { assertWritableVfsPath, normalizeVfsPath } from '../config/vfs-policy.js';

const normalizePath = (rawPath, label) => {
  return normalizeVfsPath(rawPath, label);
};

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const sourcePath = normalizePath(args.source || args.from || args.src, 'source');
  const targetPath = normalizePath(args.target || args.to || args.dest || args.path, 'target');
  assertWritableVfsPath(sourcePath, 'MoveFile');
  assertWritableVfsPath(targetPath, 'MoveFile');

  const overwrite = args.overwrite !== false;
  const targetExists = await VFS.exists(targetPath).catch(() => false);
  if (targetExists && !overwrite) {
    throw new Error('Target file exists and overwrite is false');
  }

  const content = await VFS.read(sourcePath);
  await VFS.write(targetPath, content);
  await VFS.delete(sourcePath);

  EventBus?.emit?.('artifact:moved', { sourcePath, targetPath });
  if (AuditLogger?.logEvent) {
    await AuditLogger.logEvent('FILE_MOVE', {
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
  name: 'MoveFile',
  description: 'Move a VFS file within /shadow, /artifacts, or /cycles.',
  inputSchema: {
    type: 'object',
    required: ['source', 'target'],
    properties: {
      source: { type: 'string', description: 'Writable source VFS path.' },
      target: { type: 'string', description: 'Writable target VFS path.' },
      overwrite: { type: 'boolean', description: 'Allow replacing an existing target. Defaults true.' }
    }
  },
  call
};

export default call;
