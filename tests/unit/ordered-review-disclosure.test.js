// REP-7 review acceptance on the shipped workspace and ordered partition owners: real requester,
// coordinator and stage protocol over synthetic channels (tests/fixtures/automatic-ordered-mesh.js).
// Numerical outputs are fixture data. The fixture records every frame each participant transmits,
// so these checks show what left the requester (slot 5) and when.
import { afterEach, expect, it, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';

const REQUESTER = 5, prompt = tasks[0].prompt, decoder = new TextDecoder();
const cleanups = [];
afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).reverse().map(close => close()));
  const failures = results.filter(row => row.status === 'rejected').map(row => row.reason);
  if (failures.length) throw new AggregateError(failures, 'Ordered review cleanup failed');
});
async function open() {
  const f = await automaticOrderedMesh(); cleanups.push(() => f.close());
  await f.prepare(); await vi.waitFor(() => expect(f.select(REQUESTER, 0)).toBeTruthy(), { timeout: 5000 });
  const app = createChatWorkspace({ meshId: 'mesh', participantId: f.identities[REQUESTER].peerId, store: { load: () => null, save: () => {} },
    execute: (request, controls) => f.meshes[REQUESTER].generate(request, controls) });
  cleanups.push(() => app.close());
  return { f, app, thread: app.createThread({ model: f.select(REQUESTER, 0), permissions: { sharingScope: 'mesh' } }) };
}
// Input reaching a coordinator (tokenize), stage admission (reserve), token context and activations
// (executeStage) and settlement (closeAttempt), per contributor.
const dispatch = f => f.states.map(state => state.resident ? ['tokenize', 'reserve', 'executeStage', 'closeAttempt']
  .map(name => state.resident[name].mock.calls.length) : null);
const sentBy = (f, slot) => f.traffic.filter(row => row.from === slot);
const text = rows => rows.map(row => typeof row.data === 'string' ? row.data : decoder.decode(row.data)).join('');
const reviewOf = (app, after = null) => vi.waitFor(() => {
  const attempt = app.getState().threads[0].attempts.at(-1);
  expect(attempt.id).not.toBe(after); expect(attempt.status).toBe('approval'); return attempt;
}, { timeout: 5000 });
const routeIds = model => model.partition.route.stages.map(stage => stage.participantId);
const settle = () => new Promise(resolve => setTimeout(resolve, 250));

it('Decline sends nothing: no input, token context, activation, reservation or grant leaves the requester', async () => {
  const { f, app, thread } = await open(), before = dispatch(f);
  const completion = app.send(thread, prompt);
  const review = await reviewOf(app), framesAtReview = sentBy(f, REQUESTER).length;
  const inputAtReview = sentBy(f, REQUESTER).filter(row => row.label === 'reploid-partitions-input').length;
  expect(review.approval.recipients).toEqual(routeIds(f.select(REQUESTER, 0)));
  app.approve(thread, review.id, review.approval.id, false);
  expect(await completion).toMatchObject({ status: 'cancelled', error: 'Disclosure declined', authorization: null, execution: null });
  await settle();
  expect(dispatch(f)).toEqual(before);
  // After the review the requester sends nothing on the input channel, the only one that carries a request.
  // Periodic discovery continues on the control channel whether or not a request exists: channel ready,
  // describe requests and this device's capability description. None of it carries request data.
  const after = sentBy(f, REQUESTER).slice(framesAtReview);
  expect(after.filter(row => row.label !== 'reploid-partitions-control')).toEqual([]);
  expect(after.every(row => typeof row.data === 'string')).toBe(true);
  const kinds = new Set(after.map(row => { const frame = JSON.parse(row.data); return frame.type === 'request' ? frame.metadata.operation : frame.type; }));
  expect([...kinds].every(kind => ['ready', 'describe', 'result'].includes(kind))).toBe(true);
  expect(after.filter(row => JSON.parse(row.data).type === 'result').every(row => JSON.parse(row.data).result.schema === 'reploid.partition-capability/v2')).toBe(true);
  expect(text(after)).not.toContain(review.id); expect(text(after)).not.toContain(thread);
  expect(sentBy(f, REQUESTER).filter(row => row.label === 'reploid-partitions-input')).toHaveLength(inputAtReview);
  // What the requester sent before the review (connection and descriptor refresh) carried no conversation content.
  expect(text(sentBy(f, REQUESTER))).not.toContain(prompt);
  // The coordinator never admitted the attempt, so it issued no execution, token-context or activation grant.
  expect(JSON.stringify(f.meshes[0].getState().attempts)).not.toContain(review.id);
  expect(f.states.every(state => !state.attempts?.size)).toBe(true);

  // Control: the same observations see an approved request leave the requester.
  const approved = app.send(thread, prompt), next = await reviewOf(app, review.id);
  expect(next.request.messages).toEqual([{ role: 'user', content: prompt }]); // the declined turn is not resent as history
  app.approve(thread, next.id, next.approval.id, true, { recipients: next.approval.recipients });
  expect((await approved).status).toBe('completed');
  expect(dispatch(f)).not.toEqual(before);
  expect(text(sentBy(f, REQUESTER))).toContain(prompt);
}, 20000);

it('recipients changed after display need renewed approval; the request never moves to the new route', async () => {
  const { f, app, thread } = await open();
  const completion = app.send(thread, prompt);
  const review = await reviewOf(app), shown = review.approval.recipients, before = dispatch(f);
  expect(shown[1]).toBe(f.identities[1].peerId);
  // The mesh replaces stage 1 while the review is on screen.
  await f.meshes[7].contribute(f.model.id, true); await f.meshes[1].stop();
  await vi.waitFor(() => expect(f.select(REQUESTER, 0)?.partition.route.stages[1].participantId).toBe(f.identities[7].peerId), { timeout: 5000 });
  app.approve(thread, review.id, review.approval.id, true, { recipients: shown });
  const failed = await completion;
  expect(failed.status).toBe('failed'); expect(failed.error).toContain('route changed');
  expect(failed.authorization.recipients).toEqual(shown); expect(failed.execution).toBeNull();
  await settle();
  expect(dispatch(f)).toEqual(before);
  expect(text(sentBy(f, REQUESTER))).not.toContain(prompt);

  // Renewed authorization: Retry shows the new recipients; nothing is sent until those are approved.
  const retry = app.retry(thread, review.id), renewed = await reviewOf(app, review.id);
  expect(renewed.approval.recipients).toEqual(routeIds(f.select(REQUESTER, 0)));
  expect(renewed.approval.recipients[1]).toBe(f.identities[7].peerId);
  expect(dispatch(f)).toEqual(before);
  expect(() => app.approve(thread, renewed.id, renewed.approval.id, true, { recipients: shown }))
    .toThrow('Approval no longer matches the displayed recipients');
  expect(dispatch(f)).toEqual(before);
  app.approve(thread, renewed.id, renewed.approval.id, true, { recipients: renewed.approval.recipients });
  const done = await retry;
  expect(done).toMatchObject({ status: 'completed', retryOf: review.id, authorization: { source: 'approval', recipients: renewed.approval.recipients } });
  expect(routeIds({ partition: { route: done.execution.identity.route } })).toEqual(renewed.approval.recipients);
  // The first attempt reached no stage of either route.
  for (const state of f.states.filter(row => row.resident)) {
    expect(JSON.stringify(state.resident.reserve.mock.calls.map(([args]) => args.identity.attemptId))).not.toContain(review.id);
  }
}, 20000);
