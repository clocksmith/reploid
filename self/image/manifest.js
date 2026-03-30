/**
 * @fileoverview Canonical self-image manifest helpers.
 */

import { SELF_BOOT_SPEC, cloneSelfBootSpec } from '../boot-spec.js';

const encoder = new TextEncoder();

const isWithinRoot = (path, root) => {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
};

const toHex = (bytes) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

export function isCanonicalSelfPath(path, roots = SELF_BOOT_SPEC.canonicalRoots) {
  const normalizedPath = String(path || '').trim();
  return roots.some((root) => isWithinRoot(normalizedPath, root));
}

export async function sha256Text(content) {
  const value = String(content || '');
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
  if (typeof readText !== 'function') {
    throw new Error('Missing readText');
  }

  const files = [];
  for (const path of paths) {
    const content = await readText(path);
    files.push({
      path,
      bytes: encoder.encode(String(content || '')).length,
      sha256: await sha256Text(content)
    });
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
