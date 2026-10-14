import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectExecutionRibbon, renderExecutionRibbon, bindExecutionRibbon, routeMarkup, detailMarkup } from '../../self/ui/pool-home/execution-ribbon.js';

function snapshot(execution = null, status = 'executing', response = '') {
  return { participantId: 'requester', network: { consumer: { connectionState: 'connected', peers: [{ peerId: 'unrelated-peer' }] } },
    activeThread: { id: 'thread', model: { name: 'Test model', partition: { participantA: 'advertised-only' } },
      messages: [{ id: 'reply', content: response }], attempts: [{ id: 'attempt', responseId: 'reply', createdAt: 100, finishedAt: null, status, execution }] } };
}
const split = { placement: 'two-device-layer-partition', participantA: 'executor-A', participantB: 'executor-B', requesterId: 'requester' };

describe('Execution ribbon evidence projection', () => {
  it('never promotes discovery or a selected model into an execution assignment', () => {
    const view = projectExecutionRibbon(snapshot(null, 'queued'));
    expect(view.executors).toEqual([]); expect(view.model).toBeNull(); expect(view.statusLabel).toBe('Queued');
  });
  it('keeps the requester separate from cooperating executors and missing measurements explicit', () => {
    const view = projectExecutionRibbon(snapshot(split));
    expect(view.requester).toBe('requester');
    expect(view.executors.map(node => node.id)).toEqual(['executor-A', 'executor-B']);
    expect(view.executors.every(node => node.layers === 'Not reported' && node.duration === null)).toBe(true);
    expect(view.transferMs).toBeNull(); expect(view.activationBytes).toBeNull();
  });
  it('uses retained split receipts after peers leave, without inventing GPU-only timings or final layer counts', () => {
    const state = snapshot({ ...split, splitLayer: 12, activationBytes: 2048,
      steps: [{ localStepMs: 10, remoteStepMs: 20, transferMs: 3 }, { localStepMs: 15, remoteStepMs: 25, transferMs: 4 }] }, 'completed');
    state.activeThread.attempts[0].finishedAt = 200;
    state.network = { consumer: { connectionState: 'disconnected', peers: [] } };
    const view = projectExecutionRibbon(state);
    expect(view.statusLabel).toBe('Complete');
    expect(view.executors.map(node => node.layers)).toEqual(['0–11', '12 onward']);
    expect(view.executors.map(node => node.duration)).toEqual([25, 45]);
    expect(view.transferMs).toBe(7); expect(view.totalMs).toBe(100);
  });
  it('identifies a requester that also executes instead of depicting a separate machine', () => {
    const view = projectExecutionRibbon(snapshot({ ...split, requesterId: 'executor-A' }));
    expect(view.requesterExecutes).toBe(true);
    expect(view.executors[0].label).toBe('This device');
  });
  it('does not silently sum incomplete measurements as zero', () => {
    const view = projectExecutionRibbon(snapshot({ ...split, steps: [{ transferMs: 4 }, {}] }));
    expect(view.transferMs).toBeNull();
  });
  it('keeps remote preparation and local download progress in the header', () => {
    const model = { id: 'model', identity: 'verified', availability: 'unavailable' };
    const state = { models: [model], network: { partitionPeers: [{ available: true,
      description: { phase: 'loading', offer: { id: model.id, identity: model.identity } } }] } };
    expect(projectExecutionRibbon(state).statusLabel).toBe('Preparing model');
    state.network.partitionPeers[0].available = false;
    expect(projectExecutionRibbon(state).statusLabel).toBe('No model ready');
    state.localModel = { phase: 'loading', progress: { progress: 0.42 } };
    expect(projectExecutionRibbon(state).statusLabel).toBe('Downloading model 42%');
    state.activeThread = snapshot(null, 'executing').activeThread;
    expect(projectExecutionRibbon(state).statusLabel).toBe('Executing');
  });
  it('shows a pending approval\'s verified recipients only as a proposal, never as placement', () => {
    const route = { schema: 'reploid.partition-route/v1', stages: ['a', 'b', 'c'].map((id, index) => ({ index, participantId: `stage-${id}` })) };
    const state = snapshot(null, 'approval');
    state.network.consumer.peerId = 'requester';
    state.activeThread.attempts[0].approval = { id: 'preview', route, recipients: ['stage-a', 'stage-b', 'stage-c'] };
    const view = projectExecutionRibbon(state);
    expect(view).toMatchObject({ proposed: true, ordered: true, statusLabel: 'Awaiting approval', model: 'Test model' });
    expect(view.executors.map(node => [node.id, node.layers])).toEqual([['stage-a', 'Stage 1 of 3'], ['stage-b', 'Stage 2 of 3'], ['stage-c', 'Stage 3 of 3']]);
    expect(routeMarkup(view)).toContain('is-unassigned'); expect(detailMarkup(view)).toContain('Nothing from this conversation is sent until you approve');
    // An unverified preview (no recipients) and an admitted receipt are not proposals.
    delete state.activeThread.attempts[0].approval.recipients;
    expect(projectExecutionRibbon(state)).toMatchObject({ proposed: false, executors: [] });
    expect(projectExecutionRibbon(snapshot(split)).proposed).toBe(false);
  });
  it('distinguishes local execution from whole-request peer execution', () => {
    expect(projectExecutionRibbon(snapshot({ placement: 'local-webgpu' })).executors[0].id).toBe('requester');
    expect(projectExecutionRibbon(snapshot({ placement: 'peer-whole-request', peerId: 'executor' })).executors[0].id).toBe('executor');
  });
  it('does not mistake discovery outages for execution failure, and identifies an explicit retry', () => {
    const state = snapshot(split, 'executing');
    state.network.consumer.connectionState = 'disconnected'; expect(projectExecutionRibbon(state).status).toBe('executing');
    state.network.consumer.connectionState = 'retrying'; expect(projectExecutionRibbon(state).status).toBe('executing');
    state.network.paused = true; expect(projectExecutionRibbon(state).status).toBe('executing');
    state.activeThread.attempts[0].status = 'queued';
    state.network.consumer.connectionState = 'connected'; state.activeThread.attempts[0].retryOf = 'old';
    expect(projectExecutionRibbon(state).status).toBe('recovering');
    state.activeThread.attempts[0].status = 'completed'; expect(projectExecutionRibbon(state).status).toBe('completed');
  });
});

describe('Execution ribbon interactions', () => {
  let root, binding;
  afterEach(() => { binding?.dispose(); root?.remove(); vi.useRealTimers(); });
  function mount(onInspect = () => {}) {
    root = document.createElement('div'); root.innerHTML = renderExecutionRibbon(); document.body.append(root);
    binding = bindExecutionRibbon(root, { onInspect });
  }
  it('keeps one quiet status and opens assigned execution details only on activation', () => {
    const inspect = vi.fn(); mount(inspect); binding.update(snapshot(split));
    const trigger = root.querySelector('[data-ribbon-trigger]');
    expect(root.querySelector('[data-ribbon-status]').textContent).toBe('Executing');
    expect(trigger.getAttribute('aria-label')).toContain('Test model on Computer 1 and Computer 2');
    expect(root.querySelectorAll('.execution-ribbon-node')).toHaveLength(0);
    trigger.focus(); expect(inspect).not.toHaveBeenCalled();
    trigger.click(); expect(inspect).toHaveBeenCalledWith('conversation', trigger);
    binding.update(snapshot(null, 'queued'));
    expect(root.querySelector('[data-ribbon-status]').textContent).toBe('Queued');
  });
  it('pulses only for new observed output, not execution state, history selection, or unrelated updates', () => {
    vi.useFakeTimers(); mount(); const state = snapshot(split);
    binding.update(state); expect(root.querySelector('[data-output-observed]')).toBeNull();
    binding.update(state); expect(root.querySelector('[data-output-observed]')).toBeNull();
    state.activeThread.messages[0].content = 'First'; binding.update(state);
    expect(root.querySelector('[data-output-observed]')).not.toBeNull();
    vi.advanceTimersByTime(501); expect(root.querySelector('[data-output-observed]')).toBeNull();
    binding.update(state); expect(root.querySelector('[data-output-observed]')).toBeNull();
    state.activeThread.id = 'another'; state.activeThread.messages[0].content = 'Already saved text'; binding.update(state);
    expect(root.querySelector('[data-output-observed]')).toBeNull();
    state.activeThread.messages[0].content += ' new'; binding.update(state);
    expect(root.querySelector('[data-output-observed]')).not.toBeNull();
    binding.dispose(); expect(root.querySelector('[data-output-observed]')).toBeNull();
  });
  it('escapes participant and model labels', () => {
    mount(); const state = snapshot({ ...split, participantA: '<img src=x>' }); state.activeThread.model.name = '<script>bad()</script>';
    binding.update(state); expect(root.querySelector('img,script')).toBeNull();
  });
});
