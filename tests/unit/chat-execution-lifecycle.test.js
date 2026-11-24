import { afterEach, expect, it, vi } from 'vitest';

const { createScheduler } = vi.hoisted(() => ({ createScheduler: vi.fn() }));
vi.mock('../../shared/vendor/reploid/chat/index.js', async importOriginal => ({
  ...await importOriginal(),
  createChatScheduler: createScheduler,
  remoteDisclosureKind: () => null
}));
import { createChatExecution } from '../../apps/poolday/host/chat-execution.js';

import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';

const LOCAL_POLICY = createExecutionPolicy();
const options = () => ({ service: {}, models: [], getModels: () => [], profile: {} });
afterEach(() => { createScheduler.mockReset(); });

it('retries an owned scheduler after failed close and shares in-flight closure', async () => {
  const close = vi.fn().mockRejectedValueOnce(new Error('Cleanup failed')).mockResolvedValue(undefined);
  createScheduler.mockReturnValue({ close });
  const execution = createChatExecution(options());
  const first = execution.close();
  expect(execution.close()).toBe(first);
  await expect(first).rejects.toThrow('Cleanup failed');
  await execution.close();
  await execution.close();
  expect(close).toHaveBeenCalledTimes(2);
});

it('refuses a per-request output limit on a route that would drop it, before anything is sent', async () => {
  const model = { id: 'model', identity: 'sha256:' + 'a'.repeat(64), provider: 'doppler', adapters: [] };
  const swarm = { generate: vi.fn() }, fleet = { execute: vi.fn() };
  createScheduler.mockReturnValue({ close: vi.fn() });
  const execution = createChatExecution({ ...options(), swarm, fleet, getModels: () => [model] });
  const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
  const controls = { signal: new AbortController().signal, requestApproval: vi.fn(), onState: vi.fn(), onDelta: vi.fn() };
  const request = { threadId: 't', attemptId: 'a', messages: [{ role: 'user', content: 'x' }], privacy, maxOutputTokens: 5,
    permissions: { executionLocation: 'network', sharingScope: 'network' } };
  for (const route of [model, { ...model, fleet: { poolIdentity: 'pool' } }]) {
    await expect(execution.execute({ ...request, model: route }, controls)).rejects.toThrow('cannot apply an output limit');
  }
  expect(swarm.generate).not.toHaveBeenCalled();
  expect(fleet.execute).not.toHaveBeenCalled();
  expect(controls.requestApproval).not.toHaveBeenCalled();
});

it('never closes a borrowed scheduler', async () => {
  const close = vi.fn();
  const execution = createChatExecution({ ...options(), scheduler: { close } });
  await execution.close();
  await execution.close();
  expect(createScheduler).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

// Exercise the local scheduler boundary; no numerical inference is simulated here.
function localFixture({ policy, profile = {} } = {}) {
  const model = { id: 'test-model', identity: 'sha256:' + 'a'.repeat(64), provider: 'doppler', adapters: [] };
  const schedule = vi.fn(async request => ({ model: model.id, modelIdentity: model.identity,
    adapterIdentities: [], content: String(request.maxOutputTokens) }));
  const execution = createChatExecution({ ...options(), policy, profile, models: [model],
    getModels: () => [model], scheduler: { schedule } });
  const run = maxOutputTokens => execution.execute({ threadId: 'thread', attemptId: 'attempt', model,
    messages: [{ role: 'user', content: 'Hello' }], permissions: { executionLocation: 'local' }, privacy: LOCAL_POLICY,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) },
  { signal: new AbortController().signal, onState() {}, onDelta() {} });
  return { schedule, run };
}

it('uses the owned fallback and ceiling without confusing the profile default with admission', async () => {
  const policy = { defaultOutputTokens: 16, maxOutputTokens: 32 };
  const f = localFixture({ policy });
  policy.defaultOutputTokens = 500;
  policy.maxOutputTokens = 500;
  await f.run();
  await f.run(64);
  expect(f.schedule.mock.calls.map(([request]) => request.maxOutputTokens)).toEqual([16, 32]);
  const withProfile = localFixture({ policy: { defaultOutputTokens: 16, maxOutputTokens: 32 },
    profile: { generation: { maxTokens: 20 } } });
  await withProfile.run();
  await withProfile.run(30);
  expect(withProfile.schedule.mock.calls.map(([request]) => request.maxOutputTokens)).toEqual([20, 30]);
});

it('preserves the shipped local fallback and ceiling', async () => {
  const f = localFixture();
  await f.run();
  await f.run(8192);
  expect(f.schedule.mock.calls.map(([request]) => request.maxOutputTokens)).toEqual([1024, 4096]);
});

it.each([0, -1, 1.5, NaN, Infinity, '32'])('rejects invalid local token count %s before scheduling', async count => {
  const f = localFixture();
  await expect(f.run(count)).rejects.toThrow('Invalid chat output token count');
  expect(f.schedule).not.toHaveBeenCalled();
});

it.each([null, {}, { defaultOutputTokens: 0, maxOutputTokens: 32 },
  { defaultOutputTokens: 32, maxOutputTokens: 16 }, { defaultOutputTokens: 16, maxOutputTokens: 32, extra: true }])(
  'rejects an invalid token policy before constructing a scheduler', policy => {
    expect(() => createChatExecution({ ...options(), policy })).toThrow('Invalid chat execution token policy');
    expect(createScheduler).not.toHaveBeenCalled();
  });
