// @vitest-environment node
/**
 * The browser host's swarm (apps/poolday/host/work-swarm.js) wired to weight supply: on connect it builds this
 * session's weight supply over the model-file cache's ports (here a real custody exchange in an in-process room),
 * reloads saved state, and reports this device's weight-supply offer in getState().localOffers from it. Joining a
 * fresh profile offers nothing and computes nothing; a recommendation is computed only when asked.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { parseOffer } from '../../packages/reploid/src/contracts/computer-records.js';
import { pieceFile, pinnedModelPieces } from '../../packages/reploid/src/contracts/weight-supply.js';
import { createSharedFileInventory } from '../../packages/reploid/src/artifacts/custody/shared-inventory.js';
import { resolveConfig } from '../../shared/vendor/reploid/config/index.js';
import { ROOM_POLICY, createRoom, sha256Hex, syntheticModel } from '../fixtures/weight-supply-room.js';

const ports = vi.hoisted(() => ({ ensure: vi.fn(), createTransport: vi.fn() }));
vi.mock('../../apps/poolday/host/contributor-identity.js', () => ({ createContributorIdentity: () => ({
  ensure: (...args) => ports.ensure(...args), save: vi.fn(), close: vi.fn(async () => {}) }) }));
vi.mock('../../shared/identity.js', () => ({ ensureIdentityBundle: (...args) => ports.ensure(...args), saveIdentityBundle: vi.fn(), rotateIdentityBundle: vi.fn() }));
vi.mock('../../shared/vendor/reploid/transport/index.js', () => ({
  createSwarmTransport: (...args) => Object.assign({ getConnectedPeers: () => [] }, ports.createTransport(...args)), createToolOfferChannel: vi.fn(),
  TOOL_OFFER_MESSAGE: 'offer', TOOL_OFFER_ACK: 'ack' }));
import { createWorkSwarm } from '../../apps/poolday/host/work-swarm.js';
import { createMemoryWeightSupplyRecords } from '../../apps/poolday/host/weight-supply-host.js';

const until = async (check, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!await check()) { if (Date.now() > deadline) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
let values;
beforeEach(() => { vi.clearAllMocks(); values = new Map(); });

async function room() {
  const model = await syntheticModel({ count: 3, pieceBytes: 4096 });
  const pinned = pinnedModelPieces(model);
  const shared = createRoom();
  const source = await shared.join('source-peer', { pieces: new Map(model.bytes) });
  source.exchange.offer(pinned.pieces.map(pieceFile));
  const consumer = await shared.join('consumer-peer');
  consumer.exchange.announceDemand(pinned.pieces.map(pieceFile));
  let onServed = () => {};
  const peer = await shared.join('new-peer', { observeServed: event => onServed(event) });
  await until(() => peer.exchange.getState().offers.length > 0 && peer.exchange.getState().demand.length > 0);
  return { model, pinned, source, consumer, peer, served: handler => { onServed = handler; },
    leave: () => Promise.all([source.leave(), consumer.leave(), peer.leave()]) };
}

/** The swarm on `f`'s new peer: its model-file cache's weight-supply ports are that peer's exchange and store. */
function swarmOn(f, records, { loads = { count: 0 } } = {}) {
  ports.ensure.mockResolvedValue(f.peer.identity);
  ports.createTransport.mockReturnValue({ init: async () => true, disconnect: vi.fn(), onMessage: vi.fn(), broadcast: vi.fn(), getPeerId: () => f.peer.id });
  const inventory = createSharedFileInventory({ exchange: f.peer.exchange, maxFiles: ROOM_POLICY.maxInventoryFiles });
  return createWorkSwarm({ service: {}, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    createPartitions: () => ({ getModels: () => [], stop: async () => {}, close: async () => {} }),
    createModelFiles: ({ onServed }) => {
      f.served(onServed);
      return { attach: async () => {}, close: async () => {}, announce() {}, getState: () => ({}), prepareSource: async model => model.id,
        weightSupplyPorts: () => ({ exchange: f.peer.exchange, inventory, store: f.peer.store, hashBytes: sha256Hex,
          loadModels: async () => { loads.count++; return [f.pinned]; } }) };
    },
    openWeightRecords: async () => records,
    networkOptions: () => ({ autoConnect: true, discoveryScope: 'public', getInviteUrl: () => 'https://replo.id/?swarm=public',
      config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'reploid-swarm-public' } } }) }) });
}

it('joining a fresh profile builds no offer and computes no recommendation', async () => {
  const f = await room(), loads = { count: 0 };
  const swarm = swarmOn(f, createMemoryWeightSupplyRecords(), { loads });
  try {
    await swarm.connect();
    const state = swarm.getState();
    expect(state.localOffers.filter(offer => offer.kind === 'weight-supply')).toEqual([]);
    expect(state.weightSupply).toMatchObject({ recommendation: null, approval: null, pieces: [], restore: { approval: 'none' } });
    expect(loads.count).toBe(0);
    expect(f.peer.exchange.getState().sharing).toBe(false);
  } finally { await swarm.close(); await f.leave(); }
});

it('recommends when asked, approves under the cap the UI passes, reports the offer in localOffers and survives a reload', async () => {
  const f = await room(), records = createMemoryWeightSupplyRecords();
  let swarm = swarmOn(f, records);
  try {
    await swarm.connect();
    const recommendation = await swarm.recommendWeightSupply({ storageCapBytes: 1 << 20 });
    expect(swarm.getState().weightSupply.downloadBytes).toBe(3 * 4096);
    const approval = await swarm.approveWeightSupply({ offerId: recommendation.offer.offerId, storageCapBytes: 1 << 20 });
    await until(() => swarm.getState().weightSupply.verifiedBytes === 3 * 4096);
    const [offer] = swarm.getState().localOffers.filter(row => row.kind === 'weight-supply');
    expect(parseOffer(offer)).toMatchObject({ readiness: 'ready', paused: false, connectionId: f.peer.id, expiresAt: approval.expiresAt });
    expect(offer.scope.files).toHaveLength(3);
    // Served bytes reach the projection through the model-file cache's served-transfer port.
    await f.source.exchange.stopSupply();
    await until(() => f.consumer.exchange.has(pieceFile(f.pinned.pieces[1])));
    await f.consumer.exchange.acquire(pieceFile(f.pinned.pieces[1]), { signal: new AbortController().signal });
    await until(() => swarm.getState().weightSupply.servedBytes === 4096);
    await swarm.pauseWeightSupply();
    expect(parseOffer(swarm.getState().localOffers.find(row => row.kind === 'weight-supply'))).toMatchObject({ paused: true });
    expect(f.peer.exchange.getState().sharing).toBe(false);
    await swarm.resumeWeightSupply();
    expect(f.peer.exchange.getState().sharing).toBe(true);
    await swarm.close();
    // A reload: a new swarm on the same computer, store and saved records.
    swarm = swarmOn(f, records);
    await swarm.connect();
    await until(() => swarm.getState().weightSupply.restore.approval === 'restored');
    expect(swarm.getState().weightSupply).toMatchObject({ verifiedBytes: 3 * 4096, servedBytes: 4096, approval: { approvalId: approval.approvalId },
      transfers: [{ recordedBy: 'provider', pieceId: f.pinned.pieces[1].pieceId }] });
    expect(parseOffer(swarm.getState().localOffers.find(row => row.kind === 'weight-supply'))).toMatchObject({ readiness: 'ready', paused: false });
  } finally { await swarm.close(); await f.leave(); }
});
