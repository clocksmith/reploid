import { verifyGenerationTerminal, GENERATION_TERMINAL_SCHEMAS } from '../../shared/vendor/reploid/artifacts/generation-terminal.js';
import { verifyReceipt } from '../../shared/vendor/reploid/artifacts/receipt.js';
import { verifyStageReceipt, verifyOutputAcknowledgment, attemptRouteHash, outputChainGenesis } from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { canonicalRouteAttemptBinding } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { normalizeParticipantPublicKey } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { assert, same, integer } from './contract.js';
import { SETTLEMENT_STOP_SCHEMA, verifySettlementStop } from './settlement-terms.js';

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

/** Reuse execution signatures; the credit service never treats a completed counter as evidence. */
export async function verifyCreditEvidence(request, evidence, enrollment, now, skew, { unadmitted = [], interrupted = [] } = {}) {
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
  assert(acknowledgment, 'Matching requester acknowledgment required');
  const workIds = [], interruptedStages = [];
  for (let index = 0; index < request.providers.length; index++) {
    const receipt = receipts.find(row => row.partitionIndex === index);
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
  return { outputTokens: acknowledgment.count, outputIdentity: acknowledgment.chain, workIds,
    ...(interruptedStages.length ? { interruptedStages } : {}) };
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
  const checkReceipt = async receipt => {
    const provider = request.providers[receipt?.partitionIndex];
    assert(provider, 'Unknown receipt stage');
    const checked = await verifyStageReceipt(receipt, { publicJwk: enrollment.byPeer.get(provider.participantId).publicJwk });
    assert(checked.ok && receipt.participantId === provider.participantId && receipt.reservationId === request.id
      && receipt.attemptId === request.executionId && receipt.routeHash === routeHash && receipt.steps <= request.maxOutputTokens
      && signedTime(receipt.signedAt) && executionTime(receipt.timing.reservedAt)
      && (receipt.steps === 0 || executionTime(receipt.timing.firstStepAt) && executionTime(receipt.timing.lastStepAt))
      && (receipt.status === 'executing' ? receipt.timing.closedAt === null : signedTime(receipt.timing.closedAt)),
    'Stage receipt does not match the admitted work');
    assert(receipt.partitionIndex === request.providers.length - 1 ? receipt.output !== null : receipt.output === null,
      'Only the final stage commits outputs');
    return structuredClone(receipt);
  };
  assert(Array.isArray(evidence.receipts) && evidence.receipts.length <= request.providers.length, 'Bounded stage receipts required');
  const receipts = await Promise.all(evidence.receipts.map(checkReceipt));
  assert(new Set(receipts.map(row => row.partitionIndex)).size === receipts.length, 'Duplicate stage receipt');
  const acknowledgment = evidence.acknowledgment ?? evidence.acknowledged?.acknowledgment ?? null;
  const acknowledgedReceipt = evidence.acknowledgedReceipt ?? evidence.acknowledged?.receipt ?? null;
  if (acknowledgment) {
    const ack = await verifyOutputAcknowledgment(acknowledgment, { publicJwk: enrollment.byPeer.get(request.consumer).publicJwk });
    assert(ack.ok && acknowledgment.requesterId === request.consumer && acknowledgment.reservationId === request.id
      && acknowledgment.attemptId === request.executionId && acknowledgment.routeHash === routeHash
      && signedTime(acknowledgment.signedAt) && acknowledgment.count <= request.maxOutputTokens, 'Matching requester acknowledgment required');
    if (acknowledgment.count === 0) assert(acknowledgment.chain === await outputChainGenesis({ reservationId: request.id, routeHash }),
      'Zero acknowledgment must bind the genesis chain');
    if (acknowledgedReceipt) {
      await checkReceipt(acknowledgedReceipt);
      assert(acknowledgedReceipt.partitionIndex === request.providers.length - 1
        && acknowledgedReceipt.output.count === acknowledgment.count && acknowledgedReceipt.output.chain === acknowledgment.chain,
      'Acknowledged output prefix differs');
    }
  } else assert(!acknowledgedReceipt, 'Output prefix needs its acknowledgment');
  return { identity: request.route, receipts, acknowledgment, acknowledgedReceipt };
}
