// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { signAsParticipant } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { keyFingerprint, normalizePairingCode, openSelfServeFleet, pairingClaimBody, pairingPollBody } from '../../server/fleet/self-serve.js';
import { mountSelfServeFleet } from '../../server/fleet/self-serve-mount.js';
import { firebaseSessionAuthenticator } from '../../server/fleet/self-serve-http.js';
import { createFleetServiceHandler } from '../../server/fleet/service.js';
import { selfServeConfiguration } from '../helpers/self-serve-fleet.js';

const alice = { issuer: 'test', subject: 'alice', verified: true };
const anon = { issuer: 'test', subject: 'anon', verified: false };
let root, clock, credits, fleet;

async function open(options = {}) {
  credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'), computers: [], openEnrollment: true, now: () => clock,
    policy: selfServeConfiguration(root).creditPolicy });
  fleet = await openSelfServeFleet({ credits, file: path.join(root, 'accounts.sqlite'), now: () => clock, models: [],
    network: { serviceUrl: 'https://replo.id/v1/fleet', signalingUrl: 'wss://signal.example/ws', roomId: 'reploid-swarm-fleet', roomToken: 'r'.repeat(40) },
    starterDebt: { verified: 40, unverified: 0 }, ...options });
}
async function claim(code, key, name = 'Laptop') {
  const body = pairingClaimBody({ code, participantId: key.peerId, publicJwk: key.publicJwk, name, bridgePort: 18784, at: clock, nonce: randomUUID() });
  return fleet.claim({ ...body, signature: await signAsParticipant(key, body.schema, body) });
}
async function poll(pairingId, key) {
  const body = pairingPollBody({ pairingId, participantId: key.peerId, at: clock, nonce: randomUUID() });
  return fleet.poll({ ...body, signature: await signAsParticipant(key, body.schema, body) });
}

beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'self-serve-unit-')); clock = Date.parse('2026-11-25T00:00:00Z'); });
afterEach(async () => { fleet?.close(); credits?.close(); fleet = credits = null; await rm(root, { recursive: true, force: true }); });

describe('pairing codes', () => {
  it('normalizes what a person types and prints an eight-character fingerprint', () => {
    expect(normalizePairingCode(' abcd efgh ')).toBe('ABCD-EFGH');
    expect(normalizePairingCode('ab0d-efgh')).toBe('AB0D-EFGH');
    expect(normalizePairingCode('oil1-2345')).toBe('0111-2345');
    expect(normalizePairingCode('ABCD-EFG')).toBeNull();
    expect(normalizePairingCode('ABCU-EFGH')).toBeNull();
    expect(keyFingerprint('peer:5c0ecd2fd5fd8a105a4f8068')).toBe('5C0E-CD2F');
  });

  it('expire, work once, and bind to the key that claimed them', async () => {
    await open();
    await fleet.createAccount(alice);
    const key = await createSigningIdentity({ algorithm: 'Ed25519' }), other = await createSigningIdentity({ algorithm: 'Ed25519' });
    const expired = fleet.createPairing(alice);
    clock += fleet.limits.pairingTtlMs + 1;
    await expect(claim(expired.code, key)).rejects.toThrow('not valid');
    const pairing = fleet.createPairing(alice);
    expect(pairing.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const claimed = await claim(pairing.code.toLowerCase(), key);
    expect(claimed).toMatchObject({ state: 'claimed', fingerprint: keyFingerprint(key.peerId) });
    await expect(claim(pairing.code, other)).rejects.toThrow('not valid');
    await expect(poll(pairing.id, other)).rejects.toThrow('No pairing claimed by this computer');
    expect(await poll(pairing.id, key)).toEqual({ state: 'claimed' });
    // Claiming enrolled nothing; the browser's confirmation does.
    expect(credits.enrollment.byPeer.has(key.peerId)).toBe(false);
    await fleet.confirm(alice, pairing.id, { fingerprint: keyFingerprint(key.peerId) });
    expect(credits.enrollment.byPeer.get(key.peerId)).toMatchObject({ computerId: expect.stringMatching(/^acct-/) });
    expect(await poll(pairing.id, key)).toMatchObject({ state: 'confirmed', network: { roomToken: 'r'.repeat(40) } });
    clock += fleet.limits.confirmedPollMs + 1;
    await expect(poll(pairing.id, key)).rejects.toThrow('already has its settings');
  });

  it('refuses a forged claim signature and a key already on an account', async () => {
    await open();
    await fleet.createAccount(alice);
    const key = await createSigningIdentity({ algorithm: 'Ed25519' }), forger = await createSigningIdentity({ algorithm: 'Ed25519' });
    const pairing = fleet.createPairing(alice);
    const body = pairingClaimBody({ code: pairing.code, participantId: key.peerId, publicJwk: key.publicJwk, name: 'Laptop', bridgePort: null, at: clock, nonce: 'n' });
    await expect(fleet.claim({ ...body, signature: await signAsParticipant(forger, body.schema, body) })).rejects.toThrow('Invalid pairing signature');
    await claim(pairing.code, key);
    await fleet.confirm(alice, pairing.id, { fingerprint: keyFingerprint(key.peerId) });
    await fleet.createAccount(anon);
    await expect(claim(fleet.createPairing(anon).code, key)).rejects.toThrow('already paired');
  });

  it('bounds open codes per account and new accounts per network', async () => {
    await open({ limits: { maxOpenPairings: 2, accountsPerClientPerHour: 2 } });
    await fleet.createAccount(alice, { client: 'net-a' });
    fleet.createPairing(alice); fleet.createPairing(alice);
    expect(() => fleet.createPairing(alice)).toThrow('Finish or cancel');
    await fleet.createAccount(anon, { client: 'net-a' });
    await expect(fleet.createAccount({ issuer: 'test', subject: 'third', verified: false }, { client: 'net-a' })).rejects.toThrow('Too many new accounts');
    // Asking again for an existing account is not a new account.
    expect((await fleet.createAccount(alice, { client: 'net-a' })).account.id).toBe((await fleet.account(alice)).account.id);
  });
});

describe('open-enrollment ledger', () => {
  it('appends accounts, keys, removals and debt limits through its journal and conserves credit', async () => {
    await open();
    const [a, b, c] = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    await credits.enrollAccount({ id: 'acct-a', name: 'A', ownerId: 'acct-a', debtLimit: 5, providers: [{ participantId: a.peerId, publicJwk: a.publicJwk }] });
    await expect(credits.enrollAccount({ id: 'acct-b', name: 'B', ownerId: 'acct-b', providers: [{ participantId: a.peerId, publicJwk: a.publicJwk }] }))
      .rejects.toThrow('exactly one enrolled computer');
    // Concurrent appends are checked one after another, so one key cannot land on two accounts.
    const results = await Promise.allSettled([
      credits.enrollAccount({ id: 'acct-b', name: 'B', ownerId: 'acct-b', providers: [{ participantId: b.peerId, publicJwk: b.publicJwk }] }),
      credits.enrollKey('acct-a', { participantId: b.peerId, publicJwk: b.publicJwk })]);
    expect(results.map(row => row.status)).toEqual(['fulfilled', 'rejected']);
    await credits.enrollKey('acct-a', { participantId: c.peerId, publicJwk: c.publicJwk });
    await credits.revokeKey('acct-a', c.peerId);
    await expect(credits.revokeKey('acct-a', c.peerId)).rejects.toThrow('No active key');
    expect(credits.debtLimitFor('acct-a')).toBe(5);
    await credits.setDebtLimit('acct-a', 1000);
    expect(credits.debtLimitFor('acct-a')).toBe(40);
    expect(credits.snapshot().accounts.map(row => row.balance)).toEqual([0, 0]);
    expect(credits.enrollmentLog('acct-a').map(row => row.kind)).toEqual(['computer', 'key', 'revoke', 'debt-limit']);
    credits.close();
    credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'), computers: [], openEnrollment: true, policy: selfServeConfiguration(root).creditPolicy });
    expect(credits.enrollment.byPeer.get(c.peerId).revokedAt).toEqual(expect.any(Number));
    expect(credits.enrollment.byId.get('acct-b').providers).toHaveLength(1);
  });

  it('keeps a fixed operator enrollment fixed', async () => {
    const key = await createSigningIdentity({ algorithm: 'Ed25519' });
    credits = await openFleetCredits({ file: path.join(root, 'fixed.sqlite'), policy: selfServeConfiguration(root).creditPolicy,
      computers: [{ id: 'm', name: 'M', ownerId: 'o', providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] }] });
    await expect(credits.enrollKey('m', { participantId: key.peerId, publicJwk: key.publicJwk })).rejects.toThrow('fixed operator enrollment');
    credits.close();
    await expect(openFleetCredits({ file: path.join(root, 'fixed.sqlite'), computers: [], openEnrollment: true,
      policy: selfServeConfiguration(root).creditPolicy })).rejects.toThrow('explicit migration required');
    credits = null;
  });
});

describe('signed directory', () => {
  // TRUST-06, 2026-11-26: a host started from join's settings (or by trade.js earner) follows no placement, so it never
  // sent an observation; a self-serve directory then never listed it to another account, and that account's requester
  // had nobody it could send a credited request to. A serving host now reports its presence, which lists it while fresh.
  it('lists another account\'s serving computer while it reports its presence, and stops listing it when the report is stale', async () => {
    const [mine, theirs] = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'), now: () => clock, policy: selfServeConfiguration(root).creditPolicy,
      computers: [{ id: 'mine', name: 'Mine', ownerId: 'me', providers: [{ participantId: mine.peerId, publicJwk: mine.publicJwk }] },
        { id: 'theirs', name: 'Theirs', ownerId: 'them', providers: [{ participantId: theirs.peerId, publicJwk: theirs.publicJwk }] }] });
    const placementPolicy = selfServeConfiguration(root).placementPolicy;
    const { invoke } = createFleetServiceHandler({ credits, models: [], placementPolicy, now: () => clock, directory: 'own' });
    const listed = async () => (await invoke(mine.peerId, 'computers', {})).computers.map(row => ({ id: row.id, online: row.online, participantIds: row.participantIds }));
    expect(await listed()).toEqual([{ id: 'mine', online: false, participantIds: [mine.peerId] }]);

    // The report names only the sender's own computer and key, within the clock bound; the reply says how long it lasts.
    await expect(invoke(theirs.peerId, 'present', { id: 'mine', participantId: theirs.peerId, observedAt: clock })).rejects.toThrow('Cannot report another computer');
    await expect(invoke(theirs.peerId, 'present', { id: 'theirs', participantId: theirs.peerId, observedAt: clock - 60000 })).rejects.toThrow('clock-skew');
    expect(await invoke(theirs.peerId, 'present', { id: 'theirs', participantId: theirs.peerId, observedAt: clock }))
      .toEqual({ accepted: true, expiresInMs: placementPolicy.maxObservationAgeMs });
    expect(await listed()).toEqual([{ id: 'mine', online: false, participantIds: [mine.peerId] },
      { id: 'theirs', online: true, participantIds: [theirs.peerId] }]);
    // Presence states no capacity: nothing that an observation would carry is invented for it.
    expect((await invoke(mine.peerId, 'computers', {})).computers[1]).not.toHaveProperty('resident');

    clock += placementPolicy.maxObservationAgeMs + 1;
    expect(await listed()).toEqual([{ id: 'mine', online: false, participantIds: [mine.peerId] }]);
  });
});

describe('hosted mount', () => {
  const app = { use() {} };
  it('stays off by default and refuses the test sign-in in production', async () => {
    expect(await mountSelfServeFleet(app, { env: {} })).toMatchObject({ mounted: false });
    await expect(mountSelfServeFleet(app, { env: { REPLOID_FLEET_SELF_SERVE: 'yes' } })).rejects.toThrow('must be "enabled"');
    await expect(mountSelfServeFleet(app, { env: { REPLOID_FLEET_SELF_SERVE: 'enabled', REPLOID_FLEET_SELF_SERVE_CONFIG: '/x.json',
      REPLOID_FLEET_ROOM_TOKEN: 'short' } })).rejects.toThrow('REPLOID_FLEET_ROOM_TOKEN');
    await expect(mountSelfServeFleet(app, { env: { REPLOID_FLEET_SELF_SERVE: 'enabled', REPLOID_FLEET_SELF_SERVE_CONFIG: '/x.json',
      REPLOID_FLEET_ROOM_TOKEN: 'r'.repeat(40), REPLOID_FLEET_TEST_SIGN_IN: 'enabled', K_SERVICE: 'reploid-pool' } })).rejects.toThrow('not permitted in production');
  });

  it('gives starter debt only to verified Firebase sign-ins', async () => {
    const authenticate = firebaseSessionAuthenticator(async token => ({
      anonymous: { uid: 'u1', iss: 'i', firebase: { sign_in_provider: 'anonymous' } },
      google: { uid: 'u2', iss: 'i', firebase: { sign_in_provider: 'google.com' } },
      password: { uid: 'u3', iss: 'i', firebase: { sign_in_provider: 'password' }, email_verified: false } }[token]));
    expect(await authenticate('anonymous')).toMatchObject({ subject: 'u1', verified: false });
    expect(await authenticate('google')).toMatchObject({ subject: 'u2', verified: true });
    expect(await authenticate('password')).toMatchObject({ subject: 'u3', verified: false });
  });
});
