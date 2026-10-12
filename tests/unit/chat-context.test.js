import { describe, it, expect } from 'vitest';
import { createChatContext } from '../../self/host/chat-context.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

const model = { id: 'verified-model', name: 'Verified model', identity: 'sha256:' + 'a'.repeat(64) };
const result = request => ({ threadId: request.threadId, attemptId: request.attemptId, modelId: model.id,
  modelIdentity: model.identity, adapterIdentities: [], content: 'A useful answer longer than the compact context word cap is still allowed.' });

describe('optional application context', () => {
  it('defaults off, bounds the complete generated prompt and uses only identity-bound catalog metadata', () => {
    expect(createChatContext({}, model, [model])).toMatchObject({ content: '', metadata: { enabled: false, maxWords: 16, wordCount: 0 } });
    for (const maxWords of [16, 32, 64]) {
      const context = createChatContext({ enabled: true, maxWords }, model, [model]);
      expect(context.content.split(/\s+/u).length).toBeLessThanOrEqual(maxWords);
      expect(context.metadata.wordCount).toBe(context.content.split(/\s+/u).length);
      expect(context.content).toContain('Reploid');
      expect(context.content).toContain('Never invent model identity or execution details.');
      if (maxWords === 16) expect(context.metadata.wordCount).toBe(16);
      else { expect(context.content).toContain(model.name); expect(context.content).toContain('Use supplied metadata'); }
      expect(context.metadata.mode).toBeNull();
    }
    const mismatch = createChatContext({ enabled: true }, { ...model, identity: 'sha256:' + 'b'.repeat(64) }, [model]);
    expect(mismatch.content).not.toContain(model.name); expect(mismatch.metadata.modelIdentity).toBeNull();
    const long = { ...model, name: 'Long '.repeat(100) };
    expect(createChatContext({ enabled: true }, long, [long]).content).not.toContain('Long');
    for (const selection of [{ maxWords: 17 }, { maxWords: '16' }, { enabled: 'yes' }]) {
      expect(() => createChatContext(selection)).toThrow(/Context/);
    }
  });

  it('persists policy per thread and discloses the exact ordered system context without truncating user purpose', async () => {
    let saved, preview;
    const store = { load: () => saved, save: data => { saved = structuredClone(data); } };
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'user', store,
      execute: async (request, controls) => {
        preview = { ...result(request), id: 'preview', peerId: 'peer', expiresAt: Date.now() + 10000, input: request.messages };
        await controls.requestApproval(preview);
        return result(request);
      } });
    const context = createChatContext({ enabled: true, maxWords: 16 }, model, [model]);
    const purpose = 'User purpose '.repeat(30);
    const thread = app.createThread({ model, purpose, systemContext: context });
    const other = app.createThread({ model });
    const pending = app.send(thread, 'Original question');
    const attempt = app.getState().threads[0].attempts[0];
    expect(preview.input).toEqual([{ role: 'system', content: context.content + '\n\n' + purpose }, { role: 'user', content: 'Original question' }]);
    expect(attempt.request.messages).toEqual(preview.input);
    expect(attempt.systemContext).toEqual(context);
    expect(() => app.setSystemContext(thread, null)).toThrow(/idle/);
    app.approve(thread, attempt.id, 'preview', true);
    expect((await pending).status).toBe('completed');
    expect(app.getState().threads[1].systemContext).toBeNull();
    expect(saved.threads[0].systemContext).toEqual(context);
    const disabled = createChatContext({ enabled: false, maxWords: 64 }, model, [model]);
    app.setSystemContext(thread, disabled);
    const restored = createChatWorkspace({ meshId: 'mesh', participantId: 'user', store, execute: async request => result(request) });
    expect(restored.getState().threads[0].systemContext).toEqual(disabled);
    expect(restored.getState().threads[1].id).toBe(other);
    const next = await restored.send(thread, 'Follow-up');
    expect(next.request.messages[0]).toEqual({ role: 'system', content: purpose });
    expect(next.request.messages.at(-1).content).toBe('Follow-up');
    await app.close(); await restored.close();
  });

  it('retries the original authorized snapshot after context changes and rolls back failed policy persistence', async () => {
    let saved, failStorage = false;
    const store = { load: () => saved, save: value => { if (failStorage) throw Error('storage full'); saved = structuredClone(value); } };
    let calls = 0;
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'user', store,
      execute: async request => { if (++calls === 1) throw Error('disconnected'); return result(request); } });
    const original = createChatContext({ enabled: true }, model, [model]);
    const thread = app.createThread({ model, systemContext: original });
    const failed = await app.send(thread, 'Question');
    app.setSystemContext(thread, createChatContext({ enabled: false }, model, [model]));
    const retry = await app.retry(thread, failed.id);
    expect(retry.request).toEqual(failed.request); expect(retry.systemContext).toEqual(original);
    failStorage = true;
    const previous = app.getState().threads[0].systemContext;
    expect(() => app.setSystemContext(thread, original)).toThrow('storage full');
    expect(app.getState().threads[0].systemContext).toEqual(previous);
    failStorage = false; await app.close();
  });

  it('host updates and restores context without changing model or generation allowances', async () => {
    const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const session = createChatSession({ storage, service: createChatTestService() });
    const thread = session.createThread({ model: CANONICAL_CHAT_MODELS[1], sharingScope: 'local', contextPrompt: { enabled: true, maxWords: 16 } });
    const attempt = await session.send(thread, 'Hello');
    expect(attempt.status).toBe('completed'); expect(attempt.request.messages[0].role).toBe('system');
    const identity = session.getState().activeThread.model.identity;
    session.setContextPrompt(thread, { enabled: true, maxWords: 64 });
    await session.close();
    const restored = createChatSession({ storage, service: createChatTestService() });
    expect(restored.getState().threads[0]).toMatchObject({ model: { identity }, systemContext: { metadata: { maxWords: 64, enabled: true } } });
    await restored.close();
  });
});
