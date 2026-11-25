/**
 * Builds the signed records of one split attempt with the production signing code: the requester's terms and charge
 * binding, each stage's acceptance and cumulative receipts (openStageReceipts, including its acknowledgment bound),
 * and the requester's acknowledgments (openOutputAcknowledgments). No model runs; each step's text is supplied.
 * A fake clock controls every signed time so late records can be produced on purpose.
 */
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import {
  ACKNOWLEDGMENT_OVERDUE, MAX_UNACKNOWLEDGED_OUTPUTS, createAttemptEvidenceSigner, openOutputAcknowledgments, openStageReceipts
} from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { acceptSettlementTerms, signSettlementStop, signSettlementTerms } from '../../server/fleet/settlement-terms.js';
import { UNFINISHED_ANSWER_TERMS_V2 } from '../../server/fleet/credit-shares.js';

export const POLICY = Object.freeze({
  schema: 'reploid.service-credit-policy/v1', unit: 'noncash-service-credit', version: 'settlement-replay-1',
  creditsPerOutputToken: 3, maxDebt: 1000, maxOutputTokens: 128, maxPendingPerComputer: 4, maxClockSkewMs: 1000,
  maxRequestMs: 120000, allowSameOwner: false, partitionUnclaimedReleaseMs: 60000,
  // K, published in the policy (and so in its digest), as the stages' receiver policy enforces it.
  maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS
});
export const T0 = Date.parse('2026-11-24T12:00:00.000Z');

export function createClock(start = T0) {
  let current = start;
  return { now: () => current, advance: ms => { current += ms; return current; }, set: ms => { current = ms; } };
}

export async function createParties(stageCount = 2) {
  const make = () => createSigningIdentity({ algorithm: 'Ed25519' });
  const requester = await make(), stages = [];
  for (let i = 0; i < stageCount; i++) stages.push(await make());
  return { requester, stages };
}

const route = (parties, tag) => ({
  schema: 'reploid.partition-route/v1', modelId: 'model', modelIdentity: 'sha256:' + 'a'.repeat(64), planId: 'sha256:' + 'b'.repeat(64),
  activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 8, precision: 'f32', components: 1, elementStrideBytes: 4 },
  stages: parties.stages.map((stage, index) => ({ index, participantId: stage.peerId, transportId: `transport-${tag}-${index}`,
    residentId: `resident-${tag}-${index}`, executionId: `execution-${tag}-${index}` }))
});

/**
 * Runs one attempt. Options:
 *  outputs: the text of each step the final stage produces (the last one is `done`)
 *  stopAckingAfter: the requester acknowledges no output after this count (a requester that takes output and stops paying)
 *  vanishStage / vanishAfterStep: that stage signs nothing more after that step and never closes (provider loss)
 *  lateAckDelayMs: sign the final acknowledgment this long after the deadline
 *  requesterStopAfter: the requester signs a stop after this many outputs and the stages close
 *  stagesFailAfter: the stages close with a failed receipt after this many outputs, the requester having acknowledged all
 *  maxOutputTokens: the ceiling in the requester's signed terms
 *  unfinishedTerms: the signed unfinished-answer terms (by default the decided ones, UNFINISHED_ANSWER_TERMS_V2)
 *  maxUnacknowledgedOutputs: K in the signed terms and the stages' acceptances (the stages' tallies enforce the receiver policy's K)
 *  accounts: `{ requester, stages: [...] }` signs the requester's `debitAccount` into the terms and each stage's
 *    `payoutAccount` into its acceptance (signed accounts, docs/settlement-replay.md step 8); by default none are signed
 * Returns the records each party holds, the attempt's terms, and what was actually delivered.
 */
export async function runAttempt(parties, { tag = 'r1', outputs = ['The', ' answer', ' is', ' 26', '.'], weights = [1, 3],
  stopAckingAfter = Infinity, vanishStage = null, vanishAfterStep = Infinity, lateAckDelayMs = null, clock = createClock(),
  requesterStopAfter = null, stagesFailAfter = null, maxOutputTokens = 64, maxUnacknowledgedOutputs = MAX_UNACKNOWLEDGED_OUTPUTS,
  unfinishedTerms = UNFINISHED_ANSWER_TERMS_V2, policy = POLICY, accounts = null } = {}) {
  const r = route(parties, tag);
  const identity = { schema: 'reploid.partition-attempt/v2', threadId: `thread-${tag}`, attemptId: `attempt-${tag}`,
    requesterId: parties.requester.peerId, placementGeneration: 0, route: r };
  const reservationId = `reservation-${tag}`, now = clock.now;
  const requesterSigner = createAttemptEvidenceSigner({ identity: parties.requester, now });
  const stageSigners = parties.stages.map(stage => createAttemptEvidenceSigner({ identity: stage, now }));
  const notBefore = now(), deadline = notBefore + 30000;
  const terms = await signSettlementTerms({ signer: requesterSigner, identity, reservationId, policy, maxOutputTokens,
    weights, notBefore, deadline, unfinishedTerms, maxUnacknowledgedOutputs, ...(accounts ? { debitAccount: accounts.requester } : {}) });
  // The stages here settle under whatever unfinished-answer terms the scenario signs, so older rules can be replayed.
  const acceptances = await Promise.all(stageSigners.map((signer, index) => acceptSettlementTerms({ signer, terms, partitionIndex: index,
    maxUnacknowledgedOutputs, unfinishedTerms, ...(accounts ? { payoutAccount: accounts.stages[index] } : {}) })));
  const acks = await openOutputAcknowledgments({ signer: requesterSigner, identity, reservationId });
  const tallies = await Promise.all(stageSigners.map((signer, index) => openStageReceipts({ signer, identity, partitionIndex: index, charge: acks.charge })));
  const held = { requester: [terms, acks.charge], stages: parties.stages.map((_, index) => [terms, acceptances[index], acks.charge]) };
  const vanished = new Set();
  let latestPair = null, delivered = 0, refusedAtStep = null;
  let failedClose = false;
  for (let step = 0; step < outputs.length; step++) {
    if (requesterStopAfter !== null && step === requesterStopAfter) {
      held.requester.push(await signSettlementStop({ signer: requesterSigner, terms, acknowledged: latestPair?.acknowledgment.count ?? 0 }));
      break;
    }
    if (stagesFailAfter !== null && step === stagesFailAfter) { failedClose = true; break; }
    clock.advance(500);
    let refused = false;
    for (const [index, tally] of tallies.entries()) {
      if (vanished.has(index)) { refused = true; break; }
      try { await tally.authorizeStep({ step, acknowledged: latestPair }); }
      catch (error) { if (error.code === ACKNOWLEDGMENT_OVERDUE) { refused = true; refusedAtStep = step; break; } throw error; }
    }
    if (refused) break;
    let finalReceipt = null;
    for (const [index, tally] of tallies.entries()) {
      const final = index === tallies.length - 1;
      const receipt = await tally.step({ step, inputTokenCount: step === 0 ? 12 : 1, ...(final ? { delta: outputs[step], done: step === outputs.length - 1,
        stopReason: step === outputs.length - 1 ? 'eos' : null } : {}) });
      held.stages[index].push(receipt);
      if (final) finalReceipt = receipt;
      if (index === vanishStage && step >= vanishAfterStep) vanished.add(index);
    }
    delivered = step + 1;
    if (delivered <= stopAckingAfter) {
      if (lateAckDelayMs !== null && step === outputs.length - 1) clock.set(deadline + lateAckDelayMs);
      const pair = await acks.observe({ step, delta: outputs[step], receipt: finalReceipt });
      if (pair) { latestPair = pair; held.requester.push(pair.acknowledgment, pair.receipt); tallies.forEach((_, i) => !vanished.has(i) && held.stages[i].push(pair.acknowledgment)); }
    }
  }
  for (const [index, tally] of tallies.entries()) {
    if (vanished.has(index)) continue;
    if (latestPair) await tally.acknowledge(latestPair);
    held.stages[index].push(await tally.close({ failed: refusedAtStep !== null || failedClose }));
  }
  return { terms, reservationId, identity, held, delivered, acknowledged: latestPair?.acknowledgment.count ?? 0, refusedAtStep,
    deadline, closesAt: deadline + policy.partitionUnclaimedReleaseMs,
    // The first instant the attempt is decided: after the last one at which a closing receipt counts (step 6).
    decidedAt: deadline + policy.partitionUnclaimedReleaseMs + policy.maxClockSkewMs + 1, all: () => [...held.requester, ...held.stages.flat()] };
}
