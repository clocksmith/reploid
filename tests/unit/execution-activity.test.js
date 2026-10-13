import { it, expect } from 'vitest';
import { projectExecutionActivity, updateExecutionActivity } from '../../self/ui/pool-home/execution-activity.js';

it('uses only reported step counts and durations, never text length or peer count as throughput', () => {
  const execution = { placement: 'two-device-layer-partition', participantA: 'A', participantB: 'B' };
  const state = { activeThread: { id: 'thread', model: { name: 'Model' }, messages: [], attempts: [{ id: 'attempt', status: 'executing', execution }] } };
  expect(projectExecutionActivity(state).nodes.every(node => node.speed === null && node.share === null)).toBe(true);
  execution.stepSummary = { metrics: { localStepMs: { count: 4, total: 1000 }, remoteStepMs: { count: 4, total: 3000 } } };
  const nodes = projectExecutionActivity(state).nodes;
  expect(nodes.map(node => node.share)).toEqual([0.25, 0.75]);
  expect(nodes[0].speed).toBe(4); expect(nodes[1].speed).toBeCloseTo(4 / 3);
});

function orderedState(count = 3) {
  const execution = { identity: { schema: 'reploid.partition-attempt/v2', requesterId: 'requester',
    route: { schema: 'reploid.partition-route/v1', planId: 'ordered-plan', stages: Array.from({ length: count }, (_, index) => ({ index, participantId: `stage-${index}` })) } } };
  return { participantId: 'requester', activeThread: { id: 'thread', model: { name: 'Model' }, messages: [],
    attempts: [{ id: 'attempt', status: 'executing', execution }] } };
}

it('projects all assigned stages, including retained routes with no discovery peers', () => {
  const state = orderedState(7), view = projectExecutionActivity(state);
  expect(view.nodes.map(node => node.id)).toEqual(Array.from({ length: 7 }, (_, i) => `stage-${i}`));
  expect(view.nodes.map(node => node.layers)).toEqual(Array.from({ length: 7 }, (_, i) => `Stage ${i + 1} of 7`));
  expect(view.nodes.every(node => node.speed === null && node.share === null)).toBe(true);
  expect(view.planId).toBe('ordered-plan');
  state.activeThread.attempts[0].execution.identity.requesterId = 'stage-2';
  expect(projectExecutionActivity(state).nodes[2].label).toBe('This device');
});

it('renders one measured time-share bar and all stage rates from completed step observations', () => {
  const state = orderedState();
  state.activeThread.attempts[0].execution.steps = [0, 1].map(() => ({ stages: [100, 200, 700].map((elapsedMs, partitionIndex) => ({ partitionIndex, elapsedMs })) }));
  const nodes = projectExecutionActivity(state).nodes;
  expect(nodes.map(node => node.share)).toEqual([0.1, 0.2, 0.7]);
  expect(nodes.map(node => node.speed)).toEqual([10, 5, 1000 / 700]);
  const root = document.createElement('details');
  root.innerHTML = '<summary></summary><div data-activity-detail></div>';
  updateExecutionActivity(root, state);
  expect(root.querySelector('summary').textContent).toBe('Generating · 3 computers');
  expect(root.querySelectorAll('.chat-distribution')).toHaveLength(1);
  expect(root.querySelectorAll('li')).toHaveLength(3);
  expect(root.querySelector('[role="img"]').getAttribute('aria-label')).toContain('70%');
  expect(root.textContent).toContain('10.0 tok/s');
});

it('requires complete stage timing coverage in bounded summaries and preserves unknown measurements', () => {
  const state = orderedState(), execution = state.activeThread.attempts[0].execution;
  execution.stepSummary = { count: 2, stages: [100, 200, 700].map((total, partitionIndex) => ({ partitionIndex, steps: 2, stepMs: { count: 2, total } })) };
  expect(projectExecutionActivity(state).nodes.map(node => node.share)).toEqual([0.1, 0.2, 0.7]);
  execution.stepSummary.stages[1].stepMs.count = 1;
  const view = projectExecutionActivity(state);
  expect(view.nodes[1].speed).toBeNull();
  expect(view.nodes.every(node => node.share === null)).toBe(true);
  execution.stepSummary.stages[1].stepMs = { count: 2, total: NaN };
  expect(projectExecutionActivity(state).nodes[1].speed).toBeNull();
});
