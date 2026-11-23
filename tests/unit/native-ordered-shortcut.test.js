// @vitest-environment node
import { expect, it } from 'vitest';
import { shortcutOrderedParticipation } from '../../server/native-ordered-shortcut.js';
import { snapshotWorkPartitionStage } from '../../apps/poolday/host/work-partition-plan.js';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import orderedPolicy from '../../apps/poolday/config/ordered-participation.json' with { type: 'json' };

const model27 = catalog.find(model => model.id === 'qwen-3-8-27b-text-q4k-ef16-af32');
const model08 = catalog.find(model => model.id === 'qwen-3-5-0-8b-q4k-ef16-af32-vf16');

it('gives the 27B stage shortcut the host configuration its ordered plan requires', () => {
  // Recorded on two physical hosts: `split 27b --stage 1` joined its room, found the other stage, then failed with
  // "Ordered contribution requires an explicit matching host stage and ordinary execution".
  let n = 0;
  const ordered = shortcutOrderedParticipation({ model: model27, models: catalog, stageIndex: 1, createId: () => 'id' + ++n });
  expect(ordered).toEqual({ stage: { modelId: model27.id, index: 1, residentId: 'stage-id1', executionId: 'program-id2' }, ...orderedPolicy.limits });
  // The bound stage the host later builds from it passes the check that failed.
  const stage = { index: 1, participantId: 'peer:a', transportId: 'transport-a', residentId: ordered.stage.residentId, executionId: ordered.stage.executionId };
  expect(snapshotWorkPartitionStage(model27, 1, 'peer:a', { stage }, null)).toEqual(stage);
  // Two hosts never share allocation identities.
  const other = shortcutOrderedParticipation({ model: model27, models: catalog, stageIndex: 0 });
  expect(other.stage.residentId).not.toBe(shortcutOrderedParticipation({ model: model27, models: catalog, stageIndex: 0 }).stage.residentId);
});

it('makes a weightless requester of an ordered model a stage-less participant, and leaves other models alone', () => {
  expect(shortcutOrderedParticipation({ model: model27, models: catalog })).toEqual({ stage: null, ...orderedPolicy.limits });
  expect(shortcutOrderedParticipation({ model: model08, models: catalog, stageIndex: 0 })).toBeNull();
  expect(() => shortcutOrderedParticipation({ model: model27, models: catalog, stageIndex: 2 })).toThrow(/Ordered host stage/);
});
