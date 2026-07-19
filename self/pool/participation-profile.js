/**
 * @fileoverview Signed Poolday participation modes and resource permissions.
 */

import {
  SIGNATURE_DOMAINS,
  hashJson,
  signCanonical,
  verifyCanonicalSignature
} from './inference-receipt.js';

export const PARTICIPATION_PROFILE_SCHEMA = 'reploid.pool.participation-profile/v1';
export const PARTICIPATION_STORAGE_KEY = 'reploid.pool.participation.v1';
export const PARTICIPATION_MODES = Object.freeze({
  request: 'request',
  contribute: 'contribute',
  both: 'both'
});
export const PARTICIPATION_CAPABILITIES = Object.freeze({
  requestInference: 'request_inference',
  provideInference: 'provide_inference',
  relayArtifacts: 'relay_artifacts',
  verifyResults: 'verify_results',
  publishAdapters: 'publish_adapters',
  createAdapters: 'create_adapters'
});

const VALID_MODES = new Set(Object.values(PARTICIPATION_MODES));
const VALID_CAPABILITIES = new Set(Object.values(PARTICIPATION_CAPABILITIES));
const DEFAULT_LIMITS = Object.freeze({
  maxConcurrentJobs: 1,
  maxTokensPerJob: 128,
  storageBudgetMiB: 1024,
  bandwidthBudgetMbps: 25
});

const storage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const clampInteger = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

const modeCapabilities = (mode, permissions = {}) => {
  const canRequest = mode === PARTICIPATION_MODES.request || mode === PARTICIPATION_MODES.both;
  const canContribute = mode === PARTICIPATION_MODES.contribute || mode === PARTICIPATION_MODES.both;
  return Object.freeze([
    ...(canRequest ? [PARTICIPATION_CAPABILITIES.requestInference] : []),
    ...(canContribute ? [PARTICIPATION_CAPABILITIES.provideInference] : []),
    ...(canContribute && permissions.relayArtifacts !== false
      ? [PARTICIPATION_CAPABILITIES.relayArtifacts]
      : []),
    ...(canContribute && permissions.verifyResults !== false
      ? [PARTICIPATION_CAPABILITIES.verifyResults]
      : []),
    ...(permissions.publishAdapters === true
      ? [PARTICIPATION_CAPABILITIES.publishAdapters]
      : []),
    ...(permissions.createAdapters === true
      ? [PARTICIPATION_CAPABILITIES.createAdapters]
      : [])
  ].sort());
};

export function normalizeParticipationPreferences(preferences = {}) {
  const mode = VALID_MODES.has(preferences.mode) ? preferences.mode : PARTICIPATION_MODES.request;
  const permissions = {
    relayArtifacts: preferences.permissions?.relayArtifacts !== false,
    verifyResults: preferences.permissions?.verifyResults !== false,
    publishAdapters: preferences.permissions?.publishAdapters === true,
    createAdapters: preferences.permissions?.createAdapters === true
  };
  const limits = {
    maxConcurrentJobs: clampInteger(preferences.limits?.maxConcurrentJobs, DEFAULT_LIMITS.maxConcurrentJobs, 1, 4),
    maxTokensPerJob: clampInteger(preferences.limits?.maxTokensPerJob, DEFAULT_LIMITS.maxTokensPerJob, 16, 2048),
    storageBudgetMiB: clampInteger(preferences.limits?.storageBudgetMiB, DEFAULT_LIMITS.storageBudgetMiB, 128, 65536),
    bandwidthBudgetMbps: clampInteger(preferences.limits?.bandwidthBudgetMbps, DEFAULT_LIMITS.bandwidthBudgetMbps, 1, 10000)
  };
  return Object.freeze({ mode, permissions: Object.freeze(permissions), limits: Object.freeze(limits) });
}

export function readParticipationPreferences() {
  try {
    const value = storage()?.getItem(PARTICIPATION_STORAGE_KEY);
    return normalizeParticipationPreferences(value ? JSON.parse(value) : {});
  } catch {
    return normalizeParticipationPreferences();
  }
}

export function writeParticipationPreferences(preferences = {}) {
  const normalized = normalizeParticipationPreferences(preferences);
  try {
    storage()?.setItem(PARTICIPATION_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The current session can still use the selected profile when storage is denied.
  }
  return normalized;
}

export const participationProfileSigningPayload = (profile = {}) => {
  const { profileHash, rootSignature, ...payload } = profile || {};
  return payload;
};

export async function createSignedParticipationProfile({
  preferences = readParticipationPreferences(),
  deviceId,
  devicePublicKey,
  privateKey,
  revision = 1,
  updatedAt = new Date().toISOString()
} = {}) {
  if (!deviceId || !devicePublicKey || !privateKey) {
    throw new TypeError('deviceId, devicePublicKey, and privateKey are required');
  }
  const normalized = normalizeParticipationPreferences(preferences);
  const payload = {
    schema: PARTICIPATION_PROFILE_SCHEMA,
    deviceId,
    devicePublicKey,
    mode: normalized.mode,
    capabilities: modeCapabilities(normalized.mode, normalized.permissions),
    permissions: normalized.permissions,
    limits: normalized.limits,
    revision: clampInteger(revision, 1, 1, Number.MAX_SAFE_INTEGER),
    updatedAt
  };
  const profileHash = await hashJson(payload);
  return Object.freeze({
    ...payload,
    profileHash,
    rootSignature: await signCanonical(payload, privateKey, {
      domain: SIGNATURE_DOMAINS.participationProfile
    })
  });
}

export function validateParticipationProfile(profile = {}) {
  const reasons = [];
  if (profile.schema !== PARTICIPATION_PROFILE_SCHEMA) reasons.push('participation profile schema mismatch');
  if (!String(profile.deviceId || '').trim()) reasons.push('participation deviceId is required');
  if (!String(profile.devicePublicKey || '').trim()) reasons.push('participation devicePublicKey is required');
  if (!VALID_MODES.has(profile.mode)) reasons.push('participation mode is invalid');
  if (!Array.isArray(profile.capabilities)) reasons.push('participation capabilities must be an array');
  const expectedCapabilities = modeCapabilities(profile.mode, profile.permissions || {});
  if (JSON.stringify(profile.capabilities || []) !== JSON.stringify(expectedCapabilities)) {
    reasons.push('participation capabilities do not match mode and permissions');
  }
  for (const capability of profile.capabilities || []) {
    if (!VALID_CAPABILITIES.has(capability)) reasons.push(`unknown participation capability: ${capability}`);
  }
  const normalized = normalizeParticipationPreferences(profile);
  if (JSON.stringify(profile.limits || {}) !== JSON.stringify(normalized.limits)) {
    reasons.push('participation limits are invalid');
  }
  if (!Number.isInteger(Number(profile.revision)) || Number(profile.revision) < 1) {
    reasons.push('participation revision must be a positive integer');
  }
  if (!String(profile.profileHash || '').startsWith('sha256:')) reasons.push('participation profileHash is required');
  if (!String(profile.rootSignature || '').trim()) reasons.push('participation rootSignature is required');
  return { ok: reasons.length === 0, reasons };
}

export async function verifyParticipationProfile(profile = {}) {
  const validation = validateParticipationProfile(profile);
  const reasons = [...validation.reasons];
  const payload = participationProfileSigningPayload(profile);
  const profileHash = await hashJson(payload);
  if (profile.profileHash !== profileHash) reasons.push('participation profileHash mismatch');
  if (profile.devicePublicKey && profile.rootSignature) {
    try {
      const valid = await verifyCanonicalSignature(
        payload,
        profile.devicePublicKey,
        profile.rootSignature,
        { domain: SIGNATURE_DOMAINS.participationProfile }
      );
      if (!valid) reasons.push('participation rootSignature invalid');
    } catch (error) {
      reasons.push(`participation signature verification failed: ${error.message}`);
    }
  }
  return { ok: reasons.length === 0, reasons, profileHash };
}

export const participationAllows = (profile = {}, capability) => (
  VALID_CAPABILITIES.has(capability)
  && Array.isArray(profile.capabilities)
  && profile.capabilities.includes(capability)
);

export default {
  PARTICIPATION_PROFILE_SCHEMA,
  PARTICIPATION_STORAGE_KEY,
  PARTICIPATION_MODES,
  PARTICIPATION_CAPABILITIES,
  normalizeParticipationPreferences,
  readParticipationPreferences,
  writeParticipationPreferences,
  createSignedParticipationProfile,
  validateParticipationProfile,
  verifyParticipationProfile,
  participationAllows
};
