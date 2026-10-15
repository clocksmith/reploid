import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createRemotePermission, remotePermissionNeed } from '../../packages/reploid/src/chat/remote-permission.js';
import { remotePermissionWording } from '../../self/ui/pool-home/remote-permission.js';
import { fixture as stagesFixture } from '../fixtures/ordered-partition-ports.js';
import { createHash } from 'node:crypto';
import { canonicalPartitionJson } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { createConversationPublication } from '../../packages/reploid/src/chat/workspace-publication.js';
import { residentPreparationProgress } from '../../packages/reploid/src/mesh/partitions/partition-preparation-progress.js';

const discoveryOwners = vi.hoisted(() => []);
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery(options) {
    const owner = { options, capabilities: [], closed: false,
      getSnapshot: () => structuredClone(owner.capabilities),
      getModels: () => owner.capabilities.flatMap(peer => peer.description.models),
      refresh: vi.fn(async () => {}), invalidateModel: vi.fn(), close: vi.fn(async () => { owner.closed = true; }) };
    discoveryOwners.push(owner); return owner;
  }
}));
const cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(fn => fn())); discoveryOwners.length = 0; });
async function fixture(index = 0) {
  const f = stagesFixture(3), identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const localIndex = index ?? 0;
  if (index !== null) { f.route.stages[index].participantId = identity.peerId; f.stages[index].id = identity.peerId; }
  const model = { id: f.route.modelId, identity: f.route.modelIdentity, name: 'Synthetic' };
  for (const [i, port] of f.stages.entries()) Object.assign(port, { index: i, close: vi.fn(async () => {}),
    refresh: vi.fn(async () => ({ ready: true })), subscribe: () => () => {},
    getState: () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true, index: i,
      planId: f.route.planId, stageCount: 3 }, reservations: { active: 0, availableSlots: 2, closed: false } }) });
  f.stages[0].tokenize = vi.fn(async () => ({ modelIdentity: model.identity, tokenIds: [1, 2], generation: f.request.generation }));
  const policy = { pollMs: 60000, maxPeers: 8, connectTimeoutMs: 1000, grantMs: 60000,
    maxStageOffersPerPeer: 4, limits: f.limits, receiver: { maxAttempts: 32, maxSteps: 10 }, inputChannel: { maxControlBytes: 131072 },
    inputLimits: { maxInputCharacters: 4096, maxOutputCharacters: 128, maxAttempts: 32, maxConcurrentAttempts: 2, descriptorTtlMs: 60000 } };
  const networks = [], entry = { id: f.route.stages[0].participantId,
    refresh: vi.fn(async () => ({ ready: true, descriptor: { models: [fullModel()] } })),
    generate: vi.fn(async (_input, controls) => { controls.onDelta?.('ok'); return { content: 'ok', execution: {} }; }), close: vi.fn(async () => {}) };
  function fullModel() { return { ...model, index: 0, residentId: f.route.stages[0].residentId, executionId: f.route.stages[0].executionId,
    planId: f.route.planId, activation: f.route.activation, availability: 'ready', partition: {
      schema: 'reploid.partition-selection/v2', planId: f.route.planId, coordinatorId: f.route.stages[0].participantId, route: structuredClone(f.route) } }; }
  const createNetwork = vi.fn(options => {
    const owner = { options, close: vi.fn(async () => {}), retire: vi.fn(async transportId => {
      if (createNetwork.retireFailure === transportId) throw Error('retirement unknown');
    }),
      connect: vi.fn(async (transportId, { route } = {}) => {
        if (createNetwork.connectFailure === transportId) throw Error('opening failed');
        return options.label === 'reploid-partitions-input' ? entry : f.stages[route.stages.find(row => row.transportId === transportId).index];
      }) };
    networks.push(owner); return owner;
  });
  const loadProgram = vi.fn(async () => ({ resident: f.stages[localIndex], runtime: f.runtime, model,
    plan: f.plan, planId: f.route.planId }));
  const ordered = { stage: index === null ? null : f.route.stages[index], maxRouteBytes: 32768, maxRoutes: 4, maxSelectionSteps: 256 };
  const mesh = createAutomaticPartitions({ identity, meshId: 'mesh', models: [model], policy,
    peers: () => [], createNetwork, loadProgram, ordered });
  const discovery = discoveryOwners.at(-1);
  function capabilities(full = false) {
    const now = Date.now();
    return f.route.stages.filter(stage => stage.participantId !== identity.peerId).map(stage => ({ participantId: stage.participantId,
      transportId: stage.transportId, available: true, observedAt: now, expiresAt: now + 60000,
      description: { schema: 'reploid.partition-capability/v2', participantId: stage.participantId, phase: 'ready',
        capacity: { active: 0, availableSlots: 2, closed: false }, models: [full && stage.index === 0 ? fullModel() : {
          ...model, index: stage.index, planId: f.route.planId, residentId: stage.residentId,
          executionId: stage.executionId, activation: f.route.activation, availability: 'ready' }] } }));
  }
  discovery.capabilities = capabilities();
  cleanups.push(() => mesh.close(), () => f.runner.close());
  return { ...f, identity, model, policy, ordered, mesh, loadProgram, networks, discovery, entry, capabilities, fullModel, createNetwork };
}

describe('explicit ordered automatic participation (injected discovery and numerical ports)', () => {
  it('loads only declared stage geometry, selects a full route and advertises only a complete chat entry', async () => {
    const f = await fixture();
    expect(f.mesh.getModels()).toEqual([]);
    await f.mesh.contribute('model', true);
    expect(f.loadProgram.mock.calls[0][1]).toBe(0);
    expect(f.loadProgram.mock.calls[0][2].ordered.stage).toEqual(f.ordered.stage);
    const advertised = f.discovery.options.describe();
    expect(advertised.models[0].partition.route).toEqual(f.route);
    expect(f.mesh.getState().placement).toEqual(f.route.stages.map(row => row.participantId));
    expect(f.networks[1].connect.mock.calls.map(call => call[1].route)).toEqual([f.route, f.route]);
    await f.mesh.stop(); expect(f.stages[0].close).toHaveBeenCalledOnce();
    expect(f.stages[1].close).not.toHaveBeenCalled(); expect(f.stages[2].close).not.toHaveBeenCalled();
  });
  it('validates incoming routes against actual local stage and authenticated coordinator', async () => {
    const f = await fixture(1); await f.mesh.contribute('model', true);
    const verify = f.networks[1].options.ordered.validateRoute;
    const context = { incoming: true, remoteParticipantId: f.route.stages[0].participantId, remoteTransportId: f.route.stages[0].transportId };
    expect(await verify(f.route, context)).toBe(true);
    const changed = structuredClone(f.route); changed.stages[1].residentId = 'replacement';
    expect(await verify(changed, context)).toBe(false);
    expect(await verify(f.route, { ...context, remoteTransportId: 'other-channel' })).toBe(false);
    expect(f.discovery.options.describe().models[0].partition).toBeUndefined();
  });
  it('retains a healthy prepared route through discovery loss without reloading or retiring it', async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture(); await f.mesh.contribute('model', true);
      f.discovery.capabilities = [];
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.mesh.getState().placementDecision.reason).toBe('retain-prepared-route');
      expect(f.mesh.getState().placement).toEqual(f.route.stages.map(row => row.participantId));
      expect(f.networks[1].retire).not.toHaveBeenCalled(); expect(f.loadProgram).toHaveBeenCalledOnce();
      await f.mesh.close();
    } finally { vi.useRealTimers(); }
  });
  it('uses its own prepared stage-zero entry without an RTC-to-self request', async () => {
    const f = await fixture(); await f.mesh.contribute('model', true);
    const model = f.mesh.getModels()[0], approval = vi.fn(async () => true), deltas = [];
    expect(model.partition.route).toEqual(f.route);
    const result = await f.mesh.generate({ model, messages: [{role:'user',content:'hello'}], threadId:'local', attemptId:'local' },
      { requestApproval: approval, onDelta: event => deltas.push(event.text) });
    expect(result.content).toBe('012'); expect(deltas.join('')).toBe('012');
    expect(f.networks[0].connect).not.toHaveBeenCalled(); expect(approval).toHaveBeenCalledOnce();
    expect(f.stages[0].tokenize).toHaveBeenCalledOnce();
  });
  it('invalidates a failed remote entry observation without dispatching reviewed input', async () => {
    const f = await fixture(null); f.discovery.capabilities = f.capabilities(true);
    f.entry.refresh.mockRejectedValueOnce(Error('connection unavailable'));
    await expect(f.mesh.generate({ model:f.fullModel(), messages:[{role:'user',content:'hello'}],threadId:'x',attemptId:'x' },
      {requestApproval:async()=>true})).rejects.toThrow('unavailable');
    expect(f.discovery.invalidateModel).toHaveBeenCalledOnce(); expect(f.entry.generate).not.toHaveBeenCalled();
  });
  it('keeps failed resident cleanup owned and coalesces stop before replacement', async () => {
    const f = await fixture(1); await f.mesh.contribute('model', true);
    f.stages[1].close.mockRejectedValueOnce(Error('GPU ownership unknown'));
    const first = f.mesh.stop(), second = f.mesh.stop(); expect(second).toBe(first);
    await expect(first).rejects.toThrow('unknown');
    expect(f.mesh.getState()).toMatchObject({ phase: 'failed', unsettledOwners: 1 });
    await expect(f.mesh.contribute('model', true)).rejects.toThrow('settle');
    await f.mesh.stop(); expect(f.stages[1].close).toHaveBeenCalledTimes(2);
    expect(f.mesh.getState()).toMatchObject({ phase: 'idle', unsettledOwners: 0 });
  });
  it('retains a synchronous loader cleanup owner until explicit successful stop', async () => {
    const f = await fixture(1), owner = { close: vi.fn(async () => {}) };
    f.loadProgram.mockImplementation((_model, _index, controls) => { controls.registerCleanup(owner); throw Error('loader rejected'); });
    await f.mesh.contribute('model', true); expect(f.mesh.getState()).toMatchObject({ phase: 'failed', unsettledOwners: 1 });
    await f.mesh.stop(); expect(owner.close).toHaveBeenCalledOnce();
  });
  it('keeps a preparing stage out of capacity and stops only after its outstanding compilation settles', async () => {
    const f = await fixture(1), compiled = Promise.withResolvers();
    const preparing = { phase: 'pipelines', status: 'preparing', prepared: 3, total: 22, key: 'attention_paired.wgsl#main',
      elapsedMs: 5, startedAt: 1, maxDurationMs: 1200000, outstanding: true, complete: true };
    f.loadProgram.mockImplementation(async (_model, _index, controls) => {
      controls.onProgress(residentPreparationProgress(preparing));
      controls.signal.addEventListener('abort', () => controls.onProgress(residentPreparationProgress({ ...preparing, status: 'cancelling' })), { once: true });
      await compiled.promise; // A started provider compilation cannot be interrupted.
      controls.onProgress(residentPreparationProgress({ ...preparing, status: 'cancelled', outstanding: false }));
      throw controls.signal.reason;
    });
    const loading = f.mesh.contribute('model', true);
    await vi.waitFor(() => expect(f.mesh.getState().progress?.status).toBe('preparing'));
    expect(f.mesh.getState()).toMatchObject({ phase: 'loading', descriptor: null,
      progress: { stage: 'preparing', prepared: 3, total: 22, key: preparing.key, outstanding: true } });
    expect(f.discovery.options.describe()).toMatchObject({ phase: 'loading', models: [], capacity: { availableSlots: 0, closed: true } });
    let stopped = false;
    const stopping = f.mesh.stop().then(() => { stopped = true; });
    await vi.waitFor(() => expect(f.mesh.getState().progress).toMatchObject({ status: 'cancelling', outstanding: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    expect(f.mesh.getState().phase).toBe('stopping');
    expect(f.discovery.options.describe()).toMatchObject({ models: [], capacity: { availableSlots: 0, closed: true } });
    compiled.resolve(); await stopping; await loading;
    expect(f.mesh.getState()).toMatchObject({ phase: 'idle', unsettledOwners: 0, progress: null });
  });
  it('does not let a stopped late preparation close a new session', async () => {
    const f = await fixture(1), gate = Promise.withResolvers(), original = f.loadProgram.getMockImplementation();
    f.loadProgram.mockImplementation(async (...args) => { await gate.promise; return original(...args); });
    const loading = f.mesh.contribute('model', true);
    await vi.waitFor(() => expect(f.loadProgram).toHaveBeenCalledOnce());
    const stopping = f.mesh.stop(); await expect(f.mesh.contribute('model', true)).rejects.toThrow('settle');
    gate.resolve(); await loading; await stopping;
    expect(f.stages[1].close).toHaveBeenCalledOnce();
    await f.mesh.contribute('model', true); expect(f.stages[1].close).toHaveBeenCalledOnce();
  });
  it('approves exact recipients and snapshots input for a weightless requester', async () => {
    const f = await fixture(null); f.discovery.capabilities = f.capabilities(true);
    const messages = [{ role: 'user', content: 'original' }], approval = vi.fn(async () => { messages[0].content = 'mutated'; return true; }), deltas = [];
    const result = await f.mesh.generate({ model: f.fullModel(), messages, threadId: 'thread', attemptId: 'attempt' },
      { signal: new AbortController().signal, requestApproval: approval, onDelta: event => deltas.push(event) });
    expect(result.content).toBe('ok'); expect(f.loadProgram).not.toHaveBeenCalled();
    expect(approval.mock.calls[0][0].input.messages).toEqual([{ role: 'user', content: 'original' }]);
    expect(approval.mock.calls[0][0].input.recipients).toEqual([...f.route.stages.map(row => row.participantId), f.identity.peerId]);
    expect(f.entry.generate.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'original' }]);
    expect(f.entry.generate.mock.calls[0][0]).toMatchObject({ schema: 'reploid.partition-input/v3', route: f.route, disclosureExpiresAt: approval.mock.calls[0][0].expiresAt });
    expect(deltas[0]).toMatchObject({ threadId: 'thread', attemptId: 'attempt', text: 'ok' });
  });
  it('starts the admitted execution deadline after first-use permission, retaining a bounded window', async () => {
    const f = await fixture(null); f.discovery.capabilities = f.capabilities(true);
    const clock = vi.spyOn(Date, 'now'), start = Date.now();
    clock.mockReturnValue(start);
    let preview, deadline;
    try {
      await f.mesh.generate({ model: f.fullModel(), messages: [{role:'user',content:'Hello'}], threadId:'thread', attemptId:'attempt' }, {
        requestApproval: async value => { preview = value; clock.mockReturnValue(start + 1000); deadline = Date.now() + value.executionTimeoutMs; return true; },
        authorizationExpiresAt: () => deadline
      });
      const sent = f.entry.generate.mock.calls[0][0];
      expect(sent.disclosureExpiresAt).toBe(preview.expiresAt + 1000);
      expect(sent.disclosureExpiresAt - Date.now()).toBe(preview.executionTimeoutMs);
    } finally { clock.mockRestore(); await f.mesh.close(); }
  });

  it('rejects route replacement after approval rather than disclosing to new recipients', async () => {
    const f = await fixture(null); f.discovery.capabilities = f.capabilities(true);
    const changed = f.fullModel(); changed.partition.route.stages[1].residentId = 'other';
    f.entry.refresh.mockResolvedValueOnce({ ready: true, descriptor: { models: [f.fullModel()] } })
      .mockResolvedValueOnce({ ready: true, descriptor: { models: [changed] } });
    await expect(f.mesh.generate({ model: f.fullModel(), messages: [{ role: 'user', content: 'secret' }], threadId: 't', attemptId: 'a' },
      { requestApproval: async () => true })).rejects.toThrow('route changed');
    expect(f.entry.generate).not.toHaveBeenCalled();
  });
  it('never moves a permitted request to a changed route; a retry records the route it is sent to', async () => {
    const f = await fixture(null);
    f.route.stages.forEach((stage, index) => { stage.participantId = 'peer:' + String(index).repeat(24); });
    f.discovery.capabilities = f.capabilities(true);
    const planned = f.fullModel(), replaced = f.fullModel(), ids = model => model.partition.route.stages.map(stage => stage.participantId);
    replaced.partition.route.stages[2].participantId = 'peer:' + '9'.repeat(24);
    // The entry reports the planned route when the request is prepared and a replacement before dispatch.
    f.entry.refresh.mockResolvedValueOnce({ ready: true, descriptor: { models: [planned] } })
      .mockResolvedValueOnce({ ready: true, descriptor: { models: [replaced] } })
      .mockResolvedValue({ ready: true, descriptor: { models: [replaced] } });
    const need = remotePermissionNeed({ networkId: 'mesh', sharingScope: 'mesh', disclosure: 'ordered-partition-activations-and-tokens', model: planned });
    const permission = createRemotePermission({ id: 'remote', grantedAt: 1, need, wording: remotePermissionWording(need) });
    let saved;
    const app = createChatWorkspace({ meshId: 'mesh', participantId: f.identity.peerId, remotePermissions: () => [permission],
      store: { load: () => structuredClone(saved), save: value => { saved = structuredClone(value); } },
      execute: (request, controls) => f.mesh.generate(request, controls) });
    cleanups.push(() => app.close());
    const thread = app.createThread({ model: planned, permissions: { sharingScope: 'mesh' } });
    const attempt = await app.send(thread, 'secret');
    expect(attempt.status).toBe('failed'); expect(attempt.error).toContain('route changed');
    expect(attempt.authorization).toMatchObject({ kind: 'permission', permissionId: 'remote', recipients: ids(planned) });
    expect(f.entry.generate).not.toHaveBeenCalled();
    // An explicit Retry is a new attempt; the same permission covers it and its record names the new route.
    const retried = await app.retry(thread, attempt.id);
    expect(retried).toMatchObject({ status: 'completed', retryOf: attempt.id, authorization: { permissionId: 'remote', recipients: ids(replaced) } });
    expect(f.entry.generate).toHaveBeenCalledOnce();
    expect(f.entry.generate.mock.calls[0][0].route.stages.map(stage => stage.participantId)).toEqual(ids(replaced));
  });
  it('cancels a queued conversation while the first continues on its retained route', async () => {
    const f = await fixture(), entered = Promise.withResolvers(), release = Promise.withResolvers();
    await f.mesh.contribute('model', true);
    const execute = f.stages[0].executeStage.getMockImplementation();
    f.stages[0].executeStage.mockImplementation(async request => {
      if (request.identity.attemptId === 'first' && request.step === 0) { entered.resolve(); await release.promise; }
      return execute(request);
    });
    const request = id => ({ model:f.mesh.getModels()[0],messages:[{role:'user',content:id}],threadId:id,attemptId:id });
    const controls = { requestApproval:async()=>true }, first = f.mesh.generate(request('first'), controls);
    await entered.promise;
    const controller = new AbortController(), cancelled = f.mesh.generate(request('queued'), {...controls,signal:controller.signal});
    const failure = expect(cancelled).rejects.toThrow();
    await vi.waitFor(() => expect(f.mesh.getState().attempts.some(row=>row.identity.attemptId==='queued')).toBe(true));
    controller.abort(Error('cancel queued only')); release.resolve(); await failure;
    expect(f.stages[0].executeStage.mock.calls.some(([row])=>row.identity.attemptId==='queued')).toBe(false);
    release.resolve(); expect((await first).content).toBe('012');
    expect(f.stages[0].close).not.toHaveBeenCalled();
    expect(f.mesh.getState().attempts.every(row=>row.cleanup.every(clean=>clean.status==='settled'))).toBe(true);
  });
  it('does not retire shared weights while chat cleanup is unknown; explicit stop retries', async () => {
    const f = await fixture(); await f.mesh.contribute('model',true);
    f.stages[0].closeAttempt.mockRejectedValue(Error('private state unknown'));
    await expect(f.mesh.generate({model:f.mesh.getModels()[0],messages:[{role:'user',content:'hello'}],threadId:'a',attemptId:'a'},
      {requestApproval:async()=>true})).rejects.toThrow('cleanup');
    await expect(f.mesh.stop()).rejects.toThrow('settlement');
    expect(f.stages[0].close).not.toHaveBeenCalled();
    expect(f.mesh.getState().unsettledOwners).toBeGreaterThan(0);
    f.stages[0].closeAttempt.mockResolvedValue();
    await f.mesh.stop(); expect(f.stages[0].close).toHaveBeenCalledOnce();
  });
  it('reports a lost stage as CONNECTION_LOST, keeps its receipt unknown and forms a fresh route on restored capacity', async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture(); await f.mesh.contribute('model', true);
      const reserve = f.stages[1].reserve.getMockImplementation(), execute = f.stages[1].executeStage.getMockImplementation();
      const lost = () => Object.assign(Error('contributor disconnected'), { code: 'CONNECTION_LOST' });
      f.stages[1].executeStage.mockRejectedValueOnce(lost()); f.stages[1].closeAttempt.mockRejectedValue(lost());
      const request = id => ({ model: f.mesh.getModels()[0], messages: [{ role: 'user', content: id }], threadId: id, attemptId: id });
      await expect(f.mesh.generate(request('lost'), { requestApproval: async () => true })).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
      // The killed process is gone; the restarted one joins with a fresh transport session.
      const ready = f.stages[1].getState();
      f.stages[1].getState = () => ({ ...ready, ready: false });
      const restored = { id: 'node-1', index: 1, transportId: 'transport-1b', residentId: 'resident-1', executionId: 'execution-1',
        reserve: vi.fn(reserve), executeStage: vi.fn(execute), closeAttempt: vi.fn(async () => {}), close: vi.fn(async () => {}),
        refresh: vi.fn(async () => ({ ready: true })), subscribe: () => () => {}, getState: () => ready };
      const connect = f.networks[1].connect.getMockImplementation();
      f.networks[1].connect.mockImplementation(async (transportId, options) => transportId === 'transport-1b' ? restored : connect(transportId, options));
      f.route.stages[1].transportId = 'transport-1b';
      f.discovery.refresh.mockImplementation(async () => { f.discovery.capabilities = f.capabilities(); });
      await vi.advanceTimersByTimeAsync(60000);
      const state = f.mesh.getState();
      expect(state).toMatchObject({ phase: 'ready', error: null, unsettledOwners: 0 });
      expect(state.unknownAttempts.map(row => [row.identity.attemptId, row.phase, row.cleanup[1].code])).toEqual([['lost', 'cleanup-failed', 'CONNECTION_LOST']]);
      expect(f.mesh.getModels()[0].partition.route.stages[1].transportId).toBe('transport-1b');
      expect((await f.mesh.generate(request('retry'), { requestApproval: async () => true })).content).toBe('012');
      expect(f.stages[1].closeAttempt).toHaveBeenCalledOnce();
      await f.mesh.stop(); expect(f.mesh.getState()).toMatchObject({ phase: 'idle', unsettledOwners: 0 });
    } finally { vi.useRealTimers(); }
  });
  it('retains registered cleanup for malformed loader returns and retries failed disposal', async () => {
    const f = await fixture(1), owner = { close: vi.fn().mockRejectedValueOnce(Error('cleanup unknown')).mockResolvedValue() };
    f.loadProgram.mockImplementation(async (_model,_index,controls) => { controls.registerCleanup(owner); return {}; });
    await f.mesh.contribute('model',true);
    expect(f.mesh.getState()).toMatchObject({phase:'failed',unsettledOwners:1,descriptor:null});
    await expect(f.mesh.stop()).rejects.toThrow('cleanup unknown');
    await f.mesh.stop(); expect(owner.close).toHaveBeenCalledTimes(2);
    expect(f.mesh.getState()).toMatchObject({phase:'idle',unsettledOwners:0});
  });
  it('attempts every potentially opened edge when partial route rollback fails', async () => {
    const f = await fixture();
    f.createNetwork.connectFailure = f.route.stages[2].transportId;
    f.createNetwork.retireFailure = f.route.stages[1].transportId;
    await f.mesh.contribute('model',true);
    expect(f.networks[1].retire.mock.calls.map(row=>row[0])).toEqual(f.route.stages.slice(1).map(row=>row.transportId));
    expect(f.mesh.getState()).toMatchObject({unsettledOwners:1,error:'Ordered route opening and settlement failed'});
    f.createNetwork.retireFailure = null; await f.mesh.stop();
  });
  it('closes independent discovery and input owners despite resident cleanup failure', async () => {
    const f = await fixture(1); await f.mesh.contribute('model',true);
    f.stages[1].close.mockRejectedValueOnce(Error('resident unknown'));
    f.networks[0].close.mockRejectedValueOnce(Error('input cleanup unknown'));
    await expect(f.mesh.close()).rejects.toThrow('unsettled');
    expect(f.discovery.close).toHaveBeenCalledOnce(); expect(f.networks[0].close).toHaveBeenCalledOnce();
    expect(f.mesh.getState().unsettledOwners).toBe(2);
    await f.mesh.close();
    expect(f.stages[1].close).toHaveBeenCalledTimes(2); expect(f.networks[0].close).toHaveBeenCalledTimes(2);
    expect(f.discovery.close).toHaveBeenCalledOnce(); expect(f.mesh.getState().unsettledOwners).toBe(0);
  });
  it('retains an execution network debt and weights until retry settles the same owner', async () => {
    const f = await fixture(); await f.mesh.contribute('model',true);
    f.networks[1].close.mockRejectedValueOnce(Error('remote owners unknown'));
    await expect(f.mesh.stop()).rejects.toThrow('unknown');
    expect(f.mesh.getState()).toMatchObject({phase:'failed',unsettledOwners:1});
    expect(f.stages[0].close).not.toHaveBeenCalled();
    await expect(f.mesh.contribute('model',true)).rejects.toThrow('settle');
    await f.mesh.stop();
    expect(f.networks[1].close).toHaveBeenCalledTimes(2);expect(f.stages[0].close).toHaveBeenCalledOnce();
    expect(f.mesh.getState()).toMatchObject({phase:'idle',unsettledOwners:0});
  });
  it('retains a returned owner whose state observation throws without corrupting mesh state', async () => {
    const f = await fixture(1), original = f.loadProgram.getMockImplementation();
    f.stages[1].getState = () => { throw Error('descriptor observation failed'); };
    f.loadProgram.mockImplementation(async (...args) => { args[2].registerCleanup(f.stages[1]);return original(...args); });
    await f.mesh.contribute('model',true);
    expect(f.mesh.getState()).toMatchObject({phase:'failed',unsettledOwners:1,descriptor:null,error:'descriptor observation failed'});
    await f.mesh.stop();expect(f.stages[1].close).toHaveBeenCalledOnce();
  });
  it('rejects ambiguous canonical/ordered modes without opening resources', async () => {
    expect(() => createAutomaticPartitions({ ordered: {}, canonical: {} })).toThrow('distinct');
  });
});

describe('ordered automatic requester with the requester-owned transactional writer', () => {
  const writerEpoch = '7'.repeat(32);
  const metadataDigest = (schema, body) => 'sha256:' + createHash('sha256').update(schema + '\0' + canonicalPartitionJson(body)).digest('hex');
  async function writer() {
    let durable = null, tail = Promise.resolve();
    const store = { schema: 'reploid.transactional-chat-store/v1', records: () => durable?.records ?? [],
      async read() { await tail; return structuredClone(durable); },
      transact(_key, reducer) {
        const task = tail.then(() => { const next = reducer(structuredClone(durable)); durable = structuredClone(next.state); return structuredClone(next.result); });
        tail = task.catch(() => {}); return task;
      } };
    const owner = createConversationPublication({ conversationId: 'local', writerEpoch, store, doppler: { metadataDigest },
      authenticateCommit: async () => false, authorize: () => true, requireCommitEvidence: true });
    await owner.claimWriter(null);
    return { owner, store };
  }
  it('publishes a local stage-zero route through the same requester scope before any text is delivered', async () => {
    const f = await fixture(); f.runtime.metadataDigest = metadataDigest; await f.mesh.contribute('model', true);
    const w = await writer(), projected = [], deltas = [];
    const result = await f.mesh.generate({ model: f.mesh.getModels()[0], messages: [{ role: 'user', content: 'hello' }], threadId: 'local', attemptId: 'local' },
      { requestApproval: async () => true, publication: w.owner, publisherEpoch: writerEpoch,
        onPublished: async record => { projected.push(record.publication.delta.text); }, onDelta: event => deltas.push(event.text) });
    // Under the requester's declared persistence window steps commit in batches, each projected once
    // from its last durable record; the terminal step is always committed before the result returns.
    expect(result.content).toBe('012'); expect(deltas).toEqual([]); expect(projected.at(-1)).toBe('2');
    expect(projected.length).toBeLessThanOrEqual(3);
    expect(w.store.records().map(row => row.publication.sequence)).toEqual([0, 1, 2]);
    expect((await w.owner.reconcile()).attempts[0]).toMatchObject({ status: 'completed',
      identity: { schema: 'reploid.ordered-publication-attempt/v1', requesterId: f.identity.peerId, route: f.route } });
    expect(f.networks[0].connect).not.toHaveBeenCalled();
  });
  it('carries the requester context and owner to a remote entry, and refuses publication without its projection port', async () => {
    const f = await fixture(null); f.discovery.capabilities = f.capabilities(true);
    const w = await writer(), onPublished = vi.fn(), approval = vi.fn(async () => true);
    const request = { model: f.fullModel(), messages: [{ role: 'user', content: 'hello' }], threadId: 'local', attemptId: 'remote' };
    await expect(f.mesh.generate(request, { requestApproval: approval, publication: w.owner, publisherEpoch: writerEpoch }))
      .rejects.toThrow('requester-owned writer');
    expect(approval).not.toHaveBeenCalled();
    await f.mesh.generate(request, { signal: new AbortController().signal, requestApproval: approval,
      publication: w.owner, publisherEpoch: writerEpoch, onPublished });
    const [input, controls] = f.entry.generate.mock.calls[0];
    expect(input.publication).toEqual({ schema: 'reploid.ordered-publication-context/v1', publisherEpoch: writerEpoch,
      deadlineAt: approval.mock.calls[0][0].expiresAt });
    expect(controls.publication).toBe(w.owner); expect(controls.onPublished).toBe(onPublished);
  });
});
