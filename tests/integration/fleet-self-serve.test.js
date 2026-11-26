// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { joinFleetByCode } from '../../server/fleet/join.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { settleAnswer, sessionApi, selfServeConfiguration, startSelfServeServer } from '../helpers/self-serve-fleet.js';

let root, hosted;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fleet-self-serve-'));
  hosted = await startSelfServeServer(root);
});
afterEach(async () => { await hosted?.close(); await rm(root, { recursive: true, force: true }); });

/** Account, code, `join` from a computer, and the browser's fingerprint confirmation. */
async function pairComputer(token, name) {
  const api = sessionApi(hosted.origin, token);
  await api('POST', '/v1/fleet/account', {});
  const pairing = await api('POST', '/v1/fleet/pairings', {});
  let shown = null;
  const joining = joinFleetByCode({ code: pairing.code.toLowerCase().replace('-', ' '), service: hosted.origin, name, pollMs: 20,
    stateDirectory: path.join(root, name), weightsDirectory: path.join(root, 'weights'), onClaimed: value => { shown = value.fingerprint; } });
  let claimed;
  for (let tries = 0; tries < 200 && claimed?.state !== 'claimed'; tries++) {
    claimed = await api('GET', `/v1/fleet/pairings/${pairing.id}`);
    if (claimed.state !== 'claimed') await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(claimed.computer).toMatchObject({ name, fingerprint: shown });
  await expect(api('POST', `/v1/fleet/pairings/${pairing.id}/confirm`, { fingerprint: 'AAAA-AAAA' })).rejects.toMatchObject({ code: 'fingerprint_mismatch' });
  await api('POST', `/v1/fleet/pairings/${pairing.id}/confirm`, { fingerprint: claimed.computer.fingerprint });
  const joined = await joining;
  const identity = JSON.parse(await readFile(joined.identityFile, 'utf8'));
  return { api, joined, identity, pairing };
}

it('a new account pairs a computer by code, earns by serving, spends what it earned and verifies its statement', async () => {
  const alice = await pairComputer('test:alice:verified', 'alice-laptop');
  const bob = await pairComputer('test:bob:anonymous', 'bob-desktop');

  // The written host configuration joins the hosted room under the account, with owner-only secrets.
  const host = JSON.parse(await readFile(alice.joined.hostFile, 'utf8'));
  expect(host).toMatchObject({ schema: 'reploid.fleet-native/v1', computerId: alice.joined.computerId, roomId: 'reploid-swarm-fleet-test',
    serviceUrl: 'http://127.0.0.1/v1/fleet', browserBridge: { port: 18784, origins: [hosted.origin] } });
  expect(host.browserBridge.claim.codeDigest).toMatch(/^[a-f0-9]{64}$/);
  // Every model entry carries the output bound a credited provider needs to start, within the service policy.
  expect(host.models.length).toBeGreaterThan(0);
  for (const entry of host.models) {
    expect(entry.model.generation.maxTokens).toBeGreaterThan(0);
    expect(entry.model.generation.maxTokens).toBeLessThanOrEqual(host.maxOutputTokens);
    expect(() => createFleetExecutionAdmission({ credits: {}, model: entry.model })).not.toThrow();
  }
  expect((await stat(alice.joined.roomTokenFile)).mode & 0o777).toBe(0o600);
  expect(await readFile(alice.joined.roomTokenFile, 'utf8')).toBe('room-token-for-the-self-serve-fleet-test-000000');

  // A verified sign-in starts with bounded starter debt; an anonymous one with none.
  expect((await alice.api('GET', '/v1/fleet/account')).credits).toMatchObject({ balance: 0, debtLimit: 40, spendable: 40 });
  expect((await bob.api('GET', '/v1/fleet/account')).credits).toMatchObject({ balance: 0, debtLimit: 0, spendable: 0 });
  await expect(settleAnswer({ fleetUrl: hosted.fleetUrl, consumer: bob.identity, provider: alice.identity, tokens: 3 }))
    .rejects.toThrow('not enough service credits');

  // Bob earns by serving Alice, then spends what he earned asking Alice's computer.
  expect((await settleAnswer({ fleetUrl: hosted.fleetUrl, consumer: alice.identity, provider: bob.identity, tokens: 12 })).serviceCredit.charge).toBe(12);
  expect((await settleAnswer({ fleetUrl: hosted.fleetUrl, consumer: bob.identity, provider: alice.identity, tokens: 5, maxOutputTokens: 10 })).serviceCredit.charge).toBe(5);
  expect((await bob.api('GET', '/v1/fleet/account')).credits).toMatchObject({ balance: 7, held: 0, spendable: 7 });
  expect((await alice.api('GET', '/v1/fleet/account')).credits).toMatchObject({ balance: -7, spendable: 33 });

  // Each statement checks offline against the keys the person enrolled, and names only accounts it dealt with.
  const statement = await bob.api('GET', '/v1/fleet/statement');
  expect(statement.computers.map(row => row.id).sort()).toEqual([alice.joined.computerId, bob.joined.computerId].sort());
  expect(statement.enrollment).toEqual([expect.objectContaining({ kind: 'computer', entry: expect.objectContaining({ id: bob.joined.computerId }) })]);
  expect(await verifyCreditStatement(statement, { participantIds: [bob.identity.peerId] }))
    .toMatchObject({ ok: true, statedBalance: 7, recomputedBalance: 7, uncheckedCount: 0 });

  // The signed directory shows one account its own balance, never everyone's.
  const snapshot = await createFleetClient({ url: hosted.fleetUrl, identity: bob.identity }).call('snapshot', {});
  expect(snapshot.accounts.map(row => row.id)).toEqual([bob.joined.computerId]);
});

it('a code works once, only for the browser that confirms the fingerprint, and a removed computer key is refused', async () => {
  const alice = await pairComputer('test:alice:verified', 'alice-laptop');
  const stranger = await createSigningIdentity({ algorithm: 'Ed25519' });
  await expect(joinFleetByCode({ code: alice.pairing.code, service: hosted.origin, stateDirectory: path.join(root, 'stranger') }))
    .rejects.toThrow('not valid');
  // Another account cannot read or confirm Alice's pairing.
  const mallory = sessionApi(hosted.origin, 'test:mallory:verified');
  await mallory('POST', '/v1/fleet/account', {});
  await expect(mallory('GET', `/v1/fleet/pairings/${alice.pairing.id}`)).rejects.toMatchObject({ status: 404 });

  // A second computer on the same account shares its balance.
  const second = await alice.api('POST', '/v1/fleet/pairings', {});
  const joining = joinFleetByCode({ code: second.code, service: hosted.origin, name: 'alice-desktop', pollMs: 20, stateDirectory: path.join(root, 'alice-2') });
  let claimed;
  do { claimed = await alice.api('GET', `/v1/fleet/pairings/${second.id}`); } while (claimed.state !== 'claimed');
  await alice.api('POST', `/v1/fleet/pairings/${second.id}/confirm`, { fingerprint: claimed.computer.fingerprint });
  const desktop = await joining;
  expect(desktop.computerId).toBe(alice.joined.computerId);
  expect((await alice.api('GET', '/v1/fleet/account')).computers.map(row => row.name)).toEqual(['alice-laptop', 'alice-desktop']);

  const account = await alice.api('POST', '/v1/fleet/computers/revoke', { participantId: alice.identity.peerId });
  expect(account.computers.find(row => row.participantId === alice.identity.peerId).revokedAt).toEqual(expect.any(Number));
  await expect(createFleetClient({ url: hosted.fleetUrl, identity: alice.identity }).call('statementMine', {})).rejects.toThrow('removed from its account');
  expect(stranger.peerId).not.toBe(alice.identity.peerId);
});

it('the network-wide debt cap bounds what new accounts can owe together', async () => {
  await hosted.close();
  hosted = await startSelfServeServer(path.join(root, 'capped'), { maxTotalDebt: 25 });
  const provider = await pairComputer('test:provider:anonymous', 'provider');
  const first = await pairComputer('test:first:verified', 'first');
  const second = await pairComputer('test:second:verified', 'second');
  await settleAnswer({ fleetUrl: hosted.fleetUrl, consumer: first.identity, provider: provider.identity, tokens: 15 });
  // Second could owe 20 on its own limit, but 15 + 20 holds exceeds the network's 25.
  await expect(settleAnswer({ fleetUrl: hosted.fleetUrl, consumer: second.identity, provider: provider.identity, tokens: 5 }))
    .rejects.toThrow('lent all the starter credit');
});

it('upgrading an anonymous sign-in raises its debt limit once, and replays the enrollment journal on restart', async () => {
  const anon = await pairComputer('test:carol:anonymous', 'carol');
  expect((await anon.api('GET', '/v1/fleet/account')).credits.debtLimit).toBe(0);
  // The same subject now signs in with a verified provider.
  const verified = sessionApi(hosted.origin, 'test:carol:verified');
  expect((await verified('GET', '/v1/fleet/account')).credits.debtLimit).toBe(40);
  await hosted.close(); hosted = null;
  const reopened = await openFleetCredits({ file: path.join(root, 'credits.sqlite'), computers: [], openEnrollment: true,
    policy: selfServeConfiguration(root).creditPolicy });
  try {
    expect(reopened.debtLimitFor(anon.joined.computerId)).toBe(40);
    expect(reopened.enrollmentLog(anon.joined.computerId).map(row => row.kind)).toEqual(['computer', 'debt-limit']);
  } finally { reopened.close(); }
});

it('rate limits pairing claims from one network', async () => {
  await hosted.close();
  hosted = await startSelfServeServer(path.join(root, 'limited'), { limits: { claimsPerClientPerTenMinutes: 2 } });
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(joinFleetByCode({ code: 'ZZZZ-ZZZZ', service: hosted.origin, stateDirectory: path.join(root, 'guess') })).rejects.toThrow('not valid');
  }
  await expect(joinFleetByCode({ code: 'ZZZZ-ZZZZ', service: hosted.origin, stateDirectory: path.join(root, 'guess') })).rejects.toThrow('Too many pairing attempts');
});
