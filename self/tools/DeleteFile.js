/**
 * @fileoverview DeleteFile - Delete file from VFS with audit logging
 */

const VFS_WRITABLE_ROOTS = ['/shadow', '/artifacts', '/cycles'];

const normalizePath = (rawPath) => {
  const value = String(rawPath || '').trim();
  return value.startsWith('/') ? value : `/${value}`;
};

const isWithinRoot = (path, root) => {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
};

const assertSafeWritablePath = (path) => {
  if (path.split('/').includes('..')) {
    throw new Error('Path traversal is not allowed');
  }
  if (!VFS_WRITABLE_ROOTS.some((root) => isWithinRoot(path, root))) {
    throw new Error(`VFS path not deletable by DeleteFile: ${path}. Delete candidates under /shadow or evidence under /artifacts, then use Promote for /self.`);
  }
};

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path, file, recursive = false } = args;
  const targetPath = normalizePath(path || file);
  if (!targetPath || targetPath === '/') throw new Error('Missing path argument');
  assertSafeWritablePath(targetPath);

  if (recursive) {
    const files = await VFS.list(targetPath);
    let deletedCount = 0;
    for (const filePath of files) {
      await VFS.delete(filePath);
      deletedCount++;
    }

    // Audit summary
    if (AuditLogger) {
      await AuditLogger.logEvent('FILE_DELETE_RECURSIVE', {
        path: targetPath,
        count: deletedCount
      }, 'WARN');
    }
    return `Deleted ${deletedCount} files under ${targetPath}`;
  }

  // Capture before state for audit
  const beforeContent = await VFS.read(targetPath).catch(() => null);

  await VFS.delete(targetPath);

  // Emit event for UI
  if (EventBus) {
    EventBus.emit('artifact:deleted', { path: targetPath });
  }

  // Audit log
  if (AuditLogger) {
    const isCore = targetPath.startsWith('/core/');
    await AuditLogger.logEvent('FILE_DELETE', {
      path: targetPath,
      bytesBefore: beforeContent?.length || 0,
      isCore
    }, isCore ? 'WARN' : 'INFO');
  }

  return `Deleted ${targetPath}`;
}

export const tool = {
  name: "DeleteFile",
  description: "Delete a file from the virtual filesystem",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'VFS path to delete' },
      recursive: { type: 'boolean', description: 'Delete directories recursively' }
    }
  },
  call
};

export default call;
