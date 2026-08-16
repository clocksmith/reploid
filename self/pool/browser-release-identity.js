/**
 * @fileoverview Deterministic release identities for the Poolday browser tree.
 *
 * The bundle manifest hashes the served bytes, not source filenames alone. The
 * manifest is a descriptor and is intentionally excluded from its own file set
 * by the build script so the bundle identity is not recursively defined.
 */

import { hashJson, sha256Hex } from './inference-receipt.js';

export const BROWSER_BUNDLE_MANIFEST_SCHEMA = 'poolday.browser_bundle_manifest/v1';
export const SOURCE_RELEASE_IDENTITY_SCHEMA = 'poolday.source_release_identity/v1';
export const BROWSER_BUNDLE_DESCRIPTOR_PATH = 'config/browser-bundle-manifest.json';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const textEncoder = new TextEncoder();
const nonEmptyText = (value) => typeof value === 'string' && value.trim().length > 0;
const isSha256 = (value) => SHA256_PATTERN.test(String(value || ''));

const bytesOf = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return textEncoder.encode(String(value ?? ''));
};

export const normalizeBrowserBundlePath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.endsWith('/')) {
    throw new TypeError(`Invalid browser bundle path: ${value}`);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError(`Invalid browser bundle path: ${value}`);
  }
  return segments.join('/');
};

const manifestHashPayload = (files) => ({
  schema: BROWSER_BUNDLE_MANIFEST_SCHEMA,
  hashAlgorithm: 'sha256',
  publicRoot: 'self',
  descriptor: {
    path: BROWSER_BUNDLE_DESCRIPTOR_PATH,
    includedInBundle: false,
    reason: 'descriptor-cannot-hash-itself'
  },
  files
});

export async function buildBrowserBundleManifest(entries = []) {
  if (!Array.isArray(entries)) throw new TypeError('browser bundle entries must be an array');
  const files = await Promise.all(entries.map(async (entry = {}) => {
    const path = normalizeBrowserBundlePath(entry.path);
    const bytes = bytesOf(entry.bytes);
    return {
      path,
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes)
    };
  }));
  files.sort((left, right) => left.path.localeCompare(right.path));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1].path === files[index].path) {
      throw new TypeError(`Duplicate browser bundle path: ${files[index].path}`);
    }
  }
  return {
    ...manifestHashPayload(files),
    bundleHash: await hashJson(manifestHashPayload(files))
  };
}

export async function validateBrowserBundleManifest(manifest = {}, { entries = null } = {}) {
  const reasons = [];
  if (manifest.schema !== BROWSER_BUNDLE_MANIFEST_SCHEMA) {
    reasons.push('browser bundle manifest schema is invalid');
  }
  if (manifest.hashAlgorithm !== 'sha256') {
    reasons.push('browser bundle manifest hash algorithm is invalid');
  }
  if (manifest.publicRoot !== 'self') {
    reasons.push('browser bundle manifest public root is invalid');
  }
  if (manifest.descriptor?.path !== BROWSER_BUNDLE_DESCRIPTOR_PATH
    || manifest.descriptor?.includedInBundle !== false
    || manifest.descriptor?.reason !== 'descriptor-cannot-hash-itself') {
    reasons.push('browser bundle manifest descriptor exclusion is invalid');
  }
  if (!Array.isArray(manifest.files)) {
    reasons.push('browser bundle manifest files are invalid');
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const observedPaths = new Set();
  let priorPath = null;
  for (const file of files) {
    let normalizedPath = null;
    try {
      normalizedPath = normalizeBrowserBundlePath(file?.path);
    } catch {
      reasons.push(`browser bundle manifest path is invalid: ${file?.path || 'missing'}`);
      continue;
    }
    if (normalizedPath !== file.path) {
      reasons.push(`browser bundle manifest path is not canonical: ${file.path}`);
    }
    if (observedPaths.has(normalizedPath)) {
      reasons.push(`browser bundle manifest path is duplicated: ${normalizedPath}`);
    }
    observedPaths.add(normalizedPath);
    if (normalizedPath === BROWSER_BUNDLE_DESCRIPTOR_PATH) {
      reasons.push('browser bundle manifest cannot include its own descriptor');
    }
    if (priorPath !== null && priorPath.localeCompare(normalizedPath) >= 0) {
      reasons.push(`browser bundle manifest paths are not strictly sorted: ${normalizedPath}`);
    }
    priorPath = normalizedPath;
    if (!Number.isSafeInteger(file?.byteLength) || file.byteLength < 0) {
      reasons.push(`browser bundle manifest byte length is invalid: ${normalizedPath}`);
    }
    if (!isSha256(file?.sha256)) {
      reasons.push(`browser bundle manifest file hash is invalid: ${normalizedPath}`);
    }
  }
  const computedBundleHash = await hashJson(manifestHashPayload(files));
  if (!isSha256(manifest.bundleHash) || manifest.bundleHash !== computedBundleHash) {
    reasons.push('browser bundle manifest bundle hash is invalid');
  }
  if (entries !== null) {
    let expected = null;
    try {
      expected = await buildBrowserBundleManifest(entries);
    } catch (error) {
      reasons.push(`browser bundle input is invalid: ${error.message}`);
    }
    if (expected && JSON.stringify(expected) !== JSON.stringify(manifest)) {
      reasons.push('browser bundle manifest does not match the supplied bytes');
    }
  }
  return { ok: reasons.length === 0, reasons, computedBundleHash };
}

export async function buildSourceReleaseIdentity({
  sourceRevision,
  sourceTreeBytes,
  sourceDirty,
  trackedFileCount = null
} = {}) {
  if (!nonEmptyText(sourceRevision)) throw new TypeError('source revision is required');
  if (sourceDirty !== false) throw new TypeError('source release identity requires a clean tree');
  if (trackedFileCount !== null && (!Number.isSafeInteger(trackedFileCount) || trackedFileCount < 0)) {
    throw new TypeError('tracked file count must be a non-negative integer');
  }
  return {
    schema: SOURCE_RELEASE_IDENTITY_SCHEMA,
    sourceRevision: sourceRevision.trim(),
    sourceTreeHash: await sha256Hex(bytesOf(sourceTreeBytes)),
    sourceDirty: false,
    ...(trackedFileCount === null ? {} : { trackedFileCount })
  };
}

export function validateSourceReleaseIdentity(identity = {}) {
  const reasons = [];
  if (identity.schema !== SOURCE_RELEASE_IDENTITY_SCHEMA) {
    reasons.push('source release identity schema is invalid');
  }
  if (!nonEmptyText(identity.sourceRevision)) {
    reasons.push('source release revision is missing');
  }
  if (!isSha256(identity.sourceTreeHash)) {
    reasons.push('source release tree hash is invalid');
  }
  if (identity.sourceDirty !== false) {
    reasons.push('source release tree is dirty');
  }
  if (identity.trackedFileCount !== undefined
    && (!Number.isSafeInteger(identity.trackedFileCount) || identity.trackedFileCount < 0)) {
    reasons.push('source release tracked file count is invalid');
  }
  return { ok: reasons.length === 0, reasons };
}
