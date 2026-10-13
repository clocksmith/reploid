import { beforeEach, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ swarm: vi.fn(), open: vi.fn(), legacy: vi.fn(), autoconnect: vi.fn(), service: vi.fn() }));
vi.mock('../../self/host/work-swarm.js', () => ({ createWorkSwarm: ports.swarm }));
vi.mock('../../self/host/chat-session.js', () => ({ createChatSession: ports.legacy, openCanonicalChatSession: ports.open }));
vi.mock('../../self/host/swarm-autoconnect.js', () => ({ startSwarmAutoconnect: ports.autoconnect }));
vi.mock('../../self/infrastructure/doppler-runtime-service.js', async original => ({ ...await original(), createReploidDopplerRuntimeService: ports.service }));
vi.mock('../../self/host/work-evolution.js', () => ({ createWorkEvolution: () => ({}) }));
import { createProductSession } from '../../self/host/product-session.js';
let swarm, chat;
beforeEach(() => {
  vi.resetAllMocks();
  swarm = { partitions: {}, close: vi.fn(async () => {}), connect: vi.fn(), autoConnectEnabled: () => false };
  chat = { close: vi.fn(async () => {}) };
  ports.swarm.mockReturnValue(swarm); ports.legacy.mockReturnValue(chat);
  ports.autoconnect.mockReturnValue({ close() {} });
});
it('preserves synchronous legacy creation', async () => {
  const host = createProductSession({ storage: null });
  expect(host.chat).toBe(chat); expect(ports.open).not.toHaveBeenCalled();
  await host.close();
});
it('does not connect or expose a canonical host until history admission opens', async () => {
  let resolve; ports.open.mockReturnValue(new Promise(done => { resolve = done; }));
  const canonical = { meshId: 'mesh', participantId: 'requester' };
  const opening = createProductSession({ storage: null, canonical });
  expect(ports.autoconnect).not.toHaveBeenCalled(); expect(ports.legacy).not.toHaveBeenCalled();
  expect(ports.open.mock.calls[0][0]).toMatchObject({ canonical, meshId: 'mesh', participantId: 'requester', partitions: swarm.partitions });
  resolve(chat); const host = await opening; expect(host.chat).toBe(chat);
  expect(ports.autoconnect).toHaveBeenCalledOnce(); await host.close();
});
it('settles created network owner when durable history opening fails', async () => {
  ports.open.mockRejectedValue(Error('writer epoch replaced'));
  await expect(createProductSession({ storage: null, canonical: {} })).rejects.toThrow('writer epoch replaced');
  expect(swarm.close).toHaveBeenCalledOnce(); expect(ports.autoconnect).not.toHaveBeenCalled();
});
it('attempts both opened owners if final composition fails', async () => {
  ports.open.mockResolvedValue(chat); ports.autoconnect.mockImplementation(() => { throw Error('listener registration failed'); });
  swarm.close.mockImplementation(() => { throw Error('network close failed'); });
  const failure = await createProductSession({ storage: null, canonical: {} }).catch(error => error);
  expect(failure.errors.map(error => error.message)).toEqual(['listener registration failed', 'network close failed']);
  expect(chat.close).toHaveBeenCalledOnce();
});

it('reports failed canonical cleanup, attempts all owners and permits an explicit retry', async () => {
  ports.open.mockResolvedValue(chat); const host = await createProductSession({ storage: null, canonical: {} });
  swarm.close.mockImplementationOnce(() => { throw Error('network cleanup uncertain'); });
  await expect(host.close()).rejects.toThrow('Canonical application cleanup failed');
  expect(chat.close).toHaveBeenCalledOnce(); await host.close();
  expect(swarm.close).toHaveBeenCalledTimes(2);
});
it('forwards explicit ordered host configuration while retaining ordinary chat history', async () => {
  const ordered = {stage:null,maxStages:7,maxStageOffersPerPeer:4,maxRouteBytes:8192,maxSelectionSteps:2000,maxRoutes:4};
  const host = createProductSession({storage:null,ordered});
  expect(ports.swarm.mock.calls[0][0]).toMatchObject({ordered,canonical:null});
  expect(ports.open).not.toHaveBeenCalled(); expect(ports.legacy).toHaveBeenCalledOnce();
  await host.close();
});
