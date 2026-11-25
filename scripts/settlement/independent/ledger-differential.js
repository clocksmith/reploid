#!/usr/bin/env node
/**
 * Does the live ledger post what the settlement replay computes? differential.js compares two replays; this compares
 * the service's replay (server/fleet/settlement-replay.js) with the ledger that actually moves credits
 * (server/fleet/credits.js) on the same attempts.
 *
 * Each case is one attempt built with the production signers (scripts/settlement/scenario.js) and one choice of
 * which records the parties present. The ledger is driven through its public interface the way the live route
 * drives it: reserve, dispatch and admit at the start; `collect` with each acknowledgment and the receipt it
 * acknowledged at the moment that acknowledgment was signed; `collect` again, at the moment the last record was
 * signed, with what a live route retains (each stage's latest receipt, the latest acknowledgment and its receipt, and
 * the requester's signed stop when there is one); then `recover` once the attempt is decided, which is after the
 * deadline, the release window and the clock allowance. The replay judges the same records
 * after the window. A fresh ledger is opened for every case.
 *
 * Every case runs under the failed-stage rules (reploid.settlement-replay/v3 in the ledger, signed by the requester as
 * the terms' unfinished-answer terms): a stage that fails forfeits its own share and nothing else. A case with a `claim`
 * also has a stage's owner report an interruption (`closeStageOwner`), which is the ledger's signed fault. The stage is
 * admitted with an owner, as a live stage host admits it, and the claim reaches the ledger 10 ms after the last
 * record. With `fault` the claim carries a signed stage-fault record, which the replay is given too; the two are then
 * also compared at the moment of the claim, where a fault decides its stage at once. Without it the replay has no
 * record of the claim and reaches the ledger's amounts once the window has passed.
 *
 * The terms' deadline in scenario.js is 30 s after the start, so the policy used here sets `maxRequestMs` to 30 s:
 * the ledger's own deadline for the reservation is then the same instant as the signed one, as in the live requester,
 * which signs `deadline = notBefore + maxRequestMs`.
 *
 *   node scripts/settlement/independent/ledger-differential.js [--verbose] [--latest-only] [--out FILE.json]
 *
 * `--latest-only` hands the ledger only the final collect, without the acknowledgments as they were signed and
 * without the stop: what a route that kept less would give it. It is a second question, not the default.
 *
 * Plain Node, no model, no GPU, no network. All parties are simulated identities on one machine. The ledger sees
 * less than the replay by design (latest records only, no stop on a split route), so a difference here is a question
 * to answer, not automatically a defect in either.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSigningIdentity } from '../../../packages/reploid/src/artifacts/identity.js';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner } from '../../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { signAsParticipant } from '../../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { FLEET_SERVICE_REQUEST_SCHEMA } from '../../../server/fleet/contract.js';
import { openFleetCredits } from '../../../server/fleet/credits.js';
import { SETTLEMENT_RULES, UNFINISHED_ANSWER_TERMS_V3 } from '../../../server/fleet/credit-shares.js';
import { SETTLEMENT_STOP_SCHEMA, signStageFaultRecord } from '../../../server/fleet/settlement-terms.js';
import { replaySettlement } from '../../../server/fleet/settlement-replay.js';
import { POLICY as SCENARIO_POLICY, T0, createParties, runAttempt } from '../scenario.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const flag = name => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1] ?? true; };
const POLICY = Object.freeze({ ...SCENARIO_POLICY, maxRequestMs: 30000 });
/** A stage on the requester's own account needs a policy that allows it; the terms then name this policy. */
const OWN_STAGE_POLICY = Object.freeze({ ...POLICY, version: 'settlement-replay-own-stage', allowSameOwner: true });
const LATEST_ONLY = Boolean(flag('latest-only'));
const words = count => Array.from({ length: count }, (_, index) => ` w${index}`);
const OWNER_TOKEN = 'f'.repeat(64);
const FAKE_CHAIN = `sha256:${'e'.repeat(64)}`;
const bodyOf = record => { const { publicJwk: _key, signature: _signature, ...body } = record; return body; };
const signerOf = (identity, at) => createAttemptEvidenceSigner({ identity, now: () => at });

// What a party signs on top of an honest attempt (`alter`): each returns the records to present.
/** The requester signs one more acknowledgment, of 50 outputs, with a chain nobody committed. */
const inflate = async ({ parties, records }) => {
  const last = acksOf(records).at(-1);
  return [...records, await signerOf(parties.requester, Date.parse(last.signedAt)).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { ...bodyOf(last), count: 50, chain: FAKE_CHAIN })];
};
/** The requester signs its top acknowledgment only with a chain that is not the final stage's. */
const dispute = async ({ parties, records }) => {
  const last = acksOf(records).at(-1);
  return [...records.filter(row => row !== last), await signerOf(parties.requester, Date.parse(last.signedAt)).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { ...bodyOf(last), chain: FAKE_CHAIN })];
};
/** Stage `index` signs a second, different receipt at the sequence of its first one. */
const twin = index => async ({ parties, records }) => {
  const first = receiptsOf(records, index)[0], at = Date.parse(first.signedAt) + 1;
  return [...records, await signerOf(parties.stages[index], at).sign(STAGE_RECEIPT_SCHEMA, { ...bodyOf(first), signedAt: new Date(at).toISOString() })];
};
/** Stage `index` presents its first two step receipts and a close signed with 2 steps. */
const shortClose = index => async ({ parties, records }) => {
  const own = receiptsOf(records, index), close = own.find(row => row.status !== 'executing');
  return [...records.filter(row => !(own.includes(row) && row.sequence >= 3)),
    await signerOf(parties.stages[index], Date.parse(close.signedAt)).sign(STAGE_RECEIPT_SCHEMA, { ...bodyOf(close), sequence: 3, steps: 2 })];
};
/** Requester-held edges: the first and the last of four stages are on the requester's own account. */
const EDGES = { weights: [1, 10, 10, 1], outputs: words(6) }, HELD = { stages: 4, own: [0, 3] };

const BASES = [
  { name: 'complete answer', options: {} },
  { name: 'finished 40-output answer', options: { outputs: words(40) } },
  { name: 'finished 40-output answer, last acknowledgment withheld', options: { outputs: words(40), stopAckingAfter: 39 } },
  { name: 'finished 40-output answer, last three acknowledgments withheld', options: { outputs: words(40), stopAckingAfter: 37 } },
  { name: 'requester stops acknowledging after 2 of 8', options: { outputs: words(8), stopAckingAfter: 2 } },
  { name: 'requester signs a stop after 3 outputs', options: { requesterStopAfter: 3 } },
  { name: 'requester signs a stop before any output', options: { requesterStopAfter: 0 } },
  { name: 'stages close early on their own after 3 outputs', options: { stagesFailAfter: 3 } },
  { name: 'stage0 drops after 3 steps and never closes', options: { vanishStage: 0, vanishAfterStep: 2 } },
  { name: 'final stage drops after 3 steps and never closes', options: { vanishStage: 1, vanishAfterStep: 2 } },
  { name: 'answer delivered but stage0 never closes', options: { vanishStage: 0, vanishAfterStep: 4 } },
  { name: 'last acknowledgment and closes 1 s after the deadline', options: { lateAckDelayMs: 1000 } },
  { name: 'last acknowledgment and closes 5 s after the deadline', options: { lateAckDelayMs: 5000 } },
  { name: 'output ceiling 3 with 5 outputs', options: { maxOutputTokens: 3 } },
  { name: 'three stages with equal weights', options: { weights: [1, 1, 1] }, stages: 3 },
  { name: 'every party signs with P-256', options: {}, curve: 'ECDSA' },
  // A stage that never closes after acknowledged outputs: first, middle and final stage of three (weights 1, 3 and 2).
  { name: 'three stages, complete answer', options: { weights: [1, 3, 2], outputs: words(6) }, stages: 3 },
  { name: 'three stages, first stage drops after 3 steps and never closes', options: { weights: [1, 3, 2], outputs: words(6), vanishStage: 0, vanishAfterStep: 2 }, stages: 3 },
  { name: 'three stages, middle stage drops after 3 steps and never closes', options: { weights: [1, 3, 2], outputs: words(6), vanishStage: 1, vanishAfterStep: 2 }, stages: 3 },
  { name: 'three stages, final stage drops after 3 steps and never closes', options: { weights: [1, 3, 2], outputs: words(6), vanishStage: 2, vanishAfterStep: 2 }, stages: 3 },
  { name: 'three stages close early on their own after 3 outputs', options: { weights: [1, 3, 2], outputs: words(6), stagesFailAfter: 3 }, stages: 3 },
  // Nothing acknowledged.
  { name: 'stage0 drops after its first step, nothing acknowledged', options: { vanishStage: 0, vanishAfterStep: 0, stopAckingAfter: 0 } },
  { name: 'final stage drops after its first step, nothing acknowledged', options: { vanishStage: 1, vanishAfterStep: 0, stopAckingAfter: 0 } },
  // A stage owner's interruption claim, with and without a fault record.
  { name: 'final stage drops after 3 steps, its owner claims with a fault', options: { vanishStage: 1, vanishAfterStep: 2 }, claim: { stage: 1, fault: true } },
  { name: 'final stage drops after 3 steps, its owner claims without a fault record', options: { vanishStage: 1, vanishAfterStep: 2 }, claim: { stage: 1, fault: false } },
  { name: 'stage0 drops after 3 steps, its owner claims with a fault', options: { vanishStage: 0, vanishAfterStep: 2 }, claim: { stage: 0, fault: true } },
  { name: 'stage0 drops after 3 steps, its owner claims without a fault record', options: { vanishStage: 0, vanishAfterStep: 2 }, claim: { stage: 0, fault: false } },
  { name: 'stage0 drops after 3 steps, its owner claims with no checkpoint and no fault record', options: { vanishStage: 0, vanishAfterStep: 2 }, claim: { stage: 0, fault: false, checkpoint: false } },
  { name: 'three stages, middle stage drops after 3 steps, its owner claims with a fault', options: { weights: [1, 3, 2], outputs: words(6), vanishStage: 1, vanishAfterStep: 2 }, stages: 3,
    claim: { stage: 1, fault: true } },
  { name: 'final stage drops after its first step, nothing acknowledged, its owner claims with a fault', options: { vanishStage: 1, vanishAfterStep: 0, stopAckingAfter: 0 },
    claim: { stage: 1, fault: true } },
  { name: 'stage0 drops after its first step, nothing acknowledged, its owner claims without a fault record', options: { vanishStage: 0, vanishAfterStep: 0, stopAckingAfter: 0 },
    claim: { stage: 0, fault: false } },
  // A claim from a stage that also closed. The claim reaches the ledger while the request is still open (`before`);
  // one that arrives after the request has settled changes nothing, in the ledger as in a replay decided earlier.
  { name: 'stages close early after 3 outputs, the final stage\'s owner also claims with a fault', options: { stagesFailAfter: 3 }, claim: { stage: 1, fault: true, before: true } },
  { name: 'stages close early after 3 outputs, stage0\'s owner also claims with a fault', options: { stagesFailAfter: 3 }, claim: { stage: 0, fault: true, before: true } },
  { name: 'stages close early after 3 outputs, stage0\'s owner also claims without a fault record', options: { stagesFailAfter: 3 }, claim: { stage: 0, fault: false, before: true } },
  { name: 'complete answer, stage0\'s owner also claims with a fault', options: {}, claim: { stage: 0, fault: true, before: true } },
  { name: 'final stage drops after 3 steps, its owner claims with a fault before the requester\'s records', options: { vanishStage: 1, vanishAfterStep: 2 }, claim: { stage: 1, fault: true, before: true } },
  // A stage on the requester's own account (stage0 of three): its failure changes no amount.
  { name: 'own stage0 of three, complete answer', options: { weights: [1, 3, 2], outputs: words(6) }, stages: 3, ownStage: 0 },
  { name: 'own stage0 of three drops after 3 steps and never closes', options: { weights: [1, 3, 2], outputs: words(6), vanishStage: 0, vanishAfterStep: 2 }, stages: 3, ownStage: 0 },
  { name: 'own stage0 of three drops after 3 steps, its owner claims with a fault', options: { weights: [1, 3, 2], outputs: words(6), vanishStage: 0, vanishAfterStep: 2 }, stages: 3, ownStage: 0,
    claim: { stage: 0, fault: true } },
  { name: 'own stage0 of three, the middle stage drops after 3 steps and never closes', options: { weights: [1, 3, 2], outputs: words(6), vanishStage: 1, vanishAfterStep: 2 }, stages: 3, ownStage: 0 },
  { name: 'own final stage of three drops after 3 steps and never closes', options: { weights: [1, 3, 2], outputs: words(6), vanishStage: 2, vanishAfterStep: 2 }, stages: 3, ownStage: 2 },
  // Nothing a stage on the requester's own account signs or withholds reduces what the outside stages are paid.
  { name: 'requester-held edges, complete answer', options: EDGES, ...HELD },
  { name: 'requester-held edges, own final stage drops after 3 steps and never closes', options: { ...EDGES, vanishStage: 3, vanishAfterStep: 2 }, ...HELD },
  { name: 'requester-held edges, own first stage drops after 3 steps and never closes', options: { ...EDGES, vanishStage: 0, vanishAfterStep: 2 }, ...HELD },
  { name: 'requester-held edges, an operator drops after 3 steps and never closes', options: { ...EDGES, vanishStage: 1, vanishAfterStep: 2 }, ...HELD },
  { name: 'requester-held edges, stages close early on their own after 3 outputs', options: { ...EDGES, stagesFailAfter: 3 }, ...HELD },
  { name: 'requester-held edges, the requester also acknowledges 50 outputs', options: EDGES, ...HELD, alter: inflate },
  { name: 'requester-held edges, stages close early after 3 outputs, the requester also acknowledges 50', options: { ...EDGES, stagesFailAfter: 3 }, ...HELD, alter: inflate },
  { name: 'requester-held edges, own first stage signs two receipts at one sequence', options: EDGES, ...HELD, alter: twin(0) },
  { name: 'requester-held edges, own final stage signs two receipts at one sequence', options: EDGES, ...HELD, alter: twin(3) },
  { name: 'requester-held edges, own first stage closes after 2 steps', options: EDGES, ...HELD, alter: shortClose(0) },
  { name: 'requester-held edges, the requester signs only a wrong chain for the last output', options: EDGES, ...HELD, alter: dispute },
  // The same things signed by, or against, an outside stage.
  { name: 'three stages, the requester signs only a wrong chain for the last output', options: { weights: [1, 3, 2], outputs: words(6) }, stages: 3, alter: dispute },
  { name: 'three stages, the requester also acknowledges 50 outputs', options: { weights: [1, 3, 2], outputs: words(6) }, stages: 3, alter: inflate }
];

const receiptsOf = (records, index) => records.filter(row => row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === index).sort((a, b) => a.sequence - b.sequence);
const acksOf = records => records.filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((a, b) => a.count - b.count);
const without = (records, removed) => records.filter(row => !removed.includes(row));

/** Which records the parties present. Each returns null when the attempt has nothing of that kind to withhold. */
function variants(presented, stageCount) {
  const records = [...new Set(presented)], out = [{ name: 'all records', records }];
  for (let index = 0; index < stageCount; index++) {
    const all = receiptsOf(records, index), closing = all.filter(row => row.status !== 'executing');
    if (closing.length) out.push({ name: `stage${index} withholds its closing receipt`, records: without(records, closing) });
    if (all.length) out.push({ name: `stage${index} presents no receipt`, records: without(records, all) });
    // A stage that keeps back its close and its later steps: its receipts cover only part of the answer.
    if (all.filter(row => row.steps > 2).length && all.some(row => row.steps <= 2 && row.status === 'executing')) {
      out.push({ name: `stage${index} presents only its first two steps`, records: without(records, all.filter(row => row.steps > 2 || row.status !== 'executing')) });
    }
  }
  // Every stage failing: no stage presents a closing receipt.
  const closes = records.filter(row => row.schema === STAGE_RECEIPT_SCHEMA && row.status !== 'executing');
  if (closes.length > 1) out.push({ name: 'no stage presents a closing receipt', records: without(records, closes) });
  const acks = acksOf(records);
  if (acks.length > 1) {
    out.push({ name: 'requester withholds its top acknowledgment', records: without(records, [acks.at(-1)]) });
    out.push({ name: 'requester presents only its charge binding', records: without(records, acks.slice(1)) });
  }
  return out;
}

/** A live ledger with one owner account per party, unless `ownStage` puts that stage's computer in the requester's account. */
async function openLive(parties, own = [], policy = POLICY) {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-ledger-differential-'));
  const people = [parties.requester, ...parties.stages];
  const computers = people.map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`,
    ownerId: own.includes(index - 1) ? 'owner-0' : `owner-${index}`, providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
  const accountOf = new Map(computers.map(row => [row.providers[0].participantId, row.ownerId]));
  const live = { clock: T0, accountOf };
  live.ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy, now: () => live.clock });
  live.closesAt = T0 + policy.maxRequestMs + policy.partitionUnclaimedReleaseMs;
  /** `owned` lists the stages admitted with an exclusive process owner, as a live stage host admits them. */
  live.admit = (attempt, owned = []) => {
    live.clock = T0;
    live.ledger.reserve({ id: attempt.reservationId, executionId: attempt.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
      providers: attempt.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
      model: { id: attempt.identity.route.modelId, identity: attempt.identity.route.modelIdentity, adapterIdentities: [] },
      inputDigest: `sha256:${'d'.repeat(64)}`, maxOutputTokens: attempt.terms.maxOutputTokens, route: attempt.identity });
    live.ledger.dispatch(attempt.reservationId, parties.requester.peerId);
    attempt.identity.route.stages.forEach((_, index) => live.ledger.admit(attempt.reservationId, index, owned.includes(index) ? OWNER_TOKEN : null));
  };
  /**
   * A stage owner's interruption claim, as server/fleet/stage-owner.js sends it after its process died: the last
   * checkpointed step receipt when it has one and, with `fault`, the stage's signed fault record for the replay.
   */
  live.claim = async (attempt, records, { stage, fault = false, checkpoint = true }) => {
    const identity = parties.stages[stage], at = live.clock;
    const receipt = checkpoint ? receiptsOf(records, stage).filter(row => row.status === 'executing').at(-1) ?? null : null;
    const record = fault ? await signStageFaultRecord({ signer: createAttemptEvidenceSigner({ identity, now: () => at }), reservationId: attempt.reservationId,
      attemptId: attempt.identity.attemptId, routeHash: attempt.terms.routeHash, partitionIndex: stage }) : null;
    const body = { schema: FLEET_SERVICE_REQUEST_SCHEMA, participantId: identity.peerId, operation: 'closeStageOwner',
      payload: { id: attempt.reservationId, partitionIndex: stage, owner: OWNER_TOKEN, receipt, ...(record ? { fault: record } : {}) }, at, nonce: `claim-${attempt.reservationId}-${stage}` };
    return { fault: record, envelope: { ...body, signature: await signAsParticipant(identity, FLEET_SERVICE_REQUEST_SCHEMA, body) } };
  };
  /**
   * What a live route retains: each stage's latest receipt, the latest acknowledgment the ledger took and the receipt
   * it acknowledged. An acknowledgment the ledger refused when it was handed over (`live.refused`) is not handed again.
   */
  live.refused = new Set();
  live.evidence = (attempt, records) => {
    const receipts = parties.stages.map((_, index) => receiptsOf(records, index).at(-1)).filter(Boolean);
    const acknowledgment = acksOf(records).filter(row => !live.refused.has(row)).at(-1) ?? null;
    const acknowledgedReceipt = acknowledgment && acknowledgment.count > 0 ? receiptsOf(records, parties.stages.length - 1)
      .find(row => row.output?.count === acknowledgment.count && row.output.chain === acknowledgment.chain) ?? null : null;
    const stop = records.find(row => row.schema === SETTLEMENT_STOP_SCHEMA) ?? null;
    return { identity: attempt.identity, receipts, ...(acknowledgment ? { acknowledgment } : {}), ...(acknowledgedReceipt ? { acknowledgedReceipt } : {}),
      ...(stop && !LATEST_ONLY ? { stop } : {}) };
  };
  /** As the live route does: each acknowledgment is handed over when it is signed. One the ledger refuses is not retried. */
  live.collectAcknowledgments = async (attempt, records) => {
    let refused = 0;
    for (const acknowledgment of acksOf(records).filter(row => row.count > 0)) {
      const acknowledgedReceipt = receiptsOf(records, parties.stages.length - 1)
        .find(row => row.output?.count === acknowledgment.count && row.output.chain === acknowledgment.chain);
      live.clock = Date.parse(acknowledgment.signedAt) + 1;
      try { await live.ledger.collect(attempt.reservationId, { identity: attempt.identity, receipts: [], acknowledgment, ...(acknowledgedReceipt ? { acknowledgedReceipt } : {}) }); }
      catch { refused += 1; live.refused.add(acknowledgment); }
    }
    return refused;
  };
  /** As a stage host does when it closes: each stage hands in its own closing receipt. Returns how many the ledger refused. */
  live.collectCloses = async (attempt, records) => {
    let refused = 0;
    for (const [index] of parties.stages.entries()) {
      const closing = receiptsOf(records, index).filter(row => row.status !== 'executing').at(-1);
      if (!closing) continue;
      try { await live.ledger.collect(attempt.reservationId, { identity: attempt.identity, receipts: [closing] }); }
      catch { refused += 1; }
    }
    return refused;
  };
  live.close = async () => { try { live.ledger.close(); } finally { await rm(directory, { recursive: true, force: true }); } };
  return live;
}

const attempted = async work => { try { return { value: await work() }; } catch (error) { return { threw: String(error?.message ?? error).split('\n')[0].slice(0, 200) }; } };
const amountsOf = (credits, shares) => shares.map(share => (credits ?? []).filter(row => row.participantId === share.participantId).reduce((sum, row) => sum + row.amount, 0));

const forfeitsOf = rows => (rows ?? []).map(row => `${row.partitionIndex}:${row.cause}`);
// A settled outcome carries no status word, except `failed` when a stage owner's claim interrupted the answer.
const ledgerSide = (outcome, shares) => ({ status: (outcome.status === 'failed' ? undefined : outcome.status) ?? (Number.isSafeInteger(outcome.charge) ? 'settled' : 'none'), charge: outcome.charge ?? 0,
  credits: amountsOf(outcome.credits, shares), reason: outcome.reason ?? null, forfeited: forfeitsOf(outcome.forfeitedStages), closedAtLastStep: outcome.closedAtLastStep ?? [] });
const replaySide = (row, shares) => ({ status: row?.status ?? 'none', charge: row?.debit ?? 0, credits: amountsOf(row?.credits, shares), reason: row?.reason ?? null,
  forfeited: forfeitsOf(row?.forfeited), closedAtLastStep: row?.closedAtLastStep ?? [] });
const sameAmounts = (ledger, replay) => ledger.charge === replay.charge && JSON.stringify(ledger.credits) === JSON.stringify(replay.credits);
const FINAL = ['settled', 'expired'];

async function judge({ parties, base, variant, attempt }) {
  const shares = attempt.terms.shares, requesterId = parties.requester.peerId, policy = base.policy ?? POLICY;
  const live = await openLive(parties, base.own, policy);
  const replayAt = async (records, at) => {
    const replayed = await replaySettlement({ records, policies: [policy], at, accountOf: id => live.accountOf.get(id) });
    return replayed.reservations.find(item => item.reservationId === attempt.reservationId && item.requesterId === requesterId) ?? null;
  };
  let collected, final;
  try {
    const admitted = await attempted(async () => live.admit(attempt, base.claim ? [base.claim.stage] : []));
    if (admitted.threw) {
      return { base: base.name, variant: variant.name, ledger: { status: 'refused the reservation', charge: 0, credits: shares.map(() => 0), reason: admitted.threw, atCollect: null },
        replay: { status: 'not asked', charge: 0, credits: shares.map(() => 0), reason: null }, amountsAgree: false, refused: true };
    }
    const binding = live.ledger.request(attempt.reservationId).binding;
    const rules = { settlementRules: binding.settlementRules, unfinishedTerms: binding.unfinishedTerms, signedUnfinishedTerms: attempt.terms.unfinishedTerms };
    const refusedAcknowledgments = LATEST_ONLY ? 0 : await live.collectAcknowledgments(attempt, variant.records);
    // The ledger cannot hold a record before it was signed.
    live.clock = Math.max(T0 + 1, ...variant.records.map(row => Date.parse(row.signedAt))) + 1;
    const collectedAt = live.clock - T0;
    let records = variant.records, made = null, answered = null;
    const fileClaim = async () => {
      made = await live.claim(attempt, variant.records, base.claim);
      answered = await attempted(() => live.ledger.closeStageOwner(made.envelope));
      if (made.fault) records = [...variant.records, made.fault];
    };
    // Each stage hands in every receipt it presents that is not its latest (an earlier step, or a second receipt at one
    // sequence), so that the ledger is given the records the replay is given; it keeps one receipt per stage.
    if (!LATEST_ONLY && base.alter) for (const [index] of parties.stages.entries()) {
      for (const receipt of receiptsOf(variant.records, index).slice(0, -1).filter(row => row.sequence <= 2)) {
        await attempted(() => live.ledger.collect(attempt.reservationId, { identity: attempt.identity, receipts: [receipt] }));
      }
    }
    // Each stage that closed hands in its own closing receipt, as a stage host does (execution-admission.js).
    const refusedCloses = LATEST_ONLY ? 0 : await live.collectCloses(attempt, variant.records);
    // A claim marked `before` reaches the ledger while the request is still open, ahead of the requester's records.
    if (base.claim?.before) await fileClaim();
    collected = await attempted(async () => { await live.ledger.fence(attempt.reservationId, requesterId); return live.ledger.collect(attempt.reservationId, live.evidence(attempt, variant.records)); });
    if (base.claim && !base.claim.before) { live.clock += 10; await fileClaim(); }
    // What both say once the claim and the records have been handed over: a signed fault decides its own stage at once.
    let claim = null;
    if (base.claim) {
      const then = await attempted(() => live.ledger.recover(attempt.reservationId));
      const ledgerThen = then.threw ? { status: 'threw', charge: 0, credits: shares.map(() => 0), reason: then.threw } : ledgerSide(then.value ?? {}, shares);
      const replayThen = replaySide(await replayAt(records, live.clock), shares);
      const bothFinal = FINAL.includes(ledgerThen.status) && FINAL.includes(replayThen.status);
      claim = { stage: base.claim.stage, faultRecord: Boolean(made.fault), checkpoint: made.envelope.payload.receipt !== null, beforeTheRequesterRecords: base.claim.before === true,
        atMs: live.clock - T0, refused: answered.threw ?? null, ledger: ledgerThen, replay: replayThen, bothFinal, amountsAgree: bothFinal ? sameAmounts(ledgerThen, replayThen) : null };
    }
    // Both are asked once the attempt is decided: after the deadline, the release window and the clock allowance.
    live.clock = live.closesAt + policy.maxClockSkewMs + 1;
    final = await attempted(() => live.ledger.recover(attempt.reservationId));
    const row = await replayAt(records, attempt.closesAt + policy.maxClockSkewMs + 1);
    const outcome = final.value ?? {};
    // A settled outcome carries its charge and credits and no status word.
    const ledger = { ...(final.threw ? { status: 'threw', charge: 0, credits: shares.map(() => 0), reason: final.threw, forfeited: [], closedAtLastStep: [] } : ledgerSide(outcome, shares)),
      atCollect: collected.threw ? `threw: ${collected.threw}` : collected.value?.status ?? null, collectedAtMs: collectedAt, refusedAcknowledgments, refusedCloses };
    const replay = replaySide(row, shares);
    if (claim?.faultRecord) {
      // The ledger keeps the fault it was handed and returns it with the request's evidence, for anyone to replay.
      const kept = (live.ledger.request(attempt.reservationId).evidence?.interruptedOwners ?? []).map(item => item.payload?.fault).filter(Boolean);
      claim.faultReturnedWithEvidence = kept.some(item => JSON.stringify(item) === JSON.stringify(records.at(-1)));
    }
    return { base: base.name, variant: variant.name, rules, ledger, replay, ...(claim ? { claim } : {}),
      amountsAgree: sameAmounts(ledger, replay) && claim?.amountsAgree !== false };
  } finally {
    await live.close();
  }
}

/**
 * A name for each difference in amounts. Every case runs under the failed-stage rules (reploid.settlement-replay/v3,
 * signed as the terms' unfinished-answer terms), where the ledger and the replay must agree: no difference is expected,
 * and the known differences of the earlier rules cannot arise here.
 */
function causeOf(line) {
  if (line.amountsAgree) return null;
  if (line.refused) return 'the ledger refused the reservation';
  if (LATEST_ONLY && line.base.startsWith('requester signs a stop')) return 'the ledger was not handed the requester\'s stop';
  return 'unclassified';
}

async function main() {
  const startedAt = new Date();
  const make = (algorithm, count) => Promise.all(Array.from({ length: count + 1 }, () => createSigningIdentity({ algorithm })))
    .then(([requester, ...stages]) => ({ requester, stages }));
  const two = await createParties(2), three = await createParties(3), curved = await make('ECDSA', 2);
  const lines = [];
  const four = await createParties(4);
  for (const [index, source] of BASES.entries()) {
    const own = source.own ?? (source.ownStage === undefined ? [] : [source.ownStage]);
    const base = { ...source, own, policy: own.length ? OWN_STAGE_POLICY : POLICY };
    const parties = base.curve ? curved : base.stages === 4 ? four : base.stages === 3 ? three : two;
    // What the parties present: the attempt's records, with whatever the case has a party sign on top (`alter`).
    const presentedBy = async attempt => (base.alter ? base.alter({ parties, attempt, records: [...new Set(attempt.all())] }) : attempt.all());
    // Every case gets its own attempt: a ledger takes a reservation ID once.
    const probe = await runAttempt(parties, { tag: `p${index}`, policy: base.policy, ...base.options });
    for (const [at, chosen] of variants(await presentedBy(probe), parties.stages.length).entries()) {
      const attempt = await runAttempt(parties, { tag: `l${index}-${at}`, policy: base.policy, ...base.options });
      const variant = variants(await presentedBy(attempt), parties.stages.length).find(item => item.name === chosen.name);
      const line = await judge({ parties, base, variant, attempt });
      lines.push({ ...line, cause: causeOf(line) });
    }
  }
  const differing = lines.filter(line => !line.amountsAgree), byCause = {};
  for (const line of differing) (byCause[line.cause] ??= []).push(`${line.base} | ${line.variant}`);
  const statusPairs = {};
  for (const line of lines) { const pair = `${line.ledger.status} / ${line.replay.status}`; statusPairs[pair] = (statusPairs[pair] ?? 0) + 1; }
  // Every case must have run under the failed-stage rules, in the ledger and in the signed terms.
  const otherRules = lines.filter(line => !line.refused && !(line.rules?.settlementRules === SETTLEMENT_RULES && line.rules.unfinishedTerms === UNFINISHED_ANSWER_TERMS_V3
    && line.rules.signedUnfinishedTerms === UNFINISHED_ANSWER_TERMS_V3));
  // Cases where a stage forfeited in either, and whether both name the same stages. A claim without a fault record is
  // a `fault` in the ledger and, for the replay, a stage that did not close.
  const forfeiting = lines.filter(line => line.ledger.forfeited?.length || line.replay.forfeited?.length);
  const stagesOf = rows => JSON.stringify((rows ?? []).map(row => Number(row.split(':')[0])));
  const bothSettled = forfeiting.filter(line => line.ledger.status === 'settled' && line.replay.status === 'settled');
  const claims = lines.filter(line => line.claim);
  const forfeits = { cases: forfeiting.length, bothSettled: bothSettled.length,
    sameStages: bothSettled.filter(line => stagesOf(line.ledger.forfeited) === stagesOf(line.replay.forfeited)).length,
    sameStagesAndCauses: bothSettled.filter(line => JSON.stringify(line.ledger.forfeited) === JSON.stringify(line.replay.forfeited)).length };
  const claimSummary = { cases: claims.length, refused: claims.filter(line => line.claim.refused).length,
    withFaultRecord: claims.filter(line => line.claim.faultRecord).length,
    bothFinalAtTheClaim: claims.filter(line => line.claim.bothFinal).length,
    agreedAtTheClaim: claims.filter(line => line.claim.amountsAgree === true).length,
    faultReturnedWithEvidence: claims.filter(line => line.claim.faultReturnedWithEvidence === true).length };
  let commit = 'unknown', dirty = null;
  try {
    commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    // The code this comparison runs: the ledger, the replay, the signers, the scenario builder and this file.
    dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'server/fleet', 'scripts/settlement/scenario.js',
      'scripts/settlement/independent/ledger-differential.js', 'packages/reploid/src'], { encoding: 'utf8' }).trim().length > 0;
  } catch { /* the receipt says unknown */ }
  const receipt = { schema: 'reploid.settlement-ledger-differential/v1', generatedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    command: 'node scripts/settlement/independent/ledger-differential.js --out scripts/settlement/independent/receipts/ledger-differential.json',
    commit, uncommittedChangesInComparedCode: dirty, node: process.version,
    note: 'All parties are simulated identities on one machine under one operator. The ledger is given each acknowledgment when it was signed, then what a live route retains (latest records and the signed stop) at the moment the last of them was signed, then a stage owner\'s interruption claim where the case has one, and asked again after the release window; the replay judges the same records (and the claim\'s fault record, when it carries one) after the window, and for a claim also at the moment of the claim. Status pairs are ledger / replay.',
    settlementRules: SETTLEMENT_RULES, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3, casesUnderOtherRules: otherRules.length,
    policy: POLICY, ownStagePolicy: OWN_STAGE_POLICY, handedToTheLedger: LATEST_ONLY ? 'the final collect only, no stop' : 'each acknowledgment as signed, then the final collect with the stop', cases: lines.length, amountsAgreed: lines.length - differing.length, statusPairs: Object.fromEntries(Object.entries(statusPairs).sort()),
    forfeits, claims: claimSummary,
    differences: { total: differing.length, byCause: Object.fromEntries(Object.entries(byCause).map(([cause, rows]) => [cause, { count: rows.length, cases: rows }])) },
    lines };
  const out = flag('out');
  if (out && out !== true) { const file = path.resolve(process.cwd(), out); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`); }
  console.log(JSON.stringify({ settlementRules: receipt.settlementRules, cases: receipt.cases, amountsAgreed: receipt.amountsAgreed, casesUnderOtherRules: receipt.casesUnderOtherRules,
    statusPairs: receipt.statusPairs, forfeits, claims: claimSummary }, null, 2));
  console.log(`\nDifferent amounts: ${differing.length}`);
  for (const [cause, rows] of Object.entries(byCause)) console.log(`  ${String(rows.length).padStart(3)}  ${cause}`);
  for (const line of lines) {
    if (line.amountsAgree && !flag('verbose')) continue;
    console.log(`${line.amountsAgree ? '  same' : 'DIFFER'} | ${line.base} | ${line.variant} | ledger ${line.ledger.status} ${line.ledger.charge} ${JSON.stringify(line.ledger.credits)} forfeited ${JSON.stringify(line.ledger.forfeited ?? [])} (${line.ledger.reason}; at collect: ${line.ledger.atCollect}) | replay ${line.replay.status} ${line.replay.charge} ${JSON.stringify(line.replay.credits)} forfeited ${JSON.stringify(line.replay.forfeited ?? [])} (${line.replay.reason})`
      + (line.claim ? ` | at the claim: ledger ${line.claim.refused ? `refused (${line.claim.refused})` : `${line.claim.ledger.status} ${line.claim.ledger.charge} ${JSON.stringify(line.claim.ledger.credits)}`}, replay ${line.claim.replay.status} ${line.claim.replay.charge} ${JSON.stringify(line.claim.replay.credits)}` : ''));
  }
  // A comparison that did not run under the rules it names, or that differs, is a failure of this script.
  if (!LATEST_ONLY && (differing.length || otherRules.length)) process.exitCode = 1;
}

await main();
