import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { resolveConfig } from '../../self/vendor/reploid/config/index.js';

const ports = vi.hoisted(() => ({ ensure: vi.fn(), createTransport: vi.fn() }));
vi.mock('../../self/identity.js', () => ({ ensureIdentityBundle: ports.ensure,
  saveIdentityBundle: vi.fn(), rotateIdentityBundle: vi.fn() }));
vi.mock('../../self/vendor/reploid/transport/index.js', () => ({
  createSwarmTransport: ports.createTransport, createToolOfferChannel: vi.fn(),
  TOOL_OFFER_MESSAGE: 'offer', TOOL_OFFER_ACK: 'ack'
}));
vi.mock('../../self/config/doppler-local-models.js', async importOriginal => {
  const actual = await importOriginal();
  const base = actual.LOCAL_DOPPLER_MODELS.find(model => model.id === 'qwen-3-5-2b-q4k-ehaf16');
  // Exercise the explicit whole-request compatibility contract independently
  // of the production catalog's verified partition acquisition descriptors.
  const wholeRequest = { ...base, id: 'whole-model-lifecycle-fixture', source: { ...base.source,
    files: base.source.files.filter(file => file.role !== 'model-piece-index') } };
  return { ...actual, LOCAL_DOPPLER_MODELS: [...actual.LOCAL_DOPPLER_MODELS, wholeRequest] };
});
import { createWorkSwarm } from '../../self/host/work-swarm.js';
import { LOCAL_DOPPLER_MODELS } from '../../self/config/doppler-local-models.js';
const wholeModelIdentity = LOCAL_DOPPLER_MODELS.find(model => model.id === 'whole-model-lifecycle-fixture').identity;

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let values;
const fixture = (service = {}, partitions = {}) => createWorkSwarm({ service,
  createPartitions: () => ({ getModels: () => [], stop: async () => {}, close: async () => {}, ...partitions }), storage: {
  getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)
}, createModelFiles: () => ({ attach: async () => {}, close: async () => {}, announce() {}, getState: () => ({}),
  prepareSource: async model => model.id }), networkOptions: () => ({ autoConnect: true, discoveryScope: 'public',
  getInviteUrl: () => 'https://replo.id/?swarm=public',
  config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'reploid-swarm-public' } } })
}) });
beforeEach(() => { vi.clearAllMocks(); values = new Map(); });

it('closes initialization before late identity resolution can open a transport', async () => {
  const identity = deferred(); ports.ensure.mockReturnValue(identity.promise);
  const swarm = fixture();
  const pending = swarm.connect({ automatic: true });
  const failed = expect(pending).rejects.toThrow('connection stopped');
  await vi.waitFor(() => expect(ports.ensure).toHaveBeenCalledOnce());
  const stopping = swarm.disconnect();
  identity.resolve({ peerId: 'fixture', contribution: {} });
  await stopping; await failed;
  expect(ports.createTransport).not.toHaveBeenCalled();
  expect(swarm.getState()).toMatchObject({ sharing: false, connecting: false, paused: true, consumer: null });
  expect(values.get('REPLOID_SWARM_ENABLED')).toBe('false');
  await swarm.connect({ automatic: true });
  expect(ports.ensure).toHaveBeenCalledOnce();
  await swarm.close();
});

it('coalesces attempts and disconnect retires an already opening transport', async () => {
  ports.ensure.mockResolvedValue({ peerId: 'fixture', contribution: {} });
  const initialized = deferred();
  const transport = { init: vi.fn(() => initialized.promise),
    disconnect: vi.fn(() => initialized.resolve(false)), onMessage: vi.fn(), broadcast: vi.fn(),
    getConnectionState: () => 'connecting', getTransportType: () => 'webrtc' };
  ports.createTransport.mockReturnValue(transport);
  const swarm = fixture();
  const first = swarm.connect({ automatic: true }), second = swarm.connect({ automatic: true });
  const outcomes = Promise.allSettled([first, second]);
  await vi.waitFor(() => expect(transport.init).toHaveBeenCalledOnce());
  await swarm.disconnect();
  expect((await outcomes).every(result => result.status === 'rejected')).toBe(true);
  expect(transport.disconnect).toHaveBeenCalled();
  expect(ports.createTransport).toHaveBeenCalledOnce();
  expect(swarm.autoConnectEnabled()).toBe(false);
  expect(swarm.getState().sharing).toBe(false);
  transport.init.mockResolvedValue(true);
  await swarm.connect();
  expect(swarm.autoConnectEnabled()).toBe(true);
  expect(values.get('REPLOID_SWARM_ENABLED')).toBe('true');
  expect(ports.createTransport).toHaveBeenCalledTimes(2);
  await swarm.close();
});

afterEach(() => vi.unstubAllGlobals());

it.each(['qwen-3-5-0-8b-q4k-ehaf16', 'qwen-3-5-2b-q4k-ehaf16'])(
  'contributes %s through the verified partition interface', async modelId => {
    vi.stubGlobal('navigator', { gpu: {} });
    ports.ensure.mockResolvedValue({ peerId: 'fixture', contribution: {} });
    ports.createTransport.mockReturnValue({ init: async () => true, disconnect: vi.fn(),
      onMessage: vi.fn(), broadcast: vi.fn() });
    const service = { open: vi.fn(), close: vi.fn() }, contribute = vi.fn();
    const swarm = fixture(service, { contribute });
    await swarm.share(modelId, true);
    expect(contribute).toHaveBeenCalledExactlyOnceWith(modelId, true);
    expect(service.open).not.toHaveBeenCalled();
    await swarm.close();
  });

it('reserves contribution startup before connecting and stop prevents a late model load', async () => {
  vi.stubGlobal('navigator', { gpu: {} });
  const identity = deferred(); ports.ensure.mockReturnValue(identity.promise);
  const transport = { init: async () => true, disconnect: vi.fn(), onMessage: vi.fn(), broadcast: vi.fn() };
  ports.createTransport.mockReturnValue(transport);
  const service = { open: vi.fn(), close: vi.fn() }, swarm = fixture(service);
  const first = swarm.share('qwen-3-5-2b-q4k-ehaf16', true);
  const failure = expect(first).rejects.toThrow('stopped');
  await expect(swarm.share('qwen-3-5-2b-q4k-ehaf16', true)).rejects.toThrow('existing sharing');
  await vi.waitFor(() => expect(ports.ensure).toHaveBeenCalledOnce());
  const stop = swarm.stop(); identity.resolve({ peerId: 'fixture', contribution: {} });
  await stop; await failure;
  expect(service.open).not.toHaveBeenCalled(); expect(swarm.getState().sharing).toBe(false);
  await swarm.close();
});

it('disconnect immediately after share cannot deadlock or create a late contributor', async () => {
  vi.stubGlobal('navigator', { gpu: {} });
  const service = { open: vi.fn(), close: vi.fn() }, swarm = fixture(service);
  const first = swarm.share('qwen-3-5-2b-q4k-ehaf16', true);
  const failure = expect(first).rejects.toThrow('stopped');
  await swarm.disconnect(); await failure;
  expect(service.open).not.toHaveBeenCalled(); expect(ports.ensure).not.toHaveBeenCalled();
  await swarm.close();
});

async function supplierFixture() {
  const { createSigningIdentity } = await import('../../packages/reploid/src/artifacts/identity.js');
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  ports.ensure.mockResolvedValue(identity);
  vi.stubGlobal('navigator', { gpu: {} });
  const handlers = new Map(), ads = [], sent = [], load = deferred(), settlement = deferred();
  const session = { loaded: true, modelId: 'whole-model-lifecycle-fixture', manifestHash: wholeModelIdentity.slice(7),
    resetGenerationState: vi.fn(), async *stream(messages) {
      yield { type: 'text-delta', text: messages.at(-1).content };
      if (messages.at(-1).content === 'hold') await settlement.promise;
    } };
  const service = { open: vi.fn(() => load.promise), close: vi.fn() };
  ports.createTransport.mockReturnValue({ init: async () => true, disconnect: vi.fn(),
    onMessage: (name, fn) => handlers.set(name, fn), broadcast: (_, ad) => ads.push(ad),
    sendToPeer: (peer, name, payload) => { sent.push({ peer, name, payload }); return true; } });
  const swarm = fixture(service);
  const share = swarm.share(session.modelId, true);
  await vi.waitFor(() => expect(service.open).toHaveBeenCalledOnce());
  return { swarm, share, service, session, load, settlement, handlers, ads, sent,
    request: (requestId, content) => handlers.get('reploid:generation-request')('consumer',
      { requestId, model: session.modelId, messages: [{ role: 'user', content }] }) };
}

it('advertises loading without slots, prepares once and reuses reset resident weights', async () => {
  const f = await supplierFixture();
  expect(f.ads.at(-1)).toMatchObject({ hasInference: false, readiness: 'loading', availableSlots: 0 });
  expect(f.swarm.getState().contribution.phase).toBe('loading');
  await f.request('too-early', 'not executed');
  expect(f.sent).toEqual([]);
  f.load.resolve(f.session); await f.share;
  expect(f.ads.at(-1)).toMatchObject({ hasInference: true, readiness: 'ready', availableSlots: 1, modelIdentity: wholeModelIdentity });
  await f.request('one', 'First'); await f.request('two', 'Second');
  expect(f.service.open).toHaveBeenCalledOnce(); expect(f.service.close).not.toHaveBeenCalled();
  expect(f.session.resetGenerationState).toHaveBeenCalledTimes(5);
  const results = f.sent.filter(row => row.name === 'reploid:generation-result');
  expect(results.map(row => row.payload.response.content)).toEqual(['First', 'Second']);
  expect(results.every(row => row.payload.response.modelIdentity === wholeModelIdentity)).toBe(true);
  await f.swarm.stop(); expect(f.service.close).toHaveBeenCalledOnce(); await f.swarm.close();
});

it('stop during preparation cannot publish late readiness and waits for load cleanup', async () => {
  const f = await supplierFixture(); const failed = expect(f.share).rejects.toThrow('stopped');
  let stopped = false; const stop = f.swarm.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  f.load.resolve(f.session); await stop; await failed;
  expect(f.ads.some(ad => ad.hasInference)).toBe(false);
  expect(f.service.close).toHaveBeenCalledOnce(); expect(f.swarm.getState().contribution.phase).toBe('idle');
  await f.swarm.close();
});

it('cancellation holds the slot through settlement, ignores duplicates and suppresses late output', async () => {
  const f = await supplierFixture(); f.load.resolve(f.session); await f.share;
  const active = f.request('one', 'hold');
  await vi.waitFor(() => expect(f.sent.some(row => row.name === 'reploid:generation-update')).toBe(true));
  await f.request('one', 'duplicate');
  f.handlers.get('reploid:generation-cancel')('consumer', { requestId: 'one' });
  expect(f.ads.at(-1).availableSlots).toBe(0);
  f.settlement.resolve(); await active;
  expect(f.sent.filter(row => row.name === 'reploid:generation-result')).toHaveLength(0);
  expect(f.ads.at(-1).availableSlots).toBe(1);
  const resets = f.session.resetGenerationState.mock.calls.length;
  await f.request('one', 'replay cancelled');
  expect(f.session.resetGenerationState).toHaveBeenCalledTimes(resets);
  await f.request('two', 'New context');
  expect(f.sent.filter(row => row.name === 'reploid:generation-result').map(row => row.payload.response.content)).toEqual(['New context']);
  await f.swarm.close();
});

it('stop during partition connection prevents a late contribution', async () => {
  vi.stubGlobal('navigator', { gpu: {} });
  const identity = deferred(); ports.ensure.mockReturnValue(identity.promise);
  const swarm = fixture();
  const pending = swarm.share('qwen-3-5-0-8b-q4k-ehaf16', true);
  const failure = expect(pending).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(ports.ensure).toHaveBeenCalledOnce());
  const stopping = swarm.disconnect(); identity.resolve({ peerId: 'fixture', contribution: {} });
  await stopping; await failure;
  expect(ports.createTransport).not.toHaveBeenCalled();
  expect(swarm.getState().sharing).toBe(false);
});
