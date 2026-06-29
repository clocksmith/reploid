/**
 * @fileoverview MoveFile - Move files within writable VFS roots.
 */

const VFS_WRITABLE_ROOTS = ['/shadow', '/artifacts', '/cycles'];

const normalizePath = (rawPath, label) => {
  const value = String(rawPath || '').trim();
  if (!value) throw new Error(`Missing ${label} argument`);
  return value.startsWith('/') ? value : `/${value}`;
};

const isWithinRoot = (path, root) => {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
};

const assertWritablePath = (path, operation) => {
  if (path.split('/').includes('..')) {
    throw new Error('Path traversal is not allowed');
  }
  if (!VFS_WRITABLE_ROOTS.some((root) => isWithinRoot(path, root))) {
    throw new Error(`VFS path not ${operation} by MoveFile: ${path}. Move files within /shadow, /artifacts, or /cycles.`);
  }
};

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const sourcePath = normalizePath(args.source || args.from || args.src, 'source');
  const targetPath = normalizePath(args.target || args.to || args.dest || args.path, 'target');
  assertWritablePath(sourcePath, 'movable');
  assertWritablePath(targetPath, 'writable');

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
