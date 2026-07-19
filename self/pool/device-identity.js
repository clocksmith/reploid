/**
 * @fileoverview Device-root identity, role delegation, and optional passkey binding.
 */

import {
  SIGNATURE_DOMAINS,
  exportPrivateKey,
  exportPublicKey,
  hashJson,
  importSigningKeyPair,
  sha256Hex,
  signCanonical,
  verifyCanonicalSignature
} from './inference-receipt.js';

export const DEVICE_ROLE_DELEGATION_SCHEMA = 'reploid.pool.device-role-delegation/v1';
export const PASSKEY_BINDING_SCHEMA = 'reploid.pool.passkey-binding/v1';
export const PASSKEY_SESSION_SCHEMA = 'reploid.pool.passkey-session/v1';

const DB_NAME = 'reploid-pool-identity';
const DB_VERSION = 1;
const DB_STORE = 'deviceKeys';
const ROOT_KEY_ID = 'origin-device-root-v1';
const FALLBACK_KEY = 'REPLOID_POOL_DEVICE_ROOT_SIGNING_KEY_V1';
const PASSKEY_KEY = 'REPLOID_POOL_PASSKEY_BINDING_V1';
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const rootCache = new Map();
const passkeySessionCache = new Map();
const textEncoder = new TextEncoder();

const localStorageRef = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const bytesToBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const base64ToBytes = (value) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(value || ''), 'base64'));
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const bytesToBase64Url = (bytes) => bytesToBase64(bytes)
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const base64UrlToBytes = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
};

const hashBytes = (hash) => {
  const hex = String(hash || '').replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('SHA-256 hash is required');
  return Uint8Array.from(hex.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
};

const randomBytes = (length = 32) => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

const openDeviceDb = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) {
    resolve(null);
    return;
  }
  const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('identity IndexedDB open failed'));
});

const readDeviceKey = async (keyId) => {
  const db = await openDeviceDb();
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(keyId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('identity key read failed'));
    });
  } finally {
    db.close();
  }
};

const writeDeviceKey = async (keyId, record) => {
  const db = await openDeviceDb();
  if (!db) return false;
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(record, keyId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('identity key write failed'));
    });
    return true;
  } finally {
    db.close();
  }
};

const createNonExportableKeyPair = () => globalThis.crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign', 'verify']
);

const loadFallbackKeyPair = async () => {
  const serialized = localStorageRef()?.getItem(FALLBACK_KEY);
  if (serialized) {
    try {
      return await importSigningKeyPair(JSON.parse(serialized));
    } catch {
      // Replace malformed fallback material.
    }
  }
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  try {
    localStorageRef()?.setItem(FALLBACK_KEY, JSON.stringify({
      publicKey: await exportPublicKey(keyPair.publicKey),
      privateKey: await exportPrivateKey(keyPair.privateKey),
      createdAt: new Date().toISOString()
    }));
  } catch {
    // The identity remains session-scoped when browser storage is denied.
  }
  return keyPair;
};

const readPasskeyBinding = () => {
  try {
    const serialized = localStorageRef()?.getItem(PASSKEY_KEY);
    return serialized ? JSON.parse(serialized) : null;
  } catch {
    return null;
  }
};

const writePasskeyBinding = (binding) => {
  try {
    localStorageRef()?.setItem(PASSKEY_KEY, JSON.stringify(binding));
  } catch {
    throw new Error('Passkey binding could not be persisted');
  }
};

const rootIdForPublicKey = async (publicKey) => {
  const digest = await sha256Hex(publicKey);
  return `device_${digest.replace(/^sha256:/, '')}`;
};

export async function getDeviceRootIdentity() {
  if (rootCache.has(ROOT_KEY_ID)) return rootCache.get(ROOT_KEY_ID);
  const pending = (async () => {
    let keyPair = null;
    let protection = 'browser_non_exportable';
    try {
      const record = await readDeviceKey(ROOT_KEY_ID);
      if (record?.privateKey && record?.publicKey) {
        keyPair = { privateKey: record.privateKey, publicKey: record.publicKey };
      } else if (globalThis.indexedDB) {
        keyPair = await createNonExportableKeyPair();
        await writeDeviceKey(ROOT_KEY_ID, {
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey,
          createdAt: new Date().toISOString()
        });
      }
    } catch {
      keyPair = null;
    }
    if (!keyPair) {
      protection = 'browser_exportable_fallback';
      keyPair = await loadFallbackKeyPair();
    }
    const publicKey = await exportPublicKey(keyPair.publicKey);
    const deviceId = await rootIdForPublicKey(publicKey);
    const passkey = readPasskeyBinding();
    return Object.freeze({
      deviceId,
      publicKey,
      keyPair,
      protection,
      identityRootId: passkey?.passkeyId || deviceId,
      passkey: passkey?.deviceId === deviceId ? passkey : null
    });
  })();
  rootCache.set(ROOT_KEY_ID, pending);
  return pending;
}

const delegationSigningPayload = (delegation = {}) => {
  const { delegationHash, rootSignature, ...payload } = delegation || {};
  return payload;
};

const normalizedCapabilities = (capabilities) => Array.from(new Set(
  (Array.isArray(capabilities) ? capabilities : []).map(String).filter(Boolean)
)).sort();

export async function createRoleDelegation({
  deviceIdentity,
  role,
  roleId,
  rolePublicKey,
  capabilities = [],
  participationProfileHash = null,
  passkeySessionProof = null,
  issuedAt = new Date().toISOString(),
  expiresAt = null
} = {}) {
  if (!deviceIdentity?.deviceId || !deviceIdentity?.keyPair?.privateKey) {
    throw new TypeError('deviceIdentity with a private root key is required');
  }
  if (!role || !roleId || !rolePublicKey) throw new TypeError('role, roleId, and rolePublicKey are required');
  const payload = {
    schema: DEVICE_ROLE_DELEGATION_SCHEMA,
    deviceId: deviceIdentity.deviceId,
    identityRootId: deviceIdentity.identityRootId || deviceIdentity.deviceId,
    devicePublicKey: deviceIdentity.publicKey,
    rootProtection: deviceIdentity.passkey ? 'passkey' : deviceIdentity.protection,
    role: String(role),
    roleId: String(roleId),
    rolePublicKey: String(rolePublicKey),
    capabilities: normalizedCapabilities(capabilities),
    participationProfileHash: participationProfileHash || null,
    passkeySessionProof: passkeySessionProof || null,
    issuedAt,
    expiresAt
  };
  const delegationHash = await hashJson(payload);
  return Object.freeze({
    ...payload,
    delegationHash,
    rootSignature: await signCanonical(payload, deviceIdentity.keyPair.privateKey, {
      domain: SIGNATURE_DOMAINS.deviceRoleDelegation
    })
  });
}

export async function verifyRoleDelegation(delegation = {}, {
  role = null,
  roleId = null,
  rolePublicKey = null,
  requiredCapability = null,
  participationProfileHash = null,
  now = Date.now()
} = {}) {
  const reasons = [];
  if (delegation.schema !== DEVICE_ROLE_DELEGATION_SCHEMA) reasons.push('role delegation schema mismatch');
  if (!String(delegation.deviceId || '').trim()) reasons.push('role delegation deviceId is required');
  if (!String(delegation.devicePublicKey || '').trim()) reasons.push('role delegation devicePublicKey is required');
  if (!String(delegation.role || '').trim()) reasons.push('role delegation role is required');
  if (!String(delegation.roleId || '').trim()) reasons.push('role delegation roleId is required');
  if (!String(delegation.rolePublicKey || '').trim()) reasons.push('role delegation rolePublicKey is required');
  if (!Array.isArray(delegation.capabilities)) reasons.push('role delegation capabilities must be an array');
  if (role && delegation.role !== role) reasons.push('role delegation role mismatch');
  if (roleId && delegation.roleId !== roleId) reasons.push('role delegation roleId mismatch');
  if (rolePublicKey && delegation.rolePublicKey !== rolePublicKey) reasons.push('role delegation public key mismatch');
  if (requiredCapability && !delegation.capabilities?.includes(requiredCapability)) {
    reasons.push(`role delegation lacks ${requiredCapability}`);
  }
  if (participationProfileHash && delegation.participationProfileHash !== participationProfileHash) {
    reasons.push('role delegation participation profile mismatch');
  }
  if (delegation.expiresAt && Date.parse(delegation.expiresAt) <= now) reasons.push('role delegation expired');
  try {
    if (delegation.devicePublicKey) {
      const expectedDeviceId = await rootIdForPublicKey(delegation.devicePublicKey);
      if (delegation.deviceId !== expectedDeviceId) reasons.push('role delegation deviceId mismatch');
    }
    const payload = delegationSigningPayload(delegation);
    const delegationHash = await hashJson(payload);
    if (delegation.delegationHash !== delegationHash) reasons.push('role delegation hash mismatch');
    if (!delegation.rootSignature) {
      reasons.push('role delegation rootSignature is required');
    } else if (delegation.devicePublicKey && !await verifyCanonicalSignature(
      payload,
      delegation.devicePublicKey,
      delegation.rootSignature,
      { domain: SIGNATURE_DOMAINS.deviceRoleDelegation }
    )) {
      reasons.push('role delegation rootSignature invalid');
    }
    if (delegation.rootProtection === 'passkey') {
      const passkey = await verifyPasskeySessionProof(delegation.passkeySessionProof, {
        deviceId: delegation.deviceId,
        devicePublicKey: delegation.devicePublicKey,
        now
      });
      reasons.push(...passkey.reasons.map((reason) => `passkey: ${reason}`));
      if (passkey.identityRootId && delegation.identityRootId !== passkey.identityRootId) {
        reasons.push('role delegation passkey root mismatch');
      }
    }
  } catch (error) {
    reasons.push(`role delegation verification failed: ${error.message}`);
  }
  return { ok: reasons.length === 0, reasons, delegationHash: delegation.delegationHash || null };
}

const passkeyRpId = (locationRef = globalThis.location) => String(locationRef?.hostname || '').trim();
const passkeyOrigin = (locationRef = globalThis.location) => String(locationRef?.origin || '').trim();

export async function enrollDevicePasskey({
  deviceIdentity = null,
  credentials = globalThis.navigator?.credentials,
  locationRef = globalThis.location
} = {}) {
  const resolvedDeviceIdentity = deviceIdentity || await getDeviceRootIdentity();
  if (!credentials?.create || !credentials?.get) throw new Error('This browser does not expose WebAuthn passkeys');
  const rpId = passkeyRpId(locationRef);
  const origin = passkeyOrigin(locationRef);
  if (!rpId || !origin || origin === 'null') throw new Error('Passkey enrollment requires a secure web origin');
  const enrollment = {
    schema: PASSKEY_BINDING_SCHEMA,
    deviceId: resolvedDeviceIdentity.deviceId,
    devicePublicKey: resolvedDeviceIdentity.publicKey,
    rpId,
    origin,
    nonce: bytesToBase64Url(randomBytes()),
    createdAt: new Date().toISOString()
  };
  const challenge = hashBytes(await hashJson(enrollment));
  const credential = await credentials.create({
    publicKey: {
      challenge,
      rp: { id: rpId, name: 'Reploid' },
      user: {
        id: randomBytes(),
        name: `reploid-${resolvedDeviceIdentity.deviceId.slice(-12)}`,
        displayName: 'Reploid device'
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred'
      },
      timeout: 120000,
      attestation: 'none'
    }
  });
  const publicKeyBuffer = credential?.response?.getPublicKey?.();
  const algorithm = credential?.response?.getPublicKeyAlgorithm?.();
  if (!credential?.rawId || !publicKeyBuffer || algorithm !== -7) {
    throw new Error('Passkey must expose an ES256 public key');
  }
  const credentialPublicKey = bytesToBase64(new Uint8Array(publicKeyBuffer));
  const publicKeyHash = await sha256Hex(credentialPublicKey);
  const binding = Object.freeze({
    ...enrollment,
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    credentialPublicKey,
    algorithm,
    passkeyId: `passkey_${publicKeyHash.replace(/^sha256:/, '')}`
  });
  writePasskeyBinding(binding);
  rootCache.delete(ROOT_KEY_ID);
  const refreshed = await getDeviceRootIdentity();
  await createPasskeySessionProof({ deviceIdentity: refreshed, credentials, locationRef });
  return binding;
}

const readDerLength = (bytes, offset) => {
  const first = bytes[offset];
  if ((first & 0x80) === 0) return { length: first, bytesRead: 1 };
  const count = first & 0x7f;
  if (count < 1 || count > 2) throw new Error('unsupported ECDSA DER length');
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[offset + 1 + index];
  return { length, bytesRead: 1 + count };
};

export function derEcdsaSignatureToRaw(signature, coordinateBytes = 32) {
  const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature || []);
  if (bytes[0] !== 0x30) throw new Error('ECDSA signature is not a DER sequence');
  const sequenceLength = readDerLength(bytes, 1);
  let offset = 1 + sequenceLength.bytesRead;
  if (offset + sequenceLength.length !== bytes.length) throw new Error('ECDSA DER sequence length mismatch');
  const values = [];
  for (let component = 0; component < 2; component += 1) {
    if (bytes[offset++] !== 0x02) throw new Error('ECDSA DER component is not an integer');
    const componentLength = readDerLength(bytes, offset);
    offset += componentLength.bytesRead;
    let value = bytes.slice(offset, offset + componentLength.length);
    offset += componentLength.length;
    while (value.length > coordinateBytes && value[0] === 0) value = value.slice(1);
    if (value.length > coordinateBytes) throw new Error('ECDSA DER component exceeds curve size');
    const padded = new Uint8Array(coordinateBytes);
    padded.set(value, coordinateBytes - value.length);
    values.push(padded);
  }
  const raw = new Uint8Array(coordinateBytes * 2);
  raw.set(values[0], 0);
  raw.set(values[1], coordinateBytes);
  return raw;
}

const passkeySessionPayload = ({ deviceIdentity, createdAt, expiresAt, nonce }) => ({
  schema: PASSKEY_SESSION_SCHEMA,
  deviceId: deviceIdentity.deviceId,
  devicePublicKey: deviceIdentity.publicKey,
  identityRootId: deviceIdentity.passkey?.passkeyId || null,
  credentialId: deviceIdentity.passkey?.credentialId || null,
  credentialPublicKey: deviceIdentity.passkey?.credentialPublicKey || null,
  rpId: deviceIdentity.passkey?.rpId || null,
  origin: deviceIdentity.passkey?.origin || null,
  nonce,
  createdAt,
  expiresAt
});

export async function createPasskeySessionProof({
  deviceIdentity = null,
  credentials = globalThis.navigator?.credentials,
  locationRef = globalThis.location,
  now = Date.now()
} = {}) {
  const resolvedDeviceIdentity = deviceIdentity || await getDeviceRootIdentity();
  const binding = resolvedDeviceIdentity.passkey;
  if (!binding) return null;
  const cached = passkeySessionCache.get(resolvedDeviceIdentity.deviceId);
  if (cached && Date.parse(cached.payload.expiresAt) > now) return cached;
  if (!credentials?.get) throw new Error('Passkey verification is unavailable');
  if (binding.rpId !== passkeyRpId(locationRef) || binding.origin !== passkeyOrigin(locationRef)) {
    throw new Error('Passkey origin does not match this Poolday deployment');
  }
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_LIFETIME_MS).toISOString();
  const payload = passkeySessionPayload({
    deviceIdentity: resolvedDeviceIdentity,
    createdAt,
    expiresAt,
    nonce: bytesToBase64Url(randomBytes())
  });
  const challengeHash = await hashJson(payload);
  const assertion = await credentials.get({
    publicKey: {
      challenge: hashBytes(challengeHash),
      allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(binding.credentialId) }],
      rpId: binding.rpId,
      userVerification: 'preferred',
      timeout: 120000
    }
  });
  if (!assertion?.response) throw new Error('Passkey assertion was not returned');
  const proof = Object.freeze({
    schema: PASSKEY_SESSION_SCHEMA,
    payload,
    challengeHash,
    authenticatorData: bytesToBase64Url(new Uint8Array(assertion.response.authenticatorData)),
    clientDataJSON: bytesToBase64Url(new Uint8Array(assertion.response.clientDataJSON)),
    signature: bytesToBase64Url(new Uint8Array(assertion.response.signature)),
    userHandle: assertion.response.userHandle
      ? bytesToBase64Url(new Uint8Array(assertion.response.userHandle))
      : null
  });
  const verified = await verifyPasskeySessionProof(proof, {
    deviceId: resolvedDeviceIdentity.deviceId,
    devicePublicKey: resolvedDeviceIdentity.publicKey,
    now
  });
  if (!verified.ok) throw new Error(`Passkey assertion rejected: ${verified.reasons.join('; ')}`);
  passkeySessionCache.set(resolvedDeviceIdentity.deviceId, proof);
  return proof;
}

export async function verifyPasskeySessionProof(proof = {}, {
  deviceId = null,
  devicePublicKey = null,
  now = Date.now()
} = {}) {
  const reasons = [];
  const payload = proof.payload || {};
  if (proof.schema !== PASSKEY_SESSION_SCHEMA || payload.schema !== PASSKEY_SESSION_SCHEMA) {
    reasons.push('passkey session schema mismatch');
  }
  if (deviceId && payload.deviceId !== deviceId) reasons.push('passkey session deviceId mismatch');
  if (devicePublicKey && payload.devicePublicKey !== devicePublicKey) {
    reasons.push('passkey session device public key mismatch');
  }
  if (!payload.identityRootId || !payload.credentialId || !payload.credentialPublicKey
    || !payload.rpId || !payload.origin) {
    reasons.push('passkey session identity fields are incomplete');
  }
  if (Date.parse(payload.expiresAt || '') <= now) reasons.push('passkey session expired');
  try {
    const publicKeyHash = await sha256Hex(payload.credentialPublicKey);
    if (payload.identityRootId !== `passkey_${publicKeyHash.replace(/^sha256:/, '')}`) {
      reasons.push('passkey root identity mismatch');
    }
    const challengeHash = await hashJson(payload);
    if (proof.challengeHash !== challengeHash) reasons.push('passkey session challenge hash mismatch');
    const clientBytes = base64UrlToBytes(proof.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientBytes));
    if (clientData.type !== 'webauthn.get') reasons.push('passkey client data type mismatch');
    if (clientData.challenge !== bytesToBase64Url(hashBytes(challengeHash))) {
      reasons.push('passkey client challenge mismatch');
    }
    if (clientData.origin !== payload.origin || clientData.crossOrigin === true) {
      reasons.push('passkey client origin mismatch');
    }
    const authenticatorData = base64UrlToBytes(proof.authenticatorData);
    if (authenticatorData.byteLength < 37) throw new Error('passkey authenticator data is truncated');
    const expectedRpIdHash = hashBytes(await sha256Hex(payload.rpId));
    if (!expectedRpIdHash.every((byte, index) => authenticatorData[index] === byte)) {
      reasons.push('passkey RP ID hash mismatch');
    }
    if ((authenticatorData[32] & 0x01) === 0) reasons.push('passkey user-presence flag missing');
    const clientHash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', clientBytes));
    const signedBytes = new Uint8Array(authenticatorData.byteLength + clientHash.byteLength);
    signedBytes.set(authenticatorData);
    signedBytes.set(clientHash, authenticatorData.byteLength);
    const publicKey = await globalThis.crypto.subtle.importKey(
      'spki',
      base64ToBytes(payload.credentialPublicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const signature = derEcdsaSignatureToRaw(base64UrlToBytes(proof.signature));
    if (!await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      signedBytes
    )) reasons.push('passkey assertion signature invalid');
  } catch (error) {
    reasons.push(`passkey verification failed: ${error.message}`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    identityRootId: payload.identityRootId || null
  };
}

export function resetDeviceIdentityForTests() {
  rootCache.clear();
  passkeySessionCache.clear();
}

export default {
  DEVICE_ROLE_DELEGATION_SCHEMA,
  PASSKEY_BINDING_SCHEMA,
  PASSKEY_SESSION_SCHEMA,
  getDeviceRootIdentity,
  createRoleDelegation,
  verifyRoleDelegation,
  enrollDevicePasskey,
  createPasskeySessionProof,
  verifyPasskeySessionProof,
  derEcdsaSignatureToRaw,
  resetDeviceIdentityForTests
};
