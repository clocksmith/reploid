import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatExecution } from '../../apps/poolday/host/chat-execution.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import policy from '../../apps/poolday/config/requester-weights.json' with { type: 'json' };

const sessions = [];
afterEach(async () => { for (const session of sessions.splice(0)) await session.close(); });
const open = options => {
  const session = createChatSession({ storage: null, service: createChatTestService(),
    swarm: { getState: () => ({ consumer: { peers: [] } }), connect: async () => {} }, ...options });
  sessions.push(session);
  return session;
};

it('ships with requester weights allowed, so the switch changes nothing until a deployment sets it', () => {
  expect(policy).toEqual({ schema: 'reploid.requester-weights-policy/v1', zeroRequesterWeights: false });
  expect(open().getState().zeroRequesterWeights).toBe(false);
});

it('refuses every way of placing weights on the requester when switched on', async () => {
  const session = open({ zeroRequesterWeights: true });
  const [model] = CANONICAL_CHAT_MODELS;
  expect(session.getState().localDownloadIssue).toContain('network computers only');
  expect(() => session.downloadLocalModel(model.id, true)).toThrow('network computers only');
  await expect(session.prepareLocalModel(model.id)).rejects.toThrow('network computers only');
  session.setCachedModels([{ id: model.id, identity: model.identity }]);
  const row = session.getState().models.find(item => item.id === model.id);
  expect(row.localCached).toBeFalsy();
  expect(row.localReady).toBeFalsy();
});

it.each([
  ['local-only placement', { privacy: createExecutionPolicy() }],
  ['a local execution choice', { privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }), permissions: { executionLocation: 'local' } }]
])('refuses %s before running anything', async (_name, request) => {
  const model = { id: 'model', identity: 'sha256:' + 'a'.repeat(64), provider: 'doppler', adapters: [] };
  const scheduler = { schedule: vi.fn(), close: vi.fn() }, swarm = { generate: vi.fn() };
  const execution = createChatExecution({ localExecution: false, scheduler, swarm, service: {}, models: [model], getModels: () => [model], profile: {} });
  await expect(execution.execute({ threadId: 't', attemptId: 'a', model, messages: [{ role: 'user', content: 'x' }], ...request },
    { signal: new AbortController().signal, requestApproval: vi.fn(), onState: vi.fn(), onDelta: vi.fn() })).rejects.toThrow('network computers only');
  expect(scheduler.schedule).not.toHaveBeenCalled();
  expect(swarm.generate).not.toHaveBeenCalled();
});

it('refuses every contribution that would store or run a model here, a partition or adapter model included', async () => {
  const swarm = { getState: () => ({ consumer: { peers: [] } }), connect: async () => {},
    share: vi.fn(async () => {}), stop: vi.fn(async () => {}), shareFiles: vi.fn(async () => {}), stopFiles: vi.fn(async () => {}),
    allowCachedFiles: vi.fn(async () => {}), allowCachedCompute: vi.fn(async () => {}) };
  const session = open({ zeroRequesterWeights: true, swarm });
  const [model] = CANONICAL_CHAT_MODELS;
  await expect(session.setSharing(true, model.id, true)).rejects.toThrow('network computers only');
  await expect(session.setFileSharing(true, model.id, true)).rejects.toThrow('network computers only');
  await expect(session.setComputeContribution(true)).rejects.toThrow('network computers only');
  await expect(session.setCachedFileContribution(true)).rejects.toThrow('network computers only');
  expect(swarm.share).not.toHaveBeenCalled();
  expect(swarm.shareFiles).not.toHaveBeenCalled();
  expect(swarm.allowCachedCompute).not.toHaveBeenCalled();
  expect(swarm.allowCachedFiles).not.toHaveBeenCalled();
  // Turning contribution off stays available.
  await session.setSharing(false);
  await session.setFileSharing(false);
  await session.setComputeContribution(false);
  await session.setCachedFileContribution(false);
  expect(swarm.stop).toHaveBeenCalled();
  expect(swarm.stopFiles).toHaveBeenCalled();
  expect(swarm.allowCachedCompute).toHaveBeenCalledWith(false);
  expect(swarm.allowCachedFiles).toHaveBeenCalledWith(false);
});

it('refuses on-device execution when it is chosen, not when the first answer runs', () => {
  const session = open({ zeroRequesterWeights: true });
  const [model] = CANONICAL_CHAT_MODELS;
  expect(() => session.createThread({ model, executionLocation: 'local' })).toThrow('network computers only');
  expect(() => session.createThread({ model, sharingScope: 'local' })).toThrow('network computers only');
  const threadId = session.createThread({ model, executionLocation: 'network' });
  expect(() => session.setExecutionLocation(threadId, 'local')).toThrow('network computers only');
  session.setExecutionLocation(threadId, 'auto');
  expect(session.getState().threads.find(thread => thread.id === threadId).permissions.executionLocation).toBe('auto');
});
