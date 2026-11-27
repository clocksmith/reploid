import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectExecutionRibbon } from '../../apps/poolday/ui/pool-home/execution-ribbon.js';
import { participantLabel } from '../../apps/poolday/ui/pool-home/computer-labels.js';

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
  it('distinguishes local execution from whole-request peer execution', () => {
    expect(projectExecutionRibbon(snapshot({ placement: 'local-webgpu' })).executors[0].id).toBe('requester');
    expect(projectExecutionRibbon(snapshot({ placement: 'peer-whole-request', peerId: 'executor' })).executors[0].id).toBe('executor');
    // The provider comes from the answer's operation roles when its record has them.
    const operationRoles = { schema: 'reploid.operation-roles/1', operation: 'inference', operationId: 'job',
      consumer: { computerId: null, participantId: 'peer:aaaaaaaaaaaaaaaaaaaaaaaa' },
      provider: { computerId: null, participantId: 'peer:bbbbbbbbbbbbbbbbbbbbbbbb', connectionId: 'answered-on' } };
    expect(projectExecutionRibbon(snapshot({ placement: 'peer-whole-request', peerId: 'executor', operationRoles })).executors[0].id).toBe('answered-on');
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
