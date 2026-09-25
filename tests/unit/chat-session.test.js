import { describe, it, expect, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};

describe('Chat host with injected execution, not actual inference', () => {
  it('accepts structured Doppler loader progress without losing local execution state', async () => {
    const session = createChatSession({ storage: null, service: createChatTestService() });
    const id = session.createThread({ sharingScope: 'local' }), states = [];
    session.subscribe(snapshot => {
      const attempt = snapshot.activeThread?.attempts.at(-1);
      if (attempt) states.push(attempt);
    });
    const result = await session.send(id, 'hi');
    expect(result.error).toBeFalsy();
    expect(result.status).toBe('completed');
    const loading = states.filter(attempt => attempt.status === 'loading');
    expect(loading.length).toBeGreaterThanOrEqual(1);
    expect(loading.every(attempt => attempt.execution?.placement === 'local-webgpu')).toBe(true);
    expect(session.getState().activeThread.messages.at(-1).content).toBe('Fixture: hi');
    await session.close();
  });

  it('persists multiple turns and restores history without dispatching', async () => {
    const store = storage(), service = createChatTestService();
    const session = createChatSession({ storage: store, service });
    const id = session.createThread({ sharingScope: 'local' });
    expect((await session.send(id, 'First')).status).toBe('completed');
    expect((await session.send(id, 'Second')).status).toBe('completed');
    expect(service.calls[0].source).toBe(CANONICAL_CHAT_MODELS[1].id);
    expect(service.closed).toHaveLength(0);
    await session.close();
    const restored = createChatSession({ storage: store, service });
    expect(restored.getState().threads[0].messages).toHaveLength(4);
    expect(service.calls).toHaveLength(1);
    await restored.close();
  });

  it('shares the existing device queue and isolates thread histories', async () => {
    const service = createChatTestService(), session = createChatSession({ storage: null, service });
    const a = session.createThread({ sharingScope: 'local' }), b = session.createThread({ sharingScope: 'local' });
    const results = await Promise.all([session.send(a, 'Only A'), session.send(b, 'Only B')]);
    expect(results.map(row => row.status)).toEqual(['completed', 'completed']);
    const threads = session.getState().threads;
    expect(threads[0].messages.at(-1).content).toBe('Fixture: Only A');
    expect(threads[1].messages.at(-1).content).toBe('Fixture: Only B');
    await session.close();
  });

  it('retains failed execution and never substitutes a simulated response', async () => {
    const service = { open: vi.fn(async () => { throw new Error('No GPU'); }), close: vi.fn() };
    const session = createChatSession({ storage: null, service });
    const id = session.createThread({ sharingScope: 'local' }), attempt = await session.send(id, 'Hello');
    expect(attempt.status).toBe('failed'); expect(attempt.error).toBe('No GPU');
    expect(session.getState().activeThread.messages.at(-1).content).toBe('');
    expect(service.close).toHaveBeenCalled();
    await session.close();
  });

  it('includes attached text in execution and stored conversation context', async () => {
    const session = createChatSession({ storage: null, service: createChatTestService() });
    const id = session.createThread({ sharingScope: 'local' });
    await session.send(id, 'Read this', [{ name: 'notes.txt', text: 'Actual attached text' }]);
    expect(session.getState().activeThread.messages[0].content).toContain('Actual attached text');
    expect(session.getState().activeThread.messages[1].content).toContain('Actual attached text');
    expect(() => session.send(id, 'Too big', [{ name: 'large', text: 'x'.repeat(65537) }])).toThrow();
    await session.close();
  });

  it('cancels one request without cancelling the queued conversation', async () => {
    const session = createChatSession({ storage: null, service: createChatTestService() });
    const a = session.createThread({ sharingScope: 'local' }), b = session.createThread({ sharingScope: 'local' });
    const first = session.send(a, 'Cancel'), second = session.send(b, 'Continue');
    session.cancel(a);
    expect((await first).status).toBe('cancelled');
    expect((await second).status).toBe('completed');
    await session.close();
  });

  it('requires scoped approval before a peer receives the conversation', async () => {
    let disclosed = false;
    const swarm = {
      getState: () => ({ sharing: false }), connect: async () => {}, hasProvider: () => true,
      async generate(messages, controls) {
        const preview = { id: 'preview', providerId: 'peer-B', input: messages, expiresAt: Date.now() + 10000 };
        if (!await controls.approve(preview)) throw new Error('Declined');
        disclosed = true;
        await controls.record({ stage: 'approved', preview });
        controls.onPartial('Peer answer');
        return { model: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], provider: 'doppler', peerId: 'peer-B', content: 'Peer answer' };
      }
    };
    const service = createChatTestService(), session = createChatSession({ storage: null, service, swarm });
    const id = session.createThread(), completion = session.send(id, 'Public question');
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[0].status).toBe('approval'));
    expect(disclosed).toBe(false);
    const attempt = session.getState().activeThread.attempts[0];
    session.approve(id, attempt.id, attempt.approval.id, true);
    expect((await completion).status).toBe('completed');
    expect(disclosed).toBe(true); expect(service.calls).toHaveLength(0);
    await session.close();
  });

  it('contribution invokes the owner and requires explicit consent', async () => {
    let sharing = false;
    const swarm = { getState: () => ({ sharing }), share: vi.fn(async () => { sharing = true; }), stop: vi.fn(async () => { sharing = false; }) };
    const session = createChatSession({ storage: null, service: createChatTestService(), swarm });
    expect(session.getState().network.sharing).toBe(false);
    await expect(session.setSharing(true, 'model', false)).rejects.toThrow('Approve');
    expect(swarm.share).not.toHaveBeenCalled();
    await session.setSharing(true, 'model', true);
    expect(session.getState().network.sharing).toBe(true);
    await session.setSharing(false);
    expect(swarm.stop).toHaveBeenCalled();
    await session.close();
  });

  it('does not advertise or silently execute the fabricated adapter', async () => {
    expect(CANONICAL_CHAT_MODELS.every(model => !model.adapters.length)).toBe(true);
    const service = createChatTestService(), session = createChatSession({ storage: null, service });
    const id = session.createThread({ model: { ...CANONICAL_CHAT_MODELS[0], adapters: [{ identity: 'sha256:' + 'c'.repeat(64) }] } });
    expect((await session.send(id, 'Hello')).status).toBe('failed');
    expect(service.calls).toHaveLength(0);
    await session.close();
  });
});


it('keeps mesh conversations unavailable without silently acquiring local weights', async () => {
  const service = createChatTestService();
  const swarm = { connect: async () => {}, hasProvider: () => false,
    generate: vi.fn(async () => { throw new Error('No remote host slot available'); }), getState: () => ({ consumer: { peers: [] } }) };
  const session = createChatSession({ storage: null, service, swarm });
  expect(session.getState().models.every(model => model.availability === 'unavailable')).toBe(true);
  const id = session.createThread();
  expect((await session.send(id, 'Wait for a contributor')).status).toBe('failed');
  expect(service.calls).toHaveLength(0); expect(swarm.generate).toHaveBeenCalledOnce(); await session.close();
});

it('rejects the actual provider artifact rather than copying requested identity into its result', async () => {
  const service = { open: async () => ({ loaded: true, modelId: CANONICAL_CHAT_MODELS[1].id,
    manifestHash: 'f'.repeat(64), resetGenerationState() {}, async *stream() { yield { type: 'text-delta', text: 'wrong artifact' }; } }), close: vi.fn() };
  const session = createChatSession({ storage: null, service });
  const id = session.createThread({ sharingScope: 'local' });
  const result = await session.send(id, 'Exact identity');
  expect(result.status).toBe('failed'); expect(result.error).toMatch(/different model artifact/);
  expect(session.getState().activeThread.messages.at(-1).content).toBe(''); await session.close();
});

it('projects loading, available capacity, busy capacity and departed providers from mesh records', async () => {
  const model = CANONICAL_CHAT_MODELS[1];
  const peer = { peerId: 'contributor', model: model.id, modelIdentity: model.identity, readiness: 'loading', hasInference: false, availableSlots: 0 };
  let peers = [peer]; const swarm = { getState: () => ({ consumer: { peers } }) };
  const session = createChatSession({ storage: null, service: createChatTestService(), swarm });
  const available = () => session.getState().models.find(item => item.id === model.id);
  expect(available().availability).toBe('loading');
  Object.assign(peer, { readiness: 'ready', hasInference: true, availableSlots: 1 });
  expect(available()).toMatchObject({ availability: 'ready', providerIds: ['contributor'] });
  peer.availableSlots = 0; expect(available().availability).toBe('busy');
  peers = []; expect(available().availability).toBe('unavailable'); await session.close();
});
