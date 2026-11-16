import { canonicalRouteAttemptBinding } from './partition.js';

/** Explicit disclosure closure for the ordinary stage-zero coordinator path. */
export function orderedPartitionDisclosure(identity) {
  const binding = canonicalRouteAttemptBinding(identity), stages = binding.route.stages;
  const coordinator = stages[0].participantId, unique = values => [...new Set(values)];
  return { kind: 'coordinator-mediated-activations-and-tokens',
    activationPaths: stages.slice(1).map((stage, index) => unique([stages[index].participantId, coordinator, stage.participantId])),
    tokenRecipients: stages.map(stage => stage.participantId),
    outputRecipients: unique([stages.at(-1).participantId, coordinator, binding.requesterId]) };
}

