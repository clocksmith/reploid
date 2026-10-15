/**
 * @fileoverview Sign-in provider for local runs and tests only.
 *
 * Assertions are `<claims>.<hmac>` under a key generated per instance and
 * never stored, so only the process holding the instance can issue them. It
 * checks its own MAC, issuer and audience; the provider registry enforces
 * expiry. `testOnly` marks it, and hosted compositions refuse it in
 * production. It is not a real identity provider and holds no secrets.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { canonicalJson } from '../ledger/domain.js';

/**
 * @param {object} options
 * @param {string} [options.providerId]
 * @param {string} options.audience the account policy audience assertions are issued for by default
 * @param {Function} options.clock () => ISO time used for issue times
 */
export function createTestSignInProvider({ providerId = 'test-provider', audience, clock } = {}) {
  if (typeof audience !== 'string' || typeof clock !== 'function') throw new TypeError('the test sign-in provider needs an audience and a clock');
  const key = randomBytes(32);
  const mac = (encoded) => createHmac('sha256', key).update(encoded).digest('base64url');
  return Object.freeze({
    providerId,
    testOnly: true,
    issue({ subject, audience: issuedFor = audience, authenticatedAt = clock(), expiresInMs = 5 * 60_000, assertionId = randomUUID() } = {}) {
      const claims = {
        iss: providerId, sub: subject, aud: issuedFor, jti: assertionId, auth_time: authenticatedAt,
        exp: new Date(Date.parse(clock()) + expiresInMs).toISOString()
      };
      const encoded = Buffer.from(canonicalJson(claims)).toString('base64url');
      return `${encoded}.${mac(encoded)}`;
    },
    async verifyAssertion(assertion, { audience: expected }) {
      const [encoded, signature, extra] = String(assertion).split('.');
      if (!encoded || !signature || extra !== undefined) throw new Error('malformed assertion');
      const wanted = Buffer.from(mac(encoded));
      const given = Buffer.from(signature);
      if (wanted.length !== given.length || !timingSafeEqual(wanted, given)) throw new Error('assertion signature mismatch');
      const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (claims.iss !== providerId) throw new Error('wrong issuer');
      if (claims.aud !== expected) throw new Error('wrong audience');
      return { subject: claims.sub, assertionId: claims.jti, authenticatedAt: claims.auth_time, expiresAt: claims.exp };
    }
  });
}

export default createTestSignInProvider;
