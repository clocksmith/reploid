import policy from '../config/partition-releases.json' with { type: 'json' };
import { canonicalPartitionJson, partitionAdapterIdentities } from '../../../shared/vendor/reploid/mesh/partitions/partition-contract.js';

/** Owner-reviewed public releases, never peer-advertised qualification. An approval
 * binds the exact artifact, adapters and route descriptor (including stage identities).
 * Evidence from diagnostic/test-signing journeys does not approve public service.
 * Empty policy intentionally leaves public partition execution closed. */
export function qualifiedPartitionRoute(model, approvals = policy.approvals) {
  if (!model?.partition || !model.identity) return false;
  const partition = model.partition;
  const ids = partition.route?.schema === 'reploid.partition-route/v1'
    ? Array.isArray(partition.route.stages) && partition.route.stages.map(stage => stage?.participantId)
    : [partition.participantA, partition.participantB];
  if (!ids || ids.length < 2 || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return false;
  let adapterIdentities;
  try { adapterIdentities = partitionAdapterIdentities(model); }
  catch { return false; } // Malformed discovery is ineligible, not a catalog outage.
  return Array.isArray(approvals) && approvals.some(approval => approval?.partition && Array.isArray(approval.adapterIdentities) && approval.modelId === model.id && approval.modelIdentity === model.identity
    && typeof approval.evidence === 'string' && approval.evidence.trim()
    && canonicalPartitionJson(approval.adapterIdentities) === canonicalPartitionJson(adapterIdentities)
    && canonicalPartitionJson(approval.partition) === canonicalPartitionJson(partition));
}

export const availablePartitionRoute = (model, approvals) => qualifiedPartitionRoute(model, approvals)
  && ['ready', 'busy'].includes(model.networkAvailability ?? model.availability);

/** Saved selections must still name the currently admitted route. Never substitute. */
export function currentPartitionRoute(model, models, approvals) {
  return qualifiedPartitionRoute(model, approvals) && models.some(current => availablePartitionRoute(current, approvals)
    && current.id === model.id && current.identity === model.identity
    && canonicalPartitionJson(partitionAdapterIdentities(current)) === canonicalPartitionJson(partitionAdapterIdentities(model))
    && canonicalPartitionJson(current.partition) === canonicalPartitionJson(model.partition));
}
