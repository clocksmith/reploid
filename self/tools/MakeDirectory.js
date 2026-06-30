/**
 * @fileoverview MakeDirectory - Create a logical VFS directory marker.
 */

import { assertWritableVfsPath, normalizeVfsPath } from '../config/vfs-policy.js';

const normalizePath = (rawPath) => {
  return normalizeVfsPath(rawPath);
};

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const directoryPath = normalizePath(args.path || args.directory || args.dir);
  assertWritableVfsPath(directoryPath, 'MakeDirectory');

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
