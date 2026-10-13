import { expect, it, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';

// Actual workspace, grants, automatic discovery and peer owners; injected
// numerical outputs and certificate observations are not physical inference.
it('requires a new remembered disclosure after automatic middle-replica replacement', async () => {
  const f = await automaticOrderedMesh();
  let app, primary;
  try {
    await f.prepare();
    await vi.waitFor(() => expect(f.select(5,0)).toBeTruthy(), { timeout: 5000 });
    app = createChatWorkspace({ meshId: 'mesh', participantId: f.identities[5].peerId,
      store: { load: () => null, save: () => {} },
      execute: (request, controls) => f.meshes[5].generate(request, controls) });
    const threadId = app.createThread({ model: f.select(5,0), permissions: { sharingScope: 'mesh' } });
    const first = app.send(threadId, tasks[0].prompt);
    await vi.waitFor(() => expect(app.getState().threads[0].attempts.at(-1).status).toBe('approval'));
    const initial = app.getState().threads[0].attempts.at(-1);
    expect(initial.approval.route.stages[1].participantId).toBe(f.identities[1].peerId);
    app.approve(threadId, initial.id, initial.approval.id, true, { remember: true });
    expect((await first).status).toBe('completed');
    const oldGrant = app.getState().threads[0].grants[0];

    await f.meshes[7].contribute(f.model.id, true);
    await f.meshes[1].stop();
    await vi.waitFor(() => expect(f.select(5,0)?.partition.route.stages[1].participantId)
      .toBe(f.identities[7].peerId), { timeout: 5000 });
    const before = f.states[0].resident.tokenize.mock.calls.length;
    const second = app.send(threadId, tasks[0].prompt);
    await vi.waitFor(() => expect(app.getState().threads[0].attempts.at(-1).status).toBe('approval'));
    const pending = app.getState().threads[0].attempts.at(-1);
    expect(pending.authorization).toBeNull();
    expect(pending.approval.route.stages[1].participantId).toBe(f.identities[7].peerId);
    expect(pending.approval.input.recipients).toContain(f.identities[7].peerId);
    expect(pending.approval.input.recipients).not.toContain(f.identities[1].peerId);
    expect(f.states[0].resident.tokenize).toHaveBeenCalledTimes(before);
    expect(f.states[7].resident.reserve).not.toHaveBeenCalled();
    expect(app.getState().threads[0].messages.at(-1).content).toBe('');
    // Rejecting the new recipients never inherits the old grant or dispatches.
    app.approve(threadId, pending.id, pending.approval.id, false);
    expect((await second).status).toBe('cancelled');
    expect(f.states[0].resident.tokenize).toHaveBeenCalledTimes(before);
    expect(f.states[7].resident.reserve).not.toHaveBeenCalled();

    const retry = app.retry(threadId, pending.id);
    await vi.waitFor(() => expect(app.getState().threads[0].attempts.at(-1).status).toBe('approval'));
    const replacement = app.getState().threads[0].attempts.at(-1);
    expect(replacement.id).not.toBe(pending.id);
    app.approve(threadId, replacement.id, replacement.approval.id, true, { remember: true });
    const completed = await retry;
    expect(completed.status).toBe('completed');
    expect(completed.execution.identity.route.stages[1].participantId).toBe(f.identities[7].peerId);
    const grants = app.getState().threads[0].grants;
    expect(grants).toHaveLength(2);
    expect(grants[0]).toEqual(oldGrant);
    expect(grants[1].route.stages[1].participantId).toBe(f.identities[7].peerId);
    const follow = await app.send(threadId, tasks[0].prompt);
    expect(follow.status).toBe('completed');
    expect(follow.authorization.grantId).toBe(grants[1].id);
    expect(f.loads[5]).not.toHaveBeenCalled();
    expect(f.states.every(state => state.attempts.size === 0)).toBe(true);
  } catch (error) { primary = error; } finally {
    const failures = [];
    try { await app?.close(); } catch (error) { failures.push(error); }
    try { await f.close(); } catch (error) { failures.push(error); }
    if (primary || failures.length) throw new AggregateError([...(primary ? [primary] : []), ...failures], 'Grant replacement control failed');
  }
}, 20000);
