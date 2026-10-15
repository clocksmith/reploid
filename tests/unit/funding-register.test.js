import { MAX_UNACKNOWLEDGED_OUTPUTS } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { EVIDENCE_RULES_ID } from '../../server/ledger/domain.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { POOL_FUNDER_KINDS } from '../../server/community-access/domain.js';
import { createCommunityAccess, createFundingIssuanceAuthority } from '../../server/community-access/engine.js';
import { FUNDER_KINDS, LEGACY_LOT_SCHEMA, lotFunder } from '../../server/ledger/domain.js';
import { FUNDER_KINDS as REGISTER_FUNDER_KINDS } from '../../server/ledger/funding/register.js';
import { REWARD_FUNDER_KINDS } from '../../server/rewards/domain.js';
import { createFirestoreCommunityAccessBackend, createMemoryCommunityAccessBackend } from '../../server/community-access/stores.js';
import { createFirestoreLedgerStore } from '../../server/ledger/firestore-store.js';
import { createMemoryLedgerState, createMemoryLedgerStore } from '../../server/ledger/memory-store.js';
import { composeContributionRewards } from '../../server/rewards/engine.js';
import { createFirestoreRewardBackend, createMemoryRewardBackend } from '../../server/rewards/stores.js';
import { conversionAuthority, publishConversion } from '../helpers/conversion-fixture.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import {
  LEDGER_POLICY, MIN, START, advance, at, clock, composition, decidedBy, demand, fx, otherProvenance, rejectsWith
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
  capacity: { evidenceMaxAgeMs: 5 * MIN },
  // Test-only evidence terms Community Access quotes carry.
  evidence: { rulesId: EVIDENCE_RULES_ID, windowMs: 5 * MIN, clockSkewMs: 30_000, maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS }
});
const COMPONENTS = ['ledger', 'reward', 'community'];
const NO_USE = { reward_funding: 0, community_access_pool: 0, donated_credit: 0 };
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
      ledger: (options) => createMemoryLedgerStore({ state: states.ledger, hooks: hooks('ledger'), policy: LEDGER_POLICY, clock, conversionAuthority, ...options }),
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
      ledger: (options) => createFirestoreLedgerStore({ firestore: ledgerDb, collectionPrefix: 'test', policy: LEDGER_POLICY, clock, conversionAuthority, ...options }),
      reward: () => createFirestoreRewardBackend({ firestore: dbs.reward, collectionPrefix: 'test' }),
      community: () => createFirestoreCommunityAccessBackend({ firestore: dbs.community, collectionPrefix: 'test' })
    };
  }
};

/**
 * One process: the ledger (and its funding register) with rewards and Community Access over their own stores.
 * One funding-authority port (or none) serves rewards, Community Access and the ledger's donated credit.
 */
const openServices = (harness, overrides = {}) => {
  const fundingAuthority = 'fundingAuthority' in overrides ? overrides.fundingAuthority : composition.fundingAuthority;
  const communityBackend = harness.community();
  const poolAuthority = createFundingIssuanceAuthority({ backend: communityBackend, policy: ACCESS_POLICY });
  const rewardBackend = harness.reward();
  const { ledger, rewards, issuanceAuthority } = composeContributionRewards({
    ...composition,
    backend: rewardBackend,
    createLedger: ({ issuanceAuthority: authority }) => harness.ledger({ issuanceAuthority: authority, fundingAuthority }),
    otherProvenance: (request) => (request.provenance === 'community_access' ? poolAuthority(request) : otherProvenance(request)),
    ...overrides
  });
  const access = createCommunityAccess({
    backend: communityBackend, ledger, policy: ACCESS_POLICY, fundingAuthority, clock,
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
  fundingId, commitmentId, amount, categories: ['prepared_readiness'], authority: decidedBy(`decision:reserve:${fundingId}`),
  idempotencyKey: `reserve:${fundingId}`, ...rest
});
const release = (rewards, fundingId) => rewards.releaseFunding({ fundingId, authority: decidedBy(`decision:release:${fundingId}`) });
// Donated credit into a member account, drawing a donated_credit allocation.
const donate = async (ledger, { donationId, commitmentId = 'commitment_1', amount, accountId = 'acct_c1', authority = decidedBy(`decision:donate:${donationId}`) }) => {
  const allocation = await ledger.allocateFunding({
    commitmentId, use: 'donated_credit', useRef: donationId, credits: amount, accountId, authority, funderKinds: ['operator', 'donor'], idempotencyKey: `allocate:${donationId}`
  });
  const lot = await ledger.issueCredits({
    accountId, provenance: 'donated', amount, idempotencyKey: `donate:${donationId}`,
    source: { donationId, funderId: allocation.funderId, funderKind: allocation.funderKind, commitmentId, allocationId: allocation.allocationId }
  });
  return { allocation, lot };
};
const pool = (access, { fundingId, commitmentId = 'commitment_1', quantity, ...rest }) => access.recordFunding({
  fundingId, commitmentId, quantity, poolAccountId: 'pool_general', authority: decidedBy(`decision:pool:${fundingId}`), ...rest
});
// An accepted readiness validation awaiting issuance, with the fields allocation and issuance read.
const pendingValidation = (backend, validationId, amount) => backend.runTransaction(async (tx) => {
  tx.create('validations', validationId, {
    validationId, outcome: 'accepted', issuanceStatus: 'pending', category: 'prepared_readiness', ledgerCategory: 'readiness',
    validatorId: composition.rewardPolicy.validatorId, rewardPolicyVersion: composition.rewardPolicy.rewardPolicyVersion,
    workId: `rdy_${validationId}`, workRefs: {}, reward: { amount }, validatedAt: clock(),
    offer: { offerId: `offer_${validationId}`, offerHash: 'sha256:offer', accountId: 'acct_c1', participantId: 'peer_c1' }
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

  it('funds a reward reservation, a Community Access pool and donated credit from one commitment without exceeding it', async () => {
    const { ledger, rewards, access } = services;
    await ledger.openAccount({ accountId: 'acct_c1', ownerId: 'uid_c1' });
    await commitment(ledger, { amount: 120 });
    const reserved = await reserve(rewards, { fundingId: 'funding_reward', amount: 40 });
    expect(reserved).toMatchObject({
      status: 'active', commitmentId: 'commitment_1', funderKind: 'operator', funderId: 'operator_test', amount: 40, authorized: 0, allocationId: expect.any(String)
    });
    const pooled = await pool(access, { fundingId: 'funding_pool', quantity: 60 });
    expect(pooled).toMatchObject({ status: 'issued', funderKind: 'operator', funderId: 'operator_test', allocationId: expect.any(String) });
    expect(await ledger.getLot(pooled.lotId)).toMatchObject({
      provenance: 'community_access', accountId: 'pool_general', quantity: 60, source: { commitmentId: 'commitment_1', allocationId: pooled.allocationId }
    });
    const donated = await donate(ledger, { donationId: 'donation_1', amount: 20 });
    expect(await ledger.getLot(donated.lot.lotId)).toMatchObject({
      provenance: 'donated', accountId: 'acct_c1', quantity: 20,
      source: { funderId: 'operator_test', funderKind: 'operator', commitmentId: 'commitment_1', allocationId: donated.allocation.allocationId }
    });
    expect(await ledger.getFundingAllocation(pooled.allocationId)).toMatchObject({
      use: 'community_access_pool', status: 'consumed', issuedCredits: 60, lotId: pooled.lotId, authority: decidedBy('decision:pool:funding_pool')
    });
    expect(await ledger.getFundingAllocation(donated.allocation.allocationId)).toMatchObject({
      use: 'donated_credit', status: 'consumed', issuedCredits: 20, lotId: donated.lot.lotId, authority: decidedBy('decision:donate:donation_1')
    });
    expect(await ledger.getFundingAllocation(reserved.allocationId)).toMatchObject({
      use: 'reward_funding', status: 'active', credits: 40, issuedCredits: 0, authority: decidedBy('decision:reserve:funding_reward')
    });
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ status: 'active', amount: 120, allocated: 120, unallocated: 0, allocations: 3 });

    // The same commitment cannot be recorded again through any use: the register has nothing left.
    await rejectsWith(reserve(rewards, { fundingId: 'funding_reward_2', amount: 1 }), 'allocation_exceeds_commitment');
    await rejectsWith(pool(access, { fundingId: 'funding_pool_2', quantity: 1 }), 'allocation_exceeds_commitment');
    await rejectsWith(donate(ledger, { donationId: 'donation_2', amount: 1 }), 'allocation_exceeds_commitment');
    expect(await rewards.getFunding('funding_reward_2')).toMatchObject({ status: 'refused', refusal: { code: 'allocation_exceeds_commitment', details: { remaining: 0 } } });
    expect(await access.getFunding('funding_pool_2')).toMatchObject({ status: 'refused', refusal: { code: 'allocation_exceeds_commitment' } });
    await rejectsWith(release(rewards, 'funding_reward_2'), 'funding_not_active');
    // Donated credit needs its allocation, cannot reuse a consumed one, and issues once.
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'donated', amount: 5, source: { donationId: 'donation_free', funderId: 'operator_test', funderKind: 'operator' }, idempotencyKey: 'donate:free'
    }), 'invalid_source_reference');
    const reused = { funderId: 'operator_test', funderKind: 'operator', commitmentId: 'commitment_1', allocationId: donated.allocation.allocationId };
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'donated', amount: 20, source: { ...reused, donationId: 'donation_3' }, idempotencyKey: 'donate:reused'
    }), 'allocation_mismatch');
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'donated', amount: 20, source: { ...reused, donationId: 'donation_1' }, idempotencyKey: 'donate:again'
    }), 'duplicate_issuance_source');
    // Replays converge on the original allocations; issued pool funding cannot be released back.
    expect(await reserve(rewards, { fundingId: 'funding_reward', amount: 40 })).toMatchObject({ status: 'active', allocationId: reserved.allocationId });
    expect(await pool(access, { fundingId: 'funding_pool', quantity: 60 })).toEqual(pooled);
    await rejectsWith(ledger.releaseFundingAllocation({
      allocationId: pooled.allocationId, consumedCredits: 0, closure: 'released', authority: decidedBy('decision:pool'), idempotencyKey: 'release:pool'
    }), 'allocation_closed');

    // Solvency reports the commitment, allocations by use and what is unallocated, beside the subsidy block.
    await demand(ledger, { quoteId: 'q_pool', accountId: 'pool_general' });
    const snapshot = await ledger.getSolvencySnapshot();
    expect(snapshot.funding).toEqual({
      commitments: { count: 1, pending: 0, active: 1, expired: 0 },
      allocations: { count: 3, active: 1, consumed: 2, released: 0, expired: 0 },
      byUnit: [{
        unit: { kind: 'credits', name: 'credit' },
        committed: { total: 120, byFunderKind: { operator: 120, community: 0, donor: 0 } },
        allocated: { total: 120, byUse: { reward_funding: 40, community_access_pool: 60, donated_credit: 20 } },
        returned: 0,
        unallocated: { available: 0, notYetValid: 0, lapsed: 0 }
      }],
      creditsAllocated: { total: 120, byUse: { reward_funding: 40, community_access_pool: 60, donated_credit: 20 }, byFunderKind: { donor: 0, operator: 120, community: 0 } },
      creditsIssued: { total: 80, byUse: { reward_funding: 0, community_access_pool: 60, donated_credit: 20 }, byFunderKind: { donor: 0, operator: 80, community: 0 } }
    });
    // What the register issued is exactly the ledger's issued credit of each provenance; the subsidy block discloses what pools spent of it.
    expect(snapshot.funding.creditsIssued.byUse).toEqual({
      reward_funding: snapshot.issued.byProvenance.subsidized,
      community_access_pool: snapshot.issued.byProvenance.community_access,
      donated_credit: snapshot.issued.byProvenance.donated
    });
    expect(snapshot.subsidy).toMatchObject({ communityAccessConsumed: 30, subsidizedRewardsIssued: 0 });
  });

  it('requires a named authority, allowed by the funding-authority port, for every allocation and release', async () => {
    const { ledger, rewards, access } = services;
    await commitment(ledger, { amount: 100 });
    await expect(rewards.reserveFunding({ fundingId: 'f_unnamed', commitmentId: 'commitment_1', amount: 5, categories: ['prepared_readiness'], idempotencyKey: 'r:unnamed' }))
      .rejects.toMatchObject({ code: 'invalid_funding', details: { errors: expect.arrayContaining([expect.stringContaining('authority')]) } });
    await expect(reserve(rewards, { fundingId: 'f_stranger', amount: 5, authority: decidedBy('decision:stranger', 'stranger') }))
      .rejects.toMatchObject({ code: 'funding_not_authorized', details: { reason: 'not_a_funding_authority' } });
    expect(await rewards.getFunding('f_stranger')).toBeNull();
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ allocated: 0 });

    const reserved = await reserve(rewards, { fundingId: 'f_ok', amount: 5 });
    expect(reserved).toMatchObject({ status: 'active', authority: decidedBy('decision:reserve:f_ok') });
    await rejectsWith(rewards.releaseFunding({ fundingId: 'f_ok' }), 'invalid_input');
    await rejectsWith(rewards.releaseFunding({ fundingId: 'f_ok', authority: decidedBy('decision:stranger', 'stranger') }), 'funding_not_authorized');
    expect(await rewards.getFunding('f_ok')).toMatchObject({ status: 'active' });

    // Community Access pools and donated credit need the same named, allowed decision.
    await rejectsWith(pool(access, { fundingId: 'p_unnamed', quantity: 5, authority: undefined }), 'invalid_input');
    await expect(pool(access, { fundingId: 'p_stranger', quantity: 5, authority: decidedBy('decision:stranger', 'stranger') }))
      .rejects.toMatchObject({ code: 'funding_not_authorized', details: { reason: 'not_a_funding_authority' } });
    expect(await access.getFunding('p_stranger')).toBeNull();
    await expect(donate(ledger, { donationId: 'd_stranger', amount: 5, authority: decidedBy('decision:stranger', 'stranger') }))
      .rejects.toMatchObject({ code: 'funding_not_authorized', details: { reason: 'not_a_funding_authority' } });
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ allocated: 5 });

    // The register requires the authority itself, for every use, whoever calls it; expiry names none.
    for (const [use, accountId] of [['reward_funding', undefined], ['community_access_pool', 'pool_general'], ['donated_credit', 'acct_c1']]) {
      await rejectsWith(ledger.allocateFunding({
        commitmentId: 'commitment_1', use, useRef: `direct_${use}`, credits: 1, ...(accountId ? { accountId } : {}), funderKinds: ['operator'], idempotencyKey: `direct:${use}`
      }), 'funding_authority_required');
    }
    await rejectsWith(ledger.releaseFundingAllocation({
      allocationId: reserved.allocationId, consumedCredits: 0, closure: 'released', idempotencyKey: 'direct-release'
    }), 'funding_authority_required');
    await rejectsWith(ledger.releaseFundingAllocation({
      allocationId: reserved.allocationId, consumedCredits: 0, closure: 'expired', authority: decidedBy('decision:expire'), idempotencyKey: 'direct-expire'
    }), 'invalid_input');

    // Without the port nothing is reserved, pooled, donated or released.
    const unported = openServices(harness, { fundingAuthority: null });
    await rejectsWith(reserve(unported.rewards, { fundingId: 'f_unported', amount: 5 }), 'funding_authority_required');
    await rejectsWith(pool(unported.access, { fundingId: 'p_unported', quantity: 5 }), 'funding_authority_required');
    await rejectsWith(donate(unported.ledger, { donationId: 'd_unported', amount: 5 }), 'funding_authority_required');
    await rejectsWith(release(unported.rewards, 'f_ok'), 'funding_authority_required');
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ allocated: 5 });

    expect(await release(rewards, 'f_ok')).toMatchObject({ status: 'released', returned: 5, releaseAuthority: decidedBy('decision:release:f_ok') });
    expect(await ledger.getFundingAllocation(reserved.allocationId)).toMatchObject({
      status: 'released', authority: decidedBy('decision:reserve:f_ok'), releaseAuthority: decidedBy('decision:release:f_ok')
    });
  });

  it('checks reported consumption against what the ledger issued for the allocation', async () => {
    const { ledger, rewards, rewardBackend, issuanceAuthority } = services;
    await ledger.openAccount({ accountId: 'acct_c1', ownerId: 'uid_c1' });
    await commitment(ledger, { amount: 100 });
    const { allocationId } = await reserve(rewards, { fundingId: 'funding_reward', amount: 20 });
    await pendingValidation(rewardBackend, 'val_1', 5);
    await pendingValidation(rewardBackend, 'val_2', 4);
    expect(await rewards.issueReward({ validationId: 'val_1' })).toMatchObject({ status: 'issued', provenance: 'subsidized', amount: 5 });
    // val_2 is authorized but its lot is not issued yet.
    await issuanceAuthority.allocate('val_2');
    expect(await rewards.getFunding('funding_reward')).toMatchObject({ authorized: 9 });
    expect(await ledger.getFundingAllocation(allocationId)).toMatchObject({ issuedCredits: 5 });

    // A use cannot report less than the ledger issued against the allocation.
    await expect(ledger.releaseFundingAllocation({
      allocationId, consumedCredits: 3, closure: 'released', authority: decidedBy('decision:short'), idempotencyKey: 'release:short'
    })).rejects.toMatchObject({ code: 'consumed_below_issued', details: { issuedCredits: 5, consumedCredits: 3 } });
    // Rewards reports what it authorized; the pending lot still issues, and nothing more can.
    expect(await release(rewards, 'funding_reward')).toMatchObject({ status: 'released', consumedCredits: 9, returned: 11 });
    expect(await rewards.issueReward({ validationId: 'val_2' })).toMatchObject({ status: 'issued', amount: 4 });
    expect(await ledger.getFundingAllocation(allocationId)).toMatchObject({ status: 'released', issuedCredits: 9, consumedCredits: 9, returnedCredits: 11 });
    const { source } = await ledger.getLot((await rewards.getValidation('val_2')).issuance.lotId);
    const permissive = harness.ledger({ issuanceAuthority: async () => ({ allowed: true, decisionId: 'test:permissive' }) });
    const extra = { ...source, workId: 'rdy_extra', validationId: 'val_extra' };
    await rejectsWith(permissive.issueCredits({ accountId: 'acct_c1', provenance: 'subsidized', amount: 1, source: extra, idempotencyKey: 'issue:extra' }), 'allocation_exhausted');
    await rejectsWith(permissive.issueCredits({
      accountId: 'acct_c1', provenance: 'subsidized', amount: 1, source: { ...extra, fundingId: 'funding_other' }, idempotencyKey: 'issue:other'
    }), 'allocation_mismatch');

    // An active allocation never issues more than its credits, whatever an issuance authority allows.
    const small = await reserve(rewards, { fundingId: 'funding_small', amount: 3 });
    const smallSource = { ...extra, workId: 'rdy_small', validationId: 'val_small', fundingId: 'funding_small', allocationId: small.allocationId };
    await rejectsWith(permissive.issueCredits({ accountId: 'acct_c1', provenance: 'subsidized', amount: 4, source: smallSource, idempotencyKey: 'issue:small' }), 'allocation_exhausted');

    const snapshot = await ledger.getSolvencySnapshot();
    expect(snapshot.funding.creditsIssued.byUse.reward_funding).toBe(snapshot.issued.byProvenance.subsidized);
    expect(snapshot.funding.creditsAllocated.byUse.reward_funding).toBe(12);
    expect(snapshot.subsidy.subsidizedRewardsIssued).toBe(9);
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
      commitmentId: 'commitment_race', use: 'reward_funding', useRef: `race_${index}`, credits: 30,
      authority: decidedBy(`decision:race:${index}`), funderKinds: ['operator'], idempotencyKey: `race:${index}`
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
    expect(await release(rewards, 'funding_released')).toMatchObject({ status: 'released', consumedCredits: 0, returned: 30 });
    expect(await ledger.getFundingCommitment('commitment_1')).toMatchObject({ allocated: 50, returned: 30, unallocated: 50 });
    // Returned funding can be allocated again.
    expect(await pool(access, { fundingId: 'funding_pool', quantity: 50 })).toMatchObject({ status: 'issued' });
    await rejectsWith(release(rewards, 'funding_unknown'), 'funding_not_found');

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

  it('names every funder in one vocabulary across uses, lots, solvency and subsidy reports', async () => {
    const { ledger, rewards, access, rewardBackend } = services;
    // One vocabulary; each use accepts its own subset of it.
    expect(FUNDER_KINDS).toEqual(['donor', 'operator', 'community']);
    expect(REGISTER_FUNDER_KINDS).toBe(FUNDER_KINDS);
    expect(REWARD_FUNDER_KINDS.every((kind) => FUNDER_KINDS.includes(kind))).toBe(true);
    expect(POOL_FUNDER_KINDS.every((kind) => FUNDER_KINDS.includes(kind))).toBe(true);
    await ledger.openAccount({ accountId: 'acct_c1', ownerId: 'uid_c1' });
    await commitment(ledger, { commitmentId: 'c_donor', funderKind: 'donor', amount: 60 });
    await commitment(ledger, { commitmentId: 'c_operator', funderKind: 'operator', amount: 60 });
    await commitment(ledger, { commitmentId: 'c_community', funderKind: 'community', amount: 60 });

    // Donated credit names its funder's kind as well as its id, so donor and operator gifts stay distinct.
    const fromDonor = await donate(ledger, { donationId: 'gift_donor', commitmentId: 'c_donor', amount: 10 });
    const fromOperator = await donate(ledger, { donationId: 'gift_operator', commitmentId: 'c_operator', amount: 7 });
    expect((await ledger.getLot(fromDonor.lot.lotId)).source).toMatchObject({ funderKind: 'donor', funderId: 'donor_test' });
    expect((await ledger.getLot(fromOperator.lot.lotId)).source).toMatchObject({ funderKind: 'operator', funderId: 'operator_test' });
    const misnamed = await ledger.allocateFunding({
      commitmentId: 'c_donor', use: 'donated_credit', useRef: 'gift_misnamed', credits: 5, accountId: 'acct_c1',
      authority: decidedBy('decision:gift_misnamed'), funderKinds: ['donor'], idempotencyKey: 'allocate:gift_misnamed'
    });
    const source = { donationId: 'gift_misnamed', funderId: 'donor_test', commitmentId: 'c_donor', allocationId: misnamed.allocationId };
    await rejectsWith(ledger.issueCredits({ accountId: 'acct_c1', provenance: 'donated', amount: 5, source: { ...source, funderKind: 'operator' }, idempotencyKey: 'gift:misnamed' }), 'allocation_mismatch');
    await rejectsWith(ledger.issueCredits({ accountId: 'acct_c1', provenance: 'donated', amount: 5, source: { ...source, funderKind: 'sponsor' }, idempotencyKey: 'gift:sponsor' }), 'invalid_source_reference');
    // A v1 donated lot named only donorId (its commitment's funder id); it reads with its allocation's kind, unrewritten.
    const legacy = { schema: LEGACY_LOT_SCHEMA, provenance: 'donated', source: { donationId: 'old', donorId: 'donor_test', commitmentId: 'c_donor', allocationId: misnamed.allocationId } };
    expect(lotFunder(legacy, misnamed)).toEqual({ funderId: 'donor_test', funderKind: 'donor', legacy: true });
    expect(lotFunder(await ledger.getLot(fromDonor.lot.lotId))).toEqual({ funderId: 'donor_test', funderKind: 'donor', legacy: false });

    // Rewards accept operator and community funding; pools accept donor and operator.
    await reserve(rewards, { fundingId: 'f_community', commitmentId: 'c_community', amount: 20 });
    await rejectsWith(reserve(rewards, { fundingId: 'f_donor', commitmentId: 'c_donor', amount: 5 }), 'funder_kind_not_accepted');
    await pendingValidation(rewardBackend, 'val_community', 4);
    expect(await rewards.issueReward({ validationId: 'val_community' })).toMatchObject({ status: 'issued', provenance: 'subsidized' });
    const subsidized = await ledger.getLot((await rewards.getValidation('val_community')).issuance.lotId);
    expect(subsidized.source).toMatchObject({ funderKind: 'community', funderId: 'community_test' });
    expect(await pool(access, { fundingId: 'p_operator', commitmentId: 'c_operator', quantity: 30 })).toMatchObject({ status: 'issued', funderKind: 'operator' });

    // Solvency and the subsidy report count by the same kinds.
    const { funding } = await ledger.getSolvencySnapshot();
    expect(funding.creditsIssued).toEqual({
      total: 51, byUse: { reward_funding: 4, community_access_pool: 30, donated_credit: 17 }, byFunderKind: { donor: 10, operator: 37, community: 4 }
    });
    expect(funding.byUnit[0].committed.byFunderKind).toEqual({ donor: 60, operator: 60, community: 60 });
    expect((await access.getSubsidyReport()).funded).toEqual({ total: 30, byFunderKind: { donor: 0, operator: 30, community: 0 } });

    // After the commitments lapse, the register expires only the unissued donated allocation; rewards expires its own.
    advance(DAY);
    expect(await ledger.expireAllocations()).toEqual([{ allocationId: misnamed.allocationId, status: 'expired', returnedCredits: 5 }]);
    expect(await ledger.expireAllocations()).toEqual([]);
    expect(await ledger.getFundingAllocation((await rewards.getFunding('f_community')).allocationId)).toMatchObject({ status: 'active' });
    expect(await rewards.resumeFunding()).toEqual([{ fundingId: 'f_community', status: 'expired', returned: 16 }]);
    expect(await ledger.getAccount('acct_c1')).toMatchObject({ available: 21 });
  });

  it('draws currency commitments in their own minor units and returns no more than the unused share', async () => {
    const { ledger, access } = services;
    await commitment(ledger, { commitmentId: 'commitment_usd', amount: 50_000, unit: { kind: 'currency', currency: 'USD' } });
    // Without a conversion record in effect a currency commitment allocates nothing.
    await rejectsWith(pool(access, { fundingId: 'funding_unconverted', commitmentId: 'commitment_usd', quantity: 100, commitmentAmount: 30_000 }), 'conversion_unavailable');
    // Test-only rate: one credit per 300 minor units, rounded down.
    const conversion = await publishConversion(ledger, { conversionId: 'conv_test_usd_300', rate: { credits: 1, perMinorUnits: 300 }, clock });
    await rejectsWith(pool(access, { fundingId: 'funding_unstated', commitmentId: 'commitment_usd', quantity: 100 }), 'invalid_input');
    const usd = await pool(access, { fundingId: 'funding_usd', commitmentId: 'commitment_usd', quantity: 100, commitmentAmount: 30_000 });
    expect(await ledger.getFundingAllocation(usd.allocationId)).toMatchObject({
      unit: { kind: 'currency', currency: 'USD' }, amount: 30_000, credits: 100, status: 'consumed',
      conversion: { conversionId: 'conv_test_usd_300', recordHash: conversion.recordHash }
    });
    expect(await ledger.verifyConversion({ allocationId: usd.allocationId })).toMatchObject({ consistent: true, recordedCredits: 100, recomputedCredits: 100 });
    // Credits that the stated amount does not convert to are refused and retained.
    await expect(pool(access, { fundingId: 'funding_miscounted', commitmentId: 'commitment_usd', quantity: 100, commitmentAmount: 20_001 }))
      .rejects.toMatchObject({ code: 'conversion_mismatch', details: { expected: 66 } });
    expect(await access.getFunding('funding_miscounted')).toMatchObject({ status: 'refused', refusal: { code: 'conversion_mismatch' } });
    await rejectsWith(pool(access, { fundingId: 'funding_over', commitmentId: 'commitment_usd', quantity: 100, commitmentAmount: 30_000 }), 'allocation_exceeds_commitment');
    const partial = await ledger.allocateFunding({
      commitmentId: 'commitment_usd', use: 'reward_funding', useRef: 'funding_partial', credits: 3, amount: 1000,
      authority: decidedBy('decision:partial'), funderKinds: ['operator', 'community'], idempotencyKey: 'allocate:partial'
    });
    expect(partial.conversion).toEqual({ conversionId: 'conv_test_usd_300', recordHash: conversion.recordHash });
    expect(await ledger.releaseFundingAllocation({
      allocationId: partial.allocationId, consumedCredits: 1, closure: 'released', authority: decidedBy('decision:release:partial'), idempotencyKey: 'release:partial'
    }))
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
          allocated: { total: 30_334, byUse: { reward_funding: 334, community_access_pool: 30_000, donated_credit: 0 } },
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
      creditsAllocated: { total: 101, byUse: { reward_funding: 1, community_access_pool: 100, donated_credit: 0 }, byFunderKind: { donor: 0, operator: 101, community: 0 } },
      creditsIssued: { total: 100, byUse: { reward_funding: 0, community_access_pool: 100, donated_credit: 0 }, byFunderKind: { donor: 0, operator: 100, community: 0 } }
    });
  });
});
