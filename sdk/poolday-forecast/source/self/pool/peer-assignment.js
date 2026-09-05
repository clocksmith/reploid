import { hashJson } from './inference-receipt.js';

/** Shared identity for the existing complete-job assignment record. */
export async function sealPeerAssignmentIdentity({
  intentHash, providerId, assignmentAttemptId, routeDecisionHash,
  providerAdvertHash, providerParticipationProfileHash = null, providerLimits
}) {
  const assignmentHash = await hashJson({ schema: 'reploid.peer.assignment/v1', intentHash, providerId,
    assignmentAttemptId, routeDecisionHash, providerAdvertHash, providerParticipationProfileHash, providerLimits });
  return { assignmentHash, assignmentId: `peer_assignment_${assignmentHash.replace(/^sha256:/, '').slice(0, 16)}` };
}
