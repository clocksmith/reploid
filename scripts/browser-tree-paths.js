import path from 'path';

const SELF_ROOT_FILES = new Set([
  'boot-spec.js',
  'bridge.js',
  'cloud-access-status.js',
  'cloud-access-windows.js',
  'cloud-access.js',
  'environment.js',
  'identity.js',
  'instance.js',
  'key-unsealer.js',
  'manifest.js',
  'receipt.js',
  'reward-policy.js',
  'runtime.js',
  'swarm.js',
  'tool-runner.js'
]);

const SELF_ROOT_PREFIXES = Object.freeze([
  'capsule/',
  'host/',
  'image/',
  'kernel/'
]);

export const toPosix = (value) => String(value || '').split(path.sep).join('/');

export function isSelfOwnedSourcePath(relativePath) {
  const normalized = toPosix(relativePath).replace(/^\/+/, '');
  return SELF_ROOT_FILES.has(normalized)
    || SELF_ROOT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function toCanonicalBrowserPath(relativePath) {
  const normalized = toPosix(relativePath).replace(/^\/+/, '');
  if (!normalized) return normalized;
  return isSelfOwnedSourcePath(normalized)
    ? `self/${normalized}`
    : normalized;
}

export function toBrowserSourcePath(relativePath) {
  const normalized = toPosix(relativePath).replace(/^\/+/, '');
  if (!normalized.startsWith('self/')) {
    return normalized;
  }

  const stripped = normalized.slice('self/'.length);
  return isSelfOwnedSourcePath(stripped) ? stripped : normalized;
}
