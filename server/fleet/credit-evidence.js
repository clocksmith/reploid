import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { verifyStageReceipt, verifyOutputAcknowledgment, attemptRouteHash, outputChainGenesis } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { canonicalRouteAttemptBinding } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { normalizeParticipantPublicKey } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { assert, same, integer } from './contract.js';

/** Reuse execution signatures; the credit service never treats a completed counter as evidence. */
export async function verifyCreditEvidence(request, evidence, enrollment, now, skew, { unadmitted = [] } = {}) {
  const within = at => Number.isFinite(at) && at >= request.createdAt - skew
    && at <= Math.min(now, request.deadline) + skew;
  if (request.mode === 'whole-model') {
    const receipt = structuredClone(evidence);
    assert(request.providers.length === 1 && receipt.version === 2 && receipt.status === 'completed'
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
  const workIds = [];
  for (let index = 0; index < request.providers.length; index++) {
    const receipt = receipts.find(row => row.partitionIndex === index), provider = request.providers[index];
    if (!receipt && unadmitted.includes(index) && acknowledgment.count === 0) continue;
    assert(receipt && ['settled', 'failed'].includes(receipt.status) && receipt.timing.closedAt !== null
      && receipt.steps >= acknowledgment.count, 'Settled stage receipt does not match the acknowledged work');
    workIds.push(`stage:${receipt.participantId}:${receipt.reservationId}:${receipt.attemptId}:${index}`);
  }
  if (acknowledgment.count > 0) {
    const final = acknowledgedReceipt ?? receipts.find(row => row.partitionIndex === request.providers.length - 1);
    assert(final?.output?.count === acknowledgment.count && final.output.chain === acknowledgment.chain,
      'Final output differs from requester acknowledgment');
  }
  return { outputTokens: acknowledgment.count, outputIdentity: acknowledgment.chain, workIds };
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
