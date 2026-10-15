// @vitest-environment node
// The earning loop through the in-repository composition over real HTTP: a requester signs in through the
// local test flow, tops up on the test checkout page and is quoted and charged for answers run over a route
// of real resident stages; two native contributor devices sign in, record their owner policy, are offered
// and accept stage-share offers for the model and plan they serve, and claim their settled shares; then
// the contributor spends the earned credits from a browser device of the same account. Resident sessions
// stand in for Doppler arithmetic (tests/helpers/resident-route.js); every policy value is test-only.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEarningComposition } from '../../server/earning-composition/index.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import { createNativeEarningStorage, openNativeEarning, readNativeEarningFile } from '../../server/native-earning.js';
import { createHash } from 'node:crypto';
import { MAX_UNACKNOWLEDGED_OUTPUTS, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { CAPACITY_EVIDENCE_SCHEMA as COMMUNITY_CAPACITY_SCHEMA } from '../../server/community-access/domain.js';
import { OPERATORS_SCHEMA } from '../../server/earning-composition/index.js';
import { EVIDENCE_RULES_ID } from '../../server/ledger/domain.js';
import { CAPACITY_EVIDENCE_SCHEMA } from '../../server/rewards/domain.js';
import { openBrowserEarning } from '../../self/host/credits/browser.js';
import { newIdentity } from '../helpers/account-fixture.js';
import { earningPolicy, writeOutsideRepository } from '../helpers/earning-policy-fixture.js';
import { STEPS, residentRoute } from '../helpers/resident-route.js';
import { ownerAuthorization } from '../helpers/reward-fixture.js';

const servers = [], cleanups = [];
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((close) => close()));
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

const webStorage = () => {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
};
const until = async (predicate, label) => {
  for (let i = 0; i < 300; i += 1) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error(`timed out waiting for ${label}`);
};

// Test-only economics: a three-token answer charges 6 + 2 per token = 12 at most; each stage earns 5 of it. Paid and
// Community Access quotes settle from signed receipts and acknowledgments under the same evidence terms.
const MIN = 60_000;
const EVIDENCE = Object.freeze({ rulesId: EVIDENCE_RULES_ID, windowMs: 5 * MIN, clockSkewMs: 30_000, maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS });
const policy = () => {
  const value = earningPolicy();
  const [service] = value.services;
  service.terms.evidence = { ...EVIDENCE };
  value.communityAccess = { policyVersion: 'test-community/1', poolAccountId: 'pool_general', guarantee: { mode: 'none' },
    queue: { maxLength: 4, maxPerAccount: 2, maxWaitMs: 10 * MIN }, usage: { windowMs: 60 * MIN, maxAdmissions: 3, maxAuthorizedCredits: 200 },
    rateLimits: { account: { windowMs: MIN, maxRequests: 5 }, device: { windowMs: MIN, maxRequests: 4 } }, capacity: { evidenceMaxAgeMs: 60 * MIN },
    evidence: { ...EVIDENCE } };
  service.service.limits.output.max = STEPS;
  service.pricing.maxCharge = 6 + 2 * STEPS;
  service.terms.settlement.full = { kind: 'metered', base: 6, rates: [{ meter: 'output', numerator: 2, denominator: 1 }] };
  service.terms.settlement.partialDelivery = { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 2, denominator: 1 }] };
  service.terms.settlement.cancellationDispatched = { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 2, denominator: 1 }] };
  value.offers[0].reward = { basis: { kind: 'test_share_of_settled_charge' }, formula: { kind: 'metered', base: 0, rates: [{ meter: 'settledCharge', numerator: 5, denominator: 12 }] }, maxReward: 5 };
  value.issuance.bases.settled_demand.share = { numerator: 1, denominator: 1 };
  return value;
};

describe('earning loop through the composition', () => {
  let base;
  let directory;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-earning-loop-'));
    const capacity = path.join(directory, 'capacity.json');
    await fs.writeFile(capacity, JSON.stringify({ schema: CAPACITY_EVIDENCE_SCHEMA, evidenceId: 'capacity:test', accountingVersion: 'test-accounting/1',
      serviceCredits: 1_000_000, observedAt: new Date(Date.now() - 1000).toISOString() }));
    const community = path.join(directory, 'community-capacity.json');
    await fs.writeFile(community, JSON.stringify({ schema: COMMUNITY_CAPACITY_SCHEMA, evidenceId: 'community-capacity:test', observedAt: new Date(Date.now() - 1000).toISOString(), admittedSlots: 2 }));
    const composition = await createEarningComposition({ env: {
      REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', policy()), REPLOID_EARNING_STORE: 'memory',
      REPLOID_EARNING_TEST_SIGN_IN: 'enabled', REPLOID_EARNING_TEST_PROCESSOR: 'enabled', REPLOID_EARNING_CAPACITY_FILE: capacity,
      REPLOID_EARNING_COMMUNITY_CAPACITY_FILE: community,
      REPLOID_EARNING_OPERATORS_FILE: await writeOutsideRepository('operators.json', { schema: OPERATORS_SCHEMA,
        operators: [{ actorId: 'funding_admin_test', roles: ['funding'], tokenSha256: createHash('sha256').update('founder-token').digest('hex') }] })
    } });
    const app = express();
    await mountEarningRoutes(app, { env: { REPLOID_EARNING_ROUTES: 'enabled' }, composition, log: { error() {} } });
    installJsonBodyMiddleware(app, {});
    const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    servers.push(server);
    base = `http://127.0.0.1:${server.address().port}`;
    cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  });

  /** A browser device: the composition the app uses, signed in as `subject` through the local flow. */
  const browser = async (subject) => {
    const earning = await openBrowserEarning({ location: new URL(`${base}/`), storage: webStorage(), navigate: () => {} });
    await earning.signIn.useSubject(subject);
    await until(() => earning.account.state().phase === 'ready', `${subject} ready`);
    return earning;
  };

  /** A native contributor device from its native earning file, with durable state beside its identity. */
  const native = async (name) => {
    const file = path.join(directory, `${name}.json`);
    await fs.writeFile(file, JSON.stringify({ schema: 'reploid.native-earning/v1',
      client: { schema: 'reploid.earning-client/v1', enabled: true, baseUrl: `${base}/v1`, providerId: 'local-test' }, signIn: { subject: 'carol' } }));
    const identity = await newIdentity('Ed25519');
    const earning = await openNativeEarning({ settings: await readNativeEarningFile(file), identity, ownerAuthorization,
      storage: createNativeEarningStorage(path.join(directory, `${name}-state.json`)) });
    return { ...earning, signer: createAttemptEvidenceSigner({ identity }) };
  };
  const operator = (route, body, key) => fetch(`${base}/v1${route}`, { method: 'POST', body: JSON.stringify(body),
    headers: { authorization: 'Bearer founder-token', 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then((response) => response.json());

  const send = (earning, route, threadId) => earning.earning.run(
    { threadId, attemptId: `${threadId}:a1`, model: route.model, messages: [{ role: 'user', content: 'Question' }] },
    { requestApproval: async () => true, onState() {}, onDelta() {} }, (request, controls) => route.requester.generate(request, controls));

  it('charges the requester, pays both contributor devices for validated stage shares and spends the earnings from another device', async () => {
    const alice = await browser('alice');
    const [c0, c1] = [await native('carol-0'), await native('carol-1')];
    expect(c0.session.accountId).toBe(c1.session.accountId);
    const routes = new Map();
    const routeFor = async (earning) => {
      if (!routes.has(earning.identity.peerId)) {
        routes.set(earning.identity.peerId, await residentRoute({ participants: [c0.participantId, c1.participantId], requesterId: earning.identity.peerId, signers: [c0.signer, c1.signer] }));
        cleanups.push(() => routes.get(earning.identity.peerId).close());
      }
      return routes.get(earning.identity.peerId);
    };
    const route = await routeFor(alice);
    const admissions = (index) => [...routes.values()].flatMap((row) => row.admissions(index));
    // Each contributor is offered and accepts a stage share for the model and plan it serves, before any work.
    const served = { modelId: route.route.modelId, modelIdentity: route.route.modelIdentity, planId: route.route.planId };
    for (const host of [c0, c1]) expect(await host.observe({ descriptor: served })).toMatchObject({ stages: [] });
    expect((await c0.offers()).length).toBe(1);

    // The requester buys credits, sets a standing limit and is charged for two answers, each settled at once from its acknowledged outputs.
    const started = await alice.account.topUp('test-topup');
    expect((await (await fetch(`${base}${started.checkout.url}/complete`, { method: 'POST' })).text())).toContain('Payment recorded.');
    alice.account.setSpendingLimit('12');
    for (const thread of ['t1', 't2']) expect((await send(alice, route, thread)).content).toBe('012');
    await alice.account.refresh();
    expect(alice.account.state().balance.available).toBe(1000 - 24);
    expect(alice.account.state().lastQuote).toMatchObject({ maxCharge: 12, accepted: true, funding: 'account' });
    expect((await alice.attempts.getThread('t1')).evidence).toBe(true);

    // The founder funds the Community Access pool; a member with no credits is admitted for one answer the pool pays.
    expect(await operator('/operator/funding/commitments', { commitmentId: 'founder_week_1', funderKind: 'operator', funderId: 'founder', externalRef: 'external:founder_week_1',
      amount: 100, unit: { kind: 'credits' }, validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 7 * 24 * 60 * MIN).toISOString() }, 'commit:1'))
      .toMatchObject({ commitmentId: 'founder_week_1' });
    expect(await operator('/operator/funding/community-pools', { fundingId: 'founder_pool_week_1', commitmentId: 'founder_week_1', quantity: 100,
      poolAccountId: 'pool_general', decisionId: 'decision:founder_pool' })).toMatchObject({ status: 'issued' });
    const dave = await browser('dave');
    expect((await send(dave, await routeFor(dave), 't4')).content).toBe('012');
    expect(dave.account.state().lastQuote).toMatchObject({ funding: 'community_access' });
    expect((await dave.attempts.getThread('t4'))).toMatchObject({ status: 'settled', communityAccess: { poolAccountId: 'pool_general' } });
    await dave.account.refresh();
    expect(dave.account.state().balance.available).toBe(0);

    // Contributors submit their receipts and claim their settled stage shares from their own admission records.
    const results = [await c0.observe({ admissions: admissions(0) }), await c1.observe({ admissions: admissions(1) })];
    expect(results.flatMap((row) => row.stages).map((row) => [row.outcome, row.issuance])).toEqual(Array(6).fill(['accepted', 'issued']));
    expect(results.flatMap((row) => row.evidence).every((row) => row.status === 'done')).toBe(true);

    // The same account on a browser device sees the earned credits and spends them.
    const desk = await browser('carol');
    expect(desk.account.state()).toMatchObject({ accountId: c0.session.accountId, balance: { available: 30, byProvenance: { earned: { available: 30 } } } });
    desk.account.setSpendingLimit('12');
    expect((await send(desk, await routeFor(desk), 't3')).content).toBe('012');
    await desk.account.refresh();
    expect(desk.account.state().balance.available).toBe(18);
    // Newest first: the full hold is charged, after six earned stage shares.
    expect(desk.account.state().journal.map((entry) => [entry.type, entry.amount, entry.lots[0]?.provenance]).slice(0, 3)).toEqual([
      ['charge', 12, 'earned'], ['reserve', 12, 'earned'], ['issue', 5, 'earned']]);
    // Its own demand earns its devices nothing.
    const own = await c0.observe({ admissions: admissions(0) });
    expect(own.stages.at(-1)).toMatchObject({ outcome: 'rejected' });
  });

  it('declines a quote above the standing limit and sends nothing', async () => {
    const alice = await browser('alice');
    const [c0, c1] = [await native('carol-0'), await native('carol-1')];
    const route = await residentRoute({ participants: [c0.participantId, c1.participantId], requesterId: alice.identity.peerId, signers: [c0.signer, c1.signer] });
    cleanups.push(() => route.close());
    // With purchased credits, the standing limit decides: Community Access is for answers the balance cannot cover.
    const started = await alice.account.topUp('test-topup');
    await fetch(`${base}${started.checkout.url}/complete`, { method: 'POST' });
    alice.account.setSpendingLimit('11');
    await expect(send(alice, route, 't1')).rejects.toMatchObject({ code: 'spending_declined' });
    expect(route.admissions(0)).toEqual([]);
    expect(alice.account.state().lastQuote).toMatchObject({ maxCharge: 12, accepted: false, funding: 'account' });
  });
}, 60_000);
