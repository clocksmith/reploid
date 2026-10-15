import { describe, it, expect } from 'vitest';
import { projectExecutionActivity, projectSupplyLabel, updateExecutionActivity } from '../../self/ui/pool-home/execution-activity.js';

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

describe('recorded supply provenance label', () => {
  const provenance = (supply, classes, execution = { supply, classes }) => ({ schema: 'reploid.answer-provenance/v1', supply, classes,
    execution: { participants: [], placement: null, ...execution }, earlierAttempts: [], retrieval: { supply: 'none' } });
  const render = attempt => {
    const root = document.createElement('details');
    root.innerHTML = '<summary></summary><div data-activity-detail></div>';
    updateExecutionActivity(root, { participantId: 'requester', activeThread: { id: 'thread', model: { name: 'Model' }, messages: [], attempts: [attempt] } });
    return root;
  };

  it('appends the answer supply to the per-answer details summary', () => {
    const root = render({ id: 'attempt', status: 'completed', execution: { provider: 'peer', placement: 'peer-whole-request', peerId: 'peer-1' },
      provenance: provenance('mesh', ['mesh']) });
    expect(root.hidden).toBe(false);
    expect(root.querySelector('summary').textContent).toBe('Complete · 1 computer · Mesh');
    expect(projectSupplyLabel({ provenance: provenance('local', ['local']) })).toEqual({ answer: 'This device', attempt: null });
  });

  it('shows a hosted answer that lists no computers, and an executor that reported nothing', () => {
    const hosted = render({ id: 'attempt', status: 'failed', execution: { provider: 'hosted', placement: 'hosted-api', hostedProvider: 'example' },
      provenance: provenance('hosted', ['hosted']) });
    expect(hosted.hidden).toBe(false);
    expect(hosted.querySelector('summary').textContent).toBe('Failed · Hosted');
    expect(hosted.querySelector('li')).toBeNull();
    expect(render({ id: 'attempt', status: 'completed', execution: null, provenance: provenance('unknown', []) })
      .querySelector('summary').textContent).toBe('Complete · Executor not verified');
    expect(render({ id: 'attempt', status: 'failed', execution: null, provenance: provenance('none', []) }).hidden).toBe(true);
  });

  it('names both classes of a mixed answer and this attempt\'s own supply when a retry changed it', () => {
    const root = render({ id: 'attempt', status: 'completed', retryOf: 'earlier',
      execution: { provider: 'peer', placement: 'peer-whole-request', peerId: 'peer-1' },
      provenance: { ...provenance('mixed', ['local', 'mesh'], { supply: 'mesh', classes: ['mesh'] }),
        earlierAttempts: [{ attemptId: 'earlier', status: 'failed', supply: 'local', classes: ['local'] }] } });
    expect(root.querySelector('summary').textContent).toBe('Complete · 1 computer · Mixed: This device + Mesh');
    expect(root.querySelector('[data-attempt-supply]').textContent).toBe('This attempt: Mesh');
  });
});

it('shows completed whole-model timing and never leaves a finished answer pending', () => {
  const attempt = { id: 'attempt', status: 'completed', execution: { placement: 'local-webgpu',
    timing: { totalMs: 500, generatedTokenCount: 10 } } };
  const state = { activeThread: { id: 'thread', model: { name: 'Model' }, messages: [], attempts: [attempt] } };
  const root = document.createElement('details');
  root.innerHTML = '<summary></summary><div data-activity-detail></div>';
  updateExecutionActivity(root, state);
  expect(root.textContent).toContain('20.0 tok/s');
  expect(root.textContent).toContain('includes prompt processing');
  expect(root.querySelector('.chat-distribution')).toBeNull();
  attempt.execution.timing = null;
  updateExecutionActivity(root, state);
  expect(root.textContent).toContain('Timing not recorded');
  expect(root.textContent).not.toContain('Timing pending');
  attempt.status = 'executing';
  updateExecutionActivity(root, state);
  expect(root.textContent).toContain('Timing pending');
});
