/**
 * @fileoverview Shared promotion and validator quarantine policy.
 */

import { isWithinRoot, normalizeVfsPath } from '../config/vfs-policy.js';

export { isWithinRoot } from '../config/vfs-policy.js';

export const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const VFS_PREFIX = 'vfs:';

export const ALLOWED_TARGET_ROOTS = Object.freeze([
  '/self/capabilities',
  '/self/capsule',
  '/self/config',
  '/self/core',
  '/self/host',
  '/self/infrastructure',
  '/self/kernel',
  '/self/tools',
  '/self/prompts',
  '/self/blueprints',
  '/self/pool',
  '/self/styles',
  '/self/ui'
]);

export const ALLOWED_TARGET_PATHS = Object.freeze([
  '/self/blueprint-index.json',
  '/self/boot-spec.js',
  '/self/bridge.js',
  '/self/environment.js',
  '/self/identity.js',
  '/self/instance.js',
  '/self/manifest.js',
  '/self/receipt.js',
  '/self/reward-policy.js',
  '/self/runtime.js',
  '/self/self.json',
  '/self/swarm.js',
  '/self/tool-runner.js'
]);

export const ALLOWED_TARGET_EXTENSIONS = Object.freeze([
  '.js',
  '.json',
  '.md',
  '.css',
  '.html'
]);

export const VALIDATOR_QUARANTINE_TARGETS = Object.freeze([
  '/self/core/verification-manager.js',
  '/self/testing/arena/arena-harness.js',
  '/self/capabilities/communication/consensus.js',
  '/self/infrastructure/audit-logger.js',
  '/self/config/genesis-levels.json',
  '/self/core/tool-runner.js',
  '/self/tools/Promote.js'
]);

export const VALIDATOR_QUARANTINE_PREFIXES = Object.freeze([
  '/self/testing/arena/',
  '/self/core/verification-',
  '/self/infrastructure/policy-'
]);

export function normalizePromotionPath(rawPath) {
  let path = String(rawPath || '').trim();
  if (!path) throw new Error('Missing path argument');
  if (path.startsWith(VFS_PREFIX)) {
    path = path.slice(VFS_PREFIX.length);
  }
  return normalizeVfsPath(path);
}

export function hasAllowedExtension(path) {
  return ALLOWED_TARGET_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function defaultAllowTargetPath(path) {
  return (
    (ALLOWED_TARGET_PATHS.includes(path) || ALLOWED_TARGET_ROOTS.some((root) => isWithinRoot(path, root)))
      && hasAllowedExtension(path)
  );
}

export function isValidatorMutationTarget(path) {
  return VALIDATOR_QUARANTINE_TARGETS.includes(path)
    || VALIDATOR_QUARANTINE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function textBytes(content) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(String(content)).length;
  }
  return String(content).length;
}

export async function sha256(content) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 not available in this environment');
  }
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(String(content))
    : Uint8Array.from(String(content), (char) => char.charCodeAt(0));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function parseEvidence(content, evidencePath) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Evidence is not valid JSON: ${evidencePath}`);
  }
}

export async function readRequired(VFS, path, label) {
  const exists = await VFS.exists(path);
  if (!exists) {
    throw new Error(`${label} not found: ${path}`);
  }
  return VFS.read(path);
}

export function getEvidencePath(evidence, key) {
  const value = evidence?.[key] || evidence?.promotion?.[key];
  return typeof value === 'string' && value.trim() ? normalizePromotionPath(value) : '';
}

export function getEvidenceBoolean(evidence, key) {
  if (typeof evidence?.[key] === 'boolean') return evidence[key];
  if (typeof evidence?.promotion?.[key] === 'boolean') return evidence.promotion[key];
  return false;
}

export function getEvidenceHash(evidence, key) {
  const value = evidence?.[key] || evidence?.promotion?.[key];
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
}
