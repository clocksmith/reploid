import { beforeEach, describe, expect, it } from 'vitest';

import { createCommunityAccess, createFundingIssuanceAuthority } from '../../server/community-access/engine.js';
import { createFirestoreCommunityAccessBackend, createMemoryCommunityAccessBackend } from '../../server/community-access/stores.js';
import { createFirestoreLedgerStore } from '../../server/ledger/firestore-store.js';
import { createMemoryLedgerState, createMemoryLedgerStore } from '../../server/ledger/memory-store.js';
import { composeContributionRewards } from '../../server/rewards/engine.js';
import { createFirestoreRewardBackend, createMemoryRewardBackend } from '../../server/rewards/stores.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import {
  LEDGER_POLICY, MIN, START, advance, at, clock, composition, demand, fx, otherProvenance, rejectsWith
} from '../helpers/reward-fixture.js';

// Test-only values. No amount, validity or limit here is a funding or product decision.
const DAY = 24 * 60 * MIN;
const ACCESS_POLICY = Object.freeze({
  policyVersion: 'test-community/1',
  poolAccountId: 'pool_general',
  guarantee: { mode: 'none' },
  queue: { maxLength: 4, maxPerAccount: 2, maxWaitMs: 10 * MIN },
  usage: { windowMs: 60 * MIN, maxAdmissions: 3, maxAuthorizedCredits: 200 },
  rateLimits: { account: { windowMs: MIN, maxRequests: 5 }, device: { windowMs: MIN, maxRequests: 4 } },
  capacity: { evidenceMaxAgeMs: 5 * MIN }
});
const COMPONENTS = ['ledger', 'reward', 'community'];
const NO_USE = { reward_funding: 0, community_access_pool: 0 };
const crash = (message) => () => { throw new Error(message); };

const fireOnce = (faults, point) => () => {
  const fault = faults[point];
  faults[point] = null;
  if (fault) fault();
};

// Concurrent transactions in the Firestore double run at different speeds, so a
// slower one holds reads that another commit makes stale and must retry.
const staggered = (firestore) => {
  let started = 0;
  const lagTicks = () => new Promise((resolve) => setImmediate(resolve));
  return {
    collection: firestore.collection,
    runTransaction: (operation) => {
      const lag = started % 3;
      started += 1;
      return firestore.runTransaction((transaction) => operation({
        async get(ref) {
          const snapshot = await transaction.get(ref);
          for (let tick = 0; tick < lag; tick += 1) await lagTicks();
          return snapshot;
        },
        set: (ref, data) => transaction.set(ref, data),
        create: (ref, data) => transaction.create(ref, data)
      }));
    }
  };
};

// Durable state per component; every open() models a (re)started process over it.
// faults.<component>.beforeCommit / afterCommit fire once on that component's next commit.
const harnesses = {
  memory: () => {
    const states = Object.fromEntries(COMPONENTS.map((name) => [name, createMemoryLedgerState()]));
    const faults = Object.fromEntries(COMPONENTS.map((name) => [name, { beforeCommit: null, afterCommit: null }]));
    const hooks = (name) => ({ beforeCommit: fireOnce(faults[name], 'beforeCommit'), afterCommit: fireOnce(faults[name], 'afterCommit') });
    return {
      faults,
      retries: () => null,
      ledger: (options) => createMemoryLedgerStore({ state: states.ledger, hooks: hooks('ledger'), policy: LEDGER_POLICY, clock, ...options }),
      reward: () => createMemoryRewardBackend({ state: states.reward, hooks: hooks('reward') }),
      community: () => createMemoryCommunityAccessBackend({ state: states.community, hooks: hooks('community') })
    };
  },
  firestore: () => {
    const dbs = Object.fromEntries(COMPONENTS.map((name) => [name, createFakeFirestore()]));
    const ledgerDb = staggered(dbs.ledger);
    return {
      faults: Object.fromEntries(COMPONENTS.map((name) => [name, dbs[name].faults])),
      retries: () => dbs.ledger.stats.retries,
      ledger: (options) => createFirestoreLedgerStore({ firestore: ledgerDb, collectionPrefix: 'test', policy: LEDGER_POLICY, clock, ...options }),
      reward: () => createFirestoreRewardBackend({ firestore: dbs.reward, collectionPrefix: 'test' }),
      community: () => createFirestoreCommunityAccessBackend({ firestore: dbs.community, collectionPrefix: 'test' })
    };
  }
};

/** One process: the ledger (and its funding register) with rewards and Community Access over their own stores. */
const openServices = (harness) => {
  const communityBackend = harness.community();
  const poolAuthority = createFundingIssuanceAuthority({ backend: communityBackend, policy: ACCESS_POLICY });
  const rewardBackend = harness.reward();
  const { ledger, rewards, issuanceAuthority } = composeContributionRewards({
    ...composition,
    backend: rewardBackend,
    createLedger: ({ issuanceAuthority: authority }) => harness.ledger({ issuanceAuthority: authority }),
    otherProvenance: (request) => (request.provenance === 'community_access' ? poolAuthority(request) : otherProvenance(request))
  });
  const access = createCommunityAccess({
    backend: communityBackend, ledger, policy: ACCESS_POLICY, clock,
    accounts: { participantAccount: async () => null }, readCommunityCapacity: async () => null
  });
  return { ledger, rewards, access, rewardBackend, issuanceAuthority };
};

const commitment = (ledger, { commitmentId = 'commitment_1', funderKind = 'operator', amount = 100, validForMs = DAY, externalRef = `external:${commitmentId}`, unit = { kind: 'credits' } } = {}) => (
  ledger.recordFundingCommitment({
    commitmentId, funderKind, funderId: `${funderKind}_test`, externalRef, amount, unit,
    validFrom: clock(), validUntil: at(validForMs), idempotencyKey: `commit:${commitmentId}`
  })
);
const reserve = (rewards, { fundingId, commitmentId = 'commitment_1', amount, ...rest }) => rewards.reserveFunding({
  fundingId, commitmentId, amount, categories: ['prepared_readiness'], idempotencyKey: `reserve:${fundingId}`, ...rest
});
const pool = (access, { fundingId, commitmentId = 'commitment_1', quantity, ...rest }) => access.recordFunding({
  fundingId, commitmentId, quantity, poolAccountId: 'pool_general', ...rest
});
// An accepted validation awaiting issuance, as validateWork leaves it; the allocation reads only these fields.
const pendingValidation = (backend, validationId, amount) => backend.runTransaction(async (tx) => {
  tx.create('validations', validationId, {
    validationId, outcome: 'accepted', issuanceStatus: 'pending', category: 'prepared_readiness',
    workId: `rdy_${validationId}`, reward: { amount }, offer: { accountId: 'acct_c1' }
  });
});

describe.each(Object.keys(harnesses))('funding-commitment register (%s store)', (kind) => {
  let harness;
  let services;
  const open = () => openServices(harness);

  beforeEach(() => {
    fx.nowMs = START;
    fx.capacity = { evidenceId: 'capacity:test', serviceCredits: 100_000, observedAt: null };
    harness = harnesses[kind]();
    services = open();
  });

  it('funds a reward reservation and a Community Access pool from one commitment without exceeding it', async () => {
    const { ledger, rewards, access } = services;
    await commitment(ledger, { amount: 100 });
    const reserved = await reserve(rewards, { fundingId: 'funding_reward', amount: 40 });
    expect(reserved).toMatchObject({
      status: 'active', commitmentId: 'commitment_1', funderKind: 'operator', funderId: 'operator_test', amount: 40, authorized: 0, allocationId: expect.any(String)
    });
    const pooled = await pool(access, { fundingId: 'funding_pool', quantity: 60 });
    expect(pooled).toMatchObject({ status: 'issued', funderKind: 'operator', funderId: 'operator_test', allocationId: expect.any(String) });
    expect(await ledger.getLot(pooled.lotId)).toMatchObject({
      provenance: 'community_access', accountId: 'pool_general', quantity: 60, source: { commitmentId: 'commitment_1', allocationId: pooled.allocationId }
    });
    expect(await ledger.getFundingAllocation(pooled.allocationId)).toMatchObject({ use: 'community_access_pool', status: 'consumed', consumedCredits: 60, lotId: pooled.lotId });
    expect(await ledger.getFundingAllocation(reserved.allocationId)).toMatchObject({ use: 'reward_funding', status: 'active', credits: 40 });
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ status: 'active', amount: 100, allocated: 100, unallocated: 0, allocations: 2 });

    // The same commitment cannot be recorded again through either use: the register has nothing left.
    await rejectsWith(reserve(rewards, { fundingId: 'funding_reward_2', amount: 1 }), 'allocation_exceeds_commitment');
    await rejectsWith(pool(access, { fundingId: 'funding_pool_2', quantity: 1 }), 'allocation_exceeds_commitment');
    expect(await rewards.getFunding('funding_reward_2')).toMatchObject({ status: 'refused', refusal: { code: 'allocation_exceeds_commitment', details: { remaining: 0 } } });
    expect(await access.getFunding('funding_pool_2')).toMatchObject({ status: 'refused', refusal: { code: 'allocation_exceeds_commitment' } });
    await rejectsWith(rewards.releaseFunding({ fundingId: 'funding_reward_2' }), 'funding_not_active');
    // Replays converge on the original allocations; issued pool funding cannot be released back.
    expect(await reserve(rewards, { fundingId: 'funding_reward', amount: 40 })).toMatchObject({ status: 'active', allocationId: reserved.allocationId });
    expect(await pool(access, { fundingId: 'funding_pool', quantity: 60 })).toEqual(pooled);
    await rejectsWith(ledger.releaseFundingAllocation({ allocationId: pooled.allocationId, consumedCredits: 0, closure: 'released', idempotencyKey: 'release:pool' }), 'allocation_closed');

    // Solvency reports the commitment, allocations by use and what is unallocated, beside the subsidy block.
    await demand(ledger, { quoteId: 'q_pool', accountId: 'pool_general' });
    const snapshot = await ledger.getSolvencySnapshot();
    expect(snapshot.funding).toEqual({
      commitments: { count: 1, pending: 0, active: 1, expired: 0 },
      allocations: { count: 2, active: 1, consumed: 1, released: 0, expired: 0 },
      byUnit: [{
        unit: { kind: 'credits', name: 'credit' },
        committed: { total: 100, byFunderKind: { operator: 100, community: 0, donor: 0 } },
        allocated: { total: 100, byUse: { reward_funding: 40, community_access_pool: 60 } },
        returned: 0,
        unallocated: { available: 0, notYetValid: 0, lapsed: 0 }
      }],
      creditsAllocated: { total: 100, byUse: { reward_funding: 40, community_access_pool: 60 } }
    });
    // Pool allocations are exactly the issued Community Access credit; the subsidy block discloses what pools spent of it.
    expect(snapshot.funding.creditsAllocated.byUse.community_access_pool).toBe(snapshot.issued.byProvenance.community_access);
    expect(snapshot.subsidy).toMatchObject({ communityAccessConsumed: 30, subsidizedRewardsIssued: 0 });
  });

  it('refuses over-allocation, unaccepted funders and concurrent allocations past the total', async () => {
    const { ledger, rewards, access } = services;
    await commitment(ledger, { amount: 100 });
    const both = await Promise.allSettled([
      reserve(rewards, { fundingId: 'funding_reward', amount: 70 }),
      pool(access, { fundingId: 'funding_pool', quantity: 70 })
    ]);
    expect(both.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(both.find((result) => result.status === 'rejected').reason).toMatchObject({
      code: 'allocation_exceeds_commitment', details: { committed: 100, allocated: 70, requested: 70, remaining: 30 }
    });
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ allocated: 70, allocations: 1 });

    await commitment(ledger, { commitmentId: 'commitment_race', amount: 100 });
    const racing = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => ledger.allocateFunding({
      commitmentId: 'commitment_race', use: 'reward_funding', useRef: `race_${index}`, credits: 30, funderKinds: ['operator'], idempotencyKey: `race:${index}`
    })));
    expect(racing.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(racing.filter((result) => result.status === 'rejected').map((result) => result.reason.code))
      .toEqual(['allocation_exceeds_commitment', 'allocation_exceeds_commitment']);
    const allocations = await ledger.listFundingAllocations({ commitmentId: 'commitment_race' });
    expect(allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(90);
    expect(await ledger.getFundingCommitment('commitment_race')).toMatchObject({ allocated: 90, allocations: 3, unallocated: 10 });
    // On Firestore the racing transactions really contended: stale commitment reads were retried.
    if (harness.retries() !== null) expect(harness.retries()).toBeGreaterThan(0);

    // Each use names the funder kinds it accepts; the commitment's kind decides.
    await commitment(ledger, { commitmentId: 'commitment_donor', funderKind: 'donor', amount: 50 });
    await commitment(ledger, { commitmentId: 'commitment_community', funderKind: 'community', amount: 50 });
    await rejectsWith(reserve(rewards, { fundingId: 'funding_donor', commitmentId: 'commitment_donor', amount: 10 }), 'funder_kind_not_accepted');
    await rejectsWith(pool(access, { fundingId: 'funding_community', commitmentId: 'commitment_community', quantity: 10 }), 'funder_kind_not_accepted');
    await rejectsWith(pool(access, { fundingId: 'funding_missing', commitmentId: 'commitment_missing', quantity: 10 }), 'commitment_not_found');
    expect(await pool(access, { fundingId: 'funding_donor_pool', commitmentId: 'commitment_donor', quantity: 50 })).toMatchObject({ status: 'issued', funderKind: 'donor' });
  });

  it('records each external reference once', async () => {
    const { ledger } = services;
    const first = await commitment(ledger, { externalRef: 'grant:2026-10' });
    expect(first).toMatchObject({ status: 'active', funderKind: 'operator', unit: { kind: 'credits', name: 'credit' }, amount: 100, allocated: 0, unallocated: 100 });
    expect(await commitment(ledger, { externalRef: 'grant:2026-10' })).toEqual(first);
    await rejectsWith(commitment(ledger, { commitmentId: 'commitment_2', externalRef: 'grant:2026-10' }), 'duplicate_commitment_reference');
    // Different terms do not make the same external reference a new commitment.
    await rejectsWith(commitment(ledger, { commitmentId: 'commitment_3', funderKind: 'donor', amount: 7, externalRef: 'grant:2026-10' }), 'duplicate_commitment_reference');
    await rejectsWith(ledger.recordFundingCommitment({
      commitmentId: 'commitment_1', funderKind: 'operator', funderId: 'operator_test', externalRef: 'grant:other', amount: 100,
      unit: { kind: 'credits' }, validFrom: clock(), validUntil: at(DAY), idempotencyKey: 'commit:again'
    }), 'commitment_exists');
    const raced = await Promise.allSettled(['commitment_4', 'commitment_5'].map((commitmentId) => commitment(ledger, { commitmentId, externalRef: 'grant:2026-11' })));
    expect(raced.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(raced.find((result) => result.status === 'rejected').reason).toMatchObject({ code: 'duplicate_commitment_reference' });
    await rejectsWith(commitment(ledger, { commitmentId: 'commitment_6', funderKind: 'sponsor' }), 'invalid_commitment');
    await rejectsWith(commitment(ledger, { commitmentId: 'commitment_7', unit: { kind: 'currency', currency: 'dollars' } }), 'invalid_commitment');
    await rejectsWith(commitment(ledger, { commitmentId: 'commitment_8', validForMs: 0 }), 'invalid_commitment');
  });

  it('returns unused allocation on release and on expiry, and stops drawing at expiry', async () => {
    const { ledger, rewards, access, rewardBackend, issuanceAuthority } = services;
    await commitment(ledger, { amount: 100 });
    await reserve(rewards, { fundingId: 'funding_released', amount: 30 });
    const expiring = await reserve(rewards, { fundingId: 'funding_expiring', amount: 50 });
    expect(await rewards.releaseFunding({ fundingId: 'funding_released' })).toMatchObject({ status: 'released', consumedCredits: 0, returned: 30 });
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ allocated: 50, returned: 30, unallocated: 50 });
    // Returned funding can be allocated again.
    expect(await pool(access, { fundingId: 'funding_pool', quantity: 50 })).toMatchObject({ status: 'issued' });
    await rejectsWith(rewards.releaseFunding({ fundingId: 'funding_unknown' }), 'funding_not_found');

    // A subsidized reward allowance draws on the active reservation while the commitment is valid.
    await pendingValidation(rewardBackend, 'val_before', 5);
    expect(await issuanceAuthority.allocate('val_before')).toMatchObject({ basis: 'funded_reservation', funding: { fundingId: 'funding_expiring', commitmentId: 'commitment_1' } });
    await rejectsWith(ledger.releaseFundingAllocation({
      allocationId: expiring.allocationId, consumedCredits: 5, closure: 'expired', idempotencyKey: 'expire:early'
    }), 'commitment_not_expired');

    advance(DAY);
    // After the commitment's validity nothing new is allocated and the reservation is not drawn on.
    await rejectsWith(reserve(rewards, { fundingId: 'funding_late', amount: 1 }), 'commitment_expired');
    await pendingValidation(rewardBackend, 'val_after', 5);
    await expect(issuanceAuthority.allocate('val_after')).rejects.toMatchObject({
      code: 'issuance_not_authorized', details: { reason: 'funding_exhausted' }
    });
    expect(await rewards.resumeFunding()).toEqual([{ fundingId: 'funding_expiring', status: 'expired', returned: 45 }]);
    expect(await rewards.resumeFunding()).toEqual([]);
    expect(await rewards.getFunding('funding_expiring')).toMatchObject({ status: 'expired', closure: 'expired', consumedCredits: 5, authorized: 5 });
    expect(await ledger.getFundingAllocation(expiring.allocationId)).toMatchObject({ status: 'expired', consumedCredits: 5, returnedCredits: 45 });
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ status: 'expired', allocated: 55, returned: 75, unallocated: 45 });
    expect((await ledger.getSolvencySnapshot()).funding).toMatchObject({
      commitments: { active: 0, expired: 1 },
      allocations: { consumed: 1, released: 1, expired: 1 },
      byUnit: [{ allocated: { total: 55, byUse: { reward_funding: 5, community_access_pool: 50 } }, returned: 75, unallocated: { available: 0, lapsed: 45 } }],
      creditsAllocated: { total: 55 }
    });
  });

  it('resumes after a restart mid-allocation without drawing twice', async () => {
    const { ledger, rewards, access } = services;
    await commitment(ledger, { amount: 100 });
    // The register committed the reward allocation, then the process died before the reservation recorded it.
    harness.faults.ledger.afterCommit = crash('simulated crash after register commit');
    await expect(reserve(rewards, { fundingId: 'funding_reward', amount: 40 })).rejects.toThrow('simulated crash after register commit');
    expect(await rewards.getFunding('funding_reward')).toMatchObject({ status: 'allocating', allocationId: null });
    // The process died before the register commit: nothing was drawn for the pool.
    harness.faults.ledger.beforeCommit = crash('simulated crash before register commit');
    await expect(pool(access, { fundingId: 'funding_pool', quantity: 30 })).rejects.toThrow('simulated crash before register commit');
    expect(await access.getFunding('funding_pool')).toMatchObject({ status: 'allocating' });
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ allocated: 40, allocations: 1 });

    const restarted = open();
    expect(await restarted.rewards.resumeFunding()).toEqual([{ fundingId: 'funding_reward', status: 'active', returned: null }]);
    expect(await restarted.access.resumeFunding()).toEqual([{ fundingId: 'funding_pool', status: 'issued' }]);
    expect(await reserve(restarted.rewards, { fundingId: 'funding_reward', amount: 40 })).toMatchObject({ status: 'active' });
    expect(await restarted.ledger.getFundingCommitment('commitment_1')).toMatchObject({ allocated: 70, allocations: 2, unallocated: 30 });
    expect((await restarted.ledger.getAccount('pool_general')).byProvenance.community_access.issued).toBe(30);

    // A pool allocation committed, the process died before issuance, and the commitment expired before restart.
    await commitment(restarted.ledger, { commitmentId: 'commitment_short', amount: 25, validForMs: 10 * MIN });
    harness.faults.ledger.afterCommit = crash('simulated crash after pool allocation');
    await expect(pool(restarted.access, { fundingId: 'funding_short', commitmentId: 'commitment_short', quantity: 25 })).rejects.toThrow('simulated crash after pool allocation');
    expect(await restarted.ledger.getFundingCommitment('commitment_short')).toMatchObject({ allocated: 25 });
    advance(10 * MIN);
    const later = open();
    expect(await later.access.resumeFunding()).toEqual([{ fundingId: 'funding_short', status: 'expired' }]);
    const short = await later.access.getFunding('funding_short');
    expect(await later.ledger.getFundingAllocation(short.allocationId)).toMatchObject({ status: 'expired', consumedCredits: 0, returnedCredits: 25 });
    expect(await later.ledger.getFundingCommitment('commitment_short')).toMatchObject({ status: 'expired', allocated: 0, returned: 25, unallocated: 25 });
    expect((await later.ledger.getAccount('pool_general')).byProvenance.community_access.issued).toBe(30);
    expect(await later.access.resumeFunding()).toEqual([]);
    expect(await later.ledger.auditAccount('pool_general')).toMatchObject({ consistent: true });
  });

  it('draws currency commitments in their own minor units and returns no more than the unused share', async () => {
    const { ledger, access } = services;
    await commitment(ledger, { commitmentId: 'commitment_usd', amount: 50_000, unit: { kind: 'currency', currency: 'USD' } });
    await rejectsWith(pool(access, { fundingId: 'funding_unstated', commitmentId: 'commitment_usd', quantity: 100 }), 'invalid_input');
    const usd = await pool(access, { fundingId: 'funding_usd', commitmentId: 'commitment_usd', quantity: 100, commitmentAmount: 30_000 });
    expect(await ledger.getFundingAllocation(usd.allocationId)).toMatchObject({ unit: { kind: 'currency', currency: 'USD' }, amount: 30_000, credits: 100, status: 'consumed' });
    await rejectsWith(pool(access, { fundingId: 'funding_over', commitmentId: 'commitment_usd', quantity: 100, commitmentAmount: 20_001 }), 'allocation_exceeds_commitment');
    const partial = await ledger.allocateFunding({
      commitmentId: 'commitment_usd', use: 'reward_funding', useRef: 'funding_partial', credits: 3, amount: 1000, funderKinds: ['operator', 'community'], idempotencyKey: 'allocate:partial'
    });
    expect(await ledger.releaseFundingAllocation({ allocationId: partial.allocationId, consumedCredits: 1, closure: 'released', idempotencyKey: 'release:partial' }))
      .toMatchObject({ status: 'released', returnedCredits: 2, returnedAmount: 666 });
    // A credit-unit commitment draws exactly the credits it allocates.
    await commitment(ledger, { amount: 100 });
    await rejectsWith(pool(access, { fundingId: 'funding_mismatch', quantity: 10, commitmentAmount: 11 }), 'invalid_input');
    expect((await ledger.getSolvencySnapshot()).funding).toEqual({
      commitments: { count: 2, pending: 0, active: 2, expired: 0 },
      allocations: { count: 2, active: 0, consumed: 1, released: 1, expired: 0 },
      byUnit: [
        {
          unit: { kind: 'currency', currency: 'USD' },
          committed: { total: 50_000, byFunderKind: { operator: 50_000, community: 0, donor: 0 } },
          allocated: { total: 30_334, byUse: { reward_funding: 334, community_access_pool: 30_000 } },
          returned: 666,
          unallocated: { available: 19_666, notYetValid: 0, lapsed: 0 }
        },
        {
          unit: { kind: 'credits', name: 'credit' },
          committed: { total: 100, byFunderKind: { operator: 100, community: 0, donor: 0 } },
          allocated: { total: 0, byUse: NO_USE },
          returned: 0,
          unallocated: { available: 100, notYetValid: 0, lapsed: 0 }
        }
      ],
      creditsAllocated: { total: 101, byUse: { reward_funding: 1, community_access_pool: 100 } }
    });
  });
});
