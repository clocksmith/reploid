import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createAutoDownload } from '../../apps/poolday/ui/pool-home/auto-download.js';
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

it('starts no automatic download when switched on, even with the browser preference on', () => {
  const getModelDownload = vi.fn();
  const downloads = createAutoDownload({ getState: () => ({ zeroRequesterWeights: true }), getModelDownload, downloadLocalModel: vi.fn() },
    { storage: { getItem: () => 'on', setItem() {} } });
  expect(downloads.enabled()).toBe(false);
  expect(downloads.available()).toBe(false);
  downloads.consider({ eligible: true, models: CANONICAL_CHAT_MODELS });
  expect(getModelDownload).not.toHaveBeenCalled();
  downloads.dispose();
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
