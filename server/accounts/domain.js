import { createKnownKeyValidator } from '../input-validation.js';
/**
 * @fileoverview Pure account rules: explicit account policy, record schemas,
 * deterministic identifiers, session checks and account-link kinds.
 *
 * Nothing here performs I/O or supplies a policy value. Identifiers derive
 * from verified inputs, so retried or concurrent creation converges on one
 * record.
 */

import { timingSafeEqual } from 'node:crypto';

import { canonicalJson, cloneJson, hashCanonical, isIsoTime, isNonEmptyString, sha256Hex, toMs } from '../ledger/domain.js';

export { cloneJson, hashCanonical, isIsoTime, isNonEmptyString, sha256Hex, toMs };

export const ACCOUNT_SCHEMA = 'reploid.account/v1';
export const SESSION_SCHEMA = 'reploid.account-session/v1';
export const CHALLENGE_SCHEMA = 'reploid.device-registration-challenge/v1';
export const DEVICE_SCHEMA = 'reploid.account-device/v1';
export const REGISTRATION_SCHEMA = 'reploid.device-registration/v1';
export const OWNER_RECORD_SCHEMA = 'reploid.device-owner-record/v1';
export const LINK_SCHEMA = 'reploid.account-link/v1';
export const RECOVERY_SCHEMA = 'reploid.account-recovery/v1';

/** `compromised` bars the key from registering again; `recovery` is applied only by recovery. */
export const REVOCATION_REASONS = Object.freeze(['retired', 'transfer', 'compromised', 'recovery']);

/**
 * Account-link kinds and the authorities that may record each. A link is
 * recorded evidence of a relation. The absence of a link never shows that two
 * accounts belong to independent people.
 */
export const LINK_KINDS = Object.freeze({
  same_owner: Object.freeze(['operator']),
  shared_payment_instrument: Object.freeze(['payments', 'operator']),
  shared_device: Object.freeze(['accounts']),
  operator_flagged: Object.freeze(['operator'])
});

const RETRYABLE_CODES = new Set(['storage_conflict']);

export class AccountError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export const fail = (code, message, details) => {
  throw new AccountError(code, message, details);
};

export const insert = (collection, id, value) => ({ create: true, collection, id, value });
export const put = (collection, id, value) => ({ create: false, collection, id, value });
export const addMs = (iso, ms) => new Date(toMs(iso) + ms).toISOString();
export const byTime = (field, idField) => (left, right) => toMs(left[field]) - toMs(right[field])
  || String(left[idField]).localeCompare(String(right[idField]));

export const assertText = (value, field, maxLength = 256) => {
  if (!isNonEmptyString(value) || value.length > maxLength) {
    fail('invalid_input', `${field} must be a non-empty string of at most ${maxLength} characters`, { field });
  }
  return value;
};

export const assertIdempotencyKey = (value) => {
  if (!isNonEmptyString(value) || value.length > 256) {
    fail('idempotency_key_required', 'this account mutation requires an idempotency key of at most 256 characters');
  }
  return value;
};

export const assertKnownKeys = createKnownKeyValidator(fail);

const positiveMs = (value) => Number.isSafeInteger(value) && value > 0;

const POLICY_KEYS = Object.freeze([
  'audience', 'sessionTtlMs', 'challengeTtlMs', 'recoveryMaxAuthAgeMs', 'maxClockSkewMs', 'custodyCertificateMaxLifetimeMs'
]);

/**
 * Explicit account policy. There is no default: the audience providers must
 * name, session and challenge lifetimes, the recovery re-authentication
 * window, tolerated clock skew and the longest custody certificate accepted
 * are security decisions.
 */
export function validateAccountPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') fail('invalid_policy', 'account policy is required', { errors: ['policy missing'] });
  for (const key of Object.keys(policy)) {
    if (!POLICY_KEYS.includes(key)) errors.push(`policy.${key} is not a recognized field`);
  }
  if (!isNonEmptyString(policy.audience)) errors.push('policy.audience must name this account service');
  for (const key of ['sessionTtlMs', 'challengeTtlMs', 'recoveryMaxAuthAgeMs', 'custodyCertificateMaxLifetimeMs']) {
    if (!positiveMs(policy[key])) errors.push(`policy.${key} must be a positive integer of milliseconds`);
  }
  if (!Number.isSafeInteger(policy.maxClockSkewMs) || policy.maxClockSkewMs < 0) {
    errors.push('policy.maxClockSkewMs must be a non-negative integer of milliseconds');
  }
  if (errors.length) fail('invalid_policy', 'account policy is incomplete or not permitted', { errors });
  return Object.freeze(Object.fromEntries(POLICY_KEYS.map((key) => [key, policy[key]])));
}

const digest32 = (label, value) => sha256Hex(`${label}\u0000${value}`).slice(0, 32);
const subjectKey = (providerId, subject) => `${providerId}\u0000${subject}`;

/** One account per provider subject; the same subject always names the same account. */
export const accountIdFor = (providerId, subject) => `acct_${digest32('account', subjectKey(providerId, subject))}`;
/** The ledger owner of a subject's account. Owners never span subjects without a recorded link. */
export const ownerIdFor = (providerId, subject) => `owner_${digest32('owner', subjectKey(providerId, subject))}`;
export const subjectDigest = (providerId, subject) => `sha256:${sha256Hex(subjectKey(providerId, subject))}`;
/** One device id per participant identity key. */
export const deviceIdFor = (publicJwk) => `dev_${digest32('device', canonicalJson(publicJwk))}`;
/** Document id for an index keyed by an arbitrary string. */
export const indexId = (label, value) => sha256Hex(`${label}\u0000${value}`);

export const linkPair = (left, right) => [left, right].sort();
export const linkIdFor = (kind, [left, right], evidenceId) => `lnk_${digest32('link', `${kind}\u0000${left}\u0000${right}\u0000${evidenceId}`)}`;

/** A recorded relation between two accounts, with the authority that recorded it. */
export const newLink = ({ kind, pair, evidenceId, recordedBy, note = null, now }) => ({
  schema: LINK_SCHEMA,
  linkId: linkIdFor(kind, pair, evidenceId),
  kind,
  accountA: pair[0],
  accountB: pair[1],
  pairKey: pair.join('|'),
  evidenceId,
  recordedBy: { authority: recordedBy.authority, id: recordedBy.id },
  note,
  recordedAt: now
});

export const sessionSecretDigest = (secret) => sha256Hex(`session\u0000${secret}`);

/** Constant-time comparison of two hex digests. */
export const sameDigest = (left, right) => typeof left === 'string' && typeof right === 'string' && left.length === right.length
  && timingSafeEqual(Buffer.from(left), Buffer.from(right));

/** `<sessionId>.<secret>`; returns null when malformed. */
export function parseSessionToken(token) {
  if (typeof token !== 'string' || token.length > 256) return null;
  const separator = token.indexOf('.');
  if (separator <= 0) return null;
  const sessionId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  return /^ses_[A-Za-z0-9-]{8,80}$/.test(sessionId) && /^[A-Za-z0-9_-]{32,128}$/.test(secret) ? { sessionId, secret } : null;
}

/**
 * Why a session cannot act now, or null. A session dies when it ends or
 * expires, when recovery advances the account's session epoch, and when the
 * device it is bound to is revoked or registered again.
 */
export function sessionProblem({ session, account, device, secret, now }) {
  if (!session || !account || session.accountId !== account.accountId || !sameDigest(session.secretDigest, sessionSecretDigest(secret))) {
    return 'session_invalid';
  }
  if (session.endedAt) return 'session_ended';
  if (toMs(now) >= toMs(session.expiresAt)) return 'session_expired';
  if (session.epoch !== account.sessionEpoch) return 'session_revoked';
  if (session.deviceId && (device?.status !== 'active' || device.registrationId !== session.registrationId)) return 'session_device_revoked';
  return null;
}

/** Whether a registration was in force at `atMs`. */
export const registrationCovers = (registration, atMs) => Boolean(registration)
  && toMs(registration.registeredAt) <= atMs && (registration.revokedAt == null || atMs < toMs(registration.revokedAt));

export const sessionView = (session) => ({
  sessionId: session.sessionId,
  accountId: session.accountId,
  deviceId: session.deviceId,
  registrationId: session.registrationId,
  issuedAt: session.issuedAt,
  expiresAt: session.expiresAt
});

export const accountView = (account) => ({
  accountId: account.accountId,
  ownerId: account.ownerId,
  providerId: account.providerId,
  status: account.status,
  activeDeviceIds: [...account.activeDeviceIds],
  createdAt: account.createdAt,
  creditAccountOpenedAt: account.creditAccountOpenedAt,
  recoveredAt: account.recoveredAt
});

export const deviceView = (device) => ({
  deviceId: device.deviceId,
  participantId: device.participantId,
  publicJwk: cloneJson(device.publicJwk),
  host: device.host,
  label: device.label,
  status: device.status,
  accountId: device.accountId,
  registrationId: device.registrationId,
  registeredAt: device.registeredAt,
  revokedAt: device.revokedAt,
  revocation: cloneJson(device.revocation),
  ownerRecordId: device.ownerRecordId
});

export default {
  ACCOUNT_SCHEMA,
  REVOCATION_REASONS,
  LINK_KINDS,
  AccountError,
  validateAccountPolicy,
  accountIdFor,
  ownerIdFor,
  deviceIdFor,
  sessionProblem,
  registrationCovers
};
