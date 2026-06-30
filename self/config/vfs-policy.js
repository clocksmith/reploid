/**
 * @fileoverview Shared VFS write boundary policy.
 */

export const WRITABLE_VFS_ROOTS = Object.freeze(['/shadow', '/artifacts', '/cycles']);
export const OPFS_ARTIFACT_ROOTS = Object.freeze(['/artifacts']);

export function normalizeVfsPath(rawPath, label = 'path') {
  const value = String(rawPath || '').trim();
  if (!value) throw new Error(`Missing ${label} argument`);
  return value.startsWith('/') ? value : `/${value}`;
}

export function isWithinRoot(path, root) {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}

export function assertNoPathTraversal(path) {
  if (String(path || '').split('/').includes('..')) {
    throw new Error('Path traversal is not allowed');
  }
}

const getWritableError = (path, operation) => {
  if (operation === 'WriteFile') {
    return `VFS path not writable by WriteFile: ${path}. Write candidates under /shadow or evidence under /artifacts, then use Promote for /self.`;
  }
  if (operation === 'EditFile') {
    return `VFS path not editable by EditFile: ${path}. Edit candidates under /shadow or evidence under /artifacts, then use Promote for /self.`;
  }
  if (operation === 'DeleteFile') {
    return `VFS path not deletable by DeleteFile: ${path}. Delete candidates under /shadow or evidence under /artifacts, then use Promote for /self.`;
  }
  if (operation === 'CopyFile') {
    return `VFS destination not writable by CopyFile: ${path}. Copy into /shadow, /artifacts, or /cycles.`;
  }
  if (operation === 'MoveFile') {
    return `VFS path not movable by MoveFile: ${path}. Move files within /shadow, /artifacts, or /cycles.`;
  }
  if (operation === 'MakeDirectory') {
    return `VFS path not writable by MakeDirectory: ${path}. Create directories under /shadow, /artifacts, or /cycles.`;
  }
  return `VFS path not writable by ${operation || 'tool'}: ${path}. Use /shadow, /artifacts, or /cycles.`;
};

export function assertWritableVfsPath(path, operation = 'tool') {
  assertNoPathTraversal(path);
  if (!WRITABLE_VFS_ROOTS.some((root) => isWithinRoot(path, root))) {
    throw new Error(getWritableError(path, operation));
  }
}

export function assertOpfsArtifactPath(path) {
  assertNoPathTraversal(path);
  if (!OPFS_ARTIFACT_ROOTS.some((root) => isWithinRoot(path, root))) {
    throw new Error(`OPFS path not allowed: ${path}`);
  }
}

