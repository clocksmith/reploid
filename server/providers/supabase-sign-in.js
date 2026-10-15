/**
 * @fileoverview Supabase Auth email magic-link sign-in behind the provider
 * contract in ../accounts/sign-in.js.
 *
 * The browser completes Supabase's PKCE magic-link flow, asks this service
 * for a sign-in state, writes the state into the Supabase user's metadata and
 * refreshes its session, so the new access token carries the state. An
 * assertion is `{ accessToken, state }`. Verification checks:
 *
 * - the state: this service's MAC under a configured secret (several during
 *   rotation), this provider, the account audience, and an unexpired lifetime;
 * - the token: an allowlisted asymmetric algorithm and a key id, a signature
 *   from the project's JWKS (cached; an unknown key id reloads it, so rotation
 *   needs no restart and a removed key stops verifying once the cache ages
 *   out), issuer, audience, expiry, issued-at no earlier than the state, an
 *   authenticated non-anonymous user, and the state in its user metadata.
 *
 * The state is the assertion id, so the account store accepts it once. A
 * captured or refreshed token never signs in again without a fresh state, and
 * only a holder of the Supabase session can mint a token carrying one.
 *
 * The subject is Supabase's stable user id (`sub`), never the email. The
 * authentication time is the latest email-link entry in `amr`, which a token
 * refresh does not advance, so the account store's recovery age limit
 * measures the last email-link authentication rather than the last refresh.
 *
 * No key ships here: the project URL, publishable key and state secrets come
 * from configuration (env.js). HS256 project secrets are never accepted.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from 'jose';

import { canonicalJson, sha256Hex } from '../ledger/domain.js';

export const SUPABASE_PROVIDER_ID = 'supabase';
/** The Supabase user-metadata field the browser writes the state into. */
export const SIGN_IN_STATE_METADATA_KEY = 'reploid_sign_in_state';
export const SUPPORTED_ALGORITHMS = Object.freeze(['ES256', 'RS256', 'EdDSA']);
export const DEFAULT_ALGORITHMS = Object.freeze(['ES256', 'RS256']);
/** `amr` methods Supabase records for an email-link (or emailed code) authentication. */
export const EMAIL_LINK_METHODS = Object.freeze(['otp', 'magiclink', 'email/signup']);
/** Supabase's audience for signed-in users' access tokens. */
export const SUPABASE_AUTHENTICATED_AUDIENCE = 'authenticated';

const STATE_VERSION = 'rss1';
const STATE_MAC_LABEL = 'reploid.sign-in-state/v1';
const MAX_TOKEN_CHARS = 16_384;
const MAX_STATE_CHARS = 512;
const MIN_SECRET_BYTES = 32;
const MAX_STATE_TTL_MS = 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const iso = (ms) => new Date(ms).toISOString();
const b64 = (value) => Buffer.from(value).toString('base64url');

/** An https URL, or http on loopback for a local Supabase stack. */
export function assertServiceUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) || url.search || url.hash || url.username || url.password) {
    throw new TypeError(`${label} must be https (http only on loopback) without credentials, query or fragment`);
  }
  return url;
}

/**
 * @param {object} options
 * @param {string} options.projectUrl the project's API origin, e.g. https://<ref>.supabase.co
 * @param {string} options.publishableKey the project's public (anon or publishable) key, served to browsers
 * @param {string} options.accountAudience the account policy audience this provider signs in to
 * @param {string[]} options.stateSecrets state MAC secrets, current first; each at least 32 bytes
 * @param {number} options.stateTtlMs how long an issued state may be used
 * @param {number} options.clockSkewMs tolerated clock difference with Supabase
 * @param {string} [options.issuer] defaults to `${projectUrl}/auth/v1`
 * @param {string} [options.jwksUrl] defaults to `${projectUrl}/auth/v1/.well-known/jwks.json`
 * @param {string} [options.jwtAudience] defaults to `authenticated`
 * @param {string[]} [options.algorithms] allowlist; subset of ES256, RS256, EdDSA
 * @param {string[]} [options.authenticationMethods] `amr` methods that count as authentication
 * @param {Function} [options.keys] a jose key resolver instead of the remote JWKS (tests)
 * @param {Function} [options.fetch] fetch for the JWKS
 * @param {object} [options.jwks] { cacheMaxAgeMs, cooldownMs, timeoutMs } for the remote JWKS
 * @param {Function} [options.clock] () => ISO time used when issuing states
 */
export function createSupabaseSignInProvider({
  providerId = SUPABASE_PROVIDER_ID, projectUrl, publishableKey, accountAudience, stateSecrets, stateTtlMs, clockSkewMs,
  issuer, jwksUrl, jwtAudience = SUPABASE_AUTHENTICATED_AUDIENCE, algorithms = DEFAULT_ALGORITHMS,
  authenticationMethods = EMAIL_LINK_METHODS, keys = null, fetch = null, jwks = {}, clock = () => new Date().toISOString()
} = {}) {
  const origin = assertServiceUrl(projectUrl, 'projectUrl').origin;
  const expectedIssuer = issuer ?? `${origin}/auth/v1`;
  const keySetUrl = assertServiceUrl(jwksUrl ?? `${origin}/auth/v1/.well-known/jwks.json`, 'jwksUrl');
  if (!isText(publishableKey, 4096)) throw new TypeError('publishableKey must name the project\'s public key');
  if (!isText(accountAudience, 256)) throw new TypeError('accountAudience must name the account policy audience');
  if (!isText(expectedIssuer, 512) || !isText(jwtAudience, 256)) throw new TypeError('issuer and jwtAudience must be non-empty strings');
  if (!Array.isArray(stateSecrets) || stateSecrets.length === 0
    || stateSecrets.some((secret) => typeof secret !== 'string' || Buffer.byteLength(secret) < MIN_SECRET_BYTES)) {
    throw new TypeError(`stateSecrets must list at least one secret of ${MIN_SECRET_BYTES} or more bytes`);
  }
  if (!Number.isSafeInteger(stateTtlMs) || stateTtlMs <= 0 || stateTtlMs > MAX_STATE_TTL_MS) throw new TypeError('stateTtlMs must be a positive integer of at most one hour');
  if (!Number.isSafeInteger(clockSkewMs) || clockSkewMs < 0 || clockSkewMs > MAX_CLOCK_SKEW_MS) throw new TypeError('clockSkewMs must be 0 to 300000');
  if (!Array.isArray(algorithms) || algorithms.length === 0 || algorithms.some((alg) => !SUPPORTED_ALGORITHMS.includes(alg))) {
    throw new TypeError(`algorithms must be a non-empty subset of ${SUPPORTED_ALGORITHMS.join(', ')}`);
  }
  if (!Array.isArray(authenticationMethods) || authenticationMethods.length === 0 || authenticationMethods.some((method) => !isText(method, 64))) {
    throw new TypeError('authenticationMethods must list the amr methods that count as authentication');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const allowed = Object.freeze([...algorithms]);
  const methods = Object.freeze([...authenticationMethods]);
  const secrets = stateSecrets.map((secret) => Buffer.from(secret));
  const resolveKey = keys ?? createRemoteJWKSet(keySetUrl, {
    cacheMaxAge: jwks.cacheMaxAgeMs ?? 10 * 60_000,
    cooldownDuration: jwks.cooldownMs ?? 30_000,
    timeoutDuration: jwks.timeoutMs ?? 5_000,
    ...(fetch ? { [customFetch]: fetch } : {})
  });
  if (typeof resolveKey !== 'function') throw new TypeError('keys must be a key resolver function');

  const mac = (secret, payload) => createHmac('sha256', secret).update(`${STATE_MAC_LABEL}\u0000${payload}`).digest();

  /** A state's payload when it is this service's, for this audience and unexpired; throws otherwise. */
  const verifyState = (state, { audience, nowMs }) => {
    const parts = isText(state, MAX_STATE_CHARS) ? state.split('.') : [];
    if (parts.length !== 3 || parts[0] !== STATE_VERSION) throw new Error('malformed sign-in state');
    const given = Buffer.from(parts[2], 'base64url');
    if (!secrets.some((secret) => {
      const wanted = mac(secret, parts[1]);
      return wanted.length === given.length && timingSafeEqual(wanted, given);
    })) {
      throw new Error('sign-in state was not issued by this service');
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new Error('malformed sign-in state');
    }
    if (payload?.provider !== providerId || payload.aud !== audience || payload.aud !== accountAudience) throw new Error('sign-in state was issued for another audience');
    if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat) throw new Error('malformed sign-in state');
    if (payload.iat > nowMs + clockSkewMs) throw new Error('sign-in state is from the future');
    if (payload.exp <= nowMs) throw new Error('sign-in state has expired');
    return payload;
  };

  /** The latest email-link authentication in `amr`, in milliseconds, or null. */
  const authenticatedAtMs = (amr) => {
    if (!Array.isArray(amr)) return null;
    let latest = null;
    for (const entry of amr) {
      if (entry && methods.includes(entry.method) && Number.isSafeInteger(entry.timestamp) && entry.timestamp > 0) {
        latest = Math.max(latest ?? 0, entry.timestamp * 1000);
      }
    }
    return latest;
  };

  /**
   * Verify one Supabase access token at `now` (ms): header, signature, issuer,
   * audience, expiry, issued-at and an authenticated, non-anonymous user.
   */
  const verifyAccessToken = async (token, nowMs) => {
    if (!isText(token, MAX_TOKEN_CHARS) || token.split('.').length !== 3) throw new Error('malformed access token');
    let header;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new Error('malformed access token');
    }
    if (!allowed.includes(header.alg)) throw new Error(`access token algorithm ${String(header.alg)} is not allowed`);
    if (!isText(header.kid, 256)) throw new Error('access token names no signing key');
    if (header.typ !== undefined && String(header.typ).toLowerCase() !== 'jwt') throw new Error('access token type is not JWT');
    let verified;
    try {
      verified = await jwtVerify(token, resolveKey, {
        algorithms: allowed, issuer: expectedIssuer, audience: jwtAudience, requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: Math.floor(clockSkewMs / 1000), currentDate: new Date(nowMs)
      });
    } catch (error) {
      throw new Error(`access token rejected: ${error?.message || 'verification failed'}`);
    }
    const claims = verified.payload;
    if (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= nowMs) throw new Error('access token has expired');
    if (!Number.isSafeInteger(claims.iat) || claims.iat * 1000 > nowMs + clockSkewMs) throw new Error('access token issued-at is not valid');
    if (!isText(claims.sub, 256)) throw new Error('access token names no user');
    if (claims.role !== 'authenticated') throw new Error('access token is not for an authenticated user');
    if (claims.is_anonymous === true) throw new Error('anonymous Supabase users cannot sign in');
    const authenticated = authenticatedAtMs(claims.amr);
    if (authenticated === null) throw new Error('access token records no email-link authentication');
    return {
      subject: claims.sub,
      sessionId: typeof claims.session_id === 'string' ? claims.session_id : null,
      issuedAtMs: claims.iat * 1000,
      expiresAtMs: claims.exp * 1000,
      authenticatedAtMs: authenticated,
      metadata: claims.user_metadata && typeof claims.user_metadata === 'object' ? claims.user_metadata : {}
    };
  };

  return Object.freeze({
    providerId,
    testOnly: false,
    metadataKey: SIGN_IN_STATE_METADATA_KEY,

    /** Public settings the browser flow needs; no secret. */
    clientConfig() {
      return { providerId, flow: 'supabase_magic_link', url: origin, publishableKey, metadataKey: SIGN_IN_STATE_METADATA_KEY };
    },

    /** A new single-use sign-in state under the current secret. */
    issueState() {
      const nowMs = Date.parse(clock());
      const payload = b64(canonicalJson({ aud: accountAudience, exp: nowMs + stateTtlMs, iat: nowMs, nonce: randomBytes(24).toString('base64url'), provider: providerId }));
      const state = `${STATE_VERSION}.${payload}.${mac(secrets[0], payload).toString('base64url')}`;
      return { providerId, state, metadataKey: SIGN_IN_STATE_METADATA_KEY, issuedAt: iso(nowMs), expiresAt: iso(nowMs + stateTtlMs) };
    },

    /** The token checks alone, without a state; for operator smoke checks. */
    async verifyAccessToken(token, { now = clock() } = {}) {
      const verified = await verifyAccessToken(token, Date.parse(now));
      return {
        subject: verified.subject, sessionId: verified.sessionId, issuedAt: iso(verified.issuedAtMs),
        authenticatedAt: iso(verified.authenticatedAtMs), expiresAt: iso(verified.expiresAtMs)
      };
    },

    /** The sign-in provider contract: `{ accessToken, state }` issued for `audience`. */
    async verifyAssertion(assertion, { audience, now }) {
      if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)
        || Object.keys(assertion).some((key) => !['accessToken', 'state'].includes(key))) {
        throw new Error('a Supabase assertion is { accessToken, state }');
      }
      const nowMs = Date.parse(now);
      const state = verifyState(assertion.state, { audience, nowMs });
      const token = await verifyAccessToken(assertion.accessToken, nowMs);
      if (token.issuedAtMs < state.iat - clockSkewMs) throw new Error('access token was minted before this sign-in state');
      if (token.metadata[SIGN_IN_STATE_METADATA_KEY] !== assertion.state) throw new Error('access token does not carry this sign-in state');
      return {
        subject: token.subject,
        assertionId: sha256Hex(`${STATE_VERSION}\u0000${assertion.state}`),
        authenticatedAt: iso(token.authenticatedAtMs),
        expiresAt: iso(Math.min(token.expiresAtMs, state.exp))
      };
    }
  });
}

export default createSupabaseSignInProvider;
