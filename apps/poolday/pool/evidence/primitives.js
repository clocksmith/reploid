/**
 * Shared evidence primitives and the evidence policy. One owner for text, hash, list,
 * ordering and content-hash helpers; no record kind, admission or projection authority.
 */
import policy from './policy.json' with { type: 'json' };
import {
  hashJson
} from '../../../../shared/pool/inference-receipt.js';

export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
};

const EVIDENCE_POLICY_SCHEMA = 'reploid.evidence-policy/v1';
if (policy?.schema !== EVIDENCE_POLICY_SCHEMA) throw new TypeError(`evidence policy must declare ${EVIDENCE_POLICY_SCHEMA}`);

/** Authoring roles, limits, thresholds and reward points; JSON owns the values. */
export const EVIDENCE_POLICY = deepFreeze(policy);
export const MAX_TEXT_LENGTH = EVIDENCE_POLICY.maxTextLength;
export const MAX_EMBEDDING_DIMENSIONS = EVIDENCE_POLICY.maxEmbeddingDimensions;

// Record kinds arrive from untrusted records; only declared kinds resolve to a role policy.
const AUTHOR_POLICY = new Map(Object.entries(EVIDENCE_POLICY.authorRoles));

/** The roles that may sign a record kind and the kind's label in verification reasons, or null. */
export const authorPolicyFor = (kind) => AUTHOR_POLICY.get(kind) || null;

export const compactText = (value, max = MAX_TEXT_LENGTH) => String(value || '').trim().slice(0, max);
export const unique = (values) => [...new Set(values.filter(Boolean))];
export const providerIdentities = (values) => unique((Array.isArray(values) ? values : [])
  .filter((value) => typeof value === 'string')
  .map((value) => compactText(value, 240))
  .filter(Boolean))
  .sort();
export const sameStringSet = (left = [], right = []) => {
  const normalizedLeft = unique(left.map(String)).sort();
  const normalizedRight = unique(right.map(String)).sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
};
/** Canonical comparison used wherever a declared shape must equal its re-normalized form. */
export const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const isSha256 = (value) => SHA256_PATTERN.test(String(value || ''));
/** Whether `values` is an array of at least `min` SHA-256 identities. */
export const isHashList = (values, { min = 0 } = {}) => Array.isArray(values) && values.length >= min
  && values.every((hash) => SHA256_PATTERN.test(hash));
export const isUnitInterval = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
export const stableTaskId = (kind, targetHash) => `task:${kind}:${targetHash}`;
export const withoutSignature = (record = {}) => {
  const { signature, ...payload } = record;
  return payload;
};
export const withoutIdentity = (record = {}) => {
  const { recordHash, signature, ...payload } = record;
  return payload;
};

export const requireHash = (value, label) => {
  const normalized = compactText(value, 160);
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${label} must be a SHA-256 identity`);
  return normalized;
};

export const normalizeHashList = (values, label, { min = 0, max = 128 } = {}) => {
  const hashes = unique(Array.isArray(values) ? values : []).slice(0, max);
  if (hashes.length < min) throw new TypeError(`${label} requires at least ${min} record ${min === 1 ? 'identity' : 'identities'}`);
  return hashes.map((value) => requireHash(value, label));
};

export const normalizeTextList = (values, { min = 0, max = 64, itemMax = 1000, label = 'values' } = {}) => {
  const normalized = unique((Array.isArray(values) ? values : []).map((value) => compactText(value, itemMax))).slice(0, max);
  if (normalized.length < min) throw new TypeError(`${label} requires at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
  return normalized;
};

export const requiredInteger = (value, label) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${label} is required`);
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized)) throw new TypeError(`${label} must be an integer`);
  return normalized;
};

/** Parses an http(s) URL and returns its canonical href; any other scheme throws `message`. */
export const requireHttpUrl = (value, message) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(message);
  return url.href;
};

/** Deterministic record order: creation time, then record hash. */
export const compareResearchRecords = (left, right) => (
  String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''))
  || String(left?.recordHash || '').localeCompare(String(right?.recordHash || ''))
);

export const hasPublicEvidenceConsent = (record) => record?.consent?.publicSequence === true
  && record?.consent?.publicEvidenceNetwork === true;

/** Appends `field` holding the hash of every other field. */
export const withContentHash = async (value, field) => ({ ...value, [field]: await hashJson(value) });

/** The verification reason for a content hash produced by withContentHash, or null when it binds. */
export const contentHashReason = async (value, field, label) => {
  const { [field]: declared, ...identity } = value;
  if (!isSha256(declared)) return `${label} hash is invalid`;
  return await hashJson(identity) !== declared ? `${label} hash mismatch` : null;
};
