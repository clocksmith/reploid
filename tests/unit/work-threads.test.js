import { createExecutionPolicy, bindExecutionRoute, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';
import { describe, it, expect, vi } from 'vitest';
import { createWorkSession, DEFAULT_WORK_MODELS } from '../../apps/poolday/host/work-session.js';
import { createWorkNetworkProvider, withWorkDevice } from '../../apps/poolday/providers/work-network-provider.js';

const openPolicy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
// The binding the real swarm attaches to each disclosure preview: the policy and the one recipient it will send to.
const peerPreview = async (control, peer, messages) => {
  const request = { model: { id: control.modelId, identity: control.modelIdentity }, privacy: control.privacy };
  const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [peer] }));
  return { id: crypto.randomUUID(), privacyBinding, input: messages, providerId: peer, recipientIdentity: peer,
    modelId: control.modelId, modelIdentity: control.modelIdentity, adapterIdentities: [], expiresAt: Date.now() + 30000 };
};
const peerAnswer = (control, content, peer) => ({ content, model: control.modelId, modelIdentity: control.modelIdentity,
  adapterIdentities: [], provider: 'doppler', execution: 'peer-whole-request', peerId: peer });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const store = () => {
  let value = null, tail = Promise.resolve();
  return { storage: { getItem: () => value, setItem: (_, next) => { value = next; } },
    locks: { request: (_, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; } } };
};

describe('independent work threads', () => {
  it('runs two network threads without local GPU, isolates approval, selection and stop, and retains both records', async () => {
    const controls = [], pending = [], ports = store();
    const service = { isSupported: () => false, open: vi.fn(), close: vi.fn() };
    const swarm = { connect: vi.fn(), hasProvider: () => true,
      async generate(messages, control) {
        const step = deferred(); pending.push(step); controls.push(control);
        const peer = 'peer-' + controls.length;
        const accepted = await control.approve(await peerPreview(control, peer, messages));
        control.signal.throwIfAborted();
        if (!accepted) throw new Error('Disclosure declined');
        const text = await step.promise;
        control.signal.throwIfAborted();
        return peerAnswer(control, text, peer);
      } };
    const app = createWorkSession({ ...ports, service, swarm });
    const first = app.start({ goal: 'First objective', privacy: openPolicy, allowPeers: true }), firstId = app.getState().selectedId;
    const second = app.start({ goal: 'Second objective', privacy: openPolicy, allowPeers: true }), secondId = app.getState().selectedId;
    await vi.waitFor(() => expect(app.getState().approvalThreadIds).toHaveLength(2));
    expect(app.getState().runningIds).toEqual([firstId, secondId]);
    const secondApproval = app.getState().pendingApproval.id;
    app.select(firstId);
    expect(app.getState().pendingApproval.id).not.toBe(secondApproval);
    app.approvePeer(app.getState().pendingApproval.id, true);
    app.select(null);
    expect(app.getState()).toMatchObject({ busy: false, anyBusy: true, pendingApproval: null });
    app.cancel(firstId);
    expect(controls[0].signal.aborted).toBe(true);
    expect(controls[1].signal.aborted).toBe(false);
    pending[0].resolve('late');
    expect((await first).status).toBe('paused');
    expect(app.getState().runningIds).toEqual([secondId]);
    app.select(secondId); app.approvePeer(secondApproval, true);
    pending[1].resolve('TOOL: RecordOutcome\ntext: Second result');
    await vi.waitFor(() => expect(controls).toHaveLength(3));
    await vi.waitFor(() => expect(app.getState().pendingApproval).not.toBeNull());
    app.approvePeer(app.getState().pendingApproval.id, true);
    pending[2].resolve('IDLE: Done');
    const finished = await second;
    expect(finished).toMatchObject({ status: 'review', output: 'Second result' });
    // Every peer step kept its execution receipt, naming the one recipient bound before the prompt left.
    expect(finished.peerSteps.map(step => [step.kind, step.receipt.status, step.receipt.route.participants])).toEqual([
      ['step', 'completed', ['peer-2']], ['step', 'completed', ['peer-3']]]);
    expect(finished.execution.receipt).toMatchObject({ schema: 'reploid.execution-receipt/v2', api: 'reploid.inference/v2', protection: 'plaintext' });
    expect(service.open).not.toHaveBeenCalled();
    await app.close();
    const restored = createWorkSession({ ...ports, service });
    expect(restored.getState().records.map(row => [row.goal, row.status])).toEqual([
      ['First objective', 'paused'], ['Second objective', 'review']
    ]);
    await restored.close();
  });

  it('keeps GPU ownership until settlement and removes cancelled queued work', async () => {
    const service = {}, first = new AbortController(), second = new AbortController(), third = new AbortController();
    const gate = deferred(), started = deferred(), called = vi.fn();
    const a = withWorkDevice(service, first.signal, async () => { started.resolve(); await gate.promise; });
    await started.promise;
    const b = withWorkDevice(service, second.signal, called);
    const rejected = expect(b).rejects.toThrow('Stopped queued thread');
    const c = withWorkDevice(service, third.signal, called);
    first.abort(); second.abort(new Error('Stopped queued thread'));
    await rejected;
    expect(called).not.toHaveBeenCalled();
    gate.resolve(); await Promise.all([a, c]);
    expect(called).toHaveBeenCalledTimes(1);
  });

  it('never falls back to another execution after peer refusal or failure', async () => {
    const service = { open: vi.fn(), isSupported: () => true };
    const swarm = { connect: vi.fn(), hasProvider: () => true, generate: vi.fn().mockRejectedValue(new Error('Denied')) };
    const provider = createWorkNetworkProvider({ model: DEFAULT_WORK_MODELS[0], service, swarm, privacy: openPolicy,
      signal: new AbortController().signal, controls: {} });
    await expect(provider.generate([{ role: 'user', content: 'task' }])).rejects.toThrow('Denied');
    expect(service.open).not.toHaveBeenCalled();
    expect(DEFAULT_WORK_MODELS.every(model => model.provider === 'doppler')).toBe(true);
  });

  it('does not load on the requester when discovery fails', async () => {
    const service = { isSupported: () => true, close: vi.fn(),
      open: async () => ({ async *stream() { yield { type: 'text-delta', text: 'device answer' }; } }) };
    const swarm = { connect: async () => { throw new Error('Signaling unavailable'); }, generate: vi.fn(), hasProvider: () => false };
    const provider = createWorkNetworkProvider({ model: DEFAULT_WORK_MODELS[0], service, swarm, scope: 'test', privacy: openPolicy,
      signal: new AbortController().signal, generation: {}, maxOutcomeCharacters: 100 });
    await expect(provider.generate([{ role: 'user', content: 'task' }], () => {})).rejects.toThrow('Signaling unavailable');
    expect(swarm.generate).not.toHaveBeenCalled();
    expect(service.close).not.toHaveBeenCalled();
  });
});

it('snapshots work policy and propagates it to the network without fallback', async () => {
  const privacy = structuredClone(createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['approved-provider'] } }));
  const service = { open: vi.fn() }, swarm = { connect: vi.fn(), hasProvider: () => true, generate: vi.fn().mockRejectedValue(Error('Declined')) };
  const provider = createWorkNetworkProvider({ model: DEFAULT_WORK_MODELS[0], service, swarm, privacy,
    signal: new AbortController().signal, controls: {} });
  privacy.recipients.ids.push('injected-provider');
  await expect(provider.generate([{ role: 'user', content: 'private workload' }])).rejects.toThrow('Declined');
  expect(swarm.generate.mock.calls[0][1].privacy.recipients.ids).toEqual(['approved-provider']);
  expect(service.open).not.toHaveBeenCalled();
});
it('enforces local-only and unavailable work backends before any remote data port', async () => {
  const service = { isSupported: () => false, open: vi.fn() }, swarm = { connect: vi.fn(), generate: vi.fn() };
  const options = { model: DEFAULT_WORK_MODELS[0], service, swarm, controls: {}, signal: new AbortController().signal };
  await expect(createWorkNetworkProvider({ ...options, privacy: createExecutionPolicy() }).generate([{ content: 'secret' }])).rejects.toThrow('cannot execute');
  expect(swarm.connect).not.toHaveBeenCalled(); expect(swarm.generate).not.toHaveBeenCalled();
  // A homomorphic policy is refused by the inference API with its stable code, never answered on this device.
  const confidential = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['approved-provider'] },
    computation: 'cryptographic', protocol: 'unsupported', keyContext: 'key', leakage: ['model-id', 'timing', 'length', 'access-patterns'] });
  await expect(createWorkNetworkProvider({ ...options, privacy: confidential }).generate([{ role: 'user', content: 'secret' }]))
    .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
  expect(swarm.connect).not.toHaveBeenCalled(); expect(swarm.generate).not.toHaveBeenCalled();
  expect(() => createWorkNetworkProvider({ ...options, model: { provider: 'gemini', id: 'unqualified-cloud' }, privacy: createExecutionPolicy() })).toThrow('qualified complete');
  expect(service.open).not.toHaveBeenCalled();
});
it('retains a host-owned work policy in local records and revision drafts', async () => {
  const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['approved-provider'] } });
  const swarm = { connect: vi.fn(), hasProvider: () => true, generate: vi.fn(async (_messages, controls) => ({
    content: 'IDLE: Done', model: controls.modelId, provider: 'doppler', adapterIdentities: [] })) };
  const app = createWorkSession({ ...store(), service: { isSupported: () => false }, swarm });
  try {
    await app.start({ goal: 'Keep the policy fixed', privacy });
    const row = app.getState().records[0]; expect(row.privacy).toEqual(privacy);
    expect(swarm.generate.mock.calls[0][1].privacy).toEqual(privacy);
    expect(app.prepareRevision(row.id).privacy).toEqual(privacy);
  } finally { await app.close(); }
});

describe('Work network steps through reploid/inference', () => {
  const named = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['approved-provider'] } });
  const messages = [{ role: 'user', content: 'private workload' }];
  const options = (swarm, approve = async () => true) => ({ model: DEFAULT_WORK_MODELS[0], service: { open: vi.fn(), isSupported: () => true },
    swarm, privacy: named, signal: new AbortController().signal, controls: { approve, record: async () => {} } });

  it('returns the answer with an execution receipt for the approved recipient', async () => {
    const sent = [], approved = [];
    const swarm = { connect: vi.fn(), hasProvider: () => true, async generate(input, control) {
      if (!await control.approve(await peerPreview(control, 'approved-provider', input))) throw new Error('Declined');
      sent.push(input); control.onPartial('Peer answer');
      return peerAnswer(control, 'Peer answer', 'approved-provider');
    } };
    const result = await createWorkNetworkProvider(options(swarm, async (preview, route) => { approved.push(route.participants); return true; }))
      .generate(messages, () => {});
    expect(sent).toEqual([messages]);
    expect(approved).toEqual([['approved-provider']]);
    expect(result.content).toBe('Peer answer');
    expect(result.executionReceipt).toMatchObject({ status: 'completed', route: { shape: 'remote', participants: ['approved-provider'] },
      routeKind: 'remote', requested: { execution: { protection: 'plaintext', route: 'remote', participants: { kind: 'named', ids: ['approved-provider'] } } } });
  });

  it('refuses a route change after approval and sends nothing more', async () => {
    const sent = [];
    const swarm = { connect: vi.fn(), hasProvider: () => true, async generate(input, control) {
      expect(await control.approve(await peerPreview(control, 'approved-provider', input))).toBe(true);
      // The peer binding then proposes a different recipient for the same attempt.
      if (await control.approve(await peerPreview(control, 'other-provider', input))) sent.push(input);
      throw new Error('Disclosure declined');
    } };
    const service = { open: vi.fn(), isSupported: () => true };
    // Open participants: the first admitted recipient pins the route; no later recipient is accepted.
    const error = await createWorkNetworkProvider({ ...options(swarm), service, privacy: openPolicy }).generate(messages, () => {}).catch(cause => cause);
    expect(error.code).toBe('EXECUTION_PLAN_CHANGED');
    expect(error.executionReceipt).toMatchObject({ status: 'failed', route: { participants: ['approved-provider'] } });
    expect(sent).toEqual([]);
    expect(service.open).not.toHaveBeenCalled();
  });

  it('refuses a homomorphic Work thread before it is saved or anything is sent', async () => {
    const swarm = { connect: vi.fn(), hasProvider: () => true, generate: vi.fn() };
    const service = { isSupported: () => true, open: vi.fn() };
    const ports = store();
    const app = createWorkSession({ ...ports, service, swarm });
    const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] },
      computation: 'cryptographic', protocol: 'unsupported', keyContext: 'key', leakage: ['model-id', 'timing', 'length', 'access-patterns'] });
    await expect(app.start({ goal: 'Keep this confidential', privacy, allowPeers: true }))
      .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
    expect(app.getState().records).toEqual([]);
    expect(ports.storage.getItem()).toBeNull();
    expect(swarm.connect).not.toHaveBeenCalled(); expect(swarm.generate).not.toHaveBeenCalled(); expect(service.open).not.toHaveBeenCalled();
    await app.close();
  });
});

it('runs AskPeer through reploid/inference and keeps each peer step receipt with the thread', async () => {
  const answers = ['TOOL: AskPeer\ntask: Name one prime number', 'Seven', 'TOOL: RecordOutcome\ntext: Seven is prime', 'IDLE: Done'];
  const sent = [];
  const swarm = { connect: vi.fn(), hasProvider: () => true, async generate(messages, control) {
    if (!await control.approve(await peerPreview(control, 'peer-a', messages))) throw new Error('Declined');
    sent.push(messages.at(-1).content);
    return peerAnswer(control, answers.shift(), 'peer-a');
  } };
  const app = createWorkSession({ ...store(), service: { isSupported: () => false, open: vi.fn() }, swarm });
  try {
    const done = app.start({ goal: 'Ask a peer', privacy: openPolicy, allowPeers: true });
    for (let step = 0; step < 4; step++) {
      await vi.waitFor(() => expect(app.getState().pendingApproval).not.toBeNull());
      app.approvePeer(app.getState().pendingApproval.id, true);
    }
    const row = await done;
    expect(row).toMatchObject({ status: 'review', output: 'Seven is prime' });
    expect(sent[1]).toBe('Name one prime number');
    expect(row.peerSteps.map(step => [step.kind, step.receipt.status, step.receipt.route.participants]))
      .toEqual([['step', 'completed', ['peer-a']], ['ask-peer', 'completed', ['peer-a']], ['step', 'completed', ['peer-a']], ['step', 'completed', ['peer-a']]]);
  } finally { await app.close(); }
});
