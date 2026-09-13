import { createPeerIdFromPublicJwk, encodeBytes, fromBase64Url, getIdentityImportAlgorithm, getIdentitySignAlgorithm, importSigningKey, importVerificationKey, toBase64Url } from './vendor/reploid/artifacts/identity.js';
export { createPeerIdFromPublicJwk, encodeBytes, fromBase64Url, getIdentityImportAlgorithm, getIdentitySignAlgorithm, importSigningKey, importVerificationKey, toBase64Url };
/**
 * @fileoverview Identity helpers for the awakened Reploid self.
 */

import { createContributionSummary } from './reward-policy.js';
import { getCurrentReploidInstanceId, getScopedReploidStorageKey } from './instance.js';
import { deriveSwarmRole } from './swarm.js';

const IDENTITY_STORAGE_KEY = 'REPLOID_SELF_IDENTITY_V1';
const LEGACY_IDENTITY_MIGRATION_KEY = 'REPLOID_SELF_IDENTITY_V1_MIGRATED_INSTANCE';
const RETIRED_LEGACY_IDENTITY_MARKER = '__retired__';


export function getIdentityStorageKey(instanceId = getCurrentReploidInstanceId()) {
  return getScopedReploidStorageKey(IDENTITY_STORAGE_KEY, instanceId);
}

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
