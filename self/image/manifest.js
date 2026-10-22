/**
 * @fileoverview Canonical self-image integrity helpers. Hashes prove integrity, not trust.
 */

import { SELF_BOOT_SPEC, cloneSelfBootSpec } from '../boot-spec.js';

const encoder = new TextEncoder();
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const toHex = (bytes) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

export function assertSelfImagePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/self/')
    || /[\\%?#\s\u0000-\u001f]/.test(path)
    || path.split('/').slice(1).some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid canonical self-image path: ${path}`);
  }
  return path;
}

export function isCanonicalSelfPath(path, roots = SELF_BOOT_SPEC.canonicalRoots) {
  try {
    assertSelfImagePath(path);
    return roots.some((root) => path.startsWith(`${root.replace(/\/$/, '')}/`));
  } catch {
    return false;
  }
}

export async function sha256Text(content) {
  const value = String(content ?? '');
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(value));
    return toHex(new Uint8Array(digest));
  }
  if (typeof Buffer !== 'undefined') {
    const crypto = await import('node:crypto');
    return crypto.createHash('sha256').update(value).digest('hex');
  }
  throw new Error('No SHA-256 implementation available');
}

export async function createSelfImageManifest({ paths = [], readText, bootSpec = cloneSelfBootSpec() } = {}) {
  if (typeof readText !== 'function') throw new Error('Missing readText');
  const uniquePaths = new Set();
  const files = [];
  for (const path of paths) {
    assertSelfImagePath(path);
    if (uniquePaths.has(path)) throw new Error(`Duplicate self-image path: ${path}`);
    uniquePaths.add(path);
    const content = await readText(path);
    if (typeof content !== 'string') throw new Error(`Missing text source: ${path}`);
    files.push({ path, bytes: encoder.encode(content).length, sha256: await sha256Text(content) });
  }

  return {
    schema: 'reploid/self-image/v1',
    version: 1,
    createdAt: new Date().toISOString(),
    roots: [...bootSpec.canonicalRoots],
    boot: bootSpec,
    files
  };
}

export async function validateSelfImageManifest({ manifest, files } = {}) {
  if (manifest?.schema !== 'reploid/self-image/v1' || manifest.version !== 1
    || !Array.isArray(manifest.files) || !Array.isArray(manifest.roots)
    || manifest.roots.length !== 1 || manifest.roots[0] !== '/self') {
    throw new Error('Invalid self-image manifest');
  }
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('Self-image contents are required');
  }

  // Snapshot before hashing so an asynchronous caller cannot replace checked bytes.
  const contents = Object.fromEntries(Object.entries(files));
  const entries = manifest.files.map((entry) => ({ ...entry }));
  const paths = new Set();
  let bytes = 0;
  for (const entry of entries) {
    const path = assertSelfImagePath(entry.path);
    if (paths.has(path)) throw new Error(`Duplicate self-image path: ${path}`);
    paths.add(path);
    if (!hasOwn(contents, path) || typeof contents[path] !== 'string') {
      throw new Error(`Missing text source: ${path}`);
    }
    const size = encoder.encode(contents[path]).length;
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes !== size) {
      throw new Error(`Self-image byte length mismatch: ${path}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || await sha256Text(contents[path]) !== entry.sha256) {
      throw new Error(`Self-image hash mismatch: ${path}`);
    }
    bytes += size;
  }
  for (const path of Object.keys(contents)) {
    assertSelfImagePath(path);
    if (!paths.has(path)) throw new Error(`Unmanifested self-image source: ${path}`);
  }
  return { files: contents, fileCount: paths.size, bytes };
}
