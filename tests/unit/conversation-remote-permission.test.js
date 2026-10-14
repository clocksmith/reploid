// The one-time remote contributor permission through the shipped host session, workspace, conversation view
// and settings. Only the ordered route's execution is injected: it builds the real ordered disclosure
// (partition-grants.js) and records what would leave the device. Presentation and authorization, not inference.
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
const PERMISSION_TEXT = {
  title: "Answer with contributors' computers?",
  what: "To answer, this conversation is sent to contributors' computers on this network: your message, earlier messages in the thread, and the context prompt when it is on.",
  who: 'The first computer receives the text. The other computers receive the same content as model tokens, which read back as text, plus intermediate results.',
  scope: 'You are asked once. Later questions and follow-ups are sent the same way until you turn this off in Settings.'
};

/** Injected ordered execution: the workspace decides first; only then is the disclosure recorded. */
function orderedRoute({ hold = null } = {}) {
  const disclosed = [];
  return { disclosed, getModels: () => [structuredClone(model)], subscribe: () => () => {},
    async generate(request, controls) {
      const { threadId, attemptId } = request;
      const identity = { schema: 'reploid.partition-attempt/v2', route, requesterId: REQUESTER, threadId, attemptId, placementGeneration: 0 };
      const disclosure = orderedPartitionDisclosure(identity);
      const approved = await controls.requestApproval({ id: 'preview-' + attemptId, threadId, attemptId, operation: 'generate-partition',
        peerId: STAGES[0], recipientIdentity: STAGES[0], ...structuredClone(model.partition), modelId: model.id,
        modelIdentity: model.identity, adapterIdentities: [], disclosure, expiresAt: Date.now() + 60000,
        input: { messages: structuredClone(request.messages), recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      if (approved !== true) throw Error('Ordered disclosure declined or expired');
      disclosed.push(structuredClone(request.messages));
      controls.onState({ threadId, attemptId, status: 'executing', execution: { placement: 'ordered-layer-partition', identity } });
      if (hold) await hold(request);
      controls.onDelta({ threadId, attemptId, sequence: 0, text: 'Answer' });
      return { threadId, attemptId, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'Answer',
        execution: { schema: 'reploid.mesh.partition-summary/v2', identity, stopReason: 'eos-token' } };
    } };
}
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }; };

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); document.body.replaceChildren(); });
function openSession({ storage = memory(), partitions = orderedRoute(), ...options } = {}) {
  const session = createChatSession({ storage, service: createChatTestService(), partitions, requesterIdentity: () => REQUESTER, ...options });
  cleanups.push(() => session.close());
  return { session, partitions, storage };
}
function mount(session) {
  const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace(); document.body.append(root);
  const dispose = bindConversationWorkspace(root, session); cleanups.push(async () => dispose());
  const find = selector => root.querySelector(selector), dialog = find('[data-remote-permission]');
  const shown = () => Object.fromEntries(['title', 'what', 'who', 'scope'].map(key => [key, find(`[data-remote-permission-${key}]`).textContent]));
  return { root, find, dialog, shown,
    submit(text) {
      find('[data-composer-input]').value = text;
      find('[data-composer-input]').dispatchEvent(new Event('input', { bubbles: true }));
      find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    } };
}
const lastAttempt = session => session.getState().activeThread?.attempts.at(-1);
const completed = (session, count) => vi.waitFor(() => {
  const attempts = session.getState().threads.flatMap(thread => thread.attempts);
  expect(attempts.filter(attempt => attempt.status === 'completed')).toHaveLength(count); return attempts;
});
const tick = () => new Promise(resolve => setTimeout(resolve, 30));

describe('One-time remote contributor permission', () => {
  it('asks once before anything leaves; Keep answers local sends nothing; Allow sends now and later without asking, across reloads', async () => {
    const { session, partitions, storage } = openSession(), view = mount(session);
    session.createThread({ model });
    view.submit('Summarize my notes');
    await vi.waitFor(() => expect(view.dialog.open).toBe(true));
    expect(view.shown()).toEqual(PERMISSION_TEXT);
    // Nothing was created or sent while the explanation is shown.
    expect(lastAttempt(session)).toBeUndefined(); expect(partitions.disclosed).toEqual([]);
    view.find('[data-remote-permission-local]').click();
    await tick();
    expect(view.dialog.open).toBe(false); expect(lastAttempt(session)).toBeUndefined(); expect(partitions.disclosed).toEqual([]);
    expect(view.find('[data-composer-input]').value).toBe('Summarize my notes');
    expect(session.getState().remotePermissions).toEqual([]);

    view.submit('Summarize my notes');
    await vi.waitFor(() => expect(view.dialog.open).toBe(true));
    view.find('[data-remote-permission-allow]').click();
    const [first] = await completed(session, 1);
    const [permission] = session.getState().remotePermissions;
    expect(permission).toMatchObject({ schema: 'reploid.remote-permission/v2', networkId: session.getState().remoteNetworkId, sharingScope: 'mesh',
      disclosure: 'ordered-partition-activations-and-tokens', revokedAt: null });
    expect(permission.modelIdentities).toContain(model.identity);
    expect(first.authorization).toMatchObject({ kind: 'permission', source: 'permission', permissionId: permission.id, recipients: STAGES, route });
    expect(partitions.disclosed).toEqual([[{ role: 'user', content: 'Summarize my notes' }]]);

    // A follow-up includes the earlier turn and is sent with no dialog and no held state.
    const statuses = []; session.subscribe(state => statuses.push(lastAttempt({ getState: () => state })?.status));
    view.submit('Shorter please');
    const attempts = await completed(session, 2);
    expect(view.dialog.open).toBe(false); expect(statuses).not.toContain('approval');
    expect(attempts.at(-1).authorization).toMatchObject({ permissionId: permission.id, recipients: STAGES });
    expect(partitions.disclosed[1]).toHaveLength(3);

    // The permission survives a reload: a new session over the same storage sends without asking.
    const reloaded = openSession({ storage, partitions }), again = mount(reloaded.session);
    expect(reloaded.session.getState().remotePermissions).toEqual([permission]);
    reloaded.session.createThread({ model });
    again.submit('After reload');
    await completed(reloaded.session, 3); // the two restored answers plus this one
    expect(again.dialog.open).toBe(false);
    expect(partitions.disclosed.at(-1).at(-1).content).toBe('After reload');
  });

  it('a permission granted on another network is not on here and the next request asks again', async () => {
    const storage = memory(), partitions = orderedRoute();
    const first = openSession({ storage, partitions, swarm: { getNetworkId: () => 'room-a', getState: () => ({}) } }), view = mount(first.session);
    first.session.createThread({ model }); view.submit('On room A');
    await vi.waitFor(() => expect(view.dialog.open).toBe(true));
    view.find('[data-remote-permission-allow]').click(); await completed(first.session, 1);
    expect(first.session.getState().remotePermissions[0].networkId).toBe('room-a');
    const second = openSession({ storage, partitions, swarm: { getNetworkId: () => 'room-b', getState: () => ({}) } }), other = mount(second.session);
    expect(other.find('[data-remote-permission-status]').textContent).toBe("Off. You are asked before a conversation is sent to contributors' computers.");
    second.session.createThread({ model }); other.submit('On room B');
    await vi.waitFor(() => expect(other.dialog.open).toBe(true));
    expect(partitions.disclosed.map(messages => messages.at(-1).content)).toEqual(['On room A']);
  });

  it('settings show the permission scope; turning it off asks again before anything is sent and leaves a running answer alone', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const partitions = orderedRoute({ hold: request => request.messages.at(-1).content === 'Long answer' ? gate : null });
    const { session } = openSession({ partitions }), view = mount(session);
    session.createThread({ model });
    expect(view.find('[data-remote-permission-status]').textContent).toBe("Off. You are asked before a conversation is sent to contributors' computers.");
    view.submit('Long answer');
    await vi.waitFor(() => expect(view.dialog.open).toBe(true));
    view.find('[data-remote-permission-allow]').click();
    await vi.waitFor(() => expect(partitions.disclosed).toHaveLength(1));
    const setting = view.find('[data-remote-permission-list] li');
    expect(setting.textContent).toContain("On: conversations are sent to contributors' computers on this network, split across several computers, for ");

    setting.querySelector('[data-revoke-remote-permission]').click();
    await vi.waitFor(() => expect(session.getState().remotePermissions[0].revokedAt).not.toBeNull());
    expect(view.find('[data-remote-permission-list]').children).toHaveLength(0);
    expect(lastAttempt(session).status).toBe('executing');
    release(); await completed(session, 1);

    view.submit('Next question');
    await vi.waitFor(() => expect(view.dialog.open).toBe(true));
    expect(partitions.disclosed).toHaveLength(1); expect(lastAttempt(session).status).toBe('completed');
    view.find('[data-remote-permission-allow]').click();
    await completed(session, 2);
    expect(session.getState().remotePermissions.filter(row => row.revokedAt === null)).toHaveLength(1);
  });

  it('a request held at dispatch asks once; Keep answers local declines only that request', async () => {
    const { session, partitions } = openSession(), view = mount(session);
    const id = session.createThread({ model }), held = session.send(id, 'Sent without the view');
    await vi.waitFor(() => expect(view.dialog.open).toBe(true));
    expect(lastAttempt(session)).toMatchObject({ status: 'approval', authorization: null });
    expect(partitions.disclosed).toEqual([]);
    view.find('[data-remote-permission-local]').click();
    expect(await held).toMatchObject({ status: 'cancelled', error: 'Disclosure declined' });
    expect(view.find('.chat-message-actions [role="status"]').textContent).toBe('Not sent. You declined sharing this request.');
    expect(partitions.disclosed).toEqual([]);
  });

  it('local-only execution never asks', async () => {
    const { session } = openSession({ partitions: null }), view = mount(session), opened = [];
    session.createThread({ sharingScope: 'local' });
    session.subscribe(() => opened.push(view.dialog.open));
    view.submit('Stay here');
    await vi.waitFor(() => expect(lastAttempt(session)?.status).toBe('completed'));
    expect(lastAttempt(session)).toMatchObject({ approval: null, authorization: null, execution: { placement: 'local-webgpu' } });
    expect(opened.every(open => !open)).toBe(true); expect(session.getState().remotePermissions).toEqual([]);
  });
});
