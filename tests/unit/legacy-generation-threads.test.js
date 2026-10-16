import { it, expect, vi } from 'vitest';
import { createLegacyGenerationMesh } from '../../packages/reploid/src/mesh/legacy-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

function fixture(meshOverrides = {}, execution = {}) {
  const handlers = new Map(), listeners = new Map(), sent = [];
  const events = {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    emit(name, value) { for (const fn of listeners.get(name) || []) fn(value); }
  };
  const authorize = vi.fn(async () => true);
  const mesh = createLegacyGenerationMesh({ config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test', ...meshOverrides } } }), ports: {
    instanceId: 'test', modelConfig: execution.modelConfig || null, authorize,
    getExecutionState: execution.getExecutionState, generate: execution.generate || (async () => {}),
    utils: { generateId: () => crypto.randomUUID() }, events, eventBus: events,
    identity: { ensure: async () => ({ peerId: 'requester' }), sync: async () => {}, save: async () => {} },
    createTransport: () => ({ init: async () => true, disconnect() {}, broadcast() {},
      onMessage(name, fn) { handlers.set(name, fn); },
      sendToPeer(peer, name, payload) { sent.push({ peer, name, payload }); return true; } })
  } });
  const advertise = (id, model, overrides = {}) => handlers.get('reploid:peer-advertisement')(id,
    { hasInference: true, swarmEnabled: true, readiness: 'ready', availableSlots: 1, model, updatedAt: Date.now(), ...overrides });
  const respond = (request, model = request.payload.model) => handlers.get('reploid:generation-result')(request.peer,
    { requestId: request.payload.requestId, response: { model, content: 'response' } });
  return { mesh, sent, advertise, respond, authorize, events, handlers,
    update: (request, chunk) => handlers.get('reploid:generation-update')(request.peer, { requestId: request.payload.requestId, chunk }) };
}

it('reserves separate compatible peers during concurrent approval and binds host context without putting it on the wire', async () => {
  const f = fixture(); await f.mesh.connect();
  f.advertise('wrong-model', 'other'); f.advertise('east', 'qwen'); f.advertise('west', 'qwen');
  const a = f.mesh.generate([], null, { modelId: 'qwen', requestContext: { id: 'a' } });
  const b = f.mesh.generate([], null, { modelId: 'qwen', requestContext: { id: 'b' } });
  await vi.waitFor(() => expect(f.sent).toHaveLength(2));
  expect(new Set(f.sent.map(item => item.peer))).toEqual(new Set(['east', 'west']));
  expect(f.sent.every(item => !('requestContext' in item.payload))).toBe(true);
  expect(f.authorize.mock.calls.filter(([value]) => value.action === 'mesh.dispatch').map(([value]) => value.requestContext.id)).toEqual(['a', 'b']);
  await f.respond(f.sent[0]); await f.respond(f.sent[1]);
  await Promise.all([a, b]); await f.mesh.close();
});

it('queues a second thread on a busy peer and rejects model substitution', async () => {
  const f = fixture(); await f.mesh.connect(); f.advertise('east', 'qwen');
  const a = f.mesh.generate([], null, { modelId: 'qwen' });
  const b = f.mesh.generate([], null, { modelId: 'qwen' });
  const rejected = expect(b).rejects.toThrow('substituted');
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  await f.respond(f.sent[0]); await a;
  await vi.waitFor(() => expect(f.sent).toHaveLength(2));
  await f.respond(f.sent[1], 'other'); await rejected; await f.mesh.close();
});

it('places adapted requests only on compatible peers and binds the selection to approval and completion', async () => {
  const f = fixture(), adapter = 'sha256:' + 'b'.repeat(64); await f.mesh.connect();
  f.advertise('base-only', 'qwen'); f.advertise('adapted', 'qwen', { adapterIdentities: [adapter] });
  const request = f.mesh.generate([], null, { modelId: 'qwen', adapterIdentities: [adapter] });
  const failed = expect(request).rejects.toThrow('substituted the requested adapter');
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(f.sent[0]).toMatchObject({ peer: 'adapted', payload: { adapterIdentities: [adapter] } });
  expect(f.authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'mesh.dispatch', adapterIdentities: [adapter] }));
  await f.respond(f.sent[0]); await failed; await f.mesh.close();
});

it('does not disclose if an adapter is withdrawn while approval is pending', async () => {
  const f = fixture(), adapter = 'sha256:' + 'b'.repeat(64); await f.mesh.connect();
  f.advertise('east', 'qwen', { adapterIdentities: [adapter] });
  let approve;
  f.authorize.mockImplementation(request => request.action === 'mesh.dispatch'
    ? new Promise(resolve => { approve = resolve; }) : true);
  const request = f.mesh.generate([], null, { modelId: 'qwen', adapterIdentities: [adapter] });
  const failed = expect(request).rejects.toThrow('no longer ready');
  await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
  f.advertise('east', 'qwen', { adapterIdentities: [] }); approve(true);
  await failed; expect(f.sent).toHaveLength(0); await f.mesh.close();
});

it('cancels a waiter without dispatch and cancels only the matching remote request', async () => {
  const f = fixture(); await f.mesh.connect(); f.advertise('east', 'qwen');
  const a = new AbortController(), b = new AbortController();
  const first = f.mesh.generate([], null, { modelId: 'qwen', signal: a.signal });
  const second = f.mesh.generate([], null, { modelId: 'qwen', signal: b.signal });
  const stoppedFirst = expect(first).rejects.toThrow('Stop first');
  const stoppedSecond = expect(second).rejects.toThrow('Stop second');
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  b.abort(new Error('Stop second')); await stoppedSecond;
  expect(f.sent).toHaveLength(1);
  a.abort(new Error('Stop first')); await stoppedFirst;
  expect(f.sent[1]).toMatchObject({ peer: 'east', name: 'reploid:generation-cancel', payload: { requestId: f.sent[0].payload.requestId } });
  await f.mesh.close();
});

it('expires a request with a matching remote cancellation and ignores a late result', async () => {
  vi.useFakeTimers();
  const f = fixture({ generationTimeoutMs: 1000 });
  try {
    await f.mesh.connect(); f.advertise('east', 'qwen');
    const request = f.mesh.generate([], null, { modelId: 'qwen' });
    const failed = expect(request).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    expect(f.sent[1]).toEqual({ peer: 'east', name: 'reploid:generation-cancel',
      payload: { requestId: f.sent[0].payload.requestId } });
    await f.respond(f.sent[0]);
    expect(f.sent).toHaveLength(2);
  } finally { await f.mesh.close(); vi.useRealTimers(); }
});

it('retires disconnected and departed advertisements from counts and placement', async () => {
  const f = fixture(); await f.mesh.connect();
  try {
    f.advertise('east', 'qwen'); f.advertise('west', 'qwen');
    f.events.emit('swarm:peer-disconnected', { peerId: 'east' });
    expect(f.mesh.getSwarmSnapshot().peers.map(p => p.peerId)).toEqual(['west']);
    f.events.emit('swarm:peer-left', { peerId: 'west' });
    expect(f.mesh.getSwarmSnapshot().peerCount).toBe(0);
    expect(f.mesh.hasAvailableProvider('qwen')).toBe(false);
  } finally { await f.mesh.close(); }
});

it('never places on loading or unidentified advertisements and waits for the exact ready model', async () => {
  const f = fixture(); await f.mesh.connect();
  const identity = 'sha256:' + 'a'.repeat(64);
  f.advertise('loading', 'qwen', { readiness: 'loading', availableSlots: 0, hasInference: false });
  f.advertise('wrong-artifact', 'qwen', { modelIdentity: 'sha256:' + 'b'.repeat(64) });
  const request = f.mesh.generate([], null, { modelId: 'qwen', modelIdentity: identity });
  await new Promise(resolve => setTimeout(resolve, 10)); expect(f.sent).toHaveLength(0);
  f.advertise('ready', 'qwen', { modelIdentity: identity });
  await vi.waitFor(() => expect(f.sent).toHaveLength(1)); expect(f.sent[0].peer).toBe('ready');
  const failed = expect(request).rejects.toThrow('substituted');
  await f.respond(f.sent[0]); await failed; await f.mesh.close();
});

it('settles a lost execution peer without redispatching the prompt', async () => {
  const f = fixture(); await f.mesh.connect(); f.advertise('east', 'qwen');
  const request = f.mesh.generate([], null, { modelId: 'qwen' });
  const failed = expect(request).rejects.toThrow('peer disconnected');
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  f.events.emit('swarm:peer-disconnected', { peerId: 'east' });
  await failed; await f.respond(f.sent[0]); expect(f.sent).toHaveLength(1); await f.mesh.close();
});

it('rechecks provider readiness after approval without disclosing to a replacement', async () => {
  const f = fixture(); await f.mesh.connect(); f.advertise('east', 'qwen');
  let approve;
  f.authorize.mockImplementation(request => request.action === 'mesh.dispatch'
    ? new Promise(resolve => { approve = resolve; }) : true);
  const request = f.mesh.generate([], null, { modelId: 'qwen' });
  const failed = expect(request).rejects.toThrow('no longer ready');
  await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
  f.advertise('east', 'qwen', { readiness: 'loading', hasInference: false, availableSlots: 0 });
  f.advertise('west', 'qwen'); approve(true);
  await failed; expect(f.sent).toHaveLength(0); await f.mesh.close();
});


it('cancels and settles when a stream consumer throws, without retaining a dead request', async () => {
  const f = fixture(); await f.mesh.connect(); f.advertise('east', 'qwen');
  const request = f.mesh.generate([], () => { throw new Error('consumer failed'); }, { modelId: 'qwen' });
  const failed = expect(request).rejects.toThrow('consumer failed');
  await vi.waitFor(() => expect(f.sent).toHaveLength(1)); f.update(f.sent[0], 'chunk'); await failed;
  expect(f.sent[1].name).toBe('reploid:generation-cancel');
  f.update(f.sent[0], 'late'); await f.respond(f.sent[0]); expect(f.sent).toHaveLength(2); await f.mesh.close();
});

it('retains bounded preparation telemetry and executing state without publishing raw loader details', async () => {
  const f = fixture(); await f.mesh.connect();
  f.advertise('loading', 'qwen', { hasInference: false, readiness: 'loading', preparation: {
    kind: 'downloading', receivedBytes: 30, totalBytes: 100, message: 'private loader path', path: '/private/model'
  } });
  expect(f.mesh.getSwarmSnapshot().peers.find(peer => peer.peerId === 'loading').preparation)
    .toEqual({ kind: 'downloading', receivedBytes: 30, totalBytes: 100 });
  f.advertise('loading', 'qwen', { hasInference: false, readiness: 'executing', availableSlots: 0, preparation: { kind: 'downloading' } });
  expect(f.mesh.getSwarmSnapshot().peers.find(peer => peer.peerId === 'loading')).toMatchObject({ readiness: 'executing', preparation: null });
  await f.mesh.close();
});

const artifactA = 'sha256:' + 'a'.repeat(64);
const artifactB = 'sha256:' + 'b'.repeat(64);

it('pins the selected model and advertised artifact even when the caller leaves selection automatic', async () => {
  const f = fixture(); await f.mesh.connect();
  try {
    f.advertise('east', 'qwen', { modelIdentity: artifactA });
    const request = f.mesh.generate([], null);
    const failed = expect(request).rejects.toThrow('substituted');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    expect(f.sent[0].payload).toMatchObject({ model: 'qwen', modelIdentity: artifactA });
    expect(f.authorize).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mesh.dispatch', modelId: 'qwen', modelIdentity: artifactA
    }));
    await f.handlers.get('reploid:generation-result')('east', {
      requestId: f.sent[0].payload.requestId,
      response: { model: 'qwen', modelIdentity: artifactB, content: 'wrong artifact' }
    });
    await failed;
  } finally { await f.mesh.close(); }
});

it('rejects a different model in automatic selection instead of accepting any returned model', async () => {
  const f = fixture(); await f.mesh.connect();
  try {
    f.advertise('east', 'qwen');
    const request = f.mesh.generate([], null);
    const failed = expect(request).rejects.toThrow('substituted');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    await f.respond(f.sent[0], 'other'); await failed;
  } finally { await f.mesh.close(); }
});

it.each(['artifact', 'adapter'])('rechecks provider %s after asynchronous execution authorization', async changed => {
  const state = { phase: 'ready', modelIdentity: artifactA, adapterIdentities: [artifactB] };
  const generate = vi.fn();
  const f = fixture({ executeJobs: true }, { modelConfig: { id: 'qwen' }, getExecutionState: () => state, generate });
  await f.mesh.connect();
  try {
    const authorization = Promise.withResolvers(), began = Promise.withResolvers();
    f.authorize.mockImplementation(request => {
      if (request.action !== 'mesh.execute') return true;
      began.resolve(); return authorization.promise;
    });
    const request = f.handlers.get('reploid:generation-request')('consumer', {
      requestId: 'one', model: 'qwen', modelIdentity: artifactA,
      adapterIdentities: [artifactB], messages: [{ role: 'user', content: 'hello' }]
    });
    await began.promise;
    if (changed === 'artifact') state.modelIdentity = artifactB;
    else state.adapterIdentities = [];
    authorization.resolve(true); await request;
    expect(generate).not.toHaveBeenCalled();
    expect(f.sent).toContainEqual(expect.objectContaining({ name: 'reploid:generation-error',
      payload: expect.objectContaining({ requestId: 'one', error: expect.stringContaining('changed') }) }));
  } finally { await f.mesh.close(); }
});

it('does not stream output after the provider artifact changes during execution', async () => {
  const state = { phase: 'ready', modelIdentity: artifactA };
  const generate = vi.fn(async (_messages, update) => {
    state.modelIdentity = artifactB;
    update('wrong artifact output');
    return { model: 'qwen', modelIdentity: artifactB, content: 'wrong artifact output' };
  });
  const f = fixture({ executeJobs: true }, { modelConfig: { id: 'qwen' }, getExecutionState: () => state, generate });
  await f.mesh.connect();
  try {
    await f.handlers.get('reploid:generation-request')('consumer', {
      requestId: 'one', model: 'qwen', modelIdentity: artifactA,
      messages: [{ role: 'user', content: 'hello' }]
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(f.sent.some(item => item.name === 'reploid:generation-update')).toBe(false);
    expect(f.sent).toContainEqual(expect.objectContaining({ name: 'reploid:generation-error' }));
  } finally { await f.mesh.close(); }
});

it('enforces an explicit artifact on local whole-model requests before invoking the provider', async () => {
  const generate = vi.fn();
  const f = fixture({}, { modelConfig: { id: 'qwen' },
    getExecutionState: () => ({ phase: 'ready', modelIdentity: artifactA }), generate });
  try {
    await expect(f.mesh.generate([], null, { modelId: 'qwen', modelIdentity: artifactB })).rejects.toThrow('unavailable');
    expect(generate).not.toHaveBeenCalled();
  } finally { await f.mesh.close(); }
});

it('accepts the pinned automatic selection and leaves its identity on the result', async () => {
  const f = fixture(); await f.mesh.connect();
  try {
    f.advertise('east', 'qwen', { modelIdentity: artifactA });
    const request = f.mesh.generate([], null);
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    await f.handlers.get('reploid:generation-result')('east', {
      requestId: f.sent[0].payload.requestId,
      response: { model: 'qwen', modelIdentity: artifactA, content: 'answer' }
    });
    await expect(request).resolves.toMatchObject({ model: 'qwen', modelIdentity: artifactA, content: 'answer' });
  } finally { await f.mesh.close(); }
});

it('does not dispatch after the selected artifact changes during requester authorization', async () => {
  const f = fixture(); await f.mesh.connect();
  try {
    f.advertise('east', 'qwen', { modelIdentity: artifactA });
    const authorization = Promise.withResolvers(), began = Promise.withResolvers();
    f.authorize.mockImplementation(request => {
      if (request.action !== 'mesh.dispatch') return true;
      began.resolve(); return authorization.promise;
    });
    const request = f.mesh.generate([], null);
    const failed = expect(request).rejects.toThrow('no longer ready');
    await began.promise;
    f.advertise('east', 'qwen', { modelIdentity: artifactB });
    authorization.resolve(true); await failed;
    expect(f.sent).toHaveLength(0);
  } finally { await f.mesh.close(); }
});

it('preserves the configured model and adapter binding against execution-port mutation', async () => {
  const modelConfig = { id: 'qwen' };
  const generate = vi.fn(async (_messages, _update, controls) => {
    controls.adapterIdentities.push(artifactB);
    return { model: 'qwen', modelIdentity: artifactA, adapterIdentities: [artifactB], content: 'substituted' };
  });
  const f = fixture({}, { modelConfig,
    getExecutionState: () => ({ phase: 'ready', modelIdentity: artifactA }), generate });
  modelConfig.id = 'changed by caller';
  try {
    await expect(f.mesh.generate([], null, { modelId: 'qwen', modelIdentity: artifactA })).rejects.toThrow('adapter execution identity mismatch');
    expect(generate).toHaveBeenCalledTimes(1);
  } finally { await f.mesh.close(); }
});
