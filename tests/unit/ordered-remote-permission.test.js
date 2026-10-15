// The one-time remote contributor permission on the shipped workspace and ordered partition owners: real
// requester, coordinator and stage protocol over synthetic channels (tests/fixtures/automatic-ordered-mesh.js).
// Numerical outputs are fixture data. The fixture records every frame each participant transmits, so these
// checks show what left the requester (slot 5) and when.
import { afterEach, expect, it, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createRemotePermission } from '../../packages/reploid/src/chat/remote-permission.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';

const REQUESTER = 5, prompt = tasks[0].prompt, decoder = new TextDecoder();
const cleanups = [];
afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).reverse().map(close => close()));
  const failures = results.filter(row => row.status === 'rejected').map(row => row.reason);
  if (failures.length) throw new AggregateError(failures, 'Ordered permission cleanup failed');
});
async function open() {
  const f = await automaticOrderedMesh(); cleanups.push(() => f.close());
  await f.prepare(); await vi.waitFor(() => expect(f.select(REQUESTER, 0)).toBeTruthy(), { timeout: 5000 });
  const stored = [], statuses = [];
  const app = createChatWorkspace({ meshId: 'mesh', participantId: f.identities[REQUESTER].peerId, remotePermissions: () => stored,
    store: { load: () => null, save: () => {} }, execute: (request, controls) => f.meshes[REQUESTER].generate(request, controls) });
  cleanups.push(() => app.close());
  app.subscribe(state => statuses.push(...state.threads.map(thread => thread.attempts.at(-1)?.status)));
  const thread = () => app.createThread({ model: f.select(REQUESTER, 0), permissions: { sharingScope: 'mesh' } });
  const last = id => app.getState().threads.find(item => item.id === id).attempts.at(-1);
  return { f, app, stored, statuses, thread, last };
}
// Input reaching a coordinator (tokenize), stage admission (reserve), token context and activations
// (executeStage) and settlement (closeAttempt), per contributor.
const dispatch = f => f.states.map(state => state.resident ? ['tokenize', 'reserve', 'executeStage', 'closeAttempt']
  .map(name => state.resident[name].mock.calls.length) : null);
const sentBy = (f, slot) => f.traffic.filter(row => row.from === slot);
const text = rows => rows.map(row => typeof row.data === 'string' ? row.data : decoder.decode(row.data)).join('');
const held = (app, id) => vi.waitFor(() => {
  const attempt = app.getState().threads.find(item => item.id === id).attempts.at(-1);
  expect(attempt.status).toBe('approval'); return attempt;
}, { timeout: 5000 });
const routeIds = route => route.stages.map(stage => stage.participantId);
const settle = () => new Promise(resolve => setTimeout(resolve, 250));

it('nothing leaves before permission: no input, token context, activation, reservation or grant; keeping answers local sends nothing', async () => {
  const { f, app, stored, thread } = await open(), before = dispatch(f), id = thread();
  const completion = app.send(id, prompt);
  const attempt = await held(app, id), framesAtHold = sentBy(f, REQUESTER).length;
  expect(attempt.approval.permissionNeed).toMatchObject({ sharingScope: 'mesh', disclosure: 'ordered-partition-activations-and-tokens',
    modelIdentity: f.model.identity });
  app.approve(id, attempt.id, attempt.approval.id, false);
  expect(await completion).toMatchObject({ status: 'cancelled', error: 'Disclosure declined', authorization: null, execution: null });
  await settle();
  expect(dispatch(f)).toEqual(before);
  // Only periodic discovery continues after the hold (ready, describe, this device's capability); nothing on the input channel.
  const after = sentBy(f, REQUESTER).slice(framesAtHold);
  expect(after.filter(row => row.label !== 'reploid-partitions-control')).toEqual([]);
  const kind = row => { const frame = JSON.parse(row.data); return frame.type === 'request' ? frame.metadata.operation : frame.type; };
  expect(after.every(row => ['ready', 'describe', 'result'].includes(kind(row)))).toBe(true);
  expect(text(sentBy(f, REQUESTER))).not.toContain(prompt);
  expect(text(after)).not.toContain(attempt.id);
  expect(JSON.stringify(f.meshes[0].getState().attempts)).not.toContain(attempt.id);

  // Control: granting the permission releases a held request, and the same observations see it leave.
  const next = app.send(id, prompt), waiting = await held(app, id);
  expect(dispatch(f)).toEqual(before);
  stored.push(createRemotePermission({ id: 'remote', wording: { id: 'reploid.remote-contributor-permission', version: '1', text: 'Shown text' }, need: waiting.approval.permissionNeed, grantedAt: Date.now() }));
  expect(app.resumePermitted()).toBe(1);
  const done = await next;
  expect(done).toMatchObject({ status: 'completed', authorization: { kind: 'permission', permissionId: 'remote' } });
  expect(done.request.messages).toEqual([{ role: 'user', content: prompt }]); // the kept-local turn is not resent as history
  expect(dispatch(f)).not.toEqual(before);
  expect(text(sentBy(f, REQUESTER))).toContain(prompt);
}, 20000);

it('a permitted request is sent with no approval step; each record cites the permission and the route it was dispatched to', async () => {
  const { f, app, stored, statuses, thread } = await open(), id = thread();
  stored.push(createRemotePermission({ id: 'remote', wording: { id: 'reploid.remote-contributor-permission', version: '1', text: 'Shown text' }, grantedAt: Date.now(), need: { networkId: 'mesh', sharingScope: 'mesh',
    disclosure: 'ordered-partition-activations-and-tokens', modelId: f.model.id, modelIdentity: f.model.identity, adapterIdentities: [] } }));
  const first = await app.send(id, prompt);
  expect(first.authorization).toMatchObject({ kind: 'permission', source: 'permission', permissionId: 'remote',
    recipients: routeIds(first.execution.identity.route), route: first.execution.identity.route });
  expect(first.authorization.recipients[1]).toBe(f.identities[1].peerId);

  // The mesh replaces stage 1 between requests: the next request goes to the new route under the same permission,
  // its record names that route, and the earlier record is unchanged.
  await f.meshes[7].contribute(f.model.id, true); await f.meshes[1].stop();
  await vi.waitFor(() => expect(f.select(REQUESTER, 0)?.partition.route.stages[1].participantId).toBe(f.identities[7].peerId), { timeout: 5000 });
  const other = app.createThread({ model: f.select(REQUESTER, 0), permissions: { sharingScope: 'mesh' } });
  const second = await app.send(other, prompt);
  expect(second.authorization).toMatchObject({ permissionId: 'remote', recipients: routeIds(second.execution.identity.route) });
  expect(second.authorization.recipients[1]).toBe(f.identities[7].peerId);
  expect(app.getState().threads.find(item => item.id === id).attempts[0].authorization).toEqual(first.authorization);
  expect(statuses).not.toContain('approval');
}, 20000);

it('revocation stops new disclosures and leaves an admitted answer running', async () => {
  const { f, app, stored, thread } = await open(), id = thread();
  stored.push(createRemotePermission({ id: 'remote', wording: { id: 'reploid.remote-contributor-permission', version: '1', text: 'Shown text' }, grantedAt: Date.now(), need: { networkId: 'mesh', sharingScope: 'mesh',
    disclosure: 'ordered-partition-activations-and-tokens', modelId: f.model.id, modelIdentity: f.model.identity, adapterIdentities: [] } }));
  const gate = f.gate(2, id, 1), running = app.send(id, prompt);
  await gate.entered;
  stored[0] = { ...stored[0], revokedAt: Date.now() };
  gate.release();
  expect(await running).toMatchObject({ status: 'completed', authorization: { permissionId: 'remote' } });
  const before = dispatch(f), framesBefore = sentBy(f, REQUESTER).filter(row => row.label === 'reploid-partitions-input').length;
  const other = thread(), next = app.send(other, tasks[1].prompt);
  await held(app, other); await settle();
  expect(dispatch(f)).toEqual(before);
  expect(sentBy(f, REQUESTER).filter(row => row.label === 'reploid-partitions-input')).toHaveLength(framesBefore + 1); // its describe only
  expect(text(sentBy(f, REQUESTER))).not.toContain(tasks[1].prompt);
  await app.cancel(other); expect((await next).status).toBe('cancelled');
}, 20000);
