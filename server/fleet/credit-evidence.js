import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { verifyStageReceipt, verifyOutputAcknowledgment, attemptRouteHash } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { canonicalRouteAttemptBinding } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { normalizeParticipantPublicKey } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { assert, same, integer } from './contract.js';

/** Reuse execution signatures; the credit service never treats a completed counter as evidence. */
export async function verifyCreditEvidence(request, evidence, enrollment, now, skew) {
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
    return { outputTokens: receipt.outputTokens, workIds: [`whole:${receipt.provider}:${receipt.consumer}:${receipt.jobHash}`] };
  }
  const { identity, receipts, acknowledgment } = structuredClone(evidence);
  const binding = canonicalRouteAttemptBinding(identity);
  assert(same(binding, request.route), 'Partition route differs from accepted route');
  const routeHash = await attemptRouteHash(identity);
  assert(Array.isArray(receipts) && receipts.length === request.providers.length, 'Every contributing stage must settle');
  const ack = await verifyOutputAcknowledgment(acknowledgment, { publicJwk: enrollment.byPeer.get(request.consumer).publicJwk });
  assert(ack.ok && acknowledgment.requesterId === request.consumer && acknowledgment.reservationId === request.id
    && acknowledgment.attemptId === request.executionId && acknowledgment.routeHash === routeHash
    && within(Date.parse(acknowledgment.signedAt)) && acknowledgment.count <= request.maxOutputTokens, 'Matching requester acknowledgment required');
  const workIds = [];
  for (let index = 0; index < receipts.length; index++) {
    const receipt = receipts[index], provider = request.providers[index];
    const verified = await verifyStageReceipt(receipt, { publicJwk: enrollment.byPeer.get(provider.participantId).publicJwk });
    assert(verified.ok && receipt.participantId === provider.participantId && receipt.partitionIndex === index
      && receipt.reservationId === request.id && receipt.attemptId === request.executionId && receipt.routeHash === routeHash
      && receipt.status === 'settled' && receipt.steps === acknowledgment.count && within(Date.parse(receipt.signedAt)),
    'Settled stage receipt does not match the acknowledged work');
    if (index === receipts.length - 1) assert(receipt.output?.done === true && receipt.output.count === acknowledgment.count
      && receipt.output.chain === acknowledgment.chain, 'Final output differs from requester acknowledgment');
    workIds.push(`stage:${receipt.participantId}:${receipt.reservationId}:${receipt.attemptId}:${index}`);
  }
  return { outputTokens: acknowledgment.count, workIds };
}
