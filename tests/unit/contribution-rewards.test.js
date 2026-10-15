import { beforeEach, describe, expect, it } from 'vitest';

import { PRODUCT_ECONOMICS_CONTRACT_ID } from '../../server/ledger/domain.js';
import { validateIssuancePolicy, validateRewardPolicy } from '../../server/rewards/domain.js';
import { REWARD_STORE_OPERATIONS, validateRewardStoreContract } from '../../server/rewards/store-contract.js';
import {
  ISSUANCE_POLICY, MIN, MODEL, OWNER_DIGEST, OWNER_GRANT, OWNER_POLICY, REWARD_POLICY,
  advance, at, claimInput, clock, codes, declinedWith, demand, fund, fx, harnesses, journalShape,
  offerAndAccept, offerInput, openFixture, ownerAuthorization, rejectsWith, settle, throwsWith
} from '../helpers/reward-fixture.js';

describe.each(Object.keys(harnesses))('contribution rewards (%s store)', (kind) => {
  let harness;
  let ledger;
  let rewards;

  beforeEach(async () => {
    ({ harness, ledger, rewards } = await openFixture(kind));
  });

  it('implements the reward store contract', () => {
    expect(validateRewardStoreContract(rewards)).toEqual({ ok: true, missing: [] });
    expect(REWARD_STORE_OPERATIONS).toContain('validateWork');
  });

  it('issues one earned lot with provenance for validated demanded inference under an accepted offer', async () => {
    const { offer, acceptance } = await offerAndAccept(rewards, { offerId: 'offer_c1' });
    expect(offer).toMatchObject({
      status: 'offered', category: 'demanded_inference', ledgerCategory: 'computation',
      contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID }, accountingVersion: 'test-accounting/1', rounding: 'ceil',
      work: { participantId: 'peer_c1', model: MODEL },
      reward: { basis: { kind: 'test_share_of_settled_charge' }, maxReward: 50 },
      resourceBounds: { output: { max: 100, unit: 'token' } },
      paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN },
      failureCompensation: { kind: 'none' },
      validation: {
        validatorId: 'validator_test_demanded_inference',
        conditions: expect.arrayContaining([expect.stringMatching(/^requester_quote_accepted/), expect.stringMatching(/^not_self_dealing/)]),
        collusion: { alwaysRejected: ['same_account', 'same_owner', 'same_participant'], rejectLinkKinds: ['shared_payment_instrument'] }
      }
    });
    expect(offer.offerHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(acceptance).toMatchObject({ offerId: 'offer_c1', offerHash: offer.offerHash, ownerPolicyDigest: OWNER_DIGEST });
    expect(await rewards.getOffer('offer_c1')).toMatchObject({
      status: 'accepted', acceptance: { ownerPolicyDigest: OWNER_DIGEST, equipment: { ownership: 'personal' }, network: { granted: true } }
    });

    const work = await demand(ledger, { quoteId: 'q1' });
    const validation = await rewards.validateWork(claimInput({ work }));
    expect(validation).toMatchObject({
      outcome: 'accepted', reasons: [], issuanceStatus: 'pending', workId: expect.stringMatching(/^dinf_/),
      reward: { amount: 10, uncapped: 10, capped: false, meters: { settledCharge: 30, output: 40 } },
      evidence: {
        requester: { accountId: 'acct_req' },
        settlement: { outcome: 'full', charge: 30, billableEventId: `bill:${work.reservationId}`, recipients: ['peer_c0', 'peer_c1'] },
        route: { requesterId: 'peer_req', modelId: MODEL.modelId, stageCount: 2 },
        contribution: { participantId: 'peer_c1', stageIndex: 1, ownerPolicyDigest: OWNER_DIGEST }
      }
    });

    const issued = await rewards.issueReward({ validationId: validation.validationId });
    expect(issued).toMatchObject({ status: 'issued', accountId: 'acct_c1', amount: 10, decisionId: `issuance:${validation.validationId}` });
    expect(await ledger.getLot(issued.lotId)).toMatchObject({
      provenance: 'earned', quantity: 10, accountId: 'acct_c1',
      source: {
        category: 'computation', rewardCategory: 'demanded_inference', workId: validation.workId, outcome: 'accepted',
        offerId: 'offer_c1', offerHash: offer.offerHash, validationId: validation.validationId, validatorId: 'validator_test_demanded_inference',
        reservationId: work.reservationId, settlementId: `stl:${work.reservationId}`, billableEventId: `bill:${work.reservationId}`,
        attemptId: work.attemptId, stageIndex: 1, participantId: 'peer_c1', ownerPolicyDigest: OWNER_DIGEST
      },
      issuance: { decisionId: issued.decisionId, limitId: 'test-issuance-limits/1' }
    });
    expect(await rewards.issueReward({ validationId: validation.validationId })).toEqual(issued);
    expect(await rewards.getValidation(validation.validationId)).toMatchObject({ issuanceStatus: 'issued', issuance: { lotId: issued.lotId } });
    expect(await journalShape(ledger, 'acct_c1')).toEqual([['issue', 10]]);
    expect(await ledger.getAccount('acct_c1')).toMatchObject({ available: 10, byProvenance: { earned: { issued: 10 } } });
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 10, allowances: 1 });
    expect(await rewards.listIssuanceDecisions()).toEqual([expect.objectContaining({
      allowed: true, decisionId: issued.decisionId, figures: expect.objectContaining({ measuredDemand: 30, demandLimit: 15, authorizedAfter: 10 })
    })]);
  });

  it('rejects duplicate and replayed rewards: one reward per stage share of a settled attempt', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    await offerAndAccept(rewards, { offerId: 'offer_c1_second' });
    const work = await demand(ledger, { quoteId: 'q1' });
    const input = claimInput({ work, key: 'validate:first' });
    const first = await rewards.validateWork(input);
    expect(await rewards.validateWork(input)).toEqual(first);

    const replay = await rewards.validateWork({ ...input, idempotencyKey: 'validate:replayed' });
    expect(replay).toMatchObject({
      outcome: 'rejected', workId: null, reward: null, issuanceStatus: 'not_eligible',
      reasons: [expect.objectContaining({ code: 'duplicate_reward', details: { validationId: first.validationId } })]
    });
    expect(codes(await rewards.validateWork({ ...input, offerId: 'offer_c1_second', idempotencyKey: 'validate:second-offer' })))
      .toEqual(['duplicate_reward']);
    await rejectsWith(rewards.validateWork({ ...input, stageIndex: 0 }), 'idempotency_conflict');

    const issued = await rewards.issueReward({ validationId: first.validationId });
    await rejectsWith(rewards.issueReward({ validationId: replay.validationId }), 'validation_rejected');
    const { source } = await ledger.getLot(issued.lotId);
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'earned', amount: 10, source, idempotencyKey: 'issue:replayed-reward'
    }), 'duplicate_issuance_source');
    await declinedWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'earned', amount: 10, source: { ...source, workId: 'dinf_other' }, idempotencyKey: 'issue:other-work'
    }), 'issuance_request_mismatch');
    await declinedWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'earned', amount: 10,
      source: { ...source, workId: 'dinf_forged', validationId: 'val_forged' }, idempotencyKey: 'issue:forged'
    }), 'validation_not_found');

    const second = await demand(ledger, { quoteId: 'q2' });
    const racing = await Promise.all(['a', 'b', 'c'].map((suffix) => rewards.validateWork(claimInput({ work: second, key: `race:${suffix}` }))));
    expect(racing.filter((validation) => validation.outcome === 'accepted')).toHaveLength(1);
    expect(racing.filter((validation) => validation.outcome === 'rejected').flatMap(codes)).toEqual(['duplicate_reward', 'duplicate_reward']);
    expect(await journalShape(ledger, 'acct_c1')).toEqual([['issue', 10]]);
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 10 });
  });

  it('rejects fabricated work that no accepted requester quote and completed settlement backs', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    const settled = await demand(ledger, { quoteId: 'q_settled' });
    const validate = (options) => rewards.validateWork(claimInput(options));

    // A consistent route summary and admission record (peer agreement) with no ledger settlement.
    const invented = await validate({ work: { reservationId: 'rsv:q_invented', attemptId: 'att_invented' } });
    expect(codes(invented)).toEqual(['no_matching_settlement']);
    expect(codes(await validate({ work: await demand(ledger, { quoteId: 'q_open', outcome: null }) }))).toEqual(['work_not_settled']);
    expect(codes(await validate({ work: await demand(ledger, { quoteId: 'q_failed', outcome: 'provider_failure' }) }))).toEqual(['work_not_completed']);
    expect(codes(await validate({ work: { ...settled, attemptId: 'att_unsettled' } }))).toEqual(['attempt_not_settled']);
    const unbound = await demand(ledger, { quoteId: 'q_unbound', recipients: ['peer_c0', 'peer_x'] });
    expect(codes(await validate({ work: unbound }))).toEqual(['contributor_not_bound', 'route_mismatch']);
    expect(codes(await validate({ work: settled, stages: ['peer_c1', 'peer_c0'] }))).toEqual(['route_mismatch', 'contributor_admission_invalid']);
    expect(codes(await validate({ work: settled, stageIndex: 0 }))).toEqual(expect.arrayContaining(['route_mismatch', 'contributor_admission_invalid']));
    expect(codes(await validate({ work: settled, receipt: { phase: 'failed' } }))).toEqual(['stage_not_executed']);
    expect(codes(await validate({ work: settled, receipt: { cleanup: 'unknown' } }))).toEqual(['stage_not_executed']);
    expect(codes(await validate({ work: settled, admission: { phase: 'reserved', settledAt: null } }))).toEqual(['contributor_admission_invalid']);
    expect(codes(await validate({ work: settled, requesterId: 'peer_c0' }))).toEqual(['requester_identity_mismatch']);
    expect(codes(await validate({ work: settled, ownerPolicyDigest: `sha256:${'d'.repeat(64)}` }))).toEqual(['owner_policy_mismatch']);
    expect(codes(await validate({ work: settled, execution: { schema: 'reploid.mesh.partition-summary/v2', identity: {} } }))).toEqual(['execution_invalid']);

    expect(await rewards.getValidation(invented.validationId)).toMatchObject({ outcome: 'rejected', issuanceStatus: 'not_eligible' });
    await rejectsWith(rewards.issueReward({ validationId: invented.validationId }), 'validation_rejected');
    expect(await journalShape(ledger, 'acct_c1')).toEqual([]);
    // Rejections take no claim: the honest claim for the same stage share still validates.
    expect(await validate({ work: settled })).toMatchObject({ outcome: 'accepted' });
  });

  it('rejects self-generated and linked demand under an explicit, configurable collusion rule', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    const validate = (options) => rewards.validateWork(claimInput(options));
    for (const accountId of ['acct_c1', 'acct_alt', 'acct_linked']) await fund(ledger, accountId, 500);

    const own = await demand(ledger, { quoteId: 'q_own', accountId: 'acct_c1' });
    expect(await validate({ work: own, requesterId: 'peer_c1_phone' })).toMatchObject({
      outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('same account') }]
    });
    const sameOwner = await demand(ledger, { quoteId: 'q_same_owner', accountId: 'acct_alt' });
    expect(await validate({ work: sameOwner, requesterId: 'peer_alt' })).toMatchObject({
      outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('share an owner') }]
    });
    const ownStage = await demand(ledger, { quoteId: 'q_own_stage' });
    expect(codes(await validate({ work: ownStage, requesterId: 'peer_c1' }))).toEqual(['requester_identity_mismatch', 'self_dealing']);

    fx.links.push({ a: 'acct_c1', b: 'acct_linked', kind: 'shared_payment_instrument', evidenceId: 'link:payment' });
    const linked = await demand(ledger, { quoteId: 'q_linked', accountId: 'acct_linked' });
    expect(await validate({ work: linked, requesterId: 'peer_linked' })).toMatchObject({
      outcome: 'rejected', reasons: [{ code: 'collusive_demand', details: { kinds: ['shared_payment_instrument'] } }]
    });

    // A link kind the policy does not name is retained as evidence but does not disqualify...
    fx.links.push({ a: 'acct_req', b: 'acct_c1', kind: 'shared_household_network', evidenceId: 'link:network' });
    const household = await demand(ledger, { quoteId: 'q_household' });
    expect(await validate({ work: household })).toMatchObject({
      outcome: 'accepted', evidence: { links: [{ kind: 'shared_household_network', evidenceId: 'link:network' }] }
    });
    // ...until an explicit policy names it.
    const strict = harness.open({
      rewardPolicy: { ...REWARD_POLICY, rewardPolicyVersion: 'test-reward-policy/strict', collusion: { rejectLinkKinds: ['shared_household_network'] } }
    });
    await offerAndAccept(strict.rewards, { offerId: 'offer_c1_strict' });
    const strictWork = await demand(strict.ledger, { quoteId: 'q_household_strict' });
    expect(codes(await strict.rewards.validateWork(claimInput({ offerId: 'offer_c1_strict', work: strictWork }))))
      .toEqual(['collusive_demand']);
    expect((await ledger.getAccount('acct_c1')).byProvenance.earned.issued).toBe(0);
  });

  it('caps earned issuance by measured settled demand and fresh admitted capacity', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c0', accountId: 'acct_c0', participantId: 'peer_c0' });
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    const first = await demand(ledger, { quoteId: 'q1' });
    const stage1 = await rewards.validateWork(claimInput({ work: first }));
    const stage0 = await rewards.validateWork(claimInput({ offerId: 'offer_c0', work: first, stageIndex: 0, raw: true }));
    expect([stage0.outcome, stage1.outcome]).toEqual(['accepted', 'accepted']);

    // Net settled spending is 30; a one-half demand share admits 15 earned credits in total.
    await rewards.issueReward({ validationId: stage1.validationId });
    await declinedWith(rewards.issueReward({ validationId: stage0.validationId }), 'demand_limit');
    expect(await rewards.getValidation(stage0.validationId)).toMatchObject({ issuanceStatus: 'pending' });
    expect(await rewards.listIssuanceDecisions()).toContainEqual(expect.objectContaining({
      allowed: false, reason: 'demand_limit', validationId: stage0.validationId,
      figures: expect.objectContaining({ measuredDemand: 30, demandLimit: 15, authorizedBefore: 10, authorizedAfter: 20 })
    }));
    await demand(ledger, { quoteId: 'q2', recipients: ['peer_c0', 'peer_x'] });
    expect(await rewards.resumeIssuance()).toEqual([expect.objectContaining({ validationId: stage0.validationId, status: 'issued' })]);

    // Outstanding obligations after issuance stay within admitted capacity coverage.
    const third = await demand(ledger, { quoteId: 'q3' });
    const pending = await rewards.validateWork(claimInput({ work: third }));
    const { outstanding } = await ledger.getSolvencySnapshot();
    fx.capacity.serviceCredits = outstanding.total + 9;
    await declinedWith(rewards.issueReward({ validationId: pending.validationId }), 'capacity_limit');
    fx.capacity.serviceCredits = outstanding.total + 10;
    fx.capacity.observedAt = at(-11 * MIN);
    await declinedWith(rewards.issueReward({ validationId: pending.validationId }), 'capacity_evidence_stale');
    const fresh = fx.capacity;
    fx.capacity = null;
    await declinedWith(rewards.issueReward({ validationId: pending.validationId }), 'capacity_evidence_unavailable');
    fx.capacity = { ...fresh, observedAt: null };
    expect(await rewards.issueReward({ validationId: pending.validationId })).toMatchObject({ status: 'issued', amount: 10 });

    // Concurrent issuance cannot overrun a limit: room for exactly one more 10-credit reward.
    const fourth = await demand(ledger, { quoteId: 'q4' });
    const fifth = await demand(ledger, { quoteId: 'q5' });
    const racing = [
      await rewards.validateWork(claimInput({ offerId: 'offer_c0', work: fourth, stageIndex: 0 })),
      await rewards.validateWork(claimInput({ work: fourth })),
      await rewards.validateWork(claimInput({ work: fifth }))
    ];
    fx.capacity.serviceCredits = (await ledger.getSolvencySnapshot()).outstanding.total + 10;
    const outcomes = await Promise.allSettled(racing.map(({ validationId }) => rewards.issueReward({ validationId })));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason.details.reason))
      .toEqual(['capacity_limit', 'capacity_limit']);
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 40, allowances: 4 });
    expect((await ledger.getSolvencySnapshot()).issued.byProvenance.earned).toBe(40);

    // Other provenance needs its own decision owner; the reward authority does not allow it.
    const undelegated = harness.open({ otherProvenance: null });
    await declinedWith(fund(undelegated.ledger, 'acct_req', 5, 'purchase:undelegated'), 'provenance_not_governed');
  });

  it('enables categories only through the explicit policy switch, and online time earns nothing', async () => {
    for (const category of ['online_time', 'presence']) {
      await rejectsWith(rewards.createOffer({ ...offerInput({ offerId: `offer_${category}`, category }), idempotencyKey: `offer:${category}` }), 'presence_earns_nothing');
    }
    await expect(rewards.createOffer({
      ...offerInput({ offerId: 'offer_uptime', reward: { formula: { kind: 'metered', base: 0, rates: [{ meter: 'onlineSeconds', numerator: 1, denominator: 60 }] } } }),
      idempotencyKey: 'offer:uptime'
    })).rejects.toMatchObject({ code: 'invalid_offer', details: { errors: [expect.stringContaining('reward.formula.rates[0].meter must be one of settledCharge')] } });
    await rejectsWith(rewards.createOffer({
      ...offerInput({ offerId: 'offer_compensated', failureCompensation: { kind: 'fixed', amount: 1 } }), idempotencyKey: 'offer:compensated'
    }), 'failure_compensation_unsupported');
    await expect(rewards.createOffer({ ...offerInput({ offerId: 'offer_obligated', obligations: { intervalMs: MIN } }), idempotencyKey: 'offer:obligated' }))
      .rejects.toMatchObject({ code: 'invalid_offer', details: { errors: [expect.stringContaining('obligations apply only to contracted categories')] } });

    expect(validateRewardPolicy(REWARD_POLICY).enabledCategories).toEqual(['demanded_inference', 'verified_delivery', 'contracted_storage', 'prepared_readiness']);
    throwsWith(() => validateRewardPolicy({ ...REWARD_POLICY, enabledCategories: ['online_time'] }), 'presence_earns_nothing');
    throwsWith(() => validateRewardPolicy({ ...REWARD_POLICY, enabledCategories: ['prepared_availability'] }), 'invalid_category');
    throwsWith(() => validateRewardPolicy({ ...REWARD_POLICY, collusion: undefined }), 'invalid_policy');
    throwsWith(() => validateIssuancePolicy({ ...ISSUANCE_POLICY, demand: undefined }), 'invalid_policy');
    throwsWith(() => validateIssuancePolicy({ ...ISSUANCE_POLICY, capacity: { coverage: { numerator: 1, denominator: 0 }, evidenceMaxAgeMs: 1 } }), 'invalid_policy');

    // A category the policy omits cannot earn; a policy that enables none disables every category.
    const inferenceOnly = harness.open({ rewardPolicy: { ...REWARD_POLICY, rewardPolicyVersion: 'test-reward-policy/inference', enabledCategories: ['demanded_inference'] } });
    await expect(inferenceOnly.rewards.createOffer({ ...offerInput({ offerId: 'offer_storage_off', category: 'contracted_storage' }), idempotencyKey: 'offer:storage-off' }))
      .rejects.toMatchObject({ code: 'reward_category_disabled', message: expect.stringContaining('not enabled by the active reward policy') });
    const disabled = harness.open({ rewardPolicy: { ...REWARD_POLICY, rewardPolicyVersion: 'test-reward-policy/none', enabledCategories: [] } });
    await rejectsWith(disabled.rewards.createOffer({ ...offerInput({ offerId: 'offer_none' }), idempotencyKey: 'offer:none' }), 'reward_category_disabled');
  });

  it('expires offers and rejects work outside the accepted offer terms', async () => {
    const offer = await rewards.createOffer({ ...offerInput({ offerId: 'offer_late' }), idempotencyKey: 'offer:late' });
    const acceptLate = (overrides = {}) => rewards.acceptOffer({
      offerId: 'offer_late', accountId: 'acct_c1', offerHash: offer.offerHash, ownerAuthorization, idempotencyKey: 'accept:late', ...overrides
    });
    await rejectsWith(acceptLate({ offerHash: 'sha256:altered', idempotencyKey: 'accept:altered' }), 'offer_terms_mismatch');
    await rejectsWith(acceptLate({ accountId: 'acct_c0', idempotencyKey: 'accept:other-account' }), 'participant_not_owned');
    await rejectsWith(acceptLate({ ownerAuthorization: undefined, idempotencyKey: 'accept:no-owner' }), 'owner_authorization_required');
    await rejectsWith(acceptLate({ ownerAuthorization: { ...ownerAuthorization, digest: `sha256:${'e'.repeat(64)}` }, idempotencyKey: 'accept:digest' }), 'owner_authorization_required');
    const ungranted = { ...OWNER_POLICY, authorization: { ...OWNER_POLICY.authorization, network: { ...OWNER_GRANT, granted: false } } };
    await rejectsWith(acceptLate({ ownerAuthorization: { policy: ungranted, digest: OWNER_DIGEST }, idempotencyKey: 'accept:ungranted' }), 'owner_authorization_required');
    advance(5 * MIN);
    await rejectsWith(acceptLate(), 'offer_expired');
    expect(await rewards.getOffer('offer_late')).toMatchObject({ status: 'offered', acceptance: null });

    // Work bound before acceptance cannot earn, even inside the offer's duration.
    const pendingOffer = await rewards.createOffer({ ...offerInput({ offerId: 'offer_c1' }), idempotencyKey: 'offer:c1' });
    const early = await demand(ledger, { quoteId: 'q_early', outcome: null });
    advance(1000);
    await rewards.acceptOffer({
      offerId: 'offer_c1', accountId: 'acct_c1', offerHash: pendingOffer.offerHash, ownerAuthorization, idempotencyKey: 'accept:c1'
    });
    await settle(ledger, early);
    expect(codes(await rewards.validateWork(claimInput({ work: early })))).toEqual(['work_precedes_offer']);

    // Work settled after the offer's duration.
    await offerAndAccept(rewards, { offerId: 'offer_short', duration: { startsAt: clock(), endsAt: at(2 * MIN) }, validUntil: at(MIN) });
    const late = await demand(ledger, { quoteId: 'q_late', outcome: null });
    advance(2.5 * MIN);
    await settle(ledger, late);
    expect(codes(await rewards.validateWork(claimInput({ offerId: 'offer_short', work: late })))).toEqual(['work_outside_offer_window']);

    // A claim after the claim window, and requested limits beyond the offer's resource bounds.
    await offerAndAccept(rewards, { offerId: 'offer_bounded', resourceBounds: { context: { max: 4096, unit: 'token' }, output: { max: 50, unit: 'token' } } });
    const stale = await demand(ledger, { quoteId: 'q_stale' });
    const oversized = await demand(ledger, { quoteId: 'q_oversized' });
    expect(codes(await rewards.validateWork(claimInput({ offerId: 'offer_bounded', work: oversized })))).toEqual(['work_exceeds_offer_bounds']);
    advance(31 * MIN);
    expect(codes(await rewards.validateWork(claimInput({ work: stale })))).toEqual(['claim_window_closed']);
    await rejectsWith(rewards.validateWork(claimInput({ offerId: 'offer_late', work: stale })), 'offer_not_accepted');
  });

  it('recovers restarts and crashes without lost or duplicated rewards', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c0', accountId: 'acct_c0', participantId: 'peer_c0' });
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    const work = await demand(ledger, { quoteId: 'q1' });
    await demand(ledger, { quoteId: 'q2' });

    // A crash before the validation commits retains nothing; the claim can be resubmitted.
    const stage1Claim = claimInput({ work, key: 'validate:stage1' });
    harness.faults.reward.beforeCommit = () => { throw new Error('simulated crash before reward commit'); };
    await expect(rewards.validateWork(stage1Claim)).rejects.toThrow('simulated crash before reward commit');
    const restarted = harness.open();
    const stage1 = await restarted.rewards.validateWork(stage1Claim);
    expect(stage1.outcome).toBe('accepted');

    // The ledger issued the lot, then the process died before the validation recorded it.
    harness.faults.ledger.afterCommit = () => { throw new Error('simulated crash after ledger commit'); };
    await expect(restarted.rewards.issueReward({ validationId: stage1.validationId })).rejects.toThrow('simulated crash after ledger commit');
    expect(await restarted.rewards.getValidation(stage1.validationId)).toMatchObject({ issuanceStatus: 'pending' });

    // The authority allowed issuance, then the ledger commit was lost.
    const stage0 = await restarted.rewards.validateWork(claimInput({ offerId: 'offer_c0', work, stageIndex: 0 }));
    harness.faults.ledger.beforeCommit = () => { throw new Error('simulated crash before ledger commit'); };
    await expect(restarted.rewards.issueReward({ validationId: stage0.validationId })).rejects.toThrow('simulated crash before ledger commit');

    const recovered = harness.open();
    const resumed = await recovered.rewards.resumeIssuance();
    expect(resumed.map((entry) => [entry.validationId, entry.status]).sort()).toEqual(
      [[stage0.validationId, 'issued'], [stage1.validationId, 'issued']].sort()
    );
    expect(await recovered.rewards.resumeIssuance()).toEqual([]);
    expect(await recovered.rewards.validateWork(stage1Claim)).toEqual(stage1);
    expect(await recovered.rewards.issueReward({ validationId: stage1.validationId })).toMatchObject({ status: 'issued', amount: 10 });
    expect(await journalShape(recovered.ledger, 'acct_c1')).toEqual([['issue', 10]]);
    expect(await journalShape(recovered.ledger, 'acct_c0')).toEqual([['issue', 10]]);
    expect(await recovered.rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 20, allowances: 2 });
    expect((await recovered.ledger.getSolvencySnapshot()).issued.byProvenance.earned).toBe(20);
    expect(await recovered.ledger.auditAccount('acct_c1')).toMatchObject({ consistent: true });
  });
});
