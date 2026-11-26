import { verifyGenerationTerminal, GENERATION_TERMINAL_SCHEMAS } from '../../shared/vendor/reploid/artifacts/generation-terminal.js';
import { verifyReceipt } from '../../shared/vendor/reploid/artifacts/receipt.js';
import {
  MAX_UNACKNOWLEDGED_OUTPUTS, verifyStageReceipt, verifyOutputAcknowledgment, attemptRouteHash, outputChainGenesis
} from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { canonicalRouteAttemptBinding } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { normalizeParticipantPublicKey } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { assert, same, integer } from './contract.js';
import { SETTLEMENT_STOP_SCHEMA, verifySettlementFault, verifySettlementStop } from './settlement-terms.js';
import { SETTLEMENT_RULES, SETTLEMENT_RULES_INTERIM, SETTLEMENT_RULES_V2, SETTLEMENT_RULE_SETS, UNFINISHED_ANSWER_TERMS } from './credit-shares.js';

/** A split reservation made since the ledger applies the settlement replay's charge rules (docs/settlement-replay.md). */
export const replayRules = request => request.mode === 'partition' && SETTLEMENT_RULE_SETS.includes(request.settlementRules);

/**
 * A split reservation under the failed-stage rules (SETTLEMENT_RULES, docs/settlement-replay.md "Failed stages"): a
 * stage that fails forfeits its own share and nothing else. Every earlier rules id keeps the rule it was reserved under.
 */
export const forfeitRules = request => request.mode === 'partition' && request.settlementRules === SETTLEMENT_RULES;

/**
 * Whether a split request's release window has passed at `now`, so that it can be decided without the missing
 * closes. Under the interim rules (SETTLEMENT_RULES_INTERIM) and every later id (SETTLEMENT_RULES_V2, SETTLEMENT_RULES)
 * that is after deadline + window + clock allowance, the last instant a closing receipt counts
 * (docs/settlement-replay.md, step 6); earlier reservations keep deadline + window.
 */
export const releaseWindowPassed = (request, now, releaseWindowMs, skew) => (request.mode === 'partition'
  && [SETTLEMENT_RULES_INTERIM, SETTLEMENT_RULES_V2, SETTLEMENT_RULES].includes(request.settlementRules)
  ? now > request.deadline + releaseWindowMs + skew : now >= request.deadline + releaseWindowMs);

/**
 * A whole-model answer the requester stopped before it countersigned a receipt. Whole-model output has no
 * per-token acknowledgment, so the acknowledged count is zero and the stop settles as a cancellation: no charge, no
 * credit, the same economic outcome as the provider's own signed `cancelled` cleanup under zero terminal terms. A
 * countersigned receipt can only exist if the requester accepted the answer; whichever signed closing statement
 * reaches the ledger first settles the request, and a conflicting one is refused.
 */
async function verifyWholeModelStop(request, evidence, enrollment, now, skew) {
  const checked = await verifySettlementStop(evidence);
  const signedAt = checked.ok ? Date.parse(checked.body.signedAt) : NaN;
  assert(checked.ok && checked.body.reservationId === request.id && checked.body.attemptId === request.executionId
    && checked.body.requesterId === request.consumer && checked.body.acknowledged === 0
    && same(normalizeParticipantPublicKey(evidence.publicJwk), enrollment.byPeer.get(request.consumer)?.publicJwk)
    && signedAt >= request.createdAt - skew && signedAt <= now + skew, 'Requester stop does not match the accepted request');
  return { outputTokens: null, terminalStatus: 'cancelled', fixedCharge: 0, outputIdentity: null,
    workIds: [`whole:${request.providers[0].participantId}:${request.consumer}:request:${request.executionId}`] };
}

const closedReceipt = receipt => receipt.status !== 'executing' && receipt.timing.closedAt !== null;

/**
 * The requester's signed stop of one split answer, checked against the reservation. Returns the stop when it was
 * signed in time (by the deadline plus the clock allowance), null when it was signed later: like the replay, the
 * ledger ignores a late stop. A stop that does not verify or names another request is refused.
 */
export async function verifySplitStop(request, stop, enrollment, now, skew) {
  const checked = await verifySettlementStop(stop);
  const signedAt = checked.ok ? Date.parse(checked.body.signedAt) : NaN;
  assert(checked.ok && checked.body.reservationId === request.id && checked.body.attemptId === request.executionId
    && checked.body.requesterId === request.consumer
    && same(normalizeParticipantPublicKey(stop.publicJwk), enrollment.byPeer.get(request.consumer)?.publicJwk)
    && signedAt >= request.createdAt - skew && signedAt <= now + skew, 'Requester stop does not match the accepted request');
  return signedAt <= request.deadline + skew ? structuredClone(stop) : null;
}

/** The final stage's latest retained receipt: its closing or step receipt, or the one the requester acknowledged. */
const finalReceiptOf = (request, { receipts, acknowledgedReceipt }) => [receipts.find(row => row.partitionIndex === request.providers.length - 1),
  acknowledgedReceipt].filter(Boolean).sort((a, b) => a.sequence - b.sequence).at(-1) ?? null;

/**
 * Whether the retained components show a delivered answer (the final stage signed `done` at N > 0 and the requester
 * acknowledged N with its chain in time) that some stage has no in-time receipt covering. The replay calls such an
 * attempt `unknown`; the ledger releases its hold with no charge and says so.
 */
export function deliveredWithoutCoveringReceipt(request, { receipts, acknowledgment, acknowledgedReceipt }, skew) {
  const count = acknowledgment?.count ?? 0;
  const inTime = value => Date.parse(value) <= request.deadline + skew;
  if (count === 0 || !inTime(acknowledgment.signedAt)) return false;
  const delivered = finalReceiptOf(request, { receipts, acknowledgedReceipt })?.output;
  if (!(delivered?.done === true && delivered.count === count && delivered.chain === acknowledgment.chain)) return false;
  return request.providers.some((_, index) => {
    const own = receipts.find(row => row.partitionIndex === index);
    if (own && closedReceipt(own)) return false;
    const covering = [own, index === request.providers.length - 1 ? acknowledgedReceipt : null].filter(row => row && inTime(row.signedAt));
    return !covering.some(row => row.steps >= count);
  });
}

/**
 * The settlement replay's closing rule (docs/settlement-replay.md, step 6) over already verified split components.
 * It applies when the final stage signed `done` at N > 0, the requester acknowledged N with the final stage's chain
 * before the deadline (plus clock skew), every stage that closed covers N, and each stage that did not close has a
 * receipt signed before the deadline covering all N steps. Returns those unclosed stages, which are treated as
 * closed at their last signed step once the release window has passed; otherwise null. An unfinished answer, as
 * after a provider loss, never qualifies.
 */
export function stagesClosedAtLastStep(request, { receipts, acknowledgment, acknowledgedReceipt }, skew) {
  const count = acknowledgment?.count ?? 0, finalIndex = request.providers.length - 1;
  const inTime = value => Date.parse(value) <= request.deadline + skew;
  if (count === 0 || !inTime(acknowledgment.signedAt)) return null;
  const own = index => [receipts.find(row => row.partitionIndex === index), index === finalIndex ? acknowledgedReceipt : null]
    .filter(Boolean).sort((a, b) => a.sequence - b.sequence);
  const delivered = own(finalIndex).filter(row => inTime(row.signedAt)).at(-1)?.output;
  if (!(delivered?.done === true && delivered.count === count && delivered.chain === acknowledgment.chain)) return null;
  const unclosed = [];
  for (let index = 0; index <= finalIndex; index++) {
    const rows = own(index), closing = rows.find(closedReceipt);
    if (closing) { if (closing.steps < count) return null; continue; }
    const covering = rows.filter(row => inTime(row.signedAt)).at(-1);
    if (!covering || covering.steps < count) return null;
    unclosed.push(index);
  }
  return unclosed.length ? unclosed : null;
}

/**
 * The signed stage-fault record a stage owner's interruption claim may carry (settlement-terms.js
 * `reploid.settlement-stage-fault/v1`), checked against the reservation: it names this reservation, attempt, route
 * and stage, and it is signed by the stage's enrolled key, no earlier than the reservation (less the clock allowance)
 * and no later than `now` (plus it). The ledger keeps it with the claim so that the settlement replay, which reads no
 * ledger claim, can reach the same result from records alone. `closesBy` (failed-stage rules, while the request is
 * undecided) is the last instant at which the replay counts a fault: a record signed later would be late there.
 */
export async function verifyClaimedFault(request, stage, fault, enrollment, now, skew, { closesBy = Infinity } = {}) {
  const checked = await verifySettlementFault(fault);
  const provider = request.providers[stage], signedAt = checked.ok ? Date.parse(checked.body.signedAt) : NaN;
  assert(checked.ok && provider && checked.body.reservationId === request.id && checked.body.attemptId === request.executionId
    && checked.body.routeHash === await attemptRouteHash(request.route) && checked.body.partitionIndex === stage
    && checked.body.participantId === provider.participantId
    && same(normalizeParticipantPublicKey(fault.publicJwk), enrollment.byPeer.get(provider.participantId)?.publicJwk)
    && signedAt >= request.createdAt - skew && signedAt <= now + skew, 'Stage fault does not match the accepted request');
  assert(signedAt <= closesBy, 'Stage fault is signed after the release window');
}

/**
 * Failed-stage rules: whether a stage is the requester's own, that is, on the reservation's owner account (the test
 * accountSettlement uses to charge and credit nothing for it). Nothing such a stage signs or withholds may reduce what
 * the other, outside, stages are paid (docs/settlement-replay.md, "The requester's own stages").
 */
export const ownStageOf = (request, enrollment) => index => request.accountId !== undefined
  && enrollment.byPeer.get(request.providers[index]?.participantId)?.ownerId === request.accountId;

/**
 * Failed-stage rules: which stages are paid and which forfeit, from already verified components (steps 6 and 7 of
 * docs/settlement-replay.md, as the settlement replay applies them to the same records).
 *
 * `claims` are the stage owners' interruption claims that count (`[{ stage, closure }]`). A claim is the ledger's
 * signed fault: a claimed stage forfeits with cause `fault`, or `fault-and-close` when it also has a closing receipt.
 * A claim that carries no fault record forfeits only a stage that has not closed: the replay has no record of such a
 * claim, sees the stage's close and pays it, and the ledger posts the same.
 *
 * A stage with neither a closing receipt nor a claim is `silent`. Once the release window has passed it is treated as
 * closed at its last signed step when the answer was delivered (the final stage signed `done` at N > 0 and the
 * requester acknowledged N with that chain in time) and its in-time receipts cover all N steps; otherwise it forfeits
 * with cause `no-close`. A stage that was never admitted, with nothing acknowledged, owes no close and is `skipped`.
 * `short` lists the stages that would be paid but whose closing receipt is behind the acknowledged output: the
 * replay calls that a conflict and moves nothing, so such a request cannot settle.
 *
 * `own(index)` says whether a stage is the requester's own (ownStageOf). Such a stage is never paid, so its steps are
 * not tested. When the final stage is the requester's own, only the requester vouches for the acknowledged count: no
 * stage is `short`, the requester's acknowledgment needs no matching chain to show a delivered answer, and the charge
 * stops at `stepCap`, the fewest steps signed by any outside stage that is paid (Infinity when there is none).
 */
export function decideFailedStages(request, { receipts, acknowledgment, acknowledgedReceipt, twins }, { claims = [], unadmitted = [], skew, own = () => false }) {
  const count = acknowledgment?.count ?? 0, finalIndex = request.providers.length - 1, ownFinal = own(finalIndex);
  const inTime = value => Date.parse(value) <= request.deadline + skew;
  const held = index => [receipts.find(row => row.partitionIndex === index), index === finalIndex ? acknowledgedReceipt : null]
    .filter(Boolean).sort((a, b) => a.sequence - b.sequence);
  // A requester's own final stage that signed two different receipts at the sequence of its last in-time one
  // contradicted itself there: as in the replay (ownFinalEnd), it then shows no delivered answer, and it forfeits.
  const last = held(finalIndex).filter(row => inTime(row.signedAt)).at(-1);
  const twinned = ownFinal && Boolean(last) && [...held(finalIndex), ...(twins ?? [])]
    .some(row => row.partitionIndex === finalIndex && row.sequence === last.sequence && !same(row, last));
  const delivered = twinned ? null : last?.output;
  const answerDelivered = count > 0 && inTime(acknowledgment.signedAt) && delivered?.done === true && delivered.count === count
    && (ownFinal || delivered.chain === acknowledgment.chain);
  const closedAtLastStep = [], forfeitedStages = [], silent = [], skipped = [], short = [], paidSteps = [];
  for (let index = 0; index <= finalIndex; index++) {
    const receipt = receipts.find(row => row.partitionIndex === index), closed = Boolean(receipt && closedReceipt(receipt));
    const claim = claims.find(row => row.stage === index);
    if (twinned && index === finalIndex) { forfeitedStages.push({ partitionIndex: index, cause: 'contradiction' }); continue; }
    if (claim && (claim.closure.payload.fault || !closed)) { forfeitedStages.push({ partitionIndex: index, cause: closed ? 'fault-and-close' : 'fault' }); continue; }
    if (closed) {
      if (!own(index)) { paidSteps.push(receipt.steps); if (!ownFinal && receipt.steps < count) short.push(index); }
      continue;
    }
    if (!receipt && unadmitted.includes(index) && count === 0) { skipped.push(index); continue; }
    silent.push(index);
    const covering = held(index).filter(row => inTime(row.signedAt)).at(-1);
    if (answerDelivered && covering && covering.steps >= count) { closedAtLastStep.push(index); if (!own(index)) paidSteps.push(covering.steps); }
    else forfeitedStages.push({ partitionIndex: index, cause: 'no-close' });
  }
  return { closedAtLastStep, forfeitedStages, silent, skipped, short, stepCap: ownFinal && paidSteps.length ? Math.min(...paidSteps) : Infinity };
}

/**
 * What a split request under the failed-stage rules settles as, from already verified components: the observation
 * verifyCreditEvidence returns for it. Signatures are not checked here; the ledger also calls it, at window expiry, on
 * components it verified when it collected them, so both reach the same observation for the same evidence.
 *
 * `stated` holds the evidence's own `closedAtLastStep` and `forfeitedStages`: evidence names the stages it treats as
 * closed and the stages that forfeit, and this accepts it only when the rule gives exactly those. A silent stage is
 * decided only once the release window has passed (`windowPassed`), and only with acknowledged output: with nothing
 * acknowledged the request expires instead and nobody is charged or paid.
 *
 * When the final stage is the requester's own (`own`, ownStageOf), the requester's acknowledgment counts by itself,
 * with no final-stage receipt committing its chain, and the charged output stops at the step cap; what was
 * acknowledged past it is recorded as `beyondStageSteps` and never charged.
 */
export function observeFailedStageRules(request, proof, { claims = [], unadmitted = [], stated = {}, windowPassed = false, stop = null,
  maxUnacknowledgedOutputs = MAX_UNACKNOWLEDGED_OUTPUTS, skew, own = () => false }) {
  // K as the reservation pinned it; the caller's value only for a reservation made before K was pinned.
  maxUnacknowledgedOutputs = request.maxUnacknowledgedOutputs ?? maxUnacknowledgedOutputs;
  const { receipts, acknowledgment, acknowledgedReceipt } = proof, count = acknowledgment.count;
  const decided = decideFailedStages(request, proof, { claims, unadmitted, skew, own });
  assert(decided.short.length === 0, 'Settled stage receipt does not match the acknowledged work');
  assert(decided.silent.length === 0 || windowPassed && count > 0,
    'A stage with no closing receipt is decided only after the release window, and only for acknowledged output');
  assert(same(stated.closedAtLastStep ?? [], decided.closedAtLastStep) && (stated.closedAtLastStep === undefined || decided.closedAtLastStep.length > 0),
    'A stage is treated as closed at its last signed step only after the release window, for a delivered and acknowledged answer');
  assert(same(stated.forfeitedStages ?? [], decided.forfeitedStages) && (stated.forfeitedStages === undefined || decided.forfeitedStages.length > 0),
    'The forfeiting stages differ from the stages that failed');
  if (count > 0 && !own(request.providers.length - 1)) {
    const final = acknowledgedReceipt ?? receipts.find(row => row.partitionIndex === request.providers.length - 1);
    assert(final?.output?.count === count && final.output.chain === acknowledgment.chain, 'Final output differs from requester acknowledgment');
  }
  const workIds = request.providers.flatMap((provider, index) => (decided.skipped.includes(index) ? []
    : [`stage:${provider.participantId}:${request.id}:${request.executionId}:${index}`]));
  // The charge rule is the provider-relief one (step 9): the acknowledged output, capped at the signed ceiling. An
  // unfinished answer that every stage closed, with no stop, is still an unattributed disconnect; one with a failed
  // stage is not, and names the forfeit instead.
  const delivered = finalReceiptOf(request, proof)?.output ?? null;
  const finished = delivered?.done === true;
  const withheld = Boolean(delivered) && delivered.count - count > maxUnacknowledgedOutputs;
  const unattributedDisconnect = !finished && !stop && !withheld && count > 0 && decided.forfeitedStages.length === 0;
  const beyondCeiling = Math.max(0, count - request.maxOutputTokens), ceiling = Math.min(count, request.maxOutputTokens);
  const outputTokens = Math.min(ceiling, decided.stepCap), beyondStageSteps = ceiling - outputTokens;
  return { outputTokens, outputIdentity: acknowledgment.chain, workIds,
    ...(decided.closedAtLastStep.length ? { closedAtLastStep: decided.closedAtLastStep } : {}),
    ...(decided.forfeitedStages.length ? { forfeitedStages: decided.forfeitedStages } : {}),
    ...(unattributedDisconnect ? { unattributedDisconnect: true } : {}), ...(beyondCeiling ? { beyondCeiling } : {}),
    ...(beyondStageSteps ? { beyondStageSteps } : {}) };
}

/** Reuse execution signatures; the credit service never treats a completed counter as evidence.
 * `releaseWindowMs` (split only) admits evidence that names `closedAtLastStep`: it verifies only at or after the
 * deadline plus that window, and only when stagesClosedAtLastStep names exactly those stages. Under the failed-stage
 * rules it admits, the same way, evidence in which a stage with no closing receipt forfeits (`forfeitedStages`). */
export async function verifyCreditEvidence(request, evidence, enrollment, now, skew, { unadmitted = [], interrupted = [], releaseWindowMs = null,
  maxUnacknowledgedOutputs = MAX_UNACKNOWLEDGED_OUTPUTS } = {}) {
  // K as the reservation pinned it; the caller's value only for a reservation made before K was pinned.
  maxUnacknowledgedOutputs = request.maxUnacknowledgedOutputs ?? maxUnacknowledgedOutputs;
  const within = at => Number.isFinite(at) && at >= request.createdAt - skew
    && at <= Math.min(now, request.deadline) + skew;
  if (request.mode === 'whole-model') {
    // A reservation made with generation settings accepts only evidence signed over the same
    // effective-request digest; one made without settings accepts only evidence that has none.
    const settingsBinding = request.settingsDigest === undefined ? {} : { settingsDigest: request.settingsDigest };
    if (evidence?.schema === SETTLEMENT_STOP_SCHEMA) return verifyWholeModelStop(request, evidence, enrollment, now, skew);
    if (GENERATION_TERMINAL_SCHEMAS.includes(evidence?.schema)) {
      const provider = request.providers[0]?.participantId;
      assert(request.providers.length === 1 && await verifyGenerationTerminal(evidence, {
        requestId: request.executionId, provider, consumer: request.consumer, model: request.model.id,
        modelIdentity: request.model.identity, adapterIdentities: request.model.adapterIdentities,
        inputDigest: request.inputDigest, ...settingsBinding
      }) && same(normalizeParticipantPublicKey(evidence.publicJwk), enrollment.byPeer.get(provider)?.publicJwk)
        && evidence.timestamp >= request.createdAt - skew && evidence.timestamp <= now + skew,
      'Terminal cleanup does not match the accepted request');
      // Cleanup is not a token meter. A fixed terminal charge must have been
      // accepted separately; missing terms leave this execution pending.
      return { outputTokens: null, terminalStatus: evidence.status, fixedCharge: request.terminalCharge ?? null, outputIdentity: null,
        workIds: [`whole:${provider}:${request.consumer}:request:${request.executionId}`] };
    }
    const receipt = structuredClone(evidence);
    // The applied constraint's identity is signed by the provider and checked by the requester
    // before it countersigns. The reservation does not know it, so it is not compared here.
    assert(request.providers.length === 1 && (request.settingsDigest === undefined
      ? receipt.version === 2 && receipt.settingsDigest === undefined && receipt.constraintIdentity === undefined
      : receipt.version === 3 && receipt.settingsDigest === request.settingsDigest) && receipt.status === 'completed'
      && receipt.cleanup === 'settled' && receipt.provider === request.providers[0].participantId
      && receipt.consumer === request.consumer && receipt.jobHash === `request:${request.executionId}`
      && receipt.model === request.model.id && receipt.modelIdentity === request.model.identity
      && same(receipt.adapterIdentities, request.model.adapterIdentities) && receipt.inputDigest === request.inputDigest
      && within(receipt.timestamp) && integer(receipt.outputTokens) && receipt.outputTokens <= request.maxOutputTokens,
    'Completed receipt does not match the accepted request');
    assert(same(normalizeParticipantPublicKey(receipt.providerKey), enrollment.byPeer.get(receipt.provider).publicJwk)
      && same(normalizeParticipantPublicKey(receipt.consumerKey), enrollment.byPeer.get(receipt.consumer).publicJwk), 'Receipt enrollment changed');
    const verified = await verifyReceipt(receipt);
    assert(verified.providerValid && verified.consumerValid, 'Countersigned completed receipt required');
    return { outputTokens: receipt.outputTokens, outputIdentity: receipt.outputDigest, workIds: [`whole:${receipt.provider}:${receipt.consumer}:${receipt.jobHash}`] };
  }
  const proof = await verifyPartitionComponents(request, evidence, enrollment, now, skew);
  const { receipts, acknowledgment, acknowledgedReceipt } = proof;
  assert(acknowledgment, proof.lateAcknowledgment ? 'Requester acknowledgment signed after the deadline is not charged'
    : 'Matching requester acknowledgment required');
  if (forfeitRules(request)) {
    // Failed-stage rules. A claim counts when the evidence presents it and the caller holds it (the ledger: the claims it
    // retained; a statement check: the claims whose signatures it verified); the evidence may present no other.
    const presented = evidence.interruptedOwners ?? [];
    assert(Array.isArray(presented) && presented.every(claim => interrupted.some(row => same(claim, row.closure))), 'Unmatched interrupted stage owner closure');
    const claims = interrupted.filter(row => presented.some(claim => same(claim, row.closure)));
    const stop = evidence.stop === undefined || evidence.stop === null ? null : await verifySplitStop(request, evidence.stop, enrollment, now, skew);
    // A second signed receipt of the requester's own final stage, kept by the ledger as its contradiction (credit-recovery.js).
    const twins = evidence.finalStageTwin === undefined ? [] : (await verifyPartitionComponents(request,
      { identity: evidence.identity, receipts: [evidence.finalStageTwin] }, enrollment, now, skew)).receipts;
    assert(twins.every(row => row.partitionIndex === request.providers.length - 1), 'A final-stage contradiction must be the final stage\'s receipt');
    return observeFailedStageRules(request, { ...proof, twins }, { claims, unadmitted, stop, maxUnacknowledgedOutputs, skew, own: ownStageOf(request, enrollment),
      stated: { closedAtLastStep: evidence.closedAtLastStep, forfeitedStages: evidence.forfeitedStages },
      windowPassed: Number.isSafeInteger(releaseWindowMs) && releaseWindowPassed(request, now, releaseWindowMs, skew) });
  }
  const closedAtLastStep = evidence.closedAtLastStep ?? null;
  if (closedAtLastStep !== null) {
    assert(Number.isSafeInteger(releaseWindowMs) && releaseWindowPassed(request, now, releaseWindowMs, skew)
      && !evidence.interruptedOwners?.length && same(closedAtLastStep, stagesClosedAtLastStep(request, proof, skew)),
    'A stage is treated as closed at its last signed step only after the release window, for a delivered and acknowledged answer');
  }
  const workIds = [], interruptedStages = [];
  for (let index = 0; index < request.providers.length; index++) {
    const receipt = receipts.find(row => row.partitionIndex === index);
    if (closedAtLastStep?.includes(index)) {
      workIds.push(`stage:${request.providers[index].participantId}:${request.id}:${request.executionId}:${index}`);
      continue;
    }
    if (!receipt && unadmitted.includes(index) && acknowledgment.count === 0) continue;
    const exit = interrupted.find(row => row.stage === index);
    if (exit && (!receipt || receipt.status === 'executing') && evidence.interruptedOwners?.some(claim => same(claim, exit.closure))) {
      assert((exit.closure.payload.receipt?.steps ?? 0) >= acknowledgment.count && (receipt?.steps ?? 0) >= acknowledgment.count,
        'Last signed step is behind the acknowledged output');
      interruptedStages.push(index);
      workIds.push(`stage:${request.providers[index].participantId}:${request.id}:${request.executionId}:${index}`);
      continue;
    }
    assert(receipt && ['settled', 'failed'].includes(receipt.status) && receipt.timing.closedAt !== null
      && receipt.steps >= acknowledgment.count, 'Settled stage receipt does not match the acknowledged work');
    workIds.push(`stage:${receipt.participantId}:${receipt.reservationId}:${receipt.attemptId}:${index}`);
  }
  if (acknowledgment.count > 0) {
    const final = acknowledgedReceipt ?? receipts.find(row => row.partitionIndex === request.providers.length - 1);
    assert(final?.output?.count === acknowledgment.count && final.output.chain === acknowledgment.chain,
      'Final output differs from requester acknowledgment');
  }
  if (!replayRules(request)) {
    return { outputTokens: acknowledgment.count, outputIdentity: acknowledgment.chain, workIds,
      ...(interruptedStages.length ? { interruptedStages } : {}), ...(closedAtLastStep ? { closedAtLastStep } : {}) };
  }
  // The settlement replay's charge rule (docs/settlement-replay.md, step 9). The signed ceiling caps the charge: outputs
  // past `maxOutputTokens` are recorded and never charged. An unfinished answer the stages closed, `settled` or
  // `failed`, with no in-time requester stop and no more than K acknowledgments withheld is marked: under
  // SETTLEMENT_RULES_V2 as `unattributedDisconnect`, which charges the acknowledged prefix exactly as the replay does;
  // under the older provider-loss-free rules as `stageEnded`, free under SETTLEMENT_RULES_V1 and charged the prefix
  // under SETTLEMENT_RULES_INTERIM (credit-shares.js settledCreditUnits). A closed stage's `failed` status is not a
  // verified provider failure: a stage also signs it when the requester's abort reaches a step in flight.
  const stop = evidence.stop === undefined || evidence.stop === null ? null
    : await verifySplitStop(request, evidence.stop, enrollment, now, skew);
  const delivered = finalReceiptOf(request, proof)?.output ?? null;
  const finished = delivered?.done === true;
  const withheld = Boolean(delivered) && delivered.count - acknowledgment.count > maxUnacknowledgedOutputs;
  const endedWithoutStop = !finished && !stop && !withheld && acknowledgment.count > 0 && !interruptedStages.length;
  // (Reservations under SETTLEMENT_RULES, the failed-stage rules, returned above.)
  const stageEnded = endedWithoutStop && request.unfinishedTerms === UNFINISHED_ANSWER_TERMS && request.settlementRules !== SETTLEMENT_RULES_V2;
  const unattributedDisconnect = endedWithoutStop && request.settlementRules === SETTLEMENT_RULES_V2;
  const beyondCeiling = Math.max(0, acknowledgment.count - request.maxOutputTokens);
  return { outputTokens: Math.min(acknowledgment.count, request.maxOutputTokens), outputIdentity: acknowledgment.chain, workIds,
    ...(interruptedStages.length ? { interruptedStages } : {}), ...(closedAtLastStep ? { closedAtLastStep } : {}),
    ...(stageEnded ? { stageEnded: true } : {}), ...(unattributedDisconnect ? { unattributedDisconnect: true } : {}), ...(beyondCeiling ? { beyondCeiling } : {}) };
}

/** Validate independently submitted pieces before retaining them. A signed failure is a closing
 * receipt only when it carries closedAt; executing receipts never establish cleanup. */
export async function verifyPartitionComponents(request, evidence, enrollment, now, skew) {
  assert(request.mode === 'partition' && evidence && same(canonicalRouteAttemptBinding(evidence.identity), request.route),
    'Partition route differs from accepted route');
  const routeHash = await attemptRouteHash(evidence.identity);
  const signedTime = value => Number.isFinite(Date.parse(value)) && Date.parse(value) >= request.createdAt - skew
    && Date.parse(value) <= now + skew;
  const executionTime = value => signedTime(value) && Date.parse(value) <= request.deadline + skew;
  // Under the replay's rules a receipt is timed by its signature alone, as in the replay: a closing receipt counts when
  // collected before the release window has passed (collect accepts nothing after it), a step receipt when signed by
  // the deadline plus the clock allowance. Steps past the signed ceiling are accepted and never charged.
  const rules = replayRules(request);
  const checkReceipt = async receipt => {
    const provider = request.providers[receipt?.partitionIndex];
    assert(provider, 'Unknown receipt stage');
    const checked = await verifyStageReceipt(receipt, { publicJwk: enrollment.byPeer.get(provider.participantId).publicJwk });
    assert(checked.ok && receipt.participantId === provider.participantId && receipt.reservationId === request.id
      && receipt.attemptId === request.executionId && receipt.routeHash === routeHash && (rules || receipt.steps <= request.maxOutputTokens)
      && signedTime(receipt.signedAt) && (rules || executionTime(receipt.timing.reservedAt)
        && (receipt.steps === 0 || executionTime(receipt.timing.firstStepAt) && executionTime(receipt.timing.lastStepAt)))
      && (receipt.status === 'executing' ? receipt.timing.closedAt === null : signedTime(receipt.timing.closedAt)),
    'Stage receipt does not match the admitted work');
    assert(receipt.partitionIndex === request.providers.length - 1 ? receipt.output !== null : receipt.output === null,
      'Only the final stage commits outputs');
    return structuredClone(receipt);
  };
  assert(Array.isArray(evidence.receipts) && evidence.receipts.length <= request.providers.length, 'Bounded stage receipts required');
  // A step receipt signed after the deadline (plus the clock allowance) is late: verified, then ignored, as in the replay.
  const receipts = (await Promise.all(evidence.receipts.map(checkReceipt)))
    .filter(row => !rules || closedReceipt(row) || executionTime(row.signedAt));
  assert(new Set(receipts.map(row => row.partitionIndex)).size === receipts.length, 'Duplicate stage receipt');
  const acknowledgment = evidence.acknowledgment ?? evidence.acknowledged?.acknowledgment ?? null;
  const acknowledgedReceipt = evidence.acknowledgedReceipt ?? evidence.acknowledged?.receipt ?? null;
  let lateAcknowledgment = null;
  if (acknowledgment) {
    const ack = await verifyOutputAcknowledgment(acknowledgment, { publicJwk: enrollment.byPeer.get(request.consumer).publicJwk });
    assert(ack.ok && acknowledgment.requesterId === request.consumer && acknowledgment.reservationId === request.id
      && acknowledgment.attemptId === request.executionId && acknowledgment.routeHash === routeHash
      && signedTime(acknowledgment.signedAt) && (rules || acknowledgment.count <= request.maxOutputTokens), 'Matching requester acknowledgment required');
    if (acknowledgment.count === 0) assert(acknowledgment.chain === await outputChainGenesis({ reservationId: request.id, routeHash }),
      'Zero acknowledgment must bind the genesis chain');
    if (acknowledgedReceipt) {
      await checkReceipt(acknowledgedReceipt);
      assert(acknowledgedReceipt.partitionIndex === request.providers.length - 1
        && acknowledgedReceipt.output.count === acknowledgment.count && acknowledgedReceipt.output.chain === acknowledgment.chain,
      'Acknowledged output prefix differs');
    }
    // As in the settlement replay, only acknowledgments signed by the deadline (plus clock skew) are charged. A later
    // one is verified and set aside: its receipts still count, and the requester's earlier acknowledgment still binds.
    if (!executionTime(acknowledgment.signedAt)) lateAcknowledgment = acknowledgment;
  } else assert(!acknowledgedReceipt, 'Output prefix needs its acknowledgment');
  if (lateAcknowledgment) return { identity: request.route, receipts, acknowledgment: null, acknowledgedReceipt: null, lateAcknowledgment };
  return { identity: request.route, receipts, acknowledgment, acknowledgedReceipt };
}
