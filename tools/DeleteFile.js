/**
 * @fileoverview DeleteFile - Delete file from VFS with audit logging
 */

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const path = args.path || args.file;
  if (!path) throw new Error('Missing path argument');

  // Capture before state for audit
  const beforeContent = await VFS.read(path).catch(() => null);

  await VFS.delete(path);

  // Emit event for UI
  if (EventBus) {
    EventBus.emit('artifact:deleted', { path });
  }

  // Audit log
  if (AuditLogger) {
    const isCore = path.startsWith('/core/');
    await AuditLogger.logEvent('FILE_DELETE', {
      path,
      bytesBefore: beforeContent?.length || 0,
      isCore
    }, isCore ? 'WARN' : 'INFO');
  }

  return `Deleted ${path}`;
}

export const tool = {
  name: "DeleteFile",
  description: "Delete a file from the virtual filesystem",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'VFS path to delete' }
    }
  },
  call
};

export default call;
