import { canonicalRouteAttemptBinding } from './partition.js';

/** The execution backend whose first and last stage are the requester's own (chat/execution-policy.js EDGES_BACKEND). */
const EDGES_BACKEND = 'doppler-partition-edges/v1';

/**
 * Explicit disclosure closure for the ordinary stage-zero coordinator path. Under an edges privacy binding (validated
 * by the caller's route binding) only the first and last stage receive token context; the stages between them
 * receive activations and token counts only.
 */
export function orderedPartitionDisclosure(identity, privacyBinding = null) {
  const binding = canonicalRouteAttemptBinding(identity), stages = binding.route.stages;
  const coordinator = stages[0].participantId, unique = values => [...new Set(values)];
  const edges = privacyBinding?.route?.backend === EDGES_BACKEND;
  return { kind: edges ? 'coordinator-mediated-activations-and-edge-tokens' : 'coordinator-mediated-activations-and-tokens',
    activationPaths: stages.slice(1).map((stage, index) => unique([stages[index].participantId, coordinator, stage.participantId])),
    tokenRecipients: edges ? unique([coordinator, stages.at(-1).participantId]) : stages.map(stage => stage.participantId),
    outputRecipients: unique([stages.at(-1).participantId, coordinator, binding.requesterId]) };
}
