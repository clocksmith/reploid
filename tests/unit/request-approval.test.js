// REP-7 permission step (docs/roadmap/requirements.md:145) through the shipped host session, workspace and
// conversation view. Only the ordered route's execution is injected: it builds the real ordered disclosure
// (partition-grants.js) and records what would leave the device, so these checks prove presentation and
// authorization, not inference.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatSession } from '../../self/host/chat-session.js';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createChatTestService } from '../fixtures/chat-service.js';

const peer = c => 'peer:' + c.repeat(24), digest = c => 'sha256:' + c.repeat(64);
const REQUESTER = peer('d'), STAGES = [peer('0'), peer('1'), peer('2')];
const route = { schema: 'reploid.partition-route/v1', modelId: 'ordered', modelIdentity: digest('a'), planId: digest('b'),
  activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 8, precision: 'f32', components: 1, elementStrideBytes: 4 },
  stages: STAGES.map((participantId, index) => ({ index, participantId, transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `execution-${index}` })) };
const model = { id: 'ordered', name: 'Ordered model', identity: route.modelIdentity, provider: 'doppler', availability: 'ready', adapters: [],
  selectionId: 'ordered/partition/' + route.planId,
  partition: { schema: 'reploid.partition-selection/v2', planId: route.planId, coordinatorId: STAGES[0], route } };

/** Injected ordered execution: review first, then record the disclosure and answer. */
function orderedRoute() {
  const disclosed = [];
  return { disclosed, getModels: () => [structuredClone(model)], subscribe: () => () => {},
    async generate(request, controls) {
      const { threadId, attemptId } = request, live = request.model.partition.route;
      const identity = { schema: 'reploid.partition-attempt/v2', route: live, requesterId: REQUESTER, threadId, attemptId, placementGeneration: 0 };
      const disclosure = orderedPartitionDisclosure(identity);
      const approved = await controls.requestApproval({ id: 'preview-' + attemptId, threadId, attemptId, operation: 'generate-partition',
        peerId: STAGES[0], recipientIdentity: STAGES[0], ...structuredClone(request.model.partition), modelId: model.id,
        modelIdentity: model.identity, adapterIdentities: [], disclosure, expiresAt: Date.now() + 60000,
        input: { messages: structuredClone(request.messages), recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      if (approved !== true) throw Error('Ordered disclosure declined or expired');
      disclosed.push({ attemptId, recipients: live.stages.map(stage => stage.participantId), messages: structuredClone(request.messages) });
      controls.onState({ threadId, attemptId, status: 'executing', execution: { placement: 'ordered-layer-partition', identity } });
      controls.onDelta({ threadId, attemptId, sequence: 0, text: 'Answer' });
      return { threadId, attemptId, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'Answer',
        execution: { schema: 'reploid.mesh.partition-summary/v2', identity, stopReason: 'eos-token' } };
    } };
}

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); document.body.replaceChildren(); });
function mount(session) {
  const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace(); document.body.append(root);
  const dispose = bindConversationWorkspace(root, session); cleanups.push(async () => dispose());
  const find = selector => root.querySelector(selector);
  return { root, find,
    async submit(text) {
      find('[data-composer-input]').value = text;
      find('[data-composer-input]').dispatchEvent(new Event('input', { bubbles: true }));
      find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(find('[data-chat-approval]').hidden).toBe(false));
      const section = find('[data-chat-approval]');
      return { recipientIds: JSON.parse(section.dataset.recipients), attemptId: section.dataset.attemptId,
        recipients: find('[data-permission-recipient]').textContent, scope: find('[data-permission-scope]').textContent,
        review: find('[data-permission-review-label]').textContent, content: find('[data-permission-content]').textContent };
    } };
}
function openSession(partitions = orderedRoute()) {
  const session = createChatSession({ storage: null, service: createChatTestService(), partitions, requesterIdentity: () => REQUESTER });
  cleanups.push(() => session.close());
  return { session, partitions };
}
const attemptOf = (session, threadId, id) => session.getState().threads.find(thread => thread.id === threadId).attempts.find(item => item.id === id);
const settled = (session, threadId, id) => vi.waitFor(() => {
  const attempt = attemptOf(session, threadId, id); expect(['completed', 'failed', 'cancelled']).toContain(attempt.status); return attempt;
});

describe('Remote request review before disclosure', () => {
  it('shows content, named recipients and scope before anything leaves; Approve records exactly the displayed recipients', async () => {
    const { session, partitions } = openSession(), view = mount(session);
    const threadId = session.createThread({ model });
    const first = await view.submit('Summarize my notes');
    // Nothing has left the device while the review is shown; Decline replaces Stop.
    expect(partitions.disclosed).toEqual([]);
    expect(attemptOf(session, threadId, first.attemptId)).toMatchObject({ status: 'approval', authorization: null });
    expect(view.find('[data-composer-stop]').hidden).toBe(true);
    expect(first.recipientIds).toEqual(STAGES);
    expect(first.recipients).toBe('Recipients: Computer 1 (stage 1 of 3), Computer 2 (stage 2 of 3), Computer 3 (stage 3 of 3) · Ordered model');
    expect(first.scope).toBe('Sends this message. Computer 1 receives the text; Computer 2 and Computer 3 receive it as model tokens and intermediate results. Approval applies to this request only.');
    expect(first.content).toContain('Summarize my notes');
    expect(first.recipients + first.scope).not.toMatch(/peer:|transport-|\d+\.\d+\.\d+\.\d+/);

    view.find('[data-approval-approve]').click();
    const done = await settled(session, threadId, first.attemptId);
    expect(done.status).toBe('completed');
    expect(done.authorization).toMatchObject({ kind: 'once', source: 'approval', recipients: first.recipientIds,
      disclosure: 'ordered-partition-activations-and-tokens', route, requesterIdentity: REQUESTER });
    expect(partitions.disclosed).toEqual([{ attemptId: first.attemptId, recipients: first.recipientIds,
      messages: [{ role: 'user', content: 'Summarize my notes' }] }]);

    // A follow-up discloses the earlier exchange too, and the review says so before sending.
    const second = await view.submit('Shorter please');
    expect(second.scope).toMatch(/^Sends this message and 2 earlier messages\. /);
    expect(second.review).toBe('Review 3 messages');
    expect(second.content).toContain('Summarize my notes'); expect(second.content).toContain('Answer');
    expect(partitions.disclosed).toHaveLength(1);
    view.find('[data-approval-approve]').click();
    expect((await settled(session, threadId, second.attemptId)).authorization.recipients).toEqual(second.recipientIds);
    expect(partitions.disclosed[1].messages).toHaveLength(3);
  });

  it('Decline ends only that request, returns its draft and leaves other conversations untouched; Retry asks again', async () => {
    const { session, partitions } = openSession(), view = mount(session);
    const other = session.createThread({ model });
    const background = session.send(other, 'Unrelated question');
    await vi.waitFor(() => expect(session.getState().threads.find(thread => thread.id === other).attempts[0].status).toBe('approval'));
    const otherBefore = structuredClone(session.getState().threads.find(thread => thread.id === other));
    const threadId = session.createThread({ model });
    const review = await view.submit('Private draft');
    expect(view.find('[data-composer-input]').value).toBe('');

    view.find('[data-approval-decline]').click();
    const declined = await settled(session, threadId, review.attemptId);
    expect(declined).toMatchObject({ status: 'cancelled', error: 'Disclosure declined', authorization: null });
    await vi.waitFor(() => expect(view.find('[data-composer-input]').value).toBe('Private draft'));
    expect(session.getDraft(threadId)?.text).toBe('Private draft');
    expect(view.find('.chat-message-actions [role="status"]').textContent).toBe('Not sent. You declined sharing this request.');
    expect(partitions.disclosed).toEqual([]);
    // The other conversation's pending review is unchanged and can still be approved on its own.
    expect(session.getState().threads.find(thread => thread.id === other)).toEqual(otherBefore);
    const pending = session.getState().threads.find(thread => thread.id === other).attempts[0];
    session.approve(other, pending.id, pending.approval.id, true, { recipients: pending.approval.recipients });
    expect((await background).status).toBe('completed');
    expect(partitions.disclosed.map(row => row.messages.at(-1).content)).toEqual(['Unrelated question']);

    // Retry starts a new attempt with its own review; the earlier decision authorizes nothing.
    session.select(threadId);
    await vi.waitFor(() => expect(view.find(`[data-retry-attempt="${review.attemptId}"]`)).not.toBeNull());
    view.find(`[data-retry-attempt="${review.attemptId}"]`).click();
    await vi.waitFor(() => expect(view.find('[data-chat-approval]').dataset.attemptId).not.toBe(review.attemptId));
    expect(view.find('[data-chat-approval]').hidden).toBe(false);
    expect(partitions.disclosed).toHaveLength(1);
    const retry = view.find('[data-chat-approval]').dataset.attemptId;
    view.find('[data-approval-approve]').click();
    expect(await settled(session, threadId, retry)).toMatchObject({ status: 'completed', retryOf: review.attemptId,
      authorization: { source: 'approval', recipients: STAGES } });
  });

  it('local-only execution sends nothing and shows no review', async () => {
    const service = createChatTestService(), session = createChatSession({ storage: null, service });
    cleanups.push(() => session.close());
    const view = mount(session), threadId = session.createThread({ sharingScope: 'local' }), shown = [];
    session.subscribe(() => shown.push(view.find('[data-chat-approval]').hidden));
    view.find('[data-composer-input]').value = 'Stay here';
    view.find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(session.getState().threads[0].attempts[0]?.status).toBe('completed'));
    expect(session.getState().threads[0].attempts[0]).toMatchObject({ approval: null, authorization: null,
      execution: { placement: 'local-webgpu' } });
    expect(shown.every(Boolean)).toBe(true); expect(threadId).toBeTruthy();
  });
});
