/**
 * `reploid split <model> --stage N` and `reploid ask <model>` name a stage, or none, without a host file. For a
 * catalog model whose split is an ordered Doppler plan (the 27B), a stage number alone is not a host
 * configuration: the contributor must also state its own allocation identities and route limits, as
 * `--ordered-config` does. These shortcuts stand for exactly that documented configuration, with the
 * application's limits and identities made for this process.
 */
import { randomUUID } from 'node:crypto';
import { isWorkOrderedModel, snapshotWorkOrderedParticipation } from '../apps/poolday/host/work-partition-plan.js';
import orderedPolicy from '../apps/poolday/config/ordered-participation.json' with { type: 'json' };

/** `stageIndex` is the contributor's stage, or null for a weightless requester. Returns null for other models. */
export function shortcutOrderedParticipation({ model, models, stageIndex = null, createId = randomUUID }) {
  if (!isWorkOrderedModel(model)) return null;
  const stage = stageIndex === null ? null
    : { modelId: model.id, index: stageIndex, residentId: 'stage-' + createId(), executionId: 'program-' + createId() };
  return snapshotWorkOrderedParticipation({ stage, ...orderedPolicy.limits }, null, models);
}
