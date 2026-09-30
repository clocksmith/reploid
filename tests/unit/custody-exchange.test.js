import { it, expect, vi } from 'vitest';
import { createCustodyExchange } from '../../packages/reploid/src/artifacts/custody/exchange.js';
import { createPeerPackSupplier, createPeerPackArtifactStore } from '../../self/pool/peer-pack-custody.js';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../../self/pool/inference-receipt.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

function channelPair() {
  const channels = [new EventTarget(), new EventTarget()];
  for (const [i, channel] of channels.entries()) Object.assign(channel, {
    ordered: true, maxRetransmits: null, maxPacketLifeTime: null, readyState: 'open', bufferedAmount: 0,
    send(data) { queueMicrotask(() => channels[1 - i].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  });
  return channels;
}
async function fixture({ afterCheckpoint = () => {}, count = 2, maxPeers = 16, commitArtifact } = {}) {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]), stores = Array.from({ length: count }, () => new Map()), callbacks = [], owners = [], receipts = [];
  const file = { path: 'shard.bin', role: 'model-weights', sizeBytes: 5, hash: (await sha256Hex(bytes)).slice(7), hashAlgorithm: 'sha256' };
  const policy = { maxTransfers: 2, maxPeers, maxAcquisitionAttempts: 4, maxSupplyBytes: 100, maxArtifactBytes: 20, maxInventoryFiles: 128, grantMs: 5000,
    channel: { maxFrameBytes: 128, maxControlBytes: 4096, maxChunkBytes: 2,
      maxBufferedBytes: 8192, maxPendingRequests: 2, maxTransferBytes: 1048576, timeoutMs: 1000 } };
  const reads = vi.fn(async () => bytes.slice());
  for (let i = 0; i < count; i++) {
    const pair = await createSigningKeyPair();
    const checkpoints = new Map();
    const transport = { getConnectedPeers: () => stores.map((_, index) => ({ id: String(index) })).filter(peer => peer.id !== String(i)),
      onMessage: (type, handler) => stores[i].set(type, handler),
      sendToPeer: (peer, type, payload) => { queueMicrotask(() => stores[Number(peer)].get(type)?.(String(i), structuredClone(payload))); return true; },
      broadcast(type, payload) { for (const peer of this.getConnectedPeers()) this.sendToPeer(peer.id, type, payload); },
      onDataChannel: (_, callback) => { callbacks[i] = callback; return () => {}; },
      openDataChannel(peer) { const [left, right] = channelPair(); callbacks[Number(peer)](String(i), right); return left; }
    };
    owners.push(createCustodyExchange({ transport, identity: { peerId: String(i), privateKey: pair.privateKey, publicKey: await exportPublicKey(pair.publicKey) }, policy,
      ports: { createSupplier: createPeerPackSupplier, createStore: createPeerPackArtifactStore,
        createChannel: createPeerPackDataChannel, readArtifact: (file, controls) => reads(file, controls, i),
        async verifyArtifact(descriptor, data) { if (await sha256Hex(data) !== 'sha256:' + descriptor.hash) throw new Error('integrity'); },
        commitArtifact,
        checkpoints: {
          getChunk: async chunk => checkpoints.get(chunk.hash)?.slice() || null,
          putChunk: async (chunk, data) => { checkpoints.set(chunk.hash, data.slice()); afterCheckpoint(chunk); },
          deleteChunk: async chunk => { checkpoints.delete(chunk.hash); }
        },
        hash: hashDopplerEvidence, hashBytes: sha256Hex, observe: receipt => receipts.push(receipt) } }));
  }
  return { owners, file, bytes, reads, receipts, stores, close: () => owners.forEach(owner => owner.close()) };
}
it('acquires verified bytes through signed custody only after independent file contribution and releases transfer slots', async () => {
  const f = await fixture(), [a, b] = f.owners;
  try {
    expect(a.has(f.file)).toBe(false); expect(f.reads).not.toHaveBeenCalled();
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    for (let i = 0; i < 4; i++) expect(await a.acquire(f.file, { signal: new AbortController().signal })).toEqual(f.bytes);
    expect(f.receipts).toHaveLength(4);
    expect(f.receipts.map(receipt => receipt.receivedBytes)).toEqual([5, 0, 0, 0]);
    expect(f.receipts.map(receipt => receipt.cacheBytes)).toEqual([0, 5, 5, 5]);
    b.stopSupply(); await vi.waitFor(() => expect(a.has(f.file)).toBe(false));
    await expect(a.acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow('No authorized peer');
  } finally { f.close(); }
});

it('retains cumulative supply accounting across acquisitions and fails closed after shutdown', async () => {
  const f = await fixture(), [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    await a.acquire(f.file, { signal: new AbortController().signal });
    expect(b.getState().suppliedBytes).toBe(5);
    a.close(); await expect(a.acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow('closed');
  } finally { f.close(); }
});

it('ignores malformed inventories and rejects invalid descriptors before allocating a transfer', async () => {
  const f = await fixture(), [a, b] = f.owners;
  try {
    for (const artifact of [null, {}, { ...f.file, path: '../shard.bin' }, { ...f.file, sizeBytes: -1 }]) {
      f.stores[0].get('reploid:custody-offer')('1', { artifacts: [artifact] });
      expect(a.has(f.file)).toBe(false);
      expect(() => b.offer([artifact])).toThrow('Invalid file inventory');
      await expect(a.acquire(artifact, { signal: new AbortController().signal })).rejects.toThrow('Invalid file acquisition');
    }
    expect(f.reads).not.toHaveBeenCalled();
  } finally { f.close(); }
});

it('stop while artifact verification is pending does not publish a late custody grant', async () => {
  const f = await fixture(), [a, b] = f.owners;
  let finish; f.reads.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    const acquisition = a.acquire(f.file, { signal: new AbortController().signal });
    const failure = expect(acquisition).rejects.toThrow('stopped');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    b.stopSupply(); finish(f.bytes); await failure;
    expect(f.receipts).toEqual([]); expect(b.getState().sharing).toBe(false);
  } finally { f.close(); }
});

it('resumes an interrupted acquisition from verified checkpoints under a fresh grant', async () => {
  const controller = new AbortController();
  const f = await fixture({ afterCheckpoint: () => controller.abort(new Error('interrupted')) });
  const [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    await expect(a.acquire(f.file, { signal: controller.signal })).rejects.toThrow();
    expect(await a.acquire(f.file, { signal: new AbortController().signal })).toEqual(f.bytes);
    expect(f.receipts[0].failure).toBeTruthy();
    expect(f.receipts[1]).toMatchObject({ cacheBytes: 2, receivedBytes: 3, source: 'cache-and-peer' });
    expect(f.receipts[0].transferId).not.toBe(f.receipts[1].transferId);
  } finally { f.close(); }
});

it('coalesces auxiliary channel creation for simultaneous transfers in both directions', async () => {
  const f = await fixture(), [a, b] = f.owners;
  try {
    a.offer([f.file]); b.offer([f.file]);
    await vi.waitFor(() => { expect(a.has(f.file)).toBe(true); expect(b.has(f.file)).toBe(true); });
    const results = await Promise.all([a, b].map(owner => owner.acquire(f.file, { signal: new AbortController().signal })));
    expect(results).toEqual([f.bytes, f.bytes]);
  } finally { f.close(); }
});

it('recovers from supplier failure through another authorized supplier without an origin', async () => {
  const f = await fixture({ count: 3 }), [a, b, c] = f.owners;
  try {
    f.reads.mockImplementation(async (_file, _controls, supplier) => {
      if (supplier === 1) throw new Error('Supplier disappeared');
      return f.bytes.slice();
    });
    b.offer([f.file]); c.offer([f.file]);
    await vi.waitFor(() => expect(a.getState().peers).toHaveLength(2));
    expect(await a.acquire(f.file, { signal: new AbortController().signal })).toEqual(f.bytes);
    expect(f.reads.mock.calls.map(call => call[2])).toEqual([1, 2]);
    expect(a.getState().pending).toBe(0);
    expect(f.receipts).toHaveLength(1);
  } finally { f.close(); }
});

it('does not exceed acquisition slots while streams are active or dispatch a fallback after cancellation', async () => {
  const f = await fixture({ count: 3 }), [a, b, c] = f.owners;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    f.reads.mockImplementation(async () => { await held; return f.bytes.slice(); });
    b.offer([f.file]); c.offer([f.file]);
    await vi.waitFor(() => expect(a.getState().peers).toHaveLength(2));
    const controller = new AbortController();
    const first = a.acquire(f.file, { signal: controller.signal });
    const second = a.acquire(f.file, { signal: controller.signal });
    const settled = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(f.reads).toHaveBeenCalledTimes(2));
    await expect(a.acquire(f.file, { signal: controller.signal })).rejects.toThrow('limit');
    controller.abort(new Error('Stop this acquisition'));
    expect((await settled).every(result => result.status === 'rejected')).toBe(true);
    expect(f.reads.mock.calls.every(call => call[2] === 1)).toBe(true);
    expect(a.getState().pending).toBe(0);
  } finally { release(); f.close(); }
});

it('bounds inventory retention independently of connected peer count', async () => {
  const f = await fixture({ count: 3, maxPeers: 1 });
  try {
    f.owners[1].offer([f.file]); f.owners[2].offer([f.file]);
    await vi.waitFor(() => expect(f.owners[0].getState().peers).toHaveLength(1));
    expect(f.owners[0].has(f.file)).toBe(true);
    expect(f.reads).not.toHaveBeenCalled();
  } finally { f.close(); }
});

it('releases staging bytes after verified persistence and never retries a local storage failure on another supplier', async () => {
  const commitArtifact = vi.fn(async () => {});
  const f = await fixture({ count: 3, commitArtifact }), [a, b, c] = f.owners;
  try {
    b.offer([f.file]); c.offer([f.file]);
    await vi.waitFor(() => expect(a.getState().peers).toHaveLength(2));
    await a.acquire(f.file, { signal: new AbortController().signal });
    await a.acquire(f.file, { signal: new AbortController().signal });
    expect(f.receipts.map(receipt => receipt.cacheBytes)).toEqual([0, 0]);
    expect(commitArtifact).toHaveBeenCalledTimes(2);
    commitArtifact.mockRejectedValueOnce(new Error('Quota exceeded'));
    f.reads.mockClear();
    await expect(a.acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow('Verified file could not be retained');
    expect(f.reads).toHaveBeenCalledOnce();
  } finally { f.close(); }
});
