// @vitest-environment node
// Terms signed before terms carried K (the first split trades of 2026-11-25) have no `maxUnacknowledgedOutputs`
// member. Proves the replay still reads such records to the amounts it reached with K signed, and that the older shape
// cannot be used under the decided rules or against a policy that publishes K. The records are signed here with test
// keys; this replays no physical trade.
import { describe, expect, it } from 'vitest';
import { createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { UNFINISHED_ANSWER_TERMS, UNFINISHED_ANSWER_TERMS_V2 } from '../../server/fleet/credit-shares.js';
import {
  SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_TERMS_SCHEMA, termsDigest, verifySettlementTerms
} from '../../server/fleet/settlement-terms.js';
import { POLICY, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

// A policy of that time: it publishes no K, so K is the stages' receiver policy's value.
const { maxUnacknowledgedOutputs: _published, ...POLICY_BEFORE_K } = POLICY;
const bodyOf = record => { const { publicJwk: _key, signature: _signature, ...body } = record; return body; };
const amounts = row => ({ status: row.status, debit: row.debit, credits: row.credits?.map(credit => credit.amount) ?? null,
  outputs: row.outputs, chargedOutputs: row.chargedOutputs });

/**
 * Runs an attempt, then signs its terms again without K, as the requester did then, with each stage's acceptance of
 * that digest. `withK` holds the records as first signed, `beforeK` the same attempt under the older terms shape.
 */
async function attemptBeforeK(parties, { policy = POLICY_BEFORE_K, unfinishedTerms = UNFINISHED_ANSWER_TERMS, rename = null, ...options } = {}) {
  const a = await runAttempt(parties, { ...options, policy, unfinishedTerms });
  const { maxUnacknowledgedOutputs: _signed, ...body } = bodyOf(a.terms);
  if (rename) body.unfinishedTerms = rename;
  const at = () => Date.parse(a.terms.signedAt);
  const terms = await createAttemptEvidenceSigner({ identity: parties.requester, now: at }).sign(SETTLEMENT_TERMS_SCHEMA, body);
  const digest = await termsDigest(body);
  const acceptances = await Promise.all(parties.stages.map((stage, partitionIndex) => createAttemptEvidenceSigner({ identity: stage, now: at })
    .sign(SETTLEMENT_ACCEPTANCE_SCHEMA, { schema: SETTLEMENT_ACCEPTANCE_SCHEMA, termsDigest: digest, reservationId: body.reservationId,
      attemptId: body.attemptId, participantId: stage.peerId, partitionIndex, signedAt: a.terms.signedAt })));
  const others = a.all().filter(row => row.schema !== SETTLEMENT_TERMS_SCHEMA && row.schema !== SETTLEMENT_ACCEPTANCE_SCHEMA);
  return { a, terms, policy, withK: a.all(), beforeK: [terms, ...acceptances, ...others] };
}
const replay = (records, policy, at) => replaySettlement({ records, policies: [policy], at });

describe('terms signed before they carried K', () => {
  it('verify, and settle a completed answer to the same debit and stage credits', async () => {
    const parties = await createParties(2);
    const made = await attemptBeforeK(parties, { weights: [1, 3] });
    expect(Object.hasOwn(made.terms, 'maxUnacknowledgedOutputs')).toBe(false);
    expect(await verifySettlementTerms(made.terms)).toMatchObject({ ok: true });
    const then = await replay(made.withK, made.policy, made.a.decidedAt), now = await replay(made.beforeK, made.policy, made.a.decidedAt);
    expect(now.rejected).toEqual([]);
    expect(amounts(now.reservations[0])).toEqual({ status: 'settled', debit: 15, credits: [3, 12], outputs: 5, chargedOutputs: 5 });
    expect(amounts(now.reservations[0])).toEqual(amounts(then.reservations[0]));
    expect(now.balances).toEqual(then.balances);
  });

  it.each([
    ['a signed stop charges the acknowledged prefix', { requesterStopAfter: 3 }, { status: 'settled', chargedOutputs: 3, debit: 9 }],
    ['an answer the stages closed unfinished is free under the provider-loss-free terms', { stagesFailAfter: 3 }, { status: 'settled', outputs: 3, chargedOutputs: 0, debit: 0 }],
    ['a stage that never closes expires with nobody charged', { vanishStage: 0, vanishAfterStep: 1 }, { status: 'expired', debit: 0 }]
  ])('%s, as with K signed', async (_name, options, expected) => {
    const made = await attemptBeforeK(await createParties(2), options);
    const then = await replay(made.withK, made.policy, made.a.decidedAt), now = await replay(made.beforeK, made.policy, made.a.decidedAt);
    expect(now.rejected).toEqual([]);
    expect(now.reservations[0]).toMatchObject(expected);
    expect(amounts(now.reservations[0])).toEqual(amounts(then.reservations[0]));
  });

  it('are malformed when they name the decided unfinished-answer terms: those always sign K', async () => {
    const made = await attemptBeforeK(await createParties(2), { rename: UNFINISHED_ANSWER_TERMS_V2 });
    expect(await verifySettlementTerms(made.terms)).toEqual({ ok: false, problem: 'terms_malformed' });
    const now = await replay(made.beforeK, made.policy, made.a.decidedAt);
    expect(now.rejected.map(row => row.problem)).toEqual(['terms_malformed']);
    expect(now.reservations.every(row => row.status === 'unknown' && row.debit === null)).toBe(true);
  });

  it('are invalid against a policy that publishes K', async () => {
    const made = await attemptBeforeK(await createParties(2), { policy: POLICY });
    expect(await verifySettlementTerms(made.terms)).toMatchObject({ ok: true });
    const now = await replay(made.beforeK, POLICY, made.a.decidedAt);
    expect(now.reservations[0]).toMatchObject({ status: 'invalid', reason: 'the terms differ from the named policy', debit: null });
  });

  it('still refuse a body that drops any other member or adds one', async () => {
    const made = await attemptBeforeK(await createParties(2));
    const signer = createAttemptEvidenceSigner({ identity: (await createParties(1)).requester });
    const { releaseWindowMs: _dropped, ...short } = bodyOf(made.terms);
    for (const body of [short, { ...bodyOf(made.terms), extra: 1 }]) {
      const record = await signer.sign(SETTLEMENT_TERMS_SCHEMA, { ...body, requesterId: signer.participantId });
      expect(await verifySettlementTerms(record)).toEqual({ ok: false, problem: 'terms_malformed' });
    }
  });
});
