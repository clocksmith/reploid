import { it, expect, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';

const model = { id: 'base', name: 'Base', identity: 'sha256:' + 'a'.repeat(64) };
const bob = 'peer:' + 'b'.repeat(24), carol = 'peer:' + 'c'.repeat(24);
function fixture() {
  let stored, recipient = bob, afterApproval = async () => {};
  const calls = [];
  const options = { meshId: 'mesh', participantId: 'alice',
    store: { load: () => structuredClone(stored), save: value => { stored = structuredClone(value); } },
    async execute(request, controls) {
      const preview = { id: crypto.randomUUID(), threadId: request.threadId, attemptId: request.attemptId,
        peerId: 'connection', recipientIdentity: recipient, operation: 'generate', disclosure: 'public',
        modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], expiresAt: Date.now() + 10000 };
      calls.push({ request, controls, preview });
      if (!await controls.requestApproval(preview)) throw new Error('Disclosure declined');
      controls.signal.throwIfAborted();
      await afterApproval(controls);
      return { threadId: request.threadId, attemptId: request.attemptId, modelId: model.id,
        modelIdentity: model.identity, adapterIdentities: [], content: 'Answer' };
    } };
  const app = createChatWorkspace(options);
  const create = target => target.createThread({ model, permissions: { sharingScope: 'invited-mesh' } });
  const approve = (target, threadId, remember = false) => {
    const attempt = target.getState().threads.find(t => t.id === threadId).attempts.at(-1);
    target.approve(threadId, attempt.id, attempt.approval.id, true, { remember });
  };
  return { app, options, calls, create, approve, recipient: value => { recipient = value; },
    afterApproval: fn => { afterApproval = fn; } };
}

it('persists explicit thread grants, reuses them after refresh, and requires approval for new recipients and threads', async () => {
  const f = fixture(), a = f.create(f.app);
  const first = f.app.send(a, 'First'); f.approve(f.app, a, true);
  expect((await first).status).toBe('completed');
  expect((await f.app.send(a, 'Follow-up')).authorization.kind).toBe('thread-grant');
  await f.app.close();
  const restored = createChatWorkspace(f.options);
  expect((await restored.send(a, 'After refresh')).status).toBe('completed');
  f.recipient(carol);
  const next = restored.send(a, 'Different recipient');
  expect(restored.getState().threads[0].attempts.at(-1).status).toBe('approval');
  f.approve(restored, a); await next;
  f.recipient(bob);
  const b = f.create(restored), other = restored.send(b, 'Another thread');
  expect(restored.getState().threads[1].attempts.at(-1).status).toBe('approval');
  f.approve(restored, b); await other; await restored.close();
});

it('does not remember one-time approval or accept an unverified recipient for a reusable grant', async () => {
  const f = fixture(), a = f.create(f.app);
  const first = f.app.send(a, 'Once'); f.approve(f.app, a); await first;
  expect(f.app.getState().threads[0].grants).toEqual([]);
  f.recipient(null);
  const second = f.app.send(a, 'Unverified');
  expect(f.app.getState().threads[0].attempts.at(-1).approval.reusable).toBe(false);
  expect(() => f.approve(f.app, a, true)).toThrow('verified recipient');
  f.approve(f.app, a); await second; await f.app.close();
});

it('revokes active and future use without cancelling another conversation', async () => {
  const f = fixture(), a = f.create(f.app), b = f.create(f.app);
  const first = f.app.send(a, 'Permit'); f.approve(f.app, a, true); await first;
  f.afterApproval(controls => new Promise(resolve => controls.signal.addEventListener('abort', resolve, { once: true })));
  const active = f.app.send(a, 'Running');
  await vi.waitFor(() => expect(f.calls).toHaveLength(2));
  const other = f.app.send(b, 'Pending approval');
  const grant = f.app.getState().threads[0].grants[0];
  f.app.revokeGrant(a, grant.id);
  expect((await active).status).toBe('cancelled');
  expect(f.calls.at(-1).controls.signal.aborted).toBe(false);
  f.afterApproval(async () => {});
  const next = f.app.send(a, 'Requires approval again');
  expect(f.app.getState().threads[0].attempts.at(-1).status).toBe('approval');
  f.approve(f.app, a); await next; await f.app.cancel(b); await other; await f.app.close();
});

it('does not authorize when persisting a new grant fails', async () => {
  const f = fixture(), a = f.create(f.app);
  const sent = f.app.send(a, 'Private');
  f.options.store.save = () => { throw new Error('Storage full'); };
  const rejected = expect(sent).rejects.toThrow('Storage full');
  expect(() => f.approve(f.app, a, true)).toThrow('Storage full');
  await rejected;
  expect(f.app.getState().threads[0].grants).toEqual([]);
  expect(f.app.getState().threads[0].attempts.at(-1).status).toBe('failed');
  await f.app.close();
});

it('rechecks cancellation after notifying observers of automatic grant use', async () => {
  const f = fixture(), a = f.create(f.app);
  const first = f.app.send(a, 'Permit'); f.approve(f.app, a, true); await first;
  const grant = f.app.getState().threads[0].grants[0];
  const unsubscribe = f.app.subscribe(state => {
    const attempt = state.threads[0].attempts.at(-1);
    if (attempt.request.messages.at(-1).content === 'Revoked before dispatch'
      && attempt.authorization?.grantId === grant.id && !state.threads[0].grants[0].revokedAt) f.app.revokeGrant(a, grant.id);
  });
  const result = await f.app.send(a, 'Revoked before dispatch');
  expect(result.status).toBe('cancelled');
  unsubscribe(); await f.app.close();
});

it('rejects a stored grant moved into another thread', async () => {
  const f = fixture(), a = f.create(f.app);
  const first = f.app.send(a, 'Permit'); f.approve(f.app, a, true); await first;
  const saved = f.options.store.load(); saved.threads[0].grants[0].threadId = 'someone-else';
  expect(() => createChatWorkspace({ ...f.options, store: { load: () => saved, save() {} } })).toThrow('Invalid stored conversation grants');
  await f.app.close();
});
