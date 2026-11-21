// The one-time remote contributor permission through the shipped host session, workspace, conversation view
// and settings. Only the ordered route's execution is injected: it builds the real ordered disclosure
// (partition-grants.js) and records what would leave the device. Presentation and authorization, not inference.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_CHAT_MODELS, createChatSession } from '../../apps/poolday/host/chat-session.js';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../apps/poolday/ui/pool-home/conversation-workspace.js';
import { remotePermissionWording } from '../../apps/poolday/ui/pool-home/remote-permission.js';
import { orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { bindExecutionRoute, createExecutionPolicy, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';

const OPEN_POLICY = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });

// Public partition routes need an owner-reviewed release (apps/poolday/config/partition-releases.json, empty when
// checked in; docs/partition-releases.md). The injected ordered route is approved so the host offers and admits it.
const releases = vi.hoisted(() => []);
vi.mock('../../apps/poolday/config/partition-releases.json', () => ({ default: { approvals: releases } }));

const peer = c => 'peer:' + c.repeat(24), digest = c => 'sha256:' + c.repeat(64);
const REQUESTER = peer('d'), STAGES = [peer('0'), peer('1'), peer('2')];
const route = { schema: 'reploid.partition-route/v1', modelId: 'ordered', modelIdentity: digest('a'), planId: digest('b'),
  activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 8, precision: 'f32', components: 1, elementStrideBytes: 4 },
  stages: STAGES.map((participantId, index) => ({ index, participantId, transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `execution-${index}` })) };
const model = { id: 'ordered', name: 'Ordered model', identity: route.modelIdentity, provider: 'doppler', availability: 'ready', adapters: [],
  selectionId: 'ordered/partition/' + route.planId,
  partition: { schema: 'reploid.partition-selection/v2', planId: route.planId, coordinatorId: STAGES[0], route } };
releases.push({ modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], partition: model.partition,
  evidence: 'test-fixture://conversation-remote-permission' });
/** Injected ordered execution: the workspace decides first; only then is the disclosure recorded. */
function orderedRoute({ hold = null } = {}) {
  const disclosed = [];
  return { disclosed, getModels: () => [structuredClone(model)], subscribe: () => () => {},
    async generate(request, controls) {
      const { threadId, attemptId } = request;
      const identity = { schema: 'reploid.partition-attempt/v2', route, requesterId: REQUESTER, threadId, attemptId, placementGeneration: 0 };
      const disclosure = orderedPartitionDisclosure(identity);
      const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: STAGES, route }));
      const approved = await controls.requestApproval({ privacyBinding, id: 'preview-' + attemptId, threadId, attemptId, operation: 'generate-partition',
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
  const find = selector => root.querySelector(selector);
  return { root, find,
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

describe('Contributor execution without permission popups', () => {
  it('defaults on, records authorization only on Send, and does not ask again for the answer', async () => {
    const { session, partitions } = openSession({}), view = mount(session);
    const thread = session.createThread({ model, privacy: OPEN_POLICY });
    expect(session.getState().remoteAnswersEnabled).toBe(true);
    expect(view.find('[data-remote-answers-toggle]').getAttribute('aria-checked')).toBe('true');
    expect(session.getState().remotePermissions).toEqual([]);
    expect(partitions.disclosed).toEqual([]);
    session.select(thread);
    expect(session.getState().remotePermissions).toEqual([]);
    view.submit('Answer using the network');
    const [attempt] = await completed(session, 1);
    expect(view.find('[data-remote-permission]')).toBeNull();
    const [permission] = session.getState().remotePermissions;
    expect(permission.wording.id).toBe('reploid.remote-contributor-setting');
    expect(attempt.authorization).toMatchObject({ permissionId: permission.id, recipients: STAGES });
    expect(partitions.disclosed[0].at(-1).content).toBe('Answer using the network');
  });

  it('persists an explicit off choice before any use, and on restores prompt-free network answers', async () => {
    const first = openSession({}), view = mount(first.session);
    view.find('[data-remote-answers-toggle]').click();
    await vi.waitFor(() => expect(first.session.getState().remoteAnswersEnabled).toBe(false));
    const second = openSession({ storage: first.storage }), again = mount(second.session);
    expect(second.session.getState().remoteAnswersEnabled).toBe(false);
    second.session.createThread({ model, privacy: OPEN_POLICY }); again.submit('Ask first');
    await vi.waitFor(() => expect(again.root.textContent).toContain('Network answers are off.'));
    expect(again.find('[data-remote-permission]')).toBeNull();
    expect(second.partitions.disclosed).toEqual([]);
    again.find('[data-remote-answers-toggle]').click();
    await vi.waitFor(() => expect(second.session.getState().remoteAnswersEnabled).toBe(true));
    again.submit('Allowed now'); await completed(second.session, 1);
    expect(again.find('[data-remote-permission]')).toBeNull();
  });

  it('preserves legacy Turn off records when no new preference has been stored', async () => {
    const first = openSession({});
    const thread = first.session.createThread({ model, privacy: OPEN_POLICY });
    await first.session.send(thread, 'First');
    first.session.revokeRemotePermission(first.session.getState().remotePermissions[0].id);
    first.storage.setItem('reploid.remote-access:v1', '{}');
    const second = openSession({ storage: first.storage });
    expect(second.session.getState().remoteAnswersEnabled).toBe(false);
    expect(second.session.remotePermissionNeeded({ model })).not.toBeNull();
  });

  it('sends nothing if the default permission cannot be persisted', () => {
    const storage = memory(), write = storage.setItem;
    storage.setItem = (key, value) => { if (key === 'reploid.remote-permissions:v1') throw new Error('Storage unavailable'); write(key, value); };
    const { session, partitions } = openSession({ storage });
    const thread = session.createThread({ model, privacy: OPEN_POLICY });
    expect(() => session.send(thread, 'Do not leak')).toThrow('Storage unavailable');
    expect(partitions.disclosed).toEqual([]);
    expect(session.getState().remotePermissions).toEqual([]);
  });

  it('sends follow-ups and restored conversations directly, preserving exact recipients', async () => {
    const { session, partitions, storage } = openSession(), view = mount(session);
    session.createThread({ model, privacy: OPEN_POLICY }); view.submit('Summarize my notes');
    const [first] = await completed(session, 1);
    const [permission] = session.getState().remotePermissions;
    expect(first.authorization).toMatchObject({ permissionId: permission.id, recipients: STAGES, route });
    const statuses = []; session.subscribe(state => statuses.push(state.activeThread?.attempts.at(-1)?.status));
    view.submit('Shorter please'); await completed(session, 2);
    expect(statuses).not.toContain('approval'); expect(partitions.disclosed[1].filter(message => message.role !== 'system')).toEqual([
      { role: 'user', content: 'Summarize my notes' }, { role: 'assistant', content: 'Answer' }, { role: 'user', content: 'Shorter please' }
    ]);
    const reloaded = openSession({ storage, partitions }), again = mount(reloaded.session);
    again.submit('After reload'); await completed(reloaded.session, 3);
    expect(partitions.disclosed.at(-1).at(-1).content).toBe('After reload');
    expect(again.find('[data-remote-permission]')).toBeNull();
  });

  it('binds a new network on Send without reusing another network record or asking', async () => {
    const storage = memory(), partitions = orderedRoute();
    const first = openSession({ storage, partitions, swarm: { getNetworkId: () => 'room-a', getState: () => ({}) } });
    const id = first.session.createThread({ model, privacy: OPEN_POLICY }); await first.session.send(id, 'Room A');
    const second = openSession({ storage, partitions, swarm: { getNetworkId: () => 'room-b', getState: () => ({}) } });
    const view = mount(second.session); second.session.createThread({ model, privacy: OPEN_POLICY }); view.submit('Room B');
    await completed(second.session, 2);
    expect(second.session.getState().remotePermissions.map(p => p.networkId)).toEqual(['room-a', 'room-b']);
    expect(view.find('[data-remote-permission]')).toBeNull();
  });

  it('turning network answers off blocks new work inline and preserves already admitted work', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const partitions = orderedRoute({ hold: () => gate });
    const { session } = openSession({ partitions }), view = mount(session);
    session.createThread({ model, privacy: OPEN_POLICY }); view.submit('Long answer');
    await vi.waitFor(() => expect(partitions.disclosed).toHaveLength(1));
    view.find('[data-remote-answers-toggle]').click();
    await vi.waitFor(() => expect(session.getState().remoteAnswersEnabled).toBe(false));
    expect(lastAttempt(session).status).toBe('executing');
    release(); await completed(session, 1);
    view.submit('Next question');
    await vi.waitFor(() => expect(view.root.textContent).toContain('Network answers are off.'));
    expect(partitions.disclosed).toHaveLength(1);
    expect(view.find('[data-composer-input]').value).toBe('Next question');
    expect(view.find('[data-remote-permission]')).toBeNull();
  });

  it('host callers also fail immediately when off instead of waiting for a hidden dialog', () => {
    const { session, partitions } = openSession(); session.setRemoteAnswersEnabled(false);
    const id = session.createThread({ model, privacy: OPEN_POLICY });
    expect(() => session.send(id, 'Do not send')).toThrow('Network answers are off');
    expect(partitions.disclosed).toEqual([]); expect(lastAttempt(session)).toBeUndefined();
  });

  it('local execution runs with network answers off and no permission prompt', async () => {
    const { session } = openSession({ partitions: null }), view = mount(session);
    // Send runs here only with a model on this device; jsdom has no WebGPU to prepare one, so it is already stored.
    session.setCachedModels([CANONICAL_CHAT_MODELS[1]]);
    session.setRemoteAnswersEnabled(false); session.createThread({ sharingScope: 'local' });
    view.submit('Stay here');
    await vi.waitFor(() => expect(lastAttempt(session)?.status).toBe('completed'), { timeout: 4000 });
    expect(lastAttempt(session)).toMatchObject({ approval: null, authorization: null, execution: { placement: 'local-webgpu' } });
    expect(view.find('[data-remote-permission]')).toBeNull(); expect(session.getState().remotePermissions).toEqual([]);
  });

  it('reconnects a returning provider by cryptographic identity without re-asking, and requires fresh consent when another machine would receive the prompt', async () => {
    const catalogModel = CANONICAL_CHAT_MODELS[1];
    const providerKeyA = peer('5'), providerKeyB = peer('6');
    let activeProvider = { providerId: 'rtc-conn-1', recipientIdentity: providerKeyA };
    const disclosed = [];
    const swarm = {
      getNetworkId: () => 'public-room',
      getState: () => ({}),
      connect: async () => {},
      hasProvider: () => true,
      async generate(messages, options) {
        const current = { ...activeProvider };
        const request = { model: catalogModel, privacy: options.privacy };
        const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, {
          recipients: [current.recipientIdentity], route: { schema: 'reploid.mesh-route/v1', providerId: current.recipientIdentity,
            offerId: 'whole-model-offer', backend: 'doppler-plaintext/v1' }
        }));
        const approved = await options.approve({
          privacyBinding,
          id: 'preview-' + crypto.randomUUID(),
          providerId: current.providerId,
          recipientIdentity: current.recipientIdentity,
          operation: 'generate',
          disclosure: 'public',
          modelId: catalogModel.id,
          modelIdentity: catalogModel.identity,
          adapterIdentities: [],
          expiresAt: Date.now() + 60000,
          input: { messages: structuredClone(messages), recipients: [current.recipientIdentity] },
        });
        if (approved !== true) throw new Error('Disclosure declined');
        await options.record({ stage: 'approved', providerId: current.providerId });
        disclosed.push({ recipientIdentity: current.recipientIdentity, providerId: current.providerId, messages: structuredClone(messages) });
        const content = `Reply from ${current.recipientIdentity}`;
        options.onPartial?.(content);
        return {
          provider: 'doppler',
          model: catalogModel.id,
          modelIdentity: catalogModel.identity,
          adapterIdentities: [],
          peerId: current.providerId,
          content,
        };
      },
    };
    const { session, storage } = openSession({ partitions: null, swarm });
    const thread = session.createThread({ model: catalogModel, executionLocation: 'network', privacy: OPEN_POLICY });
    await session.send(thread, 'Turn one');
    await completed(session, 1);
    expect(disclosed).toHaveLength(1);
    expect(session.getState().remotePermissions).toHaveLength(1);

    // Same cryptographic identity reconnects with a fresh ephemeral WebRTC socket + reloaded session: zero approval prompt.
    activeProvider = { providerId: 'rtc-conn-2', recipientIdentity: providerKeyA };
    const reloaded = openSession({ storage, partitions: null, swarm });
    const view = mount(reloaded.session);
    reloaded.session.select(thread);
    const statuses = [];
    reloaded.session.subscribe(state => statuses.push(state.activeThread?.attempts.at(-1)?.status));
    await reloaded.session.send(thread, 'Turn two after provider reconnect');
    await completed(reloaded.session, 2);
    expect(statuses).not.toContain('approval');
    expect(view.find('[data-remote-permission]')).toBeNull();
    expect(disclosed).toHaveLength(2);
    expect(disclosed[1]).toMatchObject({ recipientIdentity: providerKeyA, providerId: 'rtc-conn-2' });
    expect(reloaded.session.getState().remotePermissions).toHaveLength(1);

    // Another machine (different cryptographic identity) would now receive the user's prompt: fresh consent is required before sending.
    activeProvider = { providerId: 'rtc-conn-3', recipientIdentity: providerKeyB };
    const thirdTurn = reloaded.session.send(thread, 'Turn three with another machine');
    await vi.waitFor(() => expect(lastAttempt(reloaded.session)?.status).toBe('approval'));
    expect(disclosed).toHaveLength(2);
    const dialog = view.find('[data-remote-permission]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain(providerKeyB);
    view.find('[data-remote-permission-allow]').click();
    await thirdTurn;
    await completed(reloaded.session, 3);
    expect(view.find('[data-remote-permission]')).toBeNull();
    expect(disclosed).toHaveLength(3);
    expect(disclosed[2].recipientIdentity).toBe(providerKeyB);
    expect(reloaded.session.getState().remotePermissions).toHaveLength(2);
  });
});
