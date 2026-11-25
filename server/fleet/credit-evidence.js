import { verifyGenerationTerminal, GENERATION_TERMINAL_SCHEMAS } from '../../shared/vendor/reploid/artifacts/generation-terminal.js';
import { verifyReceipt } from '../../shared/vendor/reploid/artifacts/receipt.js';
import {
  MAX_UNACKNOWLEDGED_OUTPUTS, verifyStageReceipt, verifyOutputAcknowledgment, attemptRouteHash, outputChainGenesis
} from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { canonicalRouteAttemptBinding } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { normalizeParticipantPublicKey } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { assert, same, integer } from './contract.js';
import { SETTLEMENT_STOP_SCHEMA, verifySettlementStop } from './settlement-terms.js';
import { SETTLEMENT_RULES, UNFINISHED_ANSWER_TERMS } from './credit-shares.js';

/** A split reservation made since the ledger applies the settlement replay's charge rules (docs/settlement-replay.md). */
export const replayRules = request => request.mode === 'partition' && request.settlementRules === SETTLEMENT_RULES;

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

/** Reuse execution signatures; the credit service never treats a completed counter as evidence.
 * `releaseWindowMs` (split only) admits evidence that names `closedAtLastStep`: it verifies only at or after the
 * deadline plus that window, and only when stagesClosedAtLastStep names exactly those stages. */
export async function verifyCreditEvidence(request, evidence, enrollment, now, skew, { unadmitted = [], interrupted = [], releaseWindowMs = null,
  maxUnacknowledgedOutputs = MAX_UNACKNOWLEDGED_OUTPUTS } = {}) {
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
  const closedAtLastStep = evidence.closedAtLastStep ?? null;
  if (closedAtLastStep !== null) {
    assert(Number.isSafeInteger(releaseWindowMs) && now >= request.deadline + releaseWindowMs
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
  // past `maxOutputTokens` are recorded and never charged. Under provider-loss-free terms an unfinished answer is owed
  // only when the requester ended it, by its own in-time signed stop or by withholding more than K acknowledgments; a
  // stage that closes such an answer on its own, `settled` or `failed`, earns nothing and costs the requester nothing.
  const stop = evidence.stop === undefined || evidence.stop === null ? null
    : await verifySplitStop(request, evidence.stop, enrollment, now, skew);
  const delivered = finalReceiptOf(request, proof)?.output ?? null;
  const finished = delivered?.done === true;
  const withheld = Boolean(delivered) && delivered.count - acknowledgment.count > maxUnacknowledgedOutputs;
  const stageEnded = request.unfinishedTerms === UNFINISHED_ANSWER_TERMS && !finished && !stop && !withheld && acknowledgment.count > 0
    && !interruptedStages.length;
  const beyondCeiling = Math.max(0, acknowledgment.count - request.maxOutputTokens);
  return { outputTokens: Math.min(acknowledgment.count, request.maxOutputTokens), outputIdentity: acknowledgment.chain, workIds,
    ...(interruptedStages.length ? { interruptedStages } : {}), ...(closedAtLastStep ? { closedAtLastStep } : {}),
    ...(stageEnded ? { stageEnded: true } : {}), ...(beyondCeiling ? { beyondCeiling } : {}) };
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
  // signed before the hold's release window ends (collect refuses nothing after it), a step receipt when signed by the
  // deadline plus the clock allowance. Steps past the signed ceiling are accepted and never charged.
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
