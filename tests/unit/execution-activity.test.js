import { it, expect } from 'vitest';
import { projectExecutionActivity } from '../../self/ui/pool-home/execution-activity.js';

it('uses only reported step counts and durations, never text length or peer count as throughput', () => {
  const execution = { placement: 'two-device-layer-partition', participantA: 'A', participantB: 'B' };
  const state = { activeThread: { id: 'thread', model: { name: 'Model' }, messages: [], attempts: [{ id: 'attempt', status: 'executing', execution }] } };
  expect(projectExecutionActivity(state).nodes.every(node => node.speed === null && node.share === null)).toBe(true);
  execution.stepSummary = { metrics: { localStepMs: { count: 4, total: 1000 }, remoteStepMs: { count: 4, total: 3000 } } };
  const nodes = projectExecutionActivity(state).nodes;
  expect(nodes.map(node => node.share)).toEqual([0.25, 0.75]);
  expect(nodes[0].speed).toBe(4); expect(nodes[1].speed).toBeCloseTo(4 / 3);
});
