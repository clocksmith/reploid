/**
 * @fileoverview MakeDirectory - Create a logical VFS directory marker.
 */

const VFS_WRITABLE_ROOTS = ['/shadow', '/artifacts', '/cycles'];

const normalizePath = (rawPath) => {
  const value = String(rawPath || '').trim();
  if (!value) throw new Error('Missing path argument');
  return value.startsWith('/') ? value : `/${value}`;
};

const isWithinRoot = (path, root) => {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
};

const assertWritablePath = (path) => {
  if (path.split('/').includes('..')) {
    throw new Error('Path traversal is not allowed');
  }
  if (!VFS_WRITABLE_ROOTS.some((root) => isWithinRoot(path, root))) {
    throw new Error(`VFS path not writable by MakeDirectory: ${path}. Create directories under /shadow, /artifacts, or /cycles.`);
  }
};

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const directoryPath = normalizePath(args.path || args.directory || args.dir);
  assertWritablePath(directoryPath);

  const markerPath = `${directoryPath.replace(/\/+$/, '')}/.keep`;
  const exists = await VFS.exists(markerPath).catch(() => false);
  if (!exists || args.overwrite === true) {
    await VFS.write(markerPath, '');
  }

  EventBus?.emit?.('artifact:created', { path: directoryPath, kind: 'directory' });
  if (AuditLogger?.logEvent) {
    await AuditLogger.logEvent('DIRECTORY_CREATE', { path: directoryPath, markerPath }, 'INFO');
  }

  return { success: true, path: directoryPath, markerPath, existed: exists };
}

export const tool = {
  name: 'MakeDirectory',
  description: 'Create a logical directory marker under /shadow, /artifacts, or /cycles.',
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Directory path to create.' },
      overwrite: { type: 'boolean', description: 'Rewrite the marker if it already exists.' }
    }
  },
  call
};

export default call;
