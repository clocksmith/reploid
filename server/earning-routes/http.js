/**
 * @fileoverview HTTP plumbing for the earning-loop routes: explicit limits,
 * per-key rate limiting, bearer credentials, idempotency keys and the
 * mapping from component refusals to HTTP statuses.
 *
 * Nothing here decides who may act; the account store verifies sessions and
 * the injected operator-authority port verifies operator credentials.
 */

export const OPERATOR_ROLES = Object.freeze(['funding', 'settlement', 'issuance', 'links', 'audit']);
// Errors thrown by the composed components; anything else is an internal failure.
const COMPONENT_ERRORS = new Set(['AccountError', 'LedgerError', 'RewardError', 'CommunityAccessError', 'PaymentError']);
const RATE_KEYS = Object.freeze(['address', 'signIn', 'account', 'device', 'operator']);
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,256}$/;

export class RouteError extends Error {
  constructor(status, code, message = code, details = null) {
    super(message);
    this.name = 'RouteError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const refuse = (status, code, message, details) => {
  throw new RouteError(status, code, message, details);
};

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

/**
 * Explicit route limits; there is no default. Body limits are bytes; each
 * rate limit is { max, windowMs } per client address (every route), per
 * address for sign-in and recovery, per account (session routes), per
 * device (device-bound routes) and per operator actor.
 * idempotencyLeaseMs is how long an in-progress request holds its key before
 * a retry may reconcile it.
 */
export function validateRouteLimits(limits) {
  const errors = [];
  if (!limits || typeof limits !== 'object') throw new TypeError('earning routes need explicit limits');
  for (const key of Object.keys(limits)) {
    if (!['jsonBytes', 'evidenceJsonBytes', 'idempotencyLeaseMs', ...RATE_KEYS].includes(key)) errors.push(`limits.${key} is not a recognized field`);
  }
  for (const key of ['jsonBytes', 'evidenceJsonBytes']) if (!isPositiveInteger(limits[key])) errors.push(`limits.${key} must be a positive integer of bytes`);
  if (!isPositiveInteger(limits.idempotencyLeaseMs)) errors.push('limits.idempotencyLeaseMs must be a positive integer of milliseconds');
  for (const key of RATE_KEYS) {
    const rate = limits[key];
    if (!rate || Object.keys(rate).some((field) => !['max', 'windowMs'].includes(field)) || !isPositiveInteger(rate.max) || !isPositiveInteger(rate.windowMs)) {
      errors.push(`limits.${key} must be { max, windowMs } with positive integers`);
    }
  }
  if (errors.length) throw new TypeError(`earning route limits are incomplete: ${errors.join('; ')}`);
  return Object.freeze(Object.fromEntries([['jsonBytes', limits.jsonBytes], ['evidenceJsonBytes', limits.evidenceJsonBytes],
    ['idempotencyLeaseMs', limits.idempotencyLeaseMs],
    ...RATE_KEYS.map((key) => [key, Object.freeze({ max: limits[key].max, windowMs: limits[key].windowMs })])]));
}

/**
 * Fixed-window counters in this process. A multi-instance deployment needs a
 * shared limiter behind the same `consume` port.
 */
export function createMemoryRateLimiter({ nowMs = () => Date.now(), maxKeys = 100_000 } = {}) {
  const buckets = new Map();
  const sweep = (now) => {
    for (const [key, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(key);
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
  };
  return Object.freeze({
    consume({ key, max, windowMs }) {
      const now = nowMs();
      let bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        buckets.delete(key);
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
        if (buckets.size > maxKeys) sweep(now);
      }
      bucket.count += 1;
      return { allowed: bucket.count <= max, resetAt: bucket.resetAt };
    }
  });
}

/** Count one request against `key`; a refusal is 429 with Retry-After. */
export async function consumeRate(rateLimiter, res, { key, max, windowMs, nowMs }) {
  const result = await rateLimiter.consume({ key, max, windowMs });
  if (result?.allowed === true) return;
  const retryAfter = Math.max(1, Math.ceil((Number(result?.resetAt) - nowMs()) / 1000) || 1);
  res.setHeader('Retry-After', String(retryAfter));
  refuse(429, 'rate_limited', 'too many requests; retry later', { retryAfter });
}

export function bearerToken(req) {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? header.match(/^Bearer ([\x21-\x7e]{1,1024})$/) : null;
  return match ? match[1] : null;
}

/** The Idempotency-Key header, required on routes whose component deduplicates by key. */
export function idempotencyKeyOf(req) {
  const value = req.headers['idempotency-key'];
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) {
    refuse(400, 'idempotency_key_required', 'this route needs an Idempotency-Key header of 1 to 256 visible characters');
  }
  return value;
}

/** A JSON object body naming only `allowed` keys. Route-derived identity never comes from the body. */
export function bodyOf(req, allowed) {
  const body = req.body ?? {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) refuse(400, 'invalid_body', 'the request body must be a JSON object');
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) refuse(400, 'invalid_body', `this route does not accept: ${unknown.join(', ')}`, { unknown });
  return body;
}

/** Authenticate an operator credential and require one of `roles`. */
export async function authenticateOperator(operatorAuthority, req, roles) {
  if (typeof operatorAuthority?.authenticate !== 'function') refuse(503, 'operator_authority_unconfigured', 'operator routes need an operator-authority port');
  const token = bearerToken(req);
  if (!token) refuse(401, 'operator_credential_required', 'an operator bearer credential is required');
  let principal = null;
  try {
    principal = await operatorAuthority.authenticate({ token });
  } catch {
    principal = null;
  }
  if (!principal || typeof principal.actorId !== 'string' || principal.actorId.length === 0 || principal.actorId.length > 160 || !Array.isArray(principal.roles)) {
    refuse(401, 'operator_credential_invalid', 'the operator credential was not accepted');
  }
  if (!roles.some((role) => principal.roles.includes(role))) refuse(403, 'operator_role_required', `this route needs the ${roles.join(' or ')} role`);
  return { actorId: principal.actorId, roles: principal.roles.filter((role) => OPERATOR_ROLES.includes(role)) };
}

const STATUS = new Map(Object.entries({
  session_invalid: 401, session_ended: 401, session_expired: 401, session_revoked: 401, session_device_revoked: 401,
  assertion_invalid: 401, assertion_expired: 401, assertion_replayed: 401, reauthentication_required: 401,
  provider_unknown: 400, idempotency_key_required: 400, proof_malformed: 400, notification_not_authentic: 400,
  device_session_required: 403, session_binding_invalid: 403, account_mismatch: 403, participant_not_owned: 403,
  offer_account_mismatch: 403, quote_account_mismatch: 403, device_not_authorized: 403, link_authority_denied: 403,
  funding_not_authorized: 403, acquirer_device_mismatch: 403, owner_authorization_unrecorded: 403,
  idempotency_conflict: 409, challenge_used: 409, participant_conflict: 409, device_registered_elsewhere: 409,
  session_already_bound: 409, allocation_closed: 409, storage_conflict: 503, funding_authority_required: 503,
  processor_unavailable: 503
}));

/**
 * A coded refusal from a composed component. Refusals of single-transaction
 * operations are thrown before their transaction commits, so they produced
 * no effect; retryable storage conflicts and every other error may not have.
 */
export const isComponentRefusal = (error) => COMPONENT_ERRORS.has(error?.name) && typeof error.code === 'string' && error.retryable !== true;

/** HTTP status for a component refusal code. */
export function statusForCode(code) {
  if (STATUS.has(code)) return STATUS.get(code);
  if (/_not_found$/.test(code)) return 404;
  if (/^invalid_/.test(code)) return 400;
  if (/(_exists|_already_[a-z_]+|^duplicate_[a-z_]+)$/.test(code)) return 409;
  return 422;
}

// Only lists explaining the caller's own request travel back; other details stay in logs.
const publicDetails = (details) => {
  if (!details || typeof details !== 'object') return null;
  const picked = Object.fromEntries(['errors', 'reasons', 'unknown', 'retryAfter']
    .filter((key) => Array.isArray(details[key]) || Number.isSafeInteger(details[key]))
    .map((key) => [key, details[key]]));
  return Object.keys(picked).length ? picked : null;
};

/** Express error handler for the earning router. */
export function earningErrorHandler(log = console) {
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    let status = 500;
    let code = 'internal_error';
    let message = 'the request failed';
    let details = null;
    if (error instanceof RouteError) {
      ({ status, code, message } = error);
      details = publicDetails(error.details);
    } else if (error?.type === 'entity.too.large') {
      [status, code, message] = [413, 'body_too_large', 'the request body exceeds this route\'s limit'];
    } else if (error?.type === 'entity.parse.failed') {
      [status, code, message] = [400, 'invalid_json', 'the request body is not valid JSON'];
    } else if (['encoding.unsupported', 'charset.unsupported'].includes(error?.type)) {
      [status, code, message] = [415, 'unsupported_body_encoding', 'the request body encoding is not supported'];
    } else if (COMPONENT_ERRORS.has(error?.name) && typeof error.code === 'string') {
      ({ code, message } = error);
      status = statusForCode(code);
      details = publicDetails(error.details);
    }
    if (status >= 500 && code === 'internal_error') log.error?.('[Earning routes] request failed:', error);
    if (res.headersSent) return;
    if (Number.isSafeInteger(details?.retryAfter)) res.setHeader('Retry-After', String(details.retryAfter));
    res.status(status).json({ error: code, message, ...(details ? { details } : {}) });
  };
}
