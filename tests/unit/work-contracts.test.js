import { describe, it, expect, vi } from 'vitest';
import { createWorkRepository } from '../../self/host/work-repository.js';
import { createWorkSession } from '../../self/host/work-session.js';
import { selectWorkModel, openWorkProvider } from '../../self/providers/work-provider.js';
import policy from '../../self/config/work-profile.json' with { type: 'json' };
import { resolveWorkTask } from '../../self/host/work-task.js';

const row = () => ({ id: 'a', goal: 'Repair the input', modelId: 'cloud', revision: 0,
  output: 'result', inputs: [], artifacts: [], events: [{ tool: 'ReadInput', status: 'completed' }], peerJobs: [] });
const storageFixture = () => {
  let value = null;
  const storage = { getItem: () => value, setItem: vi.fn((key, next) => { value = next; }) };
  return { storage, locks: { request: (key, fn) => fn() } };
};
const model = { id: 'cloud', provider: 'gemini', name: 'Cloud' };
const providerFixture = async overrides => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ content: 'answer', model: 'cloud', provider: 'gemini' })));
  const options = { model, signal: new AbortController().signal,
    generation: { maxTokens: 10 }, maxOutcomeCharacters: 100,
    credentials: async () => ({ Authorization: 'Bearer fixture', 'X-Firebase-AppCheck': 'fixture' }),
    fetchImpl, ...overrides };
  return { provider: await openWorkProvider(options), fetchImpl };
};
const generate = provider => provider.generate([], () => {}, { signal: new AbortController().signal });

describe('Work contracts', () => {
  it('retains the deadline and a checkpoint after borrowed inference settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let started, release;
    const entered = new Promise(resolve => { started = resolve; });
    const borrowed = new Promise(resolve => { release = resolve; });
    const ports = storageFixture();
    const session = createWorkSession({ ...ports, models: [model], service: { isSupported: () => true },
      credentials: async () => ({ Authorization: 'Bearer fixture', 'X-Firebase-AppCheck': 'fixture' }),
      fetchImpl: () => { started(); return borrowed; } });
    try {
      const task = session.start({ goal: 'Repair the input', modelId: model.id });
      await entered;
      await vi.advanceTimersByTimeAsync(policy.profile.config.agent.timeoutMs);
      expect(session.getState().busy).toBe(true);
      release(new Response(JSON.stringify({ content: 'late', model: model.id })));
      const result = await task;
      expect(result).toMatchObject({ status: 'paused', error: 'Work deadline reached', checkpointAvailable: true, output: '' });
      await session.close();
      const restored = createWorkSession({ ...ports, models: [model], service: { isSupported: () => true } });
      expect(restored.getState().records[0]).toMatchObject({ status: 'paused', error: 'Work deadline reached', checkpointAvailable: true });
      await restored.close();
    } finally { release?.(new Response('{}')); vi.useRealTimers(); await session.close(); }
  });
  it('binds revision context to a detached saved parent and requires text criteria', () => {
    const parent = row();
    const request = { goal: 'Repair the input', criteria: '', parentId: parent.id, feedback: 'Use milliseconds',
      inputs: [], allowPeers: false, recallAccepted: false };
    const task = resolveWorkTask(request, { policy, records: [parent] });
    parent.output = 'changed';
    expect(task.parent.output).toBe('result');
    expect(() => resolveWorkTask({ ...request, criteria: {} }, { policy, records: [parent] })).toThrow('text');
    expect(() => resolveWorkTask({ ...request, parentId: 'missing' }, { policy, records: [parent] })).toThrow('saved parent');
  });

  it('retains an explicitly uncommitted projection if final task persistence fails', async () => {
    const ports = storageFixture();
    ports.storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    const session = createWorkSession({ ...ports, models: [model], service: { isSupported: () => true } });
    const result = await session.start({ goal: 'Repair the input', modelId: model.id });
    expect(result.revision).toBe(0);
    expect(session.getState().records[0].persistence.state).toBe('uncommitted');
    expect(session.getState().storageError).toBe('quota');
    expect(ports.storage.getItem()).toBeNull();
    await session.close();
  });
  it('rejects unknown selection and only defaults an absent selection', () => {
    expect(() => selectWorkModel({ models: [model], modelId: 'unknown', defaultModelId: model.id })).toThrow('Unknown');
    expect(selectWorkModel({ models: [model], defaultModelId: model.id })).toEqual(model);
    expect(() => selectWorkModel({ models: [{ id: 'gemini-like' }], modelId: 'gemini-like' })).toThrow('explicit');
  });
  it('does not advance committed revision on write failure and can retry', async () => {
    const ports = storageFixture(), repository = createWorkRepository({ ...ports, policy }), attempt = row();
    await repository.save(attempt);
    ports.storage.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    attempt.output = 'changed';
    await expect(repository.save(attempt)).rejects.toThrow('quota');
    expect(attempt.revision).toBe(1);
    expect(attempt.persistence.state).toBe('uncommitted');
    expect(repository.read()[0].output).toBe('result');
    await repository.save(attempt);
    expect(attempt.revision).toBe(2);
    expect(repository.read()[0].output).toBe('changed');
  });
  it('validates serialized size before committing revision', async () => {
    const ports = storageFixture(), repository = createWorkRepository({ ...ports, policy: { ...policy, maxHistoryBytes: 400 } });
    const attempt = row();
    attempt.output = 'a'.repeat(401);
    await expect(repository.save(attempt)).rejects.toThrow('storage limit');
    expect(attempt.revision).toBe(0);
    expect(ports.storage.setItem).not.toHaveBeenCalled();
  });
  it('returns detached frozen nested state to direct subscribers and getState', async () => {
    const ports = storageFixture();
    await createWorkRepository({ ...ports, policy }).save(row());
    const service = { isSupported: () => true, closeAll: vi.fn() };
    const session = createWorkSession({ ...ports, models: [model], service });
    expect(() => { session.getState().records[0].events[0].status = 'forged'; }).toThrow();
    expect(session.getState().records[0].events[0].status).toBe('completed');
    await session.close();
    expect(service.closeAll).not.toHaveBeenCalled();
  });
  it('requires both credentials before sending any cloud request', async () => {
    for (const headers of [{}, { Authorization: 'Bearer fixture' }, { 'X-Firebase-AppCheck': 'fixture' }]) {
      const { provider, fetchImpl } = await providerFixture({ credentials: async () => headers });
      await expect(generate(provider)).rejects.toThrow('credentials');
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
  it('sends credentials and retains requested and actual model identities', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ content: 'answer', model: 'fallback' })));
    const { provider } = await providerFixture({ fetchImpl, allowedFallbackModels: ['fallback'] });
    expect(await generate(provider)).toMatchObject({ requestedModel: 'cloud', model: 'fallback', provider: 'gemini' });
    expect(fetchImpl.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer fixture');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).allowedFallbackModels).toEqual(['fallback']);
    const denied = await providerFixture({ fetchImpl });
    await expect(generate(denied.provider)).rejects.toThrow('fallback policy');
  });
  it('retains status and retry evidence and rejects late cloud output after cancellation', async () => {
    const failed = await providerFixture({ fetchImpl: async () => new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }) });
    await expect(generate(failed.provider)).rejects.toMatchObject({ status: 429, retryAfter: '2' });
    const controller = new AbortController();
    const late = await providerFixture({ fetchImpl: async () => {
      controller.abort();
      return new Response(JSON.stringify({ content: 'late', model: 'cloud' }));
    } });
    const update = vi.fn();
    await expect(late.provider.generate([], update, { signal: controller.signal })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
