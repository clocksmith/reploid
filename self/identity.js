/**
 * @fileoverview Identity helpers for the awakened Reploid self.
 */

import { createContributionSummary } from './reward-policy.js';
import { getCurrentReploidInstanceId, getScopedReploidStorageKey } from './instance.js';
import { deriveSwarmRole } from './swarm.js';

const IDENTITY_STORAGE_KEY = 'REPLOID_SELF_IDENTITY_V1';
const LEGACY_IDENTITY_MIGRATION_KEY = 'REPLOID_SELF_IDENTITY_V1_MIGRATED_INSTANCE';
const RETIRED_LEGACY_IDENTITY_MARKER = '__retired__';
const encoder = new TextEncoder();

export function getIdentityStorageKey(instanceId = getCurrentReploidInstanceId()) {
  return getScopedReploidStorageKey(IDENTITY_STORAGE_KEY, instanceId);
}

const stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const getStorage = (storage) => (
  storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : (typeof localStorage !== 'undefined' ? localStorage : null)
);

const getCryptoApi = (cryptoApi) => {
  const api = cryptoApi || globalThis.crypto;
  if (!api?.subtle) {
    throw new Error('WebCrypto unavailable');
  }
  return api;
};

const iterateStorageKeys = (storage) => {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
    return [];
  }

  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
};

const parseIdentityBundle = (raw) => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.peerId || !parsed?.publicJwk || !parsed?.privateJwk) {
      return null;
    }
    return {
      ...parsed,
      contribution: createContributionSummary(parsed.contribution)
    };
  } catch {
    return null;
  }
};

const findPeerCollisionKey = (storage, peerId, currentKey = '') => {
  if (!peerId) return null;

  for (const key of iterateStorageKeys(storage)) {
    if (key === currentKey) continue;
    if (key !== IDENTITY_STORAGE_KEY && !key.endsWith(`::${IDENTITY_STORAGE_KEY}`)) {
      continue;
    }
    const bundle = parseIdentityBundle(storage.getItem(key));
    if (bundle?.peerId === peerId) {
      return key;
    }
  }

  return null;
};

const toBase64Url = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

async function sha256Hex(text, cryptoApi = globalThis.crypto) {
  const digest = await getCryptoApi(cryptoApi).subtle.digest('SHA-256', encoder.encode(String(text || '')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function inferIdentityAlgorithm(bundleOrJwk = {}) {
  const algorithm = String(bundleOrJwk?.algorithm || '').trim();
  const crv = String(bundleOrJwk?.crv || bundleOrJwk?.publicJwk?.crv || '').trim();
  if (algorithm === 'Ed25519' || crv === 'Ed25519') {
    return 'Ed25519';
  }
  return 'ECDSA';
}

export function getIdentityImportAlgorithm(bundleOrJwk = {}) {
  return inferIdentityAlgorithm(bundleOrJwk) === 'Ed25519'
    ? { name: 'Ed25519' }
    : { name: 'ECDSA', namedCurve: 'P-256' };
}

export function getIdentitySignAlgorithm(bundleOrJwk = {}) {
  return inferIdentityAlgorithm(bundleOrJwk) === 'Ed25519'
    ? { name: 'Ed25519' }
    : { name: 'ECDSA', hash: 'SHA-256' };
}

export async function createPeerIdFromPublicJwk(publicJwk, cryptoApi = globalThis.crypto) {
  const publicShape = publicJwk ? {
    kty: publicJwk.kty || null,
    crv: publicJwk.crv || null,
    x: publicJwk.x || null,
    y: publicJwk.y || null,
    n: publicJwk.n || null,
    e: publicJwk.e || null
  } : {};
  const digest = await sha256Hex(stableJson(publicShape), cryptoApi);
  return `peer:${digest.slice(0, 24)}`;
}

async function generateKeyBundle(options = {}) {
  const cryptoApi = getCryptoApi(options.cryptoApi);
  let keyPair = null;
  let algorithm = 'Ed25519';

  try {
    keyPair = await cryptoApi.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  } catch {
    algorithm = 'ECDSA';
    keyPair = await cryptoApi.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  }

  const publicJwk = await cryptoApi.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await cryptoApi.subtle.exportKey('jwk', keyPair.privateKey);
  const peerId = await createPeerIdFromPublicJwk(publicJwk, cryptoApi);

  return {
    version: 1,
    peerId,
    algorithm,
    createdAt: new Date().toISOString(),
    publicJwk,
    privateJwk,
    contribution: createContributionSummary()
  };
}

export function readStoredIdentityBundle(storage, options = {}) {
  const target = getStorage(storage);
  if (!target) return null;

  try {
    const storageKey = getIdentityStorageKey(options.instanceId);
    const useLegacyFallback = options.legacyFallback === true && storageKey !== IDENTITY_STORAGE_KEY;
    const raw = target.getItem(storageKey) ?? (
      useLegacyFallback
        ? target.getItem(IDENTITY_STORAGE_KEY)
        : null
    );
    return parseIdentityBundle(raw);
  } catch {
    return null;
  }
}

export function saveIdentityBundle(bundle, storage, options = {}) {
  const target = getStorage(storage);
  if (!target) return bundle;
  target.setItem(getIdentityStorageKey(options.instanceId), JSON.stringify(bundle));
  return bundle;
}

const shouldRetireLegacyIdentity = (storage, instanceId) => {
  if (!storage || !instanceId) return false;

  const legacyBundle = parseIdentityBundle(storage.getItem(IDENTITY_STORAGE_KEY));
  if (!legacyBundle) return false;

  const claimedInstanceId = String(storage.getItem(LEGACY_IDENTITY_MIGRATION_KEY) || '').trim();
  if (!claimedInstanceId) return true;
  if (claimedInstanceId === instanceId) return true;

  const currentBundle = readStoredIdentityBundle(storage, {
    instanceId,
    legacyFallback: false
  });
  return !!(currentBundle?.peerId && currentBundle.peerId === legacyBundle.peerId);
};

export async function ensureIdentityBundle(options = {}) {
  const storage = getStorage(options.storage);
  const instanceId = String(options.instanceId || '').trim();
  const existing = readStoredIdentityBundle(storage, options);
  if (existing && !options.forceNew) {
    if (storage && instanceId) {
      const currentKey = getIdentityStorageKey(instanceId);
      const collidingKey = findPeerCollisionKey(storage, existing.peerId, currentKey);
      if (collidingKey) {
        let claimedInstanceId = String(storage.getItem(LEGACY_IDENTITY_MIGRATION_KEY) || '').trim();
        const legacyBundle = parseIdentityBundle(storage.getItem(IDENTITY_STORAGE_KEY));
        if (!claimedInstanceId && legacyBundle?.peerId === existing.peerId) {
          storage.setItem(LEGACY_IDENTITY_MIGRATION_KEY, instanceId);
          claimedInstanceId = String(storage.getItem(LEGACY_IDENTITY_MIGRATION_KEY) || '').trim();
        }
        const ownsLegacyIdentity = claimedInstanceId === instanceId && legacyBundle?.peerId === existing.peerId;
        if (!ownsLegacyIdentity) {
          const bundle = await generateKeyBundle(options);
          return saveIdentityBundle(bundle, storage, options);
        }
      }
    }
    return existing;
  }

  if (!options.forceNew && storage && instanceId) {
    const legacyBundle = parseIdentityBundle(storage.getItem(IDENTITY_STORAGE_KEY));
    if (legacyBundle) {
      let claimedInstanceId = String(storage.getItem(LEGACY_IDENTITY_MIGRATION_KEY) || '').trim();
      if (!claimedInstanceId) {
        storage.setItem(LEGACY_IDENTITY_MIGRATION_KEY, instanceId);
        claimedInstanceId = String(storage.getItem(LEGACY_IDENTITY_MIGRATION_KEY) || '').trim();
      }
      if (claimedInstanceId === instanceId) {
        return saveIdentityBundle(legacyBundle, storage, options);
      }
    }
  }

  const bundle = await generateKeyBundle(options);
  return saveIdentityBundle(bundle, storage, options);
}

export async function rotateIdentityBundle(options = {}) {
  const storage = getStorage(options.storage);
  const instanceId = String(options.instanceId || '').trim();

  if (storage && options.retireLegacy !== false && shouldRetireLegacyIdentity(storage, instanceId)) {
    storage.setItem(LEGACY_IDENTITY_MIGRATION_KEY, RETIRED_LEGACY_IDENTITY_MARKER);
  }

  const bundle = await generateKeyBundle(options);
  return saveIdentityBundle(bundle, storage, options);
}

export function buildIdentityDocument(bundle = null, options = {}) {
  const contribution = createContributionSummary(bundle?.contribution);
  const hasInference = !!options.hasInference;
  const swarmEnabled = !!options.swarmEnabled;
  const instanceId = String(options.instanceId || getCurrentReploidInstanceId() || 'default');

  return {
    schema: 'reploid/identity/v1',
    instanceId,
    peerId: bundle?.peerId || 'pending',
    algorithm: bundle?.algorithm || 'uninitialized',
    createdAt: bundle?.createdAt || null,
    publicJwk: bundle?.publicJwk || null,
    role: deriveSwarmRole({ hasInference, swarmEnabled }),
    hasInference,
    swarmEnabled,
    contribution,
    note: bundle
      ? 'Public identity summary mirrored into self. Private signing material stays in browser storage.'
      : 'Identity will be initialized on awaken and mirrored into self.'
  };
}

export async function ensureIdentityDocument(options = {}) {
  try {
    const bundle = await ensureIdentityBundle(options);
    return buildIdentityDocument(bundle, options);
  } catch {
    return buildIdentityDocument(null, options);
  }
}

export async function importSigningKey(bundle, cryptoApi = globalThis.crypto) {
  if (!bundle?.privateJwk) {
    throw new Error('Missing private JWK');
  }
  return getCryptoApi(cryptoApi).subtle.importKey(
    'jwk',
    bundle.privateJwk,
    getIdentityImportAlgorithm(bundle),
    false,
    ['sign']
  );
}

export async function importVerificationKey(bundleOrJwk, cryptoApi = globalThis.crypto) {
  const publicJwk = bundleOrJwk?.publicJwk || bundleOrJwk;
  if (!publicJwk) {
    throw new Error('Missing public JWK');
  }
  return getCryptoApi(cryptoApi).subtle.importKey(
    'jwk',
    publicJwk,
    getIdentityImportAlgorithm(publicJwk),
    false,
    ['verify']
  );
}

export function encodeBytes(value) {
  return encoder.encode(String(value || ''));
}

export { fromBase64Url, toBase64Url };

export default {
  IDENTITY_STORAGE_KEY,
  LEGACY_IDENTITY_MIGRATION_KEY,
  RETIRED_LEGACY_IDENTITY_MARKER,
  buildIdentityDocument,
  createPeerIdFromPublicJwk,
  encodeBytes,
  ensureIdentityBundle,
  ensureIdentityDocument,
  fromBase64Url,
  getIdentityStorageKey,
  getIdentityImportAlgorithm,
  getIdentitySignAlgorithm,
  importSigningKey,
  importVerificationKey,
  readStoredIdentityBundle,
  rotateIdentityBundle,
  saveIdentityBundle,
  toBase64Url
};
