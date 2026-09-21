import { describe, it, expect, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';

const model = { id: 'model-a', name: 'Model A', identity: 'sha256:' + 'a'.repeat(64) };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const fixture = execute => {
  let data;
  const store = { load: () => data, save: value => { data = structuredClone(value); } };
  const options = { meshId: 'invited-mesh', participantId: 'alice', store, execute };
  return { options, app: createChatWorkspace(options), store };
};
const result = (request, content) => ({ threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
  modelIdentity: request.model.identity, adapterIdentities: (request.model.adapters || []).map(adapter => adapter.identity), content });

describe('conversation workspace', () => {
  it('isolates two live conversations, their streams and cancellation while closing does not stop either', async () => {
    const pending = [], calls = [];
    const { app } = fixture(async (request, controls) => {
      const gate = deferred(); pending.push(gate); calls.push({ request, controls });
      await gate.promise; return result(request, 'Answer ' + request.messages.at(-1).content);
    });
    const a = app.createThread({ model }), b = app.createThread({ model });
    const first = app.send(a, 'First'), second = app.send(b, 'Second');
    expect(calls.map(call => call.request.messages)).toEqual([[{ role: 'user', content: 'First' }], [{ role: 'user', content: 'Second' }]]);
    calls[0].controls.onDelta({ ...result(calls[0].request, ''), text: 'partial', sequence: 0 });
    calls[0].controls.onDelta({ ...result(calls[0].request, ''), text: 'partial', sequence: 0 });
    calls[1].controls.onDelta({ ...result(calls[0].request, ''), text: 'wrong thread', sequence: 0 });
    app.closeThread(a); app.select(null);
    expect(calls.every(call => !call.controls.signal.aborted)).toBe(true);
    const cancelling = app.cancel(a);
    expect(calls[0].controls.signal.aborted).toBe(true);
    expect(calls[1].controls.signal.aborted).toBe(false);
    calls[0].controls.onDelta({ ...result(calls[0].request, ''), text: 'late', sequence: 1 });
    pending[0].resolve(); pending[1].resolve(); await cancelling;
    expect((await first).status).toBe('cancelled'); expect((await second).status).toBe('completed');
    expect(app.getState().threads.map(thread => thread.messages.at(-1).content)).toEqual(['partial', 'Answer Second']);
    await app.close();
  });

  it('retains multi-turn context only inside its conversation', async () => {
    const execute = vi.fn(async request => result(request, 'A response'));
    const { app } = fixture(execute);
    const a = app.createThread({ model, purpose: 'Explain clearly' }), b = app.createThread({ model });
    await app.send(a, 'First question'); await app.send(b, 'Different question'); await app.send(a, 'Follow-up');
    expect(execute.mock.calls[2][0].messages).toEqual([
      { role: 'system', content: 'Explain clearly' }, { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'A response' }, { role: 'user', content: 'Follow-up' }
    ]);
    await app.close();
  });

  it('requires the exact thread, attempt and disclosure identity for approval', async () => {
    const { app } = fixture(async (request, controls) => {
      const approval = { ...result(request, ''), id: 'preview-' + request.threadId, peerId: 'bob', expiresAt: Date.now() + 10000 };
      if (!await controls.requestApproval(approval)) throw new Error('Disclosure declined');
      return result(request, 'Approved answer');
    });
    const a = app.createThread({ model }), b = app.createThread({ model });
    const first = app.send(a, 'Private A'), second = app.send(b, 'Private B');
    const attempts = app.getState().threads.map(thread => thread.attempts[0]);
    expect(() => app.approve(a, attempts[1].id, 'preview-' + b, true)).toThrow('Approval no longer matches');
    app.approve(a, attempts[0].id, 'preview-' + a, false);
    app.approve(b, attempts[1].id, 'preview-' + b, true);
    expect((await first).status).toBe('failed'); expect((await second).status).toBe('completed');
    await app.close();
  });

  it('restores interrupted output without resending and retries into a separate generation', async () => {
    const gate = deferred(); let original, control;
    const { app, options, store } = fixture(async (request, controls) => {
      original = request; control = controls; await gate.promise; return result(request, 'partial');
    });
    const a = app.createThread({ model }), first = app.send(a, 'Question');
    control.onDelta({ ...result(original, ''), text: 'partial', sequence: 0 });
    const saved = structuredClone(store.load());
    const resumedExecute = vi.fn(async request => result(request, 'Fresh answer'));
    const restored = createChatWorkspace({ ...options, store: { load: () => saved, save() {} }, execute: resumedExecute });
    expect(resumedExecute).not.toHaveBeenCalled();
    expect(restored.getState().selectedId).toBe(null);
    expect(restored.getState().threads[0].attempts[0].status).toBe('interrupted');
    const retry = await restored.retry(a, original.attemptId);
    expect(retry.retryOf).toBe(original.attemptId); expect(retry.id).not.toBe(original.attemptId);
    expect(restored.getState().threads[0].messages.map(message => message.content)).toEqual(['Question', 'partial', 'Fresh answer']);
    expect(resumedExecute.mock.calls[0][0].messages).toEqual(original.messages);
    gate.resolve(); await first; await app.close(); await restored.close();
  });

  it('rejects completed response identity drift and does not merge a new generation into a stream', async () => {
    const { app } = fixture(async (request, controls) => {
      controls.onDelta({ ...result(request, ''), text: 'original', sequence: 0 }); return result(request, 'replacement');
    });
    const a = app.createThread({ model });
    expect(await app.send(a, 'Hello')).toMatchObject({ status: 'failed', error: 'Completed response differs from its stream' });
    expect(app.getState().threads[0].messages.at(-1).content).toBe('original');
    await app.close();
  });

  it('does not disclose a conversation when its initial history write fails', async () => {
    const execute = vi.fn(); const { app, store } = fixture(execute);
    const thread = app.createThread({ model }); store.save = () => { throw new Error('Full'); };
    expect(() => app.send(thread, 'Private')).toThrow('Full');
    expect(execute).not.toHaveBeenCalled(); expect(app.getState().storageError).toBe('Full');
    await app.close();
  });

  it('rejects model or adapter substitution even when the displayed model name matches', async () => {
    const { app } = fixture(async request => ({ ...result(request, 'Wrong adapter'), adapterIdentities: [] }));
    const thread = app.createThread({ model: { ...model, adapters: [{ identity: 'sha256:' + 'b'.repeat(64) }] } });
    expect(await app.send(thread, 'Use my selected specialist')).toMatchObject({ status: 'failed', error: 'Response identity mismatch' });
    expect(app.getState().threads[0].messages.at(-1).content).toBe('');
    await app.close();
  });

  it('fails a stream with missing updates instead of silently joining incomplete text', async () => {
    const { app } = fixture(async (request, controls) => {
      controls.onDelta({ ...result(request, ''), text: 'missing prefix', sequence: 1 });
      return result(request, 'missing prefix');
    });
    const thread = app.createThread({ model });
    expect(await app.send(thread, 'Hello')).toMatchObject({ status: 'failed', error: 'Response stream has a gap' });
    await app.close();
  });
});
