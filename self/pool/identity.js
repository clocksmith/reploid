/**
 * @fileoverview Browser identity and signing-key persistence for pool roles.
 */

import {
  createSigningKeyPair,
  exportPrivateKey,
  exportPublicKey,
  importSigningKeyPair
} from './inference-receipt.js';
import { bootstrapPoolFirebaseAuth } from './firebase-auth.js';

const ID_PREFIX = 'REPLOID_POOL';
const SIGNING_KEY_VERSION = 'v1';

const hasStorage = () => {
  try {
    return !!globalThis.localStorage;
  } catch {
    return false;
  }
};

const safeKind = (kind) => String(kind || 'user').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

const makeLocalId = (kind) => `${kind}_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

const storageGet = (key) => {
  if (!hasStorage()) return null;
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const storageSet = (key, value) => {
  if (!hasStorage()) return;
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Ignore storage denial. Identity remains valid for the current page session.
  }
};

const normalizeUid = (uid) => String(uid || '').replace(/[^a-z0-9_-]/gi, '_');

async function resolveCompatFirebaseUser() {
  const firebase = globalThis.firebase;
  if (!firebase?.auth) return null;
  const auth = typeof firebase.auth === 'function' ? firebase.auth() : firebase.auth;
  if (!auth) return null;
  if (auth.currentUser?.uid) return auth.currentUser;
  if (typeof auth.signInAnonymously === 'function') {
    const result = await auth.signInAnonymously();
    return result?.user || auth.currentUser || null;
  }
  return null;
}

async function resolveInjectedFirebaseUser() {
  const auth = globalThis.REPLOID_FIREBASE_AUTH || globalThis.REPLOID_POOL_FIREBASE_AUTH;
  if (!auth) return null;
  if (auth.currentUser?.uid) return auth.currentUser;
  if (typeof auth.signInAnonymously === 'function') {
    const result = await auth.signInAnonymously();
    return result?.user || auth.currentUser || null;
  }
  if (typeof globalThis.REPLOID_FIREBASE_SIGN_IN_ANONYMOUSLY === 'function') {
    const result = await globalThis.REPLOID_FIREBASE_SIGN_IN_ANONYMOUSLY(auth);
    return result?.user || auth.currentUser || null;
  }
  return null;
}

export async function resolveFirebaseIdentity() {
  await bootstrapPoolFirebaseAuth().catch(() => null);
  try {
    const injected = await resolveInjectedFirebaseUser();
    if (injected?.uid) return injected;
  } catch {
    // Fall back to local anonymous identity.
  }
  try {
    const compat = await resolveCompatFirebaseUser();
    if (compat?.uid) return compat;
  } catch {
    // Fall back to local anonymous identity.
  }
  return null;
}

export async function getPoolAuthToken() {
  const firebaseUser = await resolveFirebaseIdentity();
  if (typeof firebaseUser?.getIdToken === 'function') {
    return firebaseUser.getIdToken();
  }
  return null;
}

export function getLocalRoleId(kind) {
  const role = safeKind(kind);
  const key = `${ID_PREFIX}_${role.toUpperCase()}_ID`;
  const existing = storageGet(key);
  if (existing) return existing;
  const id = makeLocalId(role);
  storageSet(key, id);
  return id;
}

export async function resolvePoolIdentity(kind = 'user') {
  const role = safeKind(kind);
  const firebaseUser = await resolveFirebaseIdentity();
  if (firebaseUser?.uid) {
    return {
      kind: role,
      source: 'firebase_anonymous',
      authUid: firebaseUser.uid,
      userId: `user_${normalizeUid(firebaseUser.uid)}`,
      roleId: `${role}_${normalizeUid(firebaseUser.uid)}`,
      isAuthenticated: true
    };
  }
  const roleId = getLocalRoleId(role);
  return {
    kind: role,
    source: 'local_anonymous',
    authUid: null,
    userId: roleId,
    roleId,
    isAuthenticated: false
  };
}

export async function getPoolSigningKeyPair(kind = 'user') {
  const role = safeKind(kind);
  const key = `${ID_PREFIX}_${role.toUpperCase()}_SIGNING_KEY_${SIGNING_KEY_VERSION.toUpperCase()}`;
  const serialized = storageGet(key);
  if (serialized) {
    try {
      return importSigningKeyPair(JSON.parse(serialized));
    } catch {
      // Replace corrupt or obsolete key material.
    }
  }
  const keyPair = await createSigningKeyPair();
  const saved = {
    publicKey: await exportPublicKey(keyPair.publicKey),
    privateKey: await exportPrivateKey(keyPair.privateKey),
    createdAt: new Date().toISOString(),
    version: SIGNING_KEY_VERSION
  };
  storageSet(key, JSON.stringify(saved));
  return keyPair;
}

export function createLocalPoolIdentity(kind = 'user') {
  const role = safeKind(kind);
  let cachedIdentity = null;
  let cachedKeyPair = null;
  return {
    kind: role,
    async resolve() {
      if (!cachedIdentity) {
        const roleId = getLocalRoleId(role);
        cachedIdentity = {
          kind: role,
          source: 'local_anonymous',
          authUid: null,
          userId: roleId,
          roleId,
          isAuthenticated: false
        };
      }
      return cachedIdentity;
    },
    async getRoleId() {
      return (await this.resolve()).roleId;
    },
    async getSigningKeyPair() {
      if (!cachedKeyPair) cachedKeyPair = await getPoolSigningKeyPair(role);
      return cachedKeyPair;
    },
    async getAuthToken() {
      return null;
    }
  };
}

export function createPoolIdentity(kind = 'user', { localOnly = false } = {}) {
  if (localOnly) return createLocalPoolIdentity(kind);
  const role = safeKind(kind);
  let cachedIdentity = null;
  let cachedKeyPair = null;
  return {
    kind: role,
    async resolve() {
      if (!cachedIdentity) cachedIdentity = await resolvePoolIdentity(role);
      return cachedIdentity;
    },
    async getRoleId() {
      return (await this.resolve()).roleId;
    },
    async getSigningKeyPair() {
      if (!cachedKeyPair) cachedKeyPair = await getPoolSigningKeyPair(role);
      return cachedKeyPair;
    },
    async getAuthToken() {
      return getPoolAuthToken();
    }
  };
}

export default {
  createLocalPoolIdentity,
  createPoolIdentity,
  getPoolAuthToken,
  getLocalRoleId,
  getPoolSigningKeyPair,
  resolveFirebaseIdentity,
  resolvePoolIdentity
};
