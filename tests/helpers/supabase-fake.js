// A stand-in for a Supabase project's token issuer: asymmetric signing keys published as a
// JWKS over a fake fetch, and access tokens shaped like Supabase Auth's (issuer, audience,
// `sub`, `email`, `role`, `amr`, `session_id`, `user_metadata`). Test-only keys generated per
// run; no Supabase project, credential or network.
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

import { SIGN_IN_STATE_METADATA_KEY } from '../../server/providers/supabase-sign-in.js';

export const PROJECT_URL = 'https://projectreftest.supabase.co';
export const ISSUER = `${PROJECT_URL}/auth/v1`;
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
export const PUBLISHABLE_KEY = 'sb_publishable_test_only';
export const STATE_SECRET = 'sign-in-state-secret-for-tests-only-0123456789';
export const OTHER_STATE_SECRET = 'another-sign-in-state-secret-for-tests-only-0123';

const seconds = (ms) => Math.floor(ms / 1000);

/** A signing key with its public JWK under `kid`. */
export async function signingKey(kid, alg = 'ES256') {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  return { kid, alg, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' } };
}

/** A JWKS endpoint whose published keys a test changes; counts fetches and can fail. */
export function createJwksEndpoint(keys = []) {
  const endpoint = {
    keys: [...keys],
    fetches: 0,
    failing: false,
    publish(...more) { endpoint.keys.push(...more); },
    remove(kid) { endpoint.keys = endpoint.keys.filter((key) => key.kid !== kid); },
    fetch: async (url) => {
      endpoint.fetches += 1;
      if (endpoint.failing) return new Response('unavailable', { status: 503 });
      if (String(url) !== JWKS_URL) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ keys: endpoint.keys.map((key) => key.jwk) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  };
  return endpoint;
}

/**
 * An access token as Supabase Auth issues one. `state` lands in user metadata
 * as the browser flow writes it; `authenticatedAtMs` is the email-link `amr`
 * entry, which a refresh keeps while `iatMs` moves.
 */
export async function accessToken(key, {
  sub = '7f6d1c2e-0000-4000-8000-000000000001', email = 'person@example.test', state, nowMs = Date.now(), iatMs = nowMs,
  expMs = iatMs + 60 * 60_000, authenticatedAtMs = iatMs, method = 'magiclink', iss = ISSUER, aud = 'authenticated',
  role = 'authenticated', isAnonymous = false, amr, header = {}, extra = {}
} = {}) {
  const metadata = { email, email_verified: true, ...(state === undefined ? {} : { [SIGN_IN_STATE_METADATA_KEY]: state }) };
  return new SignJWT({
    email, phone: '', role, aal: 'aal1', session_id: 'b1c2d3e4-0000-4000-8000-000000000002', is_anonymous: isAnonymous,
    amr: amr ?? [{ method, timestamp: seconds(authenticatedAtMs) }],
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: metadata, ...extra
  })
    .setProtectedHeader({ alg: key.alg, kid: key.kid, typ: 'JWT', ...header })
    .setIssuer(iss).setAudience(aud).setSubject(sub)
    .setIssuedAt(seconds(iatMs)).setExpirationTime(seconds(expMs))
    .sign(key.privateKey);
}

/** The browser flow's assertion: a fresh state written into metadata, then a refreshed token carrying it. */
export async function browserAssertion(provider, key, options = {}) {
  const { state } = provider.issueState();
  return { accessToken: await accessToken(key, { ...options, state }), state };
}
