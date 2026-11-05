/**
 * Source roots of the served browser tree. Each root holds files at their served
 * paths, so a served path such as /config/chat-models.json resolves to the one root
 * that contains it. Dependency-free: native delivery and the hosted backend use it.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Agent substrate, code both surfaces load, and the Poolday product. */
export const BROWSER_ROOTS = Object.freeze(['self', 'shared', 'apps/poolday']);

const toPosix = value => String(value).split(path.sep).join('/');

/** The root that contains a repository-relative path, or null. */
export function rootOf(sourcePath, roots = BROWSER_ROOTS) {
  const normalized = toPosix(sourcePath).replace(/^\.\//, '');
  return [...roots].sort((a, b) => b.length - a.length)
    .find(root => normalized.startsWith(root + '/')) || null;
}

/** The served path of a repository-relative source path, or null outside the roots. */
export function servedPathOf(sourcePath, roots = BROWSER_ROOTS) {
  const normalized = toPosix(sourcePath).replace(/^\.\//, '');
  const root = rootOf(normalized, roots);
  return root ? normalized.slice(root.length + 1) : null;
}

/**
 * Absolute path of the source that serves a path or origin-relative URL. A path no
 * root holds resolves inside the first root, so reading it fails as a missing file.
 */
export function resolveServedFile(servedPath, { repoRoot = REPOSITORY_ROOT, roots = BROWSER_ROOTS } = {}) {
  const served = String(servedPath).replace(/[?#].*$/, '').replace(/^\/+/, '');
  if (!served || served.split('/').some(part => part === '..' || part === '.')) throw new Error(`Invalid served path: ${servedPath}`);
  for (const root of roots) {
    const candidate = path.join(repoRoot, root, served);
    if (existsSync(candidate)) return candidate;
  }
  return path.join(repoRoot, roots[0], served);
}
