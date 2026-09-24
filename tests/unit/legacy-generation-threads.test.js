import { it, expect, vi } from 'vitest';
import { createLegacyGenerationMesh } from '../../packages/reploid/src/mesh/legacy-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

function fixture(meshOverrides = {}) {
  const handlers = new Map(), listeners = new Map(), sent = [];
  const events = {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    emit(name, value) { for (const fn of listeners.get(name) || []) fn(value); }
  };
  const authorize = vi.fn(async () => true);
  const mesh = createLegacyGenerationMesh({ config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test', ...meshOverrides } } }), ports: {
    instanceId: 'test', modelConfig: null, authorize, generate: async () => {},
    utils: { generateId: () => crypto.randomUUID() }, events, eventBus: events,
    identity: { ensure: async () => ({ peerId: 'requester' }), sync: async () => {}, save: async () => {} },
    createTransport: () => ({ init: async () => true, disconnect() {}, broadcast() {},
      onMessage(name, fn) { handlers.set(name, fn); },
      sendToPeer(peer, name, payload) { sent.push({ peer, name, payload }); return true; } })
  } });
  const advertise = (id, model) => handlers.get('reploid:peer-advertisement')(id,
    { hasInference: true, swarmEnabled: true, model, updatedAt: Date.now() });
  const respond = (request, model = request.payload.model) => handlers.get('reploid:generation-result')(request.peer,
    { requestId: request.payload.requestId, response: { model, content: 'response' } });
  return { mesh, sent, advertise, respond, authorize, events };
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
