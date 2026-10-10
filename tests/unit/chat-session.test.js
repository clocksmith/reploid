import { describe, it, expect, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';
import { createChatScheduler } from '../../self/vendor/reploid/chat/index.js';
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

  it('archives and renames during execution without aborting or losing drafts', async () => {
    let release, signal;
    const gate = new Promise(resolve => { release = resolve; });
    const store = storage();
    const session = createChatSession({ storage: store, service: createChatTestService(), scheduler: {
      getState: () => ({}), close: async () => {},
      async schedule(request, controls) { signal = controls.signal; await gate; return { content: 'Complete', model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [] }; }
    } });
    const id = session.createThread({ sharingScope: 'local', purpose: 'Instruction' });
    const completion = session.send(id, 'Question');
    session.saveDraft(id, { text: 'Next question', files: [] }); session.renameThread(id, 'New title'); session.archiveThread(id);
    expect(signal.aborted).toBe(false); expect(session.getState().selectedId).toBeNull();
    release(); expect((await completion).status).toBe('completed'); session.restoreThread(id);
    expect(session.getDraft(id).text).toBe('Next question'); expect(session.getState().activeThread.title).toBe('New title');
    expect(session.getState().activeThread.purpose).toBe('Instruction'); await session.close();
    const restored = createChatSession({ storage: store, service: createChatTestService() });
    expect(restored.getState().threads[0].title).toBe('New title'); await restored.close();
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
    await expect(session.setSharing(true, 'unknown-model', true)).rejects.toThrow('catalog');
    await session.setSharing(true, CANONICAL_CHAT_MODELS[1].id, true);
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

describe('Chat host ownership boundaries', () => {
  it('does not close a borrowed scheduler or expose its lifecycle controls', async () => {
    const scheduler = { schedule: vi.fn(), getState: () => ({ queued: 0 }), close: vi.fn() };
    const session = createChatSession({ storage: null, service: createChatTestService(), scheduler });
    expect(session.getState().scheduler).toEqual({ queued: 0 });
    await session.close();
    expect(scheduler.close).not.toHaveBeenCalled();
    expect(session.scheduler).toBeUndefined();
  });

  it('restores placement from accepted attempts and does not retain a rejected provider claim', async () => {
    const store = storage(), service = createChatTestService();
    const session = createChatSession({ storage: store, service });
    const id = session.createThread({ sharingScope: 'local' });
    const result = await session.send(id, 'Retain this result');
    expect(result.status).toBe('completed');
    const placements = session.getState().placements;
    await session.close();
    const restored = createChatSession({ storage: store, service });
    expect(restored.getState().placements).toEqual(placements);
    await restored.close();
    const badScheduler = { getState: () => ({}), close: async () => {},
      schedule: async request => ({ model: request.model.id, modelIdentity: 'sha256:' + 'f'.repeat(64), adapterIdentities: [], content: 'wrong model' }) };
    const rejected = createChatSession({ storage: null, service, scheduler: badScheduler });
    const failedId = rejected.createThread({ sharingScope: 'local' });
    expect((await rejected.send(failedId, 'Check identity')).status).toBe('failed');
    expect(rejected.getState().placements[failedId]).toBeUndefined();
    await rejected.close();
  });

  it('publishes immutable snapshots so one listener cannot corrupt the next listener', async () => {
    const session = createChatSession({ storage: null, service: createChatTestService() });
    let blocked = false, seen;
    session.subscribe(state => {
      try { state.models[0].identity = 'forged'; } catch { blocked = true; }
    });
    session.subscribe(state => { seen = state.models[0].identity; });
    session.refreshNetwork();
    expect(blocked).toBe(true);
    expect(seen).toBe(CANONICAL_CHAT_MODELS[0].identity);
    await session.close();
  });

  it('invalidates late discovery and rejects new operations once close begins', async () => {
    let resolve;
    const peers = { discover: () => new Promise(done => { resolve = done; }) };
    const swarm = { connect: vi.fn(), share: vi.fn() };
    const session = createChatSession({ storage: null, service: createChatTestService(), peers, swarm });
    const pending = session.discoverPeers();
    await session.close();
    resolve([{ ...CANONICAL_CHAT_MODELS[0], id: 'late-model' }]);
    await pending;
    expect(session.getState().models.some(model => model.id === 'late-model')).toBe(false);
    await expect(session.connect()).rejects.toThrow('closed');
    await expect(session.setSharing(true, CANONICAL_CHAT_MODELS[0].id, true)).rejects.toThrow('closed');
    expect(swarm.connect).not.toHaveBeenCalled();
    expect(swarm.share).not.toHaveBeenCalled();
  });
});

it('keeps an owned execution slot until close settles and makes shutdown single-flight', async () => {
  let finish;
  const service = createChatTestService();
  const open = service.open;
  service.open = async (...args) => {
    const resident = await open(...args);
    resident.stream = async function* () {
      await new Promise(resolve => { finish = resolve; });
      yield { type: 'text-delta', text: 'Late answer' };
    };
    return resident;
  };
  const session = createChatSession({ storage: null, service });
  const id = session.createThread({ sharingScope: 'local' });
  const response = session.send(id, 'Wait for settlement');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const closed = session.close();
  expect(session.close()).toBe(closed);
  expect(() => session.send(id, 'Must not start')).toThrow('closed');
  let settled = false;
  closed.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(service.closed).toHaveLength(0);
  finish();
  await closed;
  expect((await response).status).toBe('cancelled');
  expect(service.closed).toHaveLength(1);
  expect(session.getState().runningIds).toEqual([]);
});

it('does not advertise a different artifact with the same model name as loading', async () => {
  const model = CANONICAL_CHAT_MODELS[0];
  const swarm = { getState: () => ({ consumer: { peers: [{
    peerId: 'wrong-artifact', model: model.id, modelIdentity: 'sha256:' + 'f'.repeat(64), readiness: 'loading'
  }] } }) };
  const session = createChatSession({ storage: null, service: createChatTestService(), swarm });
  expect(session.getState().models.find(item => item.id === model.id).availability).toBe('unavailable');
  await session.close();
});

it('forwards each workspace transition once and releases subscriptions once', async () => {
  const unsubscribe = vi.fn();
  const partitions = { getModels: () => [], subscribe: () => unsubscribe };
  const session = createChatSession({ storage: null, service: createChatTestService(), partitions });
  const listener = vi.fn();
  session.subscribe(listener);
  listener.mockClear();
  session.createThread();
  expect(listener).toHaveBeenCalledOnce();
  listener.mockClear();
  session.select(null);
  expect(listener).toHaveBeenCalledOnce();
  await Promise.all([session.close(), session.close()]);
  expect(unsubscribe).toHaveBeenCalledOnce();
  listener.mockClear();
  session.refreshNetwork();
  expect(listener).not.toHaveBeenCalled();
});

it('closing one host preserves another host queued on the same borrowed scheduler', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const closeResident = vi.fn();
  const scheduler = createChatScheduler({ observe: () => {}, open: async () => ({
    reset() {}, setAdapters() {}, close: closeResident,
    async run(request) {
      if (request.participantId === 'first-owner') await gate;
      return { model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [], content: request.participantId };
    }
  }) });
  const first = createChatSession({ storage: null, scheduler, participantId: 'first-owner' });
  const second = createChatSession({ storage: null, scheduler, participantId: 'second-owner' });
  const a = first.createThread({ sharingScope: 'local' }), b = second.createThread({ sharingScope: 'local' });
  const cancelled = first.send(a, 'Stop this owner');
  const completed = second.send(b, 'Preserve this owner');
  try {
    await vi.waitFor(() => expect(first.getState().activeThread.attempts[0].status).toBe('executing'));
    const closing = first.close();
    expect(scheduler.getState().queued).toBe(1);
    release();
    await closing;
    expect((await cancelled).status).toBe('cancelled');
    expect((await completed).status).toBe('completed');
    expect(second.getState().activeThread.messages.at(-1).content).toBe('second-owner');
    expect(scheduler.getState().closed).toBe(false);
    expect(closeResident).not.toHaveBeenCalled();
  } finally {
    release();
    await Promise.all([first.close(), second.close()]);
    await scheduler.close();
  }
  expect(closeResident).toHaveBeenCalledOnce();
});

it('does not let a borrowed contribution port mutate retained model descriptions', async () => {
  const model = { ...CANONICAL_CHAT_MODELS[1], availableAdapters: [{ id: 'adapter', name: 'Original',
    identity: 'sha256:' + 'a'.repeat(64), baseModelIdentity: CANONICAL_CHAT_MODELS[1].identity }] };
  const swarm = { shareFiles: async catalog => { catalog.availableAdapters[0].name = 'Changed by port'; } };
  const session = createChatSession({ storage: null, service: createChatTestService(), models: [model], swarm });
  await session.setFileSharing(true, model.id, true);
  expect(session.getState().models[0].availableAdapters[0].name).toBe('Original');
  await session.close();
});

it('reports the verified download size without opening an execution session', async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode(JSON.stringify({ modelId: CANONICAL_CHAT_MODELS[0].id, shards: [{ size: 200 }, { size: 300 }] }));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  const model = structuredClone(CANONICAL_CHAT_MODELS[0]);
  model.identity = 'sha256:' + hash;
  model.source.files = [{ role: 'model-manifest', path: 'manifest.json', sizeBytes: bytes.length },
    { role: 'tokenizer', path: 'tokenizer.json', sizeBytes: 100 },
    { role: 'model-piece-index', path: 'pieces.json', sizeBytes: 50 }];
  const service = createChatTestService(), session = createChatSession({ storage: null, service, models: [model] });
  const fetcher = vi.fn(async () => new Response(bytes));
  globalThis.fetch = fetcher;
  try {
    expect((await session.getModelDownload(model.id)).sizeBytes).toBe(600 + bytes.length);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(new URL('manifest.json', model.source.baseUrl).href);
    expect(service.calls).toHaveLength(0);
    const corrupt = bytes.slice(); corrupt[0] = 32;
    fetcher.mockImplementation(async () => new Response(corrupt));
    await expect(session.getModelDownload(model.id)).rejects.toThrow('identity mismatch');
    fetcher.mockImplementation(async () => new Response(bytes.slice(1)));
    await expect(session.getModelDownload(model.id)).rejects.toThrow('size mismatch');
    fetcher.mockImplementation(async () => new Response('', { status: 503 }));
    await expect(session.getModelDownload(model.id)).rejects.toThrow('Could not check');
    expect(service.calls).toHaveLength(0);
  } finally { globalThis.fetch = originalFetch; await session.close(); }
});
