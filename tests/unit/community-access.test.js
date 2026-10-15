import { beforeEach, describe, expect, it } from 'vitest';

import { CAPACITY_EVIDENCE_SCHEMA, validateCommunityAccessPolicy } from '../../server/community-access/domain.js';
import { createCommunityAccess, createFundingIssuanceAuthority } from '../../server/community-access/engine.js';
import { COMMUNITY_ACCESS_OPERATIONS, validateCommunityAccessContract } from '../../server/community-access/store-contract.js';
import {
  MIN, accounts, advance, at, clock, composeIssuance, decidedBy, deliver, fundingAuthority, fx, harnesses, journalShape, quoteTerms, rejectsWith, resetFixture
} from '../helpers/access-fixture.js';

// Test-only limits. The guarantee mode, limits and funding are open product decisions.
const POLICY = Object.freeze({
  policyVersion: 'test-community/1',
  poolAccountId: 'pool_general',
  guarantee: { mode: 'none' },
  queue: { maxLength: 4, maxPerAccount: 2, maxWaitMs: 10 * MIN },
  usage: { windowMs: 60 * MIN, maxAdmissions: 3, maxAuthorizedCredits: 200 },
  rateLimits: { account: { windowMs: MIN, maxRequests: 5 }, device: { windowMs: MIN, maxRequests: 4 } },
  capacity: { evidenceMaxAgeMs: 5 * MIN }
});
const FLOOR_POLICY = Object.freeze({
  ...POLICY,
  guarantee: {
    mode: 'funded_floor',
    floor: {
      poolAccountId: 'pool_floor',
      fundingIds: ['floor:operator:1'],
      admissionsPerAccount: 1,
      reservedSlots: 1,
      reliabilityCoverage: { evidenceRef: 'coverage:test' },
      shortfall: 'unavailable'
    }
  }
});

const MEMBERS = ['alice', 'bob', 'carol', 'dave'];
const capacity = (admittedSlots, extra = {}) => {
  fx.capacity = { schema: CAPACITY_EVIDENCE_SCHEMA, evidenceId: `capacity:${admittedSlots}`, observedAt: clock(), admittedSlots, ...extra };
};

describe.each(Object.keys(harnesses))('Community Access (%s store)', (kind) => {
  let harness;
  let ledger;
  let access;
  let seq;

  const open = (policy = POLICY) => {
    const backend = harness.openCommunityBackend();
    ledger = harness.openLedger({ issuanceAuthority: composeIssuance({ community_access: createFundingIssuanceAuthority({ backend, policy }) }) });
    access = createCommunityAccess({ backend, ledger, accounts, readCommunityCapacity: async () => fx.capacity, policy, fundingAuthority, clock });
  };
  // Each funding draws its whole quantity from its own registered commitment.
  const fund = async (quantity, { fundingId = `funding:${quantity}`, funderKind = 'donor', poolAccountId = 'pool_general' } = {}) => {
    const commitmentId = `commitment:${fundingId}`;
    if (!await ledger.getFundingCommitment(commitmentId)) {
      await ledger.recordFundingCommitment({
        commitmentId, funderKind, funderId: `${funderKind}_test`, externalRef: `external:${fundingId}`, amount: quantity,
        unit: { kind: 'credits' }, validFrom: clock(), validUntil: at(30 * 24 * 60 * MIN), idempotencyKey: `commit:${fundingId}`
      });
    }
    return access.recordFunding({ fundingId, commitmentId, quantity, poolAccountId, authority: decidedBy(`decision:${fundingId}`) });
  };
  const request = (member, { device = `${member}-phone`, requestId = `r${++seq}:${member}` } = {}) => access.requestAccess({
    requestId, participantId: `peer_${member}`, deviceId: device, quote: quoteTerms()
  });
  const finish = async (view) => {
    await deliver(ledger, view.reservationId);
    return access.admitWaiting();
  };

  beforeEach(async () => {
    resetFixture();
    seq = 0;
    harness = harnesses[kind]();
    open();
    for (const member of MEMBERS) {
      fx.participants.set(`peer_${member}`, `acct_${member}`);
      await ledger.openAccount({ accountId: `acct_${member}`, ownerId: `uid_${member}` });
    }
  });

  it('implements the store contract and requires an explicit guarantee switch', () => {
    expect(validateCommunityAccessContract(access)).toEqual({ ok: true, missing: [] });
    expect(COMMUNITY_ACCESS_OPERATIONS).toContain('admitWaiting');
    const invalid = (policy) => expect(() => validateCommunityAccessPolicy(policy)).toThrow(expect.objectContaining({ code: 'invalid_policy' }));
    invalid({ ...POLICY, guarantee: undefined });
    invalid({ ...POLICY, guarantee: { mode: 'funded_floor' } });
    invalid({ ...POLICY, guarantee: { mode: 'none', floor: FLOOR_POLICY.guarantee.floor } });
    invalid({ ...FLOOR_POLICY, guarantee: { mode: 'funded_floor', floor: { ...FLOOR_POLICY.guarantee.floor, reliabilityCoverage: undefined } } });
    expect(validateCommunityAccessPolicy(FLOOR_POLICY).guarantee.floor.shortfall).toBe('unavailable');
  });

  it('records donor and operator funding with provenance in pool accounts, never member accounts', async () => {
    const donor = await fund(300, { fundingId: 'donation:1' });
    expect(donor).toMatchObject({ status: 'issued', funderKind: 'donor', poolAccountId: 'pool_general', quantity: 300 });
    expect(await fund(300, { fundingId: 'donation:1' })).toEqual(donor);
    await rejectsWith(fund(301, { fundingId: 'donation:1' }), 'funding_conflict');
    const operator = await fund(200, { fundingId: 'operator:1', funderKind: 'operator' });
    await rejectsWith(fund(50, { fundingId: 'donation:2', poolAccountId: 'acct_alice' }), 'not_a_pool_account');
    await rejectsWith(fund(50, { fundingId: 'donation:3', funderKind: 'sponsor' }), 'invalid_commitment');
    expect(await ledger.getLot(donor.lotId)).toMatchObject({
      provenance: 'community_access', accountId: 'pool_general', quantity: 300,
      source: { fundingId: 'donation:1', funderKind: 'donor', funderId: 'donor_test', commitmentId: 'commitment:donation:1', allocationId: donor.allocationId }
    });
    expect(await ledger.getAccount('pool_general')).toMatchObject({ available: 500, byProvenance: { community_access: { issued: 500 }, purchased: { issued: 0 }, earned: { issued: 0 } } });
    // Community Access credit cannot be minted into a member account by any path.
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'community_access', amount: 10, idempotencyKey: 'mint:member',
      source: { fundingId: 'operator:1', funderId: 'operator_test', funderKind: 'operator', commitmentId: 'commitment:operator:1', allocationId: operator.allocationId }
    }), 'issuance_not_authorized');
  });

  it('issues nothing transferable at registration or through access', async () => {
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 0, held: 0, openLots: [], transfersEnabled: false });
    await fund(300);
    capacity(2);
    const view = await request('alice');
    expect(view).toMatchObject({ state: 'available', accountId: 'acct_alice', poolAccountId: 'pool_general', authorizedMax: 60 });
    expect((await ledger.getReservation(view.reservationId)).accountId).toBe('pool_general');
    await finish(view);
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 0, held: 0, openLots: [] });
    expect(await journalShape(ledger, 'acct_alice')).toEqual([]);
    expect(await ledger.getAccount('pool_general')).toMatchObject({ available: 270, byProvenance: { community_access: { spent: 30 } } });
    await rejectsWith(ledger.transferCredits({ fromAccountId: 'pool_general', toAccountId: 'acct_alice', amount: 1 }), 'transfers_disabled');
  });

  it('shows available, queued and unavailable states under funded and admitted capacity', async () => {
    const probe = (index) => request('dave', { device: `dave-probe-${index}` });
    expect(await probe(1)).toMatchObject({ state: 'unavailable', reason: 'capacity_evidence_unavailable', retry: 'explicit' });
    capacity(1, { observedAt: at(-6 * MIN) });
    expect(await probe(2)).toMatchObject({ state: 'unavailable', reason: 'capacity_evidence_stale' });
    capacity(0);
    expect(await probe(3)).toMatchObject({ state: 'unavailable', reason: 'no_admitted_capacity' });
    capacity(1, { meanOccupancyMs: 2 * MIN });
    expect(await probe(4)).toMatchObject({ state: 'unavailable', reason: 'unfunded' });

    await fund(500);
    expect(await access.describeAvailability({ participantId: 'peer_bob', deviceId: 'bob-phone', maxCharge: 60 }))
      .toMatchObject({ state: 'available', guarantee: 'none', completion: 'not_guaranteed' });
    const admitted = await request('alice');
    expect(admitted).toMatchObject({ state: 'available', guarantee: 'none', completion: 'not_guaranteed', reservationId: expect.any(String) });
    const queued = await request('bob');
    expect(queued).toMatchObject({ state: 'queued', position: 1, estimatedWaitMs: 2 * MIN, completion: 'not_guaranteed', queuedUntil: at(10 * MIN) });
    expect(await access.describeAvailability({ participantId: 'peer_carol', deviceId: 'carol-phone', maxCharge: 60 }))
      .toMatchObject({ state: 'queued', position: 2, estimatedWaitMs: 4 * MIN });
    const late = await request('carol');

    await finish(admitted);
    expect(await access.getRequest(admitted.requestId)).toMatchObject({ state: 'completed', outcome: 'settled', charge: 30 });
    expect(await access.getRequest(queued.requestId)).toMatchObject({ state: 'available' });
    // Queue access promises no eventual answer: past the wait it asks for explicit retry.
    advance(11 * MIN);
    capacity(1);
    await access.admitWaiting();
    expect(await access.getRequest(late.requestId)).toMatchObject({ state: 'unavailable', reason: 'queue_wait_exceeded', retry: 'explicit' });
  });

  it('serves accounts in fair turns rather than arrival order', async () => {
    await fund(1000);
    capacity(1);
    const busy = await request('dave');
    const [a1, a2] = [await request('alice'), await request('alice')];
    const b1 = await request('bob');
    const c1 = await request('carol');
    const positions = await Promise.all([a1, a2, b1, c1].map((view) => access.getRequest(view.requestId)));
    expect(positions.map((view) => view.position)).toEqual([1, 4, 2, 3]);

    const served = [];
    let current = busy;
    for (let turn = 0; turn < 4; turn += 1) {
      await finish(current);
      const views = await Promise.all([a1, a2, b1, c1].map((view) => access.getRequest(view.requestId)));
      current = views.find((view) => view.state === 'available');
      served.push(current.requestId);
    }
    expect(served).toEqual([a1.requestId, b1.requestId, c1.requestId, a2.requestId]);
  });

  it('enforces per-account usage limits, queue caps and account and device rate limits', async () => {
    await fund(2000);
    capacity(5);
    for (let index = 0; index < 3; index += 1) await finish(await request('alice'));
    expect(await request('alice', { device: 'alice-laptop' })).toMatchObject({
      state: 'unavailable', reason: 'usage_limit_reached', resetsAt: at(60 * MIN), retry: 'explicit'
    });
    // The account limit counts every device: a fifth and sixth request, then refusal.
    expect(await request('alice', { device: 'alice-tablet' })).toMatchObject({ reason: 'usage_limit_reached' });
    const throttled = await request('alice', { device: 'alice-watch', requestId: 'r:throttled' });
    expect(throttled).toMatchObject({ state: 'unavailable', reason: 'rate_limited', scope: 'account', retryAfter: at(MIN) });
    expect(await access.getRequest('r:throttled')).toBeNull();

    advance(MIN);
    capacity(1);
    const holder = await request('bob', { device: 'shared-kiosk' });
    expect(await request('bob', { device: 'shared-kiosk' })).toMatchObject({ state: 'queued' });
    expect(await request('bob', { device: 'shared-kiosk' })).toMatchObject({ state: 'queued' });
    expect(await request('bob', { device: 'shared-kiosk' })).toMatchObject({ state: 'unavailable', reason: 'account_queue_full' });
    expect(await request('carol', { device: 'shared-kiosk' })).toMatchObject({ state: 'unavailable', reason: 'rate_limited', scope: 'device' });
    expect(await request('carol')).toMatchObject({ state: 'queued' });
    expect(await request('carol')).toMatchObject({ state: 'queued' });
    expect(await request('dave')).toMatchObject({ state: 'unavailable', reason: 'queue_full' });
    expect(holder.state).toBe('available');

    // A new usage window admits Alice again.
    advance(60 * MIN);
    capacity(5);
    expect(await request('alice', { device: 'alice-watch' })).toMatchObject({ state: 'available' });
  });

  it('records Community Access consumption as subsidy in solvency', async () => {
    await fund(100, { fundingId: 'donation:1' });
    advance(MIN);
    await fund(100, { fundingId: 'operator:1', funderKind: 'operator' });
    capacity(2);
    const first = await request('alice');
    const receipt = await deliver(ledger, first.reservationId);
    await ledger.refundSettlement({
      reservationId: first.reservationId, refundId: 'refund:community', amount: 10, idempotencyKey: 'refund:community',
      authority: { kind: 'operator_adjustment', decisionId: 'decision:1', actorId: 'operator_test' }
    });
    const second = await request('bob');
    await deliver(ledger, second.reservationId, { output: 100 });
    expect(receipt.chargedLots.map((lot) => lot.provenance)).toEqual(['community_access']);

    const snapshot = await ledger.getSolvencySnapshot();
    expect(snapshot.subsidy).toEqual({ communityAccessConsumed: 80, subsidizedRewardsIssued: 0, reversalAbsorbed: 0 });
    expect(snapshot.spent.byProvenance).toMatchObject({ community_access: 90, earned: 0, purchased: 0, subsidized: 0 });
    const report = await access.getSubsidyReport();
    expect(report).toMatchObject({
      guarantee: 'none',
      funded: { total: 200, byFunderKind: { donor: 100, operator: 100 } },
      consumed: { total: 80, byFunderKind: { donor: 80, operator: 0 } },
      pools: [{ poolAccountId: 'pool_general', available: 120, held: 0 }],
      solvencySubsidy: { communityAccessConsumed: 80 }
    });
    for (const member of ['alice', 'bob']) expect(await ledger.getAccount(`acct_${member}`)).toMatchObject({ available: 0, openLots: [] });
  });

  it('under a funded floor admits floor requests to reserved slots and applies the declared shortfall', async () => {
    open(FLOOR_POLICY);
    await fund(300);
    await fund(100, { fundingId: 'floor:operator:1', funderKind: 'operator', poolAccountId: 'pool_floor' });
    capacity(2);
    const alice = await request('alice');
    expect(alice).toMatchObject({ state: 'available', guarantee: 'funded_floor', poolAccountId: 'pool_floor', completion: 'not_guaranteed' });
    // The reserved slot is taken, so Bob's floor-eligible request uses the general slot without a guarantee.
    const bob = await request('bob');
    expect(bob).toMatchObject({ state: 'available', guarantee: 'none', poolAccountId: 'pool_general' });
    const aliceAgain = await request('alice');
    const carol = await request('carol');
    // Carol has not used her floor admission, so she is ahead of Alice's second request.
    expect([(await access.getRequest(carol.requestId)).position, (await access.getRequest(aliceAgain.requestId)).position]).toEqual([1, 2]);
    await finish(alice);
    expect(await access.getRequest(carol.requestId)).toMatchObject({ state: 'available', guarantee: 'funded_floor' });
    await finish(bob);
    expect(await access.getRequest(aliceAgain.requestId)).toMatchObject({ state: 'available', guarantee: 'none' });

    // The floor pool now holds 100 - 30 - 30 = 40, short of Dave's maximum: this floor declares `unavailable`.
    await finish(await access.getRequest(carol.requestId));
    expect(await ledger.getAccount('pool_floor')).toMatchObject({ available: 40 });
    expect(await request('dave')).toMatchObject({ state: 'unavailable', reason: 'floor_shortfall', cause: 'floor_unfunded', retry: 'explicit' });

    // Admitted capacity below the reserved slots is a shortfall too; a floor declaring `queue` queues instead.
    open({ ...FLOOR_POLICY, guarantee: { mode: 'funded_floor', floor: { ...FLOOR_POLICY.guarantee.floor, reservedSlots: 3, shortfall: 'queue' } } });
    capacity(2);
    expect(await request('dave', { device: 'dave-laptop' })).toMatchObject({ state: 'queued', guarantee: 'funded_floor', completion: 'not_guaranteed' });
  });
});
