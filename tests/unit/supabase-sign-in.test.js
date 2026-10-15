// @vitest-environment node
// Supabase magic-link sign-in behind the account store: token checks, state binding, single
// use, key rotation and the recovery age. Tokens come from a local signer shaped like Supabase
// Auth's; keys, secrets, users and times are test-only.
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountIdFor } from '../../server/accounts/domain.js';
import { createMemoryAccountState, createMemoryAccountStore } from '../../server/accounts/stores.js';
import { createSupabaseSignInProvider, SIGN_IN_STATE_METADATA_KEY } from '../../server/providers/supabase-sign-in.js';
import {
  ISSUER, OTHER_STATE_SECRET, PROJECT_URL, PUBLISHABLE_KEY, STATE_SECRET, accessToken, browserAssertion, createJwksEndpoint, signingKey
} from '../helpers/supabase-fake.js';

const MIN = 60_000;
const START = Date.parse('2026-10-15T12:00:00.000Z');
const USER = '7f6d1c2e-0000-4000-8000-000000000001';
const OTHER_USER = '7f6d1c2e-0000-4000-8000-000000000002';
// Test-only account policy; none is a product decision.
const POLICY = Object.freeze({
  audience: 'reploid-accounts-test', sessionTtlMs: 60 * MIN, challengeTtlMs: 5 * MIN, recoveryMaxAuthAgeMs: 5 * MIN,
  maxClockSkewMs: 30_000, custodyCertificateMaxLifetimeMs: 120 * MIN
});

const advance = (ms) => vi.setSystemTime(Date.now() + ms);
const clock = () => new Date().toISOString();

describe('Supabase magic-link sign-in', () => {
  let keyA;
  let keyB;
  let rsa;
  let jwks;
  let provider;
  let accounts;

  const createProvider = (options = {}) => createSupabaseSignInProvider({
    projectUrl: PROJECT_URL, publishableKey: PUBLISHABLE_KEY, accountAudience: POLICY.audience, stateSecrets: [STATE_SECRET],
    stateTtlMs: 5 * MIN, clockSkewMs: POLICY.maxClockSkewMs, fetch: jwks.fetch, clock, ...options
  });
  const openAccounts = (providers = [provider]) => createMemoryAccountStore({ state: createMemoryAccountState(), policy: POLICY, providers, clock });
  const signIn = (assertion, store = accounts) => store.signIn({ providerId: 'supabase', assertion });
  const rejects = (promise, code, message) => expect(promise).rejects.toMatchObject({ code, ...(message ? { message: expect.stringMatching(message) } : {}) });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    [keyA, keyB, rsa] = await Promise.all([signingKey('key-a'), signingKey('key-b'), signingKey('key-rsa', 'RS256')]);
    jwks = createJwksEndpoint([keyA, rsa]);
    provider = createProvider();
    accounts = openAccounts();
  });
  afterEach(() => vi.useRealTimers());

  it('signs in once per server-issued state and keys the account to the Supabase user id, never the email', async () => {
    const assertion = await browserAssertion(provider, keyA, { sub: USER, email: 'first@example.test' });
    const first = await signIn(assertion);
    expect(first).toMatchObject({ created: true, account: { accountId: accountIdFor('supabase', USER), providerId: 'supabase' } });
    // The same assertion, and a refreshed token still carrying the used state, never sign in again.
    await rejects(signIn(assertion), 'assertion_replayed');
    advance(MIN);
    const refreshed = await accessToken(keyA, { sub: USER, state: assertion.state, authenticatedAtMs: START });
    await rejects(signIn({ accessToken: refreshed, state: assertion.state }), 'assertion_replayed');

    // A new email on the same user id reaches the same account; the same email on another id does not.
    const renamed = await signIn(await browserAssertion(provider, keyA, { sub: USER, email: 'changed@example.test' }));
    expect(renamed).toMatchObject({ created: false, account: { accountId: first.account.accountId } });
    const sameEmail = await signIn(await browserAssertion(provider, keyA, { sub: OTHER_USER, email: 'first@example.test' }));
    expect(sameEmail.account.accountId).toBe(accountIdFor('supabase', OTHER_USER));
    expect(JSON.stringify([first, renamed, sameEmail])).not.toMatch(/example\.test/);

    // An RS256 key in the allowlist verifies too.
    expect((await signIn(await browserAssertion(provider, rsa, { sub: OTHER_USER }))).created).toBe(false);
  });

  it('refuses expired, wrong-issuer, wrong-audience, disallowed-algorithm, unsigned and tampered tokens', async () => {
    const withState = async (options) => browserAssertion(provider, options.key ?? keyA, options);
    await rejects(signIn(await withState({ iatMs: START - 2 * 60 * MIN, expMs: START - 1000 })), 'assertion_invalid', /exp|expired/);
    await rejects(signIn(await withState({ iss: 'https://otherproject.supabase.co/auth/v1' })), 'assertion_invalid', /iss/);
    await rejects(signIn(await withState({ aud: 'anon' })), 'assertion_invalid', /aud/);
    await rejects(signIn(await withState({ role: 'anon' })), 'assertion_invalid', /authenticated user/);
    await rejects(signIn(await withState({ isAnonymous: true })), 'assertion_invalid', /anonymous/);
    await rejects(signIn(await withState({ amr: [{ method: 'password', timestamp: Math.floor(START / 1000) }] })), 'assertion_invalid', /email-link/);
    await rejects(signIn(await withState({ amr: [] })), 'assertion_invalid', /email-link/);
    await rejects(signIn(await withState({ header: { typ: 'at+jwt' } })), 'assertion_invalid', /type/);

    // HS256 under a shared secret and unsigned tokens are refused before any key lookup.
    const fetchesBefore = jwks.fetches;
    const { state } = provider.issueState();
    const hs256 = await new SignJWT({ role: 'authenticated', amr: [{ method: 'magiclink', timestamp: Math.floor(START / 1000) }], user_metadata: { [SIGN_IN_STATE_METADATA_KEY]: state } })
      .setProtectedHeader({ alg: 'HS256', kid: 'key-a', typ: 'JWT' }).setIssuer(ISSUER).setAudience('authenticated').setSubject(USER)
      .setIssuedAt(Math.floor(START / 1000)).setExpirationTime(Math.floor(START / 1000) + 3600)
      .sign(new TextEncoder().encode('legacy-project-jwt-secret-test-only'));
    await rejects(signIn({ accessToken: hs256, state }), 'assertion_invalid', /HS256 is not allowed/);
    const [, body] = hs256.split('.');
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'key-a' })).toString('base64url')}.${body}.`;
    await rejects(signIn({ accessToken: unsigned, state }), 'assertion_invalid', /none is not allowed/);
    expect(jwks.fetches).toBe(fetchesBefore);

    // An allowed algorithm the provider was not configured for, and an algorithm-confused header.
    const esOnly = createProvider({ algorithms: ['ES256'] });
    await rejects(signIn(await browserAssertion(esOnly, rsa), openAccounts([esOnly])), 'assertion_invalid', /RS256 is not allowed/);
    const confused = await browserAssertion(provider, keyA);
    const [header, payload, signature] = confused.accessToken.split('.');
    const relabeled = { ...JSON.parse(Buffer.from(header, 'base64url').toString()), alg: 'RS256' };
    await rejects(signIn({ ...confused, accessToken: `${Buffer.from(JSON.stringify(relabeled)).toString('base64url')}.${payload}.${signature}` }), 'assertion_invalid');

    // A changed claim breaks the signature.
    const genuine = await browserAssertion(provider, keyA, { sub: USER });
    const claims = JSON.parse(Buffer.from(genuine.accessToken.split('.')[1], 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: OTHER_USER })).toString('base64url');
    const [h, , s] = genuine.accessToken.split('.');
    await rejects(signIn({ ...genuine, accessToken: `${h}.${forged}.${s}` }), 'assertion_invalid', /signature/);
    await rejects(signIn({ ...genuine, extra: true }), 'assertion_invalid');
    // None of these consumed the genuine state.
    expect((await signIn(genuine)).created).toBe(true);
  });

  it('binds each sign-in to a fresh server-issued state carried inside the signed token', async () => {
    // A token without the state, or carrying another state, does not sign in with it.
    const issued = provider.issueState();
    await rejects(signIn({ accessToken: await accessToken(keyA, {}), state: issued.state }), 'assertion_invalid', /does not carry/);
    const other = provider.issueState();
    await rejects(signIn({ accessToken: await accessToken(keyA, { state: other.state }), state: issued.state }), 'assertion_invalid', /does not carry/);
    // A token minted before the state was issued cannot have been refreshed for it.
    await rejects(signIn({ accessToken: await accessToken(keyA, { state: issued.state, iatMs: START - 2 * MIN }), state: issued.state }), 'assertion_invalid', /minted before/);

    // States this service did not issue, altered ones, other audiences and expired ones.
    const foreign = createProvider({ stateSecrets: [OTHER_STATE_SECRET] }).issueState().state;
    await rejects(signIn({ accessToken: await accessToken(keyA, { state: foreign }), state: foreign }), 'assertion_invalid', /not issued by this service/);
    const [version, payload, mac] = issued.state.split('.');
    const stretched = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), exp: START + 600 * MIN })).toString('base64url');
    const altered = `${version}.${stretched}.${mac}`;
    await rejects(signIn({ accessToken: await accessToken(keyA, { state: altered }), state: altered }), 'assertion_invalid', /not issued by this service/);
    const elsewhere = createProvider({ accountAudience: 'another-deployment' });
    const elsewhereState = elsewhere.issueState().state;
    await rejects(signIn({ accessToken: await accessToken(keyA, { state: elsewhereState }), state: elsewhereState }), 'assertion_invalid', /another audience/);
    const late = await browserAssertion(provider, keyA);
    advance(5 * MIN);
    await rejects(signIn(late), 'assertion_invalid', /expired/);

    // During a secret rotation the previous secret still verifies; after it, it does not.
    const before = await browserAssertion(provider, keyA);
    const rotating = createProvider({ stateSecrets: [OTHER_STATE_SECRET, STATE_SECRET] });
    expect((await signIn(before, openAccounts([rotating]))).created).toBe(true);
    const rotated = createProvider({ stateSecrets: [OTHER_STATE_SECRET] });
    const rotatedAccounts = openAccounts([rotated]);
    await rejects(signIn(await browserAssertion(provider, keyA), rotatedAccounts), 'assertion_invalid', /not issued by this service/);
    // New states are signed with the current secret, listed first.
    expect((await signIn(await browserAssertion(rotating, keyA), rotatedAccounts)).created).toBe(true);
  });

  it('picks up a rotated signing key from the JWKS and stops accepting a removed one', async () => {
    expect((await signIn(await browserAssertion(provider, keyA, { sub: USER }))).created).toBe(true);
    expect(jwks.fetches).toBe(1);
    // A key published after the last fetch is found on reload once the cooldown passes.
    jwks.publish(keyB);
    await rejects(signIn(await browserAssertion(provider, keyB)), 'assertion_invalid');
    advance(31_000);
    expect((await signIn(await browserAssertion(provider, keyB))).created).toBe(false);
    expect(jwks.fetches).toBe(2);
    // The old key is withdrawn: still cached for a while, refused once the cache ages out.
    jwks.remove('key-a');
    expect((await signIn(await browserAssertion(provider, keyA))).created).toBe(false);
    advance(11 * MIN);
    await rejects(signIn(await browserAssertion(provider, keyA)), 'assertion_invalid');
    expect((await signIn(await browserAssertion(provider, keyB))).created).toBe(false);
    // An unreachable key set fails closed.
    jwks.failing = true;
    advance(11 * MIN);
    await rejects(signIn(await browserAssertion(provider, keyB)), 'assertion_invalid');
  });

  it('measures the recovery age from the email-link authentication, not a refreshed token', async () => {
    const signedIn = await signIn(await browserAssertion(provider, keyA, { sub: USER, authenticatedAtMs: START }));
    advance(10 * MIN);
    // A refresh mints a new token (new iat) but keeps the original amr time.
    const refreshed = await browserAssertion(provider, keyA, { sub: USER, authenticatedAtMs: START });
    await rejects(accounts.recoverAccount({ providerId: 'supabase', assertion: refreshed }), 'reauthentication_required');
    // A new email link authenticates now.
    const recovered = await accounts.recoverAccount({ providerId: 'supabase', assertion: await browserAssertion(provider, keyA, { sub: USER }) });
    expect(recovered).toMatchObject({ account: { accountId: signedIn.account.accountId }, recovery: { providerId: 'supabase', authenticatedAt: new Date(Date.now()).toISOString() } });
    // The latest email-link entry counts when amr lists several.
    const verified = await provider.verifyAccessToken(await accessToken(keyA, {
      amr: [{ method: 'magiclink', timestamp: Math.floor((START - 60 * MIN) / 1000) }, { method: 'otp', timestamp: Math.floor((Date.now() - MIN) / 1000) }, { method: 'password', timestamp: Math.floor(Date.now() / 1000) }]
    }));
    expect(verified.authenticatedAt).toBe(new Date(Math.floor((Date.now() - MIN) / 1000) * 1000).toISOString());
  });

  it('serves public client settings and states without any secret, and refuses unsafe configuration', () => {
    const settings = provider.clientConfig();
    expect(settings).toEqual({ providerId: 'supabase', flow: 'supabase_magic_link', url: PROJECT_URL, publishableKey: PUBLISHABLE_KEY, metadataKey: SIGN_IN_STATE_METADATA_KEY });
    const issued = provider.issueState();
    expect(issued).toMatchObject({ providerId: 'supabase', metadataKey: SIGN_IN_STATE_METADATA_KEY, issuedAt: new Date(START).toISOString(), expiresAt: new Date(START + 5 * MIN).toISOString() });
    expect(JSON.stringify([settings, issued])).not.toContain(STATE_SECRET);
    expect(provider.issueState().state).not.toBe(issued.state);
    expect(provider.testOnly).toBe(false);

    expect(() => createProvider({ algorithms: ['HS256'] })).toThrow(/subset/);
    expect(() => createProvider({ stateSecrets: ['short'] })).toThrow(/32/);
    expect(() => createProvider({ projectUrl: 'http://projectreftest.supabase.co' })).toThrow(/https/);
    expect(() => createProvider({ stateTtlMs: 2 * 60 * MIN })).toThrow(/stateTtlMs/);
    expect(() => createProvider({ accountAudience: '' })).toThrow(/accountAudience/);
    expect(createProvider({ projectUrl: 'http://127.0.0.1:54321' }).clientConfig().url).toBe('http://127.0.0.1:54321');
  });
});
