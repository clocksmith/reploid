import { createExecutionPolicy, bindExecutionRoute, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';
import { it, expect, vi } from 'vitest';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

import { createSigningIdentity, importSigningKey, getIdentitySignAlgorithm, encodeBytes, toBase64Url } from '../../packages/reploid/src/artifacts/identity.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';

const openPolicy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });

function fixture(meshOverrides = {}, execution = {}) {
  const handlers = new Map(), listeners = new Map(), sent = [], broadcasts = [];
  const events = {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    emit(name, value) { for (const fn of listeners.get(name) || []) fn(value); }
  };
  const authorize = vi.fn(async () => true);
  const identities = new Map();
  const signingIdentity = id => {
    if (!identities.has(id)) identities.set(id, createSigningIdentity({ algorithm: 'Ed25519' }));
    return identities.get(id);
  };
  const connection = peer => ({ local: 'fixture:local', remote: 'fixture:' + peer });
  const readyOffer = identity => ({ schema: 'reploid.execution-offer/v1', id: 'ordinary-generation',
    backend: 'doppler-plaintext/v1', kind: 'plaintext', modelIdentities: [identity],
    operation: 'generate', protocol: null, evidence: null });
  const underlying = createPeerGenerationMesh({ config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test', ...meshOverrides } } }), ports: {
    instanceId: 'test', modelConfig: execution.modelConfig || null, authorize, admitsBeforeDisclosure: true,
    getExecutionState: execution.getExecutionState || (() => ({ phase: execution.modelConfig ? 'ready' : 'idle', modelIdentity: artifactA })), generate: execution.generate || (async () => {}),
    utils: { generateId: () => crypto.randomUUID() }, events, eventBus: events,
    identity: { ensure: () => signingIdentity('fixture-local'), sync: async () => {}, save: async () => {} },
    createTransport: () => ({ init: async () => true, disconnect() {}, broadcast(name, payload) { broadcasts.push({ name, payload }); },
      getPeerId: () => 'fixture-local', getPeerBinding: connection,
      onMessage(name, fn) { handlers.set(name, fn); },
      sendToPeer(peer, name, payload) {
        if (name === 'reploid:identity-challenge') {
          queueMicrotask(async () => {
            const identity = await signingIdentity(peer), key = await importSigningKey(identity);
            const bytes = encodeBytes(JSON.stringify(['reploid.mesh-recipient/v1', payload.roomId, payload.nonce,
              payload.requester, payload.provider, payload.local, payload.remote, identity.peerId]));
            const signature = await crypto.subtle.sign(getIdentitySignAlgorithm(identity.publicJwk), key, bytes);
            handlers.get('reploid:identity-proof')(peer, { nonce: payload.nonce, participantId: identity.peerId,
              publicJwk: identity.publicJwk, signature: toBase64Url(signature) });
          });
        } else if (name === 'reploid:generation-admit') {
          queueMicrotask(() => handlers.get('reploid:generation-admitted')(peer, { requestId: payload.requestId,
            admissionProtocol: 2, promptCommitment: payload.promptCommitment }));
        } else if (name !== 'reploid:generation-admitted') sent.push({ peer, name, payload });
        return true;
      } })
  } });
  const mesh = Object.freeze({ ...underlying, generate(messages, stream, options) {
    return underlying.generate(messages, stream, execution.modelConfig ? options : { privacy: openPolicy, ...options });
  } });
  const advertise = (id, model, overrides = {}) => {
    const modelIdentity = Object.hasOwn(overrides, 'modelIdentity') ? overrides.modelIdentity : artifactA;
    return handlers.get('reploid:peer-advertisement')(id, { hasInference: true, swarmEnabled: true, readiness: 'ready',
      availableSlots: 1, model, modelIdentity, identityProtocol: 1, admissionProtocol: 2,
      executionOffers: modelIdentity ? [readyOffer(modelIdentity)] : [],
      updatedAt: Date.now(), ...overrides });
  };
  const respond = (request, model = request.payload.model) => handlers.get('reploid:generation-result')(request.peer,
    { requestId: request.payload.requestId, response: { model, modelIdentity: request.payload.modelIdentity, content: 'response' } });
  const prepareInbound = async (peer, requestId, metadata = {}) => {
    const provider = (await signingIdentity('fixture-local')).peerId, consumer = (await signingIdentity(peer)).peerId;
    const { model = 'qwen', modelIdentity = artifactA, adapterIdentities = [], messages = [{ role: 'user', content: 'hello' }] } = metadata;
    const input = { model: { id: model, identity: modelIdentity, adapters: adapterIdentities.map(identity => ({ identity })) }, privacy: openPolicy };
    const details = { requestId, consumer, provider, model, modelIdentity, adapterIdentities, admissionProtocol: 2,
      modelContract: null, privacy: openPolicy, offerId: 'ordinary-generation',
      privacyBinding: await bindExecutionRoute(input, plaintextExecutionRoute(input, { recipients: [provider], route: {
        schema: 'reploid.mesh-route/v1', providerId: provider, offerId: 'ordinary-generation', backend: 'doppler-plaintext/v1'
      } })) };
    const salt = 'a'.repeat(64);
    const promptCommitment = await hashJson({ schema: 'reploid.prompt-commitment/v1', salt, messages, settings: null });
    await handlers.get('reploid:generation-admit')(peer, { ...details, promptCommitment });
    return { ...details, messages, admission: { salt } };
  };
  return { mesh, sent, broadcasts, advertise, respond, authorize, events, handlers, prepareInbound,
    update: (request, chunk) => handlers.get('reploid:generation-update')(request.peer, { requestId: request.payload.requestId, chunk }) };
}

it('prefers the successful conversation provider only while it remains eligible and available', async () => {
  const f = fixture(); await f.mesh.connect();
  try {
    f.advertise('west', 'qwen');
    const run = async () => {
      const offset = f.sent.length;
      const pending = f.mesh.generate([], null, { modelId: 'qwen', requestContext: { contextId: 'thread-a' } });
      await vi.waitFor(() => expect(f.sent.length).toBeGreaterThan(offset));
      const sent = f.sent.at(-1);
      await f.respond(sent); await pending;
      return sent.peer;
    };
    expect(await run()).toBe('west');
    f.advertise('east', 'qwen', { availableSlots: 10 });
    expect(await run()).toBe('west');
    f.advertise('west', 'qwen', { availableSlots: 0 });
    expect(await run()).toBe('east');
    f.advertise('east', 'other'); f.advertise('west', 'qwen');
    expect(await run()).toBe('west');
  } finally { await f.mesh.close(); }
});

it('transports bounded reported GPU metadata and clears it when a peer no longer reports it', async () => {
  const f = fixture({}, { getExecutionState: () => ({ phase: 'ready', modelIdentity: 'fixture',
    hardware: { vendor: 'AMD', description: 'GPU', hostname: 'private-host' } }) });
  await f.mesh.connect();
  try {
    f.mesh.refreshAdvertisement();
    expect(f.broadcasts.at(-1).payload.hardware).toEqual({ vendor: 'AMD', description: 'GPU' });
    f.advertise('remote', 'qwen', { hardware: { vendor: 'Intel', description: 'GPU', hostname: 'private-host' }, updatedAt: 100 });
    expect(f.mesh.getSwarmSnapshot().peers[0].hardware).toEqual({ vendor: 'Intel', description: 'GPU' });
    f.advertise('remote', 'qwen', { updatedAt: 101 });
    expect(f.mesh.getSwarmSnapshot().peers[0].hardware).toBeNull();
  } finally { await f.mesh.close(); }
});

it('does not trust identity fields injected into peer advertisements', async () => {
  const f = fixture(); await f.mesh.connect();
  try {
    f.advertise('wire', 'qwen', { participantId: 'forged-key', identityVerified: true });
    expect(f.mesh.getSwarmSnapshot().peers[0]).toMatchObject({ peerId: 'wire', participantId: null, identityVerified: false });
  } finally { await f.mesh.close(); }
});

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
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
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
  f.advertise('unidentified', 'qwen', { modelIdentity: null });
  f.advertise('wrong-artifact', 'qwen', { modelIdentity: 'sha256:' + 'b'.repeat(64) });
  const request = f.mesh.generate([], null, { modelId: 'qwen', modelIdentity: identity });
  await new Promise(resolve => setTimeout(resolve, 10)); expect(f.sent).toHaveLength(0);
  f.advertise('ready', 'qwen', { modelIdentity: identity });
  await vi.waitFor(() => expect(f.sent).toHaveLength(1)); expect(f.sent[0].peer).toBe('ready');
  await f.respond(f.sent[0]); await expect(request).resolves.toMatchObject({ modelIdentity: identity }); await f.mesh.close();
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

it('delivers one well-formed early input count that precedes text and ignores a malformed, repeated or late one without disturbing the stream', async () => {
  const f = fixture(); await f.mesh.connect(); f.advertise('east', 'qwen');
  const completion = promptTokenCount => ({ schema: 'doppler.generation-completion/v1', stopReason: 'eos-token', promptTokenCount, generatedTokenCount: 2 });
  const open = async controls => {
    const seen = [], offset = f.sent.length;
    const pending = f.mesh.generate([], chunk => seen.push(chunk), { modelId: 'qwen', ...controls(seen) });
    await vi.waitFor(() => expect(f.sent.length).toBeGreaterThan(offset));
    const { requestId } = f.sent.at(-1).payload;
    return { seen, pending, raw: payload => f.handlers.get('reploid:generation-update')('east', { requestId, ...payload }),
      finish: promptTokenCount => f.handlers.get('reploid:generation-result')('east',
        { requestId, response: { model: 'qwen', modelIdentity: artifactA, content: 'ab', ...(promptTokenCount === undefined ? {} : { completion: completion(promptTokenCount) }) } }) };
  };
  const observing = seen => ({ onUsage: usage => seen.push(usage) });
  try {
    const first = await open(observing);
    for (const usage of [null, 'seven', 7, [7], {}, { inputTokens: 0 }, { inputTokens: -1 }, { inputTokens: 1.5 }, { inputTokens: '7' },
      { inputTokens: Number.MAX_SAFE_INTEGER + 1 }]) first.raw({ usage });
    expect(first.seen).toEqual([]);
    first.raw({ usage: { inputTokens: 7 } }); first.raw({ usage: { inputTokens: 8 } });
    first.raw({ chunk: 'a' }); first.raw({ usage: { inputTokens: 9 } }); first.raw({ chunk: 'b', usage: { inputTokens: 9 } });
    expect(first.seen).toEqual([{ inputTokens: 7 }, 'a', 'b']);
    await first.finish(7);
    expect((await first.pending).content).toBe('ab');

    // An observation that arrives after text is never delivered, so it binds nothing.
    const late = await open(observing);
    late.raw({ chunk: 'a' }); late.raw({ usage: { inputTokens: 7 } }); late.raw({ chunk: 'b' });
    await late.finish(3);
    expect((await late.pending).content).toBe('ab');
    expect(late.seen).toEqual(['a', 'b']);

    // Without the control the update is ignored, as by a requester that predates it.
    const unasked = await open(() => ({}));
    unasked.raw({ usage: { inputTokens: 7 } }); unasked.raw({ chunk: 'ab' });
    await unasked.finish(3);
    expect((await unasked.pending).content).toBe('ab');
    expect(unasked.seen).toEqual(['ab']);

    // Once delivered, the completion must report the same count; a different or missing one is refused.
    for (const reported of [8, undefined]) {
      const bound = await open(observing);
      bound.raw({ usage: { inputTokens: 7 } }); bound.raw({ chunk: 'ab' });
      const refused = expect(bound.pending).rejects.toThrow('Provider input token count differs from its early observation');
      await bound.finish(reported); await refused;
      expect(bound.seen).toEqual([{ inputTokens: 7 }, 'ab']);
    }
    expect(f.sent.every(item => item.name === 'reploid:generation-request')).toBe(true);
  } finally { await f.mesh.close(); }
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
    const request = f.handlers.get('reploid:generation-request')('consumer', await f.prepareInbound('consumer', 'one', { adapterIdentities: [artifactB] }));
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
    await f.handlers.get('reploid:generation-request')('consumer', await f.prepareInbound('consumer', 'one'));
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

it('keeps every close caller pending until admitted provider execution settles', async () => {
  let finishExecution, executionSignal;
  const generate = vi.fn((_messages, _onUpdate, { signal }) => {
    executionSignal = signal;
    return new Promise(resolve => { finishExecution = resolve; });
  });
  const f = fixture({ executeJobs: true }, { modelConfig: { id: 'qwen' }, generate });
  await f.mesh.connect();
  const request = f.handlers.get('reploid:generation-request')('consumer', await f.prepareInbound('consumer', 'active'));
  await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
  const firstClosed = vi.fn(), secondClosed = vi.fn();
  const first = f.mesh.close().then(firstClosed);
  const second = f.mesh.close().then(secondClosed);
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(executionSignal.aborted).toBe(true);
    expect(firstClosed).not.toHaveBeenCalled();
    expect(secondClosed).not.toHaveBeenCalled();
    await f.handlers.get('reploid:generation-request')('consumer', {
      requestId: 'late', model: 'qwen', messages: [{ role: 'user', content: 'too late' }]
    });
    expect(generate).toHaveBeenCalledOnce();
  } finally {
    finishExecution({ model: 'qwen', content: 'late result' });
    await Promise.all([request, first, second]);
  }
  expect(firstClosed).toHaveBeenCalledOnce();
  expect(secondClosed).toHaveBeenCalledOnce();
  expect(f.sent).toEqual([]);
});


it('settles local whole-model generation before close and suppresses output after stopping', async () => {
  let finishExecution, emit, executionSignal;
  const generate = vi.fn((_messages, onUpdate, { signal }) => {
    emit = onUpdate; executionSignal = signal;
    return new Promise(resolve => { finishExecution = resolve; });
  });
  const f = fixture({}, { modelConfig: { id: 'qwen' }, generate });
  const updates = vi.fn();
  const request = f.mesh.generate([], updates, { modelId: 'qwen' });
  const failed = expect(request).rejects.toThrow('Mesh closed');
  const closed = vi.fn();
  const stopping = f.mesh.close().then(closed);
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(executionSignal.aborted).toBe(true);
    expect(closed).not.toHaveBeenCalled();
    emit('late text');
    expect(updates).not.toHaveBeenCalled();
  } finally {
    finishExecution({ model: 'qwen', modelIdentity: artifactA, content: 'late result' });
    await failed; await stopping;
  }
  expect(closed).toHaveBeenCalledOnce();
});

it('does not regress observed preparation or execution on delayed advertisements', async () => {
  const f = fixture(); await f.mesh.connect();
  const observation = { observationSession: 'one', updatedAt: 100 };
  f.advertise('east', 'qwen', { ...observation, observationSequence: 2, readiness: 'loading', preparation: { kind: 'receiving', receivedBytes: 70, totalBytes: 100 } });
  f.advertise('east', 'qwen', { ...observation, observationSequence: 1, readiness: 'loading', preparation: { kind: 'receiving', receivedBytes: 10, totalBytes: 100 } });
  expect(f.mesh.getSwarmSnapshot().peers[0].preparation.receivedBytes).toBe(70);
  f.advertise('east', 'qwen', { ...observation, observationSequence: 3, readiness: 'ready', activity: { phase: 'executing', completed: 2 } });
  expect(f.mesh.getSwarmSnapshot().peers[0]).toMatchObject({ readiness: 'ready', activity: { phase: 'executing', completed: 2 } });
  await f.mesh.close();
});

it('fails visibly when no peer serves the requested adapter instead of dispatching to a base-model peer', async () => {
  const adapter = 'sha256:' + 'd'.repeat(64);
  const f = fixture({ generationTimeoutMs: 1000 });
  await f.mesh.connect();
  try {
    f.advertise('base-only', 'qwen', { modelIdentity: 'sha256:' + 'e'.repeat(64), adapterIdentities: [] });
    await expect(f.mesh.generate([], null, { modelId: 'qwen', adapterIdentities: [adapter] }))
      .rejects.toThrow('No contributor serves the requested adapter. The base model was not used.');
    expect(f.sent).toEqual([]);
  } finally { await f.mesh.close(); }
});

it('filters unsupported advertised paths before ranking and never falls back from cryptographic requirements', async () => {
  const f = fixture(); await f.mesh.connect();
  const modelIdentity = 'sha256:' + 'a'.repeat(64);
  const advertised = { schema: 'reploid.execution-offer/v1', id: 'fhe', kind: 'cryptographic', backend: 'fhe/v1',
    modelIdentities: [modelIdentity], operation: 'generate', protocol: 'fhe/v1', evidence: null };
  f.advertise('unsupported', 'qwen', { modelIdentity, executionOffers: [advertised], availableSlots: 100 });
  f.advertise('ordinary', 'qwen', { modelIdentity });
  const pending = f.mesh.generate([], null, { modelId: 'qwen', modelIdentity, privacy: openPolicy });
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(f.sent[0].peer).toBe('ordinary');
  await f.handlers.get('reploid:generation-result')('ordinary', { requestId: f.sent[0].payload.requestId,
    response: { model: 'qwen', modelIdentity, content: 'response' } });
  await pending;
  const prior = f.sent.length;
  await expect(f.mesh.generate([{ content: 'secret' }], null, { modelId: 'qwen', modelIdentity,
    privacy: createExecutionPolicy({ computation: 'cryptographic', protocol: 'fhe/v1', keyContext: 'client-key' }) })).rejects.toThrow('unavailable');
  expect(f.sent).toHaveLength(prior);
  await f.mesh.close();
});

it.each(['deadline', 'disconnect'])('withdraws a whole-model request during validation on %s', async kind => {
  const generate = vi.fn(async () => ({ model: 'qwen', content: 'answered' }));
  const f = fixture({ executeJobs: true }, { modelConfig: { id: 'qwen' }, generate });
  await f.mesh.connect();
  const offer = await f.prepareInbound('consumer', 'request-1');
  const receive = f.handlers.get('reploid:generation-request');
  try {
    const validating = receive('consumer', offer);
    if (kind === 'deadline') {
      f.handlers.get('reploid:generation-cancel')('consumer', { requestId: offer.requestId });
    } else {
      f.events.emit('swarm:peer-disconnected', { peerId: 'consumer' });
    }
    await validating;
    expect(generate).not.toHaveBeenCalled();
    expect(f.sent.some(row => row.name === 'reploid:generation-result')).toBe(false);
    expect(f.authorize.mock.calls.some(([request]) => request.action === 'mesh.execute')).toBe(false);
    await receive('next-consumer', await f.prepareInbound('next-consumer', 'request-2'));
    expect(generate).toHaveBeenCalledOnce();
  } finally { await f.mesh.close(); }
});
