/**
 * @fileoverview Provider-neutral sign-in.
 *
 * A sign-in provider verifies its own assertion and returns a stable subject.
 * The account component never handles provider credentials, keys or user
 * profile data; it keys accounts by (providerId, subject) only.
 *
 * Provider contract:
 *   providerId: stable, unique identifier for the provider configuration
 *   verifyAssertion(assertion, { audience, now }) -> Promise<{
 *     subject,          // stable per person at this provider
 *     assertionId,      // unique per assertion; the store rejects a second use
 *     authenticatedAt,  // ISO time the person authenticated
 *     expiresAt         // ISO time after which the assertion is not accepted
 *   }>
 *   It throws (or rejects) when the assertion is not genuine, not issued for
 *   `audience`, or expired.
 *
 * No real provider ships here. Real providers need their own acceptance.
 */

import { fail, isIsoTime, isNonEmptyString, toMs } from './domain.js';

const PROVIDER_ID = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

const text = (value, maxLength) => isNonEmptyString(value) && value.length <= maxLength;

/**
 * @param {Array<object>} providers sign-in providers satisfying the contract above
 * @returns {{ providerIds: string[], verify(input): Promise<object> }}
 */
export function createSignInProviders(providers = []) {
  const byId = new Map();
  for (const provider of providers) {
    if (!PROVIDER_ID.test(String(provider?.providerId)) || typeof provider.verifyAssertion !== 'function') {
      throw new TypeError('each sign-in provider needs a providerId and verifyAssertion(assertion, context)');
    }
    if (byId.has(provider.providerId)) throw new TypeError(`duplicate sign-in provider ${provider.providerId}`);
    byId.set(provider.providerId, provider);
  }
  return Object.freeze({
    providerIds: [...byId.keys()],

    /** Verify one assertion and normalize the provider's answer; every failure is explicit. */
    async verify({ providerId, assertion, audience, now, maxClockSkewMs }) {
      const provider = byId.get(providerId);
      if (!provider) fail('provider_unknown', `no sign-in provider ${providerId} is configured`, { providerId });
      let claims;
      try {
        claims = await provider.verifyAssertion(assertion, { audience, now });
      } catch (error) {
        fail('assertion_invalid', `the ${providerId} assertion was not accepted: ${error?.message ?? 'verification failed'}`, { providerId });
      }
      const nowMs = toMs(now);
      if (!text(claims?.subject, 256) || !text(claims.assertionId, 256)
        || !isIsoTime(claims.authenticatedAt) || !isIsoTime(claims.expiresAt)) {
        fail('assertion_invalid', `the ${providerId} provider returned an incomplete subject`, { providerId });
      }
      if (toMs(claims.authenticatedAt) > nowMs + maxClockSkewMs) fail('assertion_invalid', 'the assertion claims a future authentication time', { providerId });
      if (toMs(claims.expiresAt) <= nowMs) fail('assertion_expired', 'the assertion has expired', { providerId });
      return {
        providerId,
        subject: claims.subject,
        assertionId: claims.assertionId,
        authenticatedAt: new Date(toMs(claims.authenticatedAt)).toISOString(),
        expiresAt: new Date(toMs(claims.expiresAt)).toISOString()
      };
    }
  });
}

export default createSignInProviders;
