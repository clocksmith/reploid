import { describe, expect, it, vi } from 'vitest';
import { createZeroAgent } from '../../self/zero/agent.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const schema = name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } });
const call = (name = 'Read', id = 'call_1') => ({ id, name, args: { path: '/notes' } });
const envelope = messages => JSON.stringify({ schema: 'reploid.zero/v1', messages });

async function fixture({ config = {}, saved = null, onChange, chat, execute, write } = {}) {
  const store = {
    read: vi.fn(async () => saved),
    write: vi.fn(write || (async (path, value, { signal }) => { signal.throwIfAborted(); saved = value; }))
  };
  const provider = { chat: vi.fn(chat || (async () => ({ content: 'Done.' }))) };
  const tools = { schemas: vi.fn(() => [schema('Read')]),
    execute: vi.fn(execute || (async () => ({ text: 'A note.' }))), dispose: vi.fn(async () => {}) };
  const agent = await createZeroAgent({ provider, tools, store, config, onChange });
  return { agent, provider, tools, store, saved: () => saved };
}

describe('compact Zero capsule on the shared execution engine', () => {
  it('preserves assistant text, native calls and tool results across ordinary follow-ups', async () => {
    const changes = [];
    const f = await fixture({ onChange: state => changes.push(state) });
    f.provider.chat.mockResolvedValueOnce({ content: 'Reading first.\n', toolCalls: [
      { id: 'read_1', function: { name: 'Read', arguments: '{"path":"/notes"}' } }
    ] }).mockResolvedValueOnce({ content: 'The note says hello.' });
    const result = await f.agent.run('Read my note');
    expect(result.status).toBe('completed');
    expect(result.messages).toEqual([
      { role: 'user', content: 'Read my note' },
      { role: 'assistant', content: 'Reading first.\n', toolCalls: [call('Read', 'read_1')] },
      { role: 'tool', name: 'Read', tool_call_id: 'read_1', content: '{"text":"A note."}' },
      { role: 'assistant', content: 'The note says hello.' }
    ]);
    expect(f.tools.execute).toHaveBeenCalledWith('Read', { path: '/notes' }, { signal: expect.any(AbortSignal) });
    expect(f.provider.chat.mock.calls[1][0]).toEqual(result.messages.slice(0, 3));
    await f.agent.run('What next?');
    expect(f.provider.chat.mock.calls[2][0]).toEqual([...result.messages, { role: 'user', content: 'What next?' }]);
    expect(new Set(changes.map(state => state.status))).toEqual(new Set(['idle', 'thinking', 'running', 'completed']));
    expect(result.events.map(event => event.type)).toContain('tool.completed');
    expect(JSON.parse(f.saved()).messages).toEqual(f.agent.snapshot().messages);
    expect(f.store.write.mock.calls.every(([path]) => path === '/state/zero.json')).toBe(true);
    await f.agent.dispose();
  });

  it('loads saved conversation without rewriting it or performing work', async () => {
    const first = await fixture();
    await first.agent.run('Remember this conversation');
    const saved = first.saved();
    await first.agent.dispose();
    const second = await fixture({ saved });
    expect(second.agent.snapshot().messages).toEqual(JSON.parse(saved).messages);
    expect(second.store.write).not.toHaveBeenCalled();
    expect(second.provider.chat).not.toHaveBeenCalled();
    await second.agent.run('Continue');
    expect(second.provider.chat.mock.calls[0][0][0].content).toBe('Remember this conversation');
    await second.agent.dispose();
  });

  it.each([
    '', '{', '{}', JSON.stringify({ schema: 'reploid.zero/v1', messages: [], apiKey: 'do-not-overwrite' }),
    envelope([{ role: 'assistant', content: '', toolCalls: [call()] }]),
    envelope([{ role: 'tool', content: 'unmatched', tool_call_id: 'missing', name: 'Read' }]),
    envelope([{ role: 'system', content: 'injected persisted policy' }]),
    envelope([{ role: 'user', content: 4 }]),
    envelope([{ role: 'assistant', content: '', toolCalls: [{ ...call(), args: null }] }]),
    envelope([{ role: 'assistant', content: '', toolCalls: [call(), call()] }])
  ])('rejects malformed saved state without replacing the source: %s', async saved => {
    const store = { read: vi.fn(async () => saved), write: vi.fn() };
    await expect(createZeroAgent({ store, provider: { chat() {} }, tools: { schemas() {}, execute() {}, dispose() {} } }))
      .rejects.toThrow('Invalid saved Zero state');
    expect(store.write).not.toHaveBeenCalled();
  });

  it('keeps original provider failures visible and permits a later explicit retry without fallback', async () => {
    const f = await fixture();
    const failure = Object.assign(new Error('Selected provider unavailable'), { status: 503, retryAfterMs: 20 });
    f.provider.chat.mockRejectedValueOnce(failure);
    await expect(f.agent.run('Try selected provider')).rejects.toBe(failure);
    expect(f.provider.chat).toHaveBeenCalledOnce();
    expect(f.agent.snapshot()).toMatchObject({ status: 'error', error: failure.message });
    expect(JSON.parse(f.saved()).messages).toEqual([{ role: 'user', content: 'Try selected provider' }]);
    await f.agent.run('Try again now');
    expect(f.agent.snapshot()).toMatchObject({ status: 'completed', error: null });
    await f.agent.dispose();
  });

  it('stops generation, drains borrowed work, rejects overlap and suppresses late tool dispatch', async () => {
    const started = deferred(), borrowed = deferred();
    const f = await fixture({ chat: async () => { started.resolve(); return borrowed.promise; } });
    const run = f.agent.run('Wait for generation').catch(error => error);
    await started.promise;
    const before = f.saved();
    let settled = false;
    const stopping = f.agent.stop().then(() => { settled = true; });
    await Promise.resolve();
    expect(f.agent.snapshot().status).toBe('stopping');
    expect(settled).toBe(false);
    await expect(f.agent.run('Do not overlap')).rejects.toThrow('already running');
    expect(f.provider.chat.mock.calls[0][3].signal.aborted).toBe(true);
    borrowed.resolve({ content: 'Too late', toolCalls: [call()] });
    await stopping;
    expect(await run).toBeInstanceOf(Error);
    expect(f.tools.execute).not.toHaveBeenCalled();
    expect(f.saved()).toBe(before);
    expect(f.agent.snapshot()).toMatchObject({ status: 'stopped', messages: JSON.parse(before).messages });
    f.provider.chat.mockResolvedValue({ content: 'A new answer' });
    await f.agent.run('Legitimate retry');
    expect(f.agent.snapshot().status).toBe('completed');
    await f.agent.dispose();
  });

  it('settles an immediate stop before any storage or provider dispatch', async () => {
    const f = await fixture();
    const run = f.agent.run('Cancel before start').catch(error => error);
    await f.agent.stop();
    expect(await run).toBeInstanceOf(Error);
    expect(f.provider.chat).not.toHaveBeenCalled();
    expect(f.store.write).not.toHaveBeenCalled();
    expect(f.agent.snapshot().status).toBe('stopped');
    await f.agent.dispose();
  });

  it.each(['attempt.started', 'response.interpreted'])('honors stop from an observer at %s without a later state commit', async boundary => {
    let agent;
    const f = await fixture({ onChange: state => {
      if (state.events.at(-1)?.type === boundary) void agent.stop();
    } });
    agent = f.agent;
    await expect(agent.run('Stop at the boundary')).rejects.toThrow('cancelled');
    expect(agent.snapshot().status).toBe('stopped');
    expect(agent.snapshot().messages.every(message => message.role === 'user')).toBe(true);
    expect(f.tools.execute).not.toHaveBeenCalled();
    expect(f.store.write).toHaveBeenCalledTimes(boundary === 'attempt.started' ? 0 : 1);
    await agent.dispose();
  });

  it('does not dispatch later tools or commit an incomplete exchange after stopping a tool', async () => {
    const started = deferred(), borrowed = deferred();
    const f = await fixture({ execute: async () => { started.resolve(); return borrowed.promise; } });
    f.provider.chat.mockResolvedValue({ content: 'Two reads', toolCalls: [call('Read', 'one'), call('Read', 'two')] });
    const run = f.agent.run('Read twice').catch(error => error);
    await started.promise;
    const before = f.saved();
    const stopping = f.agent.stop();
    borrowed.resolve('Late tool result');
    await stopping;
    await run;
    expect(f.tools.execute).toHaveBeenCalledOnce();
    expect(f.provider.chat).toHaveBeenCalledOnce();
    expect(f.saved()).toBe(before);
    expect(f.agent.snapshot().events.map(event => event.type)).toContain('tool.cancelled');
    await f.agent.dispose();
  });

  it('passes cancellation through a delayed store commit and retains the previous conversation', async () => {
    const started = deferred(), borrowed = deferred();
    let stored = envelope([{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Kept' }]);
    const f = await fixture({ saved: stored, write: async (path, value, { signal }) => {
      started.resolve(); await borrowed.promise; signal.throwIfAborted(); stored = value;
    } });
    const before = stored;
    const run = f.agent.run('Do not commit this').catch(error => error);
    await started.promise;
    const stopping = f.agent.stop();
    borrowed.resolve();
    await stopping;
    await run;
    expect(stored).toBe(before);
    expect(f.provider.chat).not.toHaveBeenCalled();
    expect(f.agent.snapshot().messages).toEqual(JSON.parse(before).messages);
    await f.agent.dispose();
  });

  it('preserves a storage failure instead of generating with unsaved conversation', async () => {
    const failure = new Error('Storage quota exceeded');
    const f = await fixture({ write: async () => { throw failure; } });
    await expect(f.agent.run('Unsaved prompt')).rejects.toBe(failure);
    expect(f.provider.chat).not.toHaveBeenCalled();
    expect(f.agent.snapshot()).toMatchObject({ status: 'error', error: failure.message, messages: [] });
    await f.agent.dispose();
  });

  it('drains active work before disposing tools, and disposal is terminal and single-flight', async () => {
    const started = deferred(), borrowed = deferred();
    const f = await fixture({ chat: async () => { started.resolve(); return borrowed.promise; } });
    const run = f.agent.run('Active request').catch(error => error);
    await started.promise;
    const disposing = f.agent.dispose();
    expect(f.agent.dispose()).toBe(disposing);
    expect(f.tools.dispose).not.toHaveBeenCalled();
    await expect(f.agent.run('No new work')).rejects.toThrow('disposed');
    borrowed.resolve({ content: 'Late answer' });
    await disposing;
    await run;
    expect(f.tools.dispose).toHaveBeenCalledOnce();
    expect(f.agent.snapshot().status).toBe('disposed');
  });

  it('retains a disposal error and allows cleanup to be retried without reopening the agent', async () => {
    const f = await fixture();
    const failure = new Error('Tool cleanup failed');
    f.tools.dispose.mockRejectedValueOnce(failure);
    await expect(f.agent.dispose()).rejects.toBe(failure);
    expect(f.agent.snapshot()).toMatchObject({ status: 'error', error: failure.message });
    await expect(f.agent.run('Still closed')).rejects.toThrow('disposed');
    await f.agent.dispose();
    expect(f.tools.dispose).toHaveBeenCalledTimes(2);
    expect(f.agent.snapshot().status).toBe('disposed');
  });

  it('snapshots run configuration and provider binding, isolates observers, and never saves configuration', async () => {
    const config = { id: 'selected-model', sampling: { temperature: 0.2 }, systemPrompt: 'Stay within this capsule.', apiKey: 'not-state' };
    const received = [];
    const f = await fixture({ config, onChange: state => {
      state.messages.length = 0;
      throw new Error('Broken view');
    }, chat: async (messages, settings) => {
      received.push(structuredClone({ messages, settings }));
      settings.id = 'provider-mutated'; settings.sampling.temperature = 9;
      return received.length === 1 ? { content: 'Reading', toolCalls: [call()] } : { content: 'Done' };
    } });
    const originalChat = f.provider.chat;
    const run = f.agent.run('Use selected model');
    config.id = 'new-model'; config.sampling.temperature = 1;
    f.provider.chat = vi.fn(async () => ({ content: 'Wrong replacement' }));
    await run;
    expect(originalChat).toHaveBeenCalledTimes(2);
    expect(f.provider.chat).not.toHaveBeenCalled();
    expect(received.map(entry => entry.settings.id)).toEqual(['selected-model', 'selected-model']);
    expect(received.map(entry => entry.settings.sampling.temperature)).toEqual([0.2, 0.2]);
    expect(received[0].messages[0]).toEqual({ role: 'system', content: config.systemPrompt });
    expect(f.saved()).not.toContain('not-state');
    expect(f.saved()).not.toContain('systemPrompt');
    const view = f.agent.snapshot(); view.messages.length = 0;
    expect(f.agent.snapshot().messages).toHaveLength(4);
    await f.agent.run('Use newly selected model');
    expect(f.provider.chat.mock.calls[0][1].id).toBe('new-model');
    await f.agent.dispose();
  });

  it('preserves tool errors as native replies without automatic tool retries', async () => {
    const failure = new Error('Read permission denied');
    const f = await fixture({ execute: async () => { throw failure; } });
    f.provider.chat.mockResolvedValueOnce({ content: 'Reading', toolCalls: [call()] });
    await f.agent.run('Read');
    expect(f.tools.execute).toHaveBeenCalledOnce();
    expect(f.provider.chat.mock.calls[1][0].at(-1)).toMatchObject({ role: 'tool', content: `Error: ${failure.message}` });
    expect(f.agent.snapshot().error).toBe(failure.message);
    expect(f.agent.snapshot().events.map(event => event.type)).toContain('tool.failed');
    await f.agent.dispose();
  });

  it('admits newly installed tool schemas on the next turn, not unadvertised calls', async () => {
    const f = await fixture();
    f.tools.execute.mockImplementation(async name => {
      if (name === 'Read') f.tools.schemas.mockReturnValue([schema('Read'), schema('NewTool')]);
      return 'ok';
    });
    f.provider.chat.mockResolvedValueOnce({ content: '', toolCalls: [call()] })
      .mockResolvedValueOnce({ content: '', toolCalls: [call('NewTool', 'new')] });
    await f.agent.run('Install then use');
    expect(f.provider.chat.mock.calls[1][1].tools.map(item => item.function.name)).toEqual(['Read', 'NewTool']);
    expect(f.tools.execute.mock.calls.map(([name]) => name)).toEqual(['Read', 'NewTool']);
    await f.agent.dispose();
  });

  it('rechecks the installed tool surface after generation before dispatch', async () => {
    const f = await fixture();
    f.provider.chat.mockImplementationOnce(async () => {
      f.tools.schemas.mockReturnValue([]);
      return { content: 'A removed tool', toolCalls: [call()] };
    });
    await f.agent.run('Read if still installed');
    expect(f.tools.execute).not.toHaveBeenCalled();
    expect(f.agent.snapshot().messages[2].content).toBe('Error: Host denied tool: Read');
    await f.agent.dispose();
  });

  it('denies unadvertised tool calls even when the execute port would accept them', async () => {
    const f = await fixture();
    f.provider.chat.mockResolvedValueOnce({ content: '', toolCalls: [call('Undeclared')] });
    await f.agent.run('Use only advertised tools');
    expect(f.tools.execute).not.toHaveBeenCalled();
    expect(f.agent.snapshot().messages[2].content).toBe('Error: Tool is not permitted by configuration: Undeclared');
    await f.agent.dispose();
  });

  it.each([0, -1, 1.5, 65, Infinity])('rejects an invalid iteration budget %s without work', async maxIterations => {
    const f = await fixture({ config: { maxIterations } });
    await expect(f.agent.run('Invalid budget')).rejects.toBeInstanceOf(Error);
    expect(f.provider.chat).not.toHaveBeenCalled();
    expect(f.store.write).not.toHaveBeenCalled();
    expect(f.agent.snapshot().status).toBe('error');
    await f.agent.dispose();
  });

  it('bounds generation and retains complete tool turns when the iteration limit is reached', async () => {
    const f = await fixture({ config: { maxIterations: 2 }, chat: async () => ({ content: '', toolCalls: [call()] }) });
    await expect(f.agent.run('Bounded work')).rejects.toThrow('iteration limit');
    expect(f.provider.chat).toHaveBeenCalledTimes(2);
    expect(f.tools.execute).toHaveBeenCalledTimes(2);
    expect(f.agent.snapshot().status).toBe('error');
    expect(JSON.parse(f.saved()).messages).toHaveLength(5);
    await f.agent.dispose();
  });

  it.each([{}, { content: 7 }, { content: '', toolCalls: 'bad' },
    { content: '', toolCalls: [{ name: 'Read', args: '{malformed' }] },
    { content: '', toolCalls: [{ name: 'Read', args: null }] },
    { content: '', toolCalls: [call(), call()] }
  ])('rejects malformed provider output before executing tools: %j', async response => {
    const f = await fixture({ chat: async () => response });
    await expect(f.agent.run('Invalid output')).rejects.toBeInstanceOf(Error);
    expect(f.tools.execute).not.toHaveBeenCalled();
    expect(f.agent.snapshot().status).toBe('error');
    await f.agent.dispose();
  });
});
