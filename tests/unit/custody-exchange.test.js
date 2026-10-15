import { describe, it, expect, vi } from 'vitest';
import { createCustodyExchange } from '../../packages/reploid/src/artifacts/custody/exchange.js';
import { CUSTODY_CERTIFICATE_LIFETIME_MS, checkCustodyKeyCertificate, createCustodyKeyCertifier } from '../../packages/reploid/src/artifacts/custody-certificate.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
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
async function fixture({ afterCheckpoint = () => {}, count = 2, maxPeers = 16, maxSupplyBytes = 100, commitArtifact, onChange = () => {}, clockOffsets = [], grantMs = [], supplierGrant = () => {}, supplyBudgets = [], sendResult = () => true, onSupplier = () => {}, timeoutMs = 1000, down = new Set(), certify = null } = {}) {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]), stores = Array.from({ length: count }, () => new Map()), callbacks = [], owners = [], receipts = [], requests = [], deliveries = [];
  const file = { path: 'shard.bin', role: 'model-weights', sizeBytes: 5, hash: (await sha256Hex(bytes)).slice(7), hashAlgorithm: 'sha256' };
  const policy = { maxTransfers: 2, maxPeers, maxAcquisitionAttempts: 4, maxSupplyBytes, maxArtifactBytes: 20, maxInventoryFiles: 128, grantMs: 5000,
    channel: { maxFrameBytes: 128, maxControlBytes: 4096, maxChunkBytes: 2,
      maxBufferedBytes: 8192, maxPendingRequests: 2, maxTransferBytes: 1048576, timeoutMs } };
  const reads = vi.fn(async () => bytes.slice());
  for (let i = 0; i < count; i++) {
    const pair = await createSigningKeyPair(), publicKey = await exportPublicKey(pair.publicKey);
    let durableReserved = 0;
    const supplyBudget = supplyBudgets[i] || { getState: () => ({ reservedBytes: durableReserved, maxBytes: maxSupplyBytes }),
      async reserve(bytes) { if (durableReserved + bytes > maxSupplyBytes) throw new Error('File contribution limit reached'); durableReserved += bytes; return this.getState(); } };
    const checkpoints = new Map();
    // A peer id in `down` is disconnected from everyone until it is removed again.
    const transport = { getConnectedPeers: () => stores.map((_, index) => ({ id: String(index) }))
      .filter(peer => peer.id !== String(i) && !down.has(peer.id) && !down.has(String(i))),
      onMessage: (type, handler) => stores[i].set(type, handler),
      sendToPeer: (peer, type, payload) => {
        if (!sendResult(i, peer, type, payload)) return false;
        if (type === 'reploid:custody-request' && payload.maxExpiresAt !== undefined) requests.push(structuredClone(payload));
        queueMicrotask(() => stores[Number(peer)].get(type)?.(String(i), structuredClone(payload))); return true;
      },
      broadcast(type, payload) { for (const peer of this.getConnectedPeers()) this.sendToPeer(peer.id, type, payload); },
      onDataChannel: (_, callback) => { callbacks[i] = callback; return () => {}; },
      openDataChannel(peer) { const [left, right] = channelPair(); callbacks[Number(peer)](String(i), right); return left; }
    };
    owners.push(createCustodyExchange({ transport, identity: { peerId: String(i), privateKey: pair.privateKey, publicKey },
      policy: { ...policy, grantMs: grantMs[i] ?? policy.grantMs },
      ports: { supplyBudget, now: () => Date.now() + (clockOffsets[i] || 0),
        createSupplier: async options => { supplierGrant(options.authorization, i); const supplier = await createPeerPackSupplier(options); onSupplier(supplier, i); return supplier; }, createStore: createPeerPackArtifactStore,
        createChannel: createPeerPackDataChannel, readArtifact: (file, controls) => reads(file, controls, i),
        async verifyArtifact(descriptor, data) { if (await sha256Hex(data) !== 'sha256:' + descriptor.hash) throw new Error('integrity'); },
        commitArtifact,
        checkpoints: {
          getChunk: async chunk => checkpoints.get(chunk.hash)?.slice() || null,
          putChunk: async (chunk, data) => { checkpoints.set(chunk.hash, data.slice()); afterCheckpoint(chunk); },
          deleteChunk: async chunk => { checkpoints.delete(chunk.hash); }
        },
        hash: hashDopplerEvidence, hashBytes: sha256Hex, observe: receipt => receipts.push(receipt),
        observeDelivery: record => deliveries.push({ owner: i, ...record }),
        ...(certify?.(i) ? { certificate: certify(i)({ custodyPeerId: String(i), custodyPublicKey: publicKey, privateKey: pair.privateKey }) } : {}),
        onChange: () => onChange(i) } }));
  }
  return { owners, file, bytes, reads, receipts, stores, requests, deliveries, close: () => owners.forEach(owner => owner.close()) };
}

it('cannot renew the supply allowance by refreshing inventory or stopping and restarting', async () => {
  const f = await fixture({ maxSupplyBytes: 5 }), [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    await a.acquire(f.file, { signal: new AbortController().signal });
    for (const stop of [false, true]) {
      if (stop) b.stopSupply();
      b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
      expect(b.getState().suppliedBytes).toBe(5);
      await expect(a.acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow();
      expect(b.getState().suppliedBytes).toBe(5);
    }
    expect(f.reads).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it.each([[0, 250], [250, 0]])('acquires signed files in both directions with peer clock offsets %d/%d', async (firstOffset, secondOffset) => {
  const f = await fixture({ clockOffsets: [firstOffset, secondOffset] }), [a, b] = f.owners;
  try {
    a.offer([f.file]); b.offer([f.file]);
    await vi.waitFor(() => { expect(a.has(f.file)).toBe(true); expect(b.has(f.file)).toBe(true); });
    expect(await a.acquire(f.file, { signal: new AbortController().signal })).toEqual(f.bytes);
    expect(await b.acquire(f.file, { signal: new AbortController().signal })).toEqual(f.bytes);
  } finally { f.close(); }
});

it('clips a supplier grant to the requester allowance while preserving signed verification', async () => {
  let expiry;
  const f = await fixture({ grantMs: [2000, 5000], supplierGrant: grant => { expiry = grant.expiresAt; } });
  const [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    expect(await a.acquire(f.file, { signal: new AbortController().signal })).toEqual(f.bytes);
    expect(expiry).toBe(f.requests[0].maxExpiresAt);
    expect(f.receipts).toHaveLength(1);
  } finally { f.close(); }
});

it('rejects a correctly signed supplier grant that expands the requested expiry', async () => {
  const f = await fixture({ supplierGrant: grant => { grant.expiresAt += 1000; } }), [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    await expect(a.acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow('File grant exceeds requested acquisition');
    expect(f.receipts).toEqual([]);
  } finally { f.close(); }
});
it('acquires only an authenticated range of an approved file and rejects invalid ranges', async () => {
  const f = await fixture(); const [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    const bytes = f.bytes.slice(1, 4), range = { offset: 1, size: 3, identity: await sha256Hex(bytes) };
    expect(await a.acquire(f.file, { signal: new AbortController().signal, range })).toEqual(bytes);
    expect(f.receipts.at(-1).receivedBytes).toBe(3);
    expect(f.receipts.at(-1).maxConcurrentChunks).toBe(2);
    expect(f.receipts.at(-1).peakInFlightBytes).toBeLessThanOrEqual(4);
    expect(f.receipts.at(-1).completed[0].sizeBytes).toBe(3);
    await expect(a.acquire(f.file, { signal: new AbortController().signal,
      range: { ...range, offset: 4 } })).rejects.toThrow('Invalid verified file range');
    await expect(a.acquire(f.file, { signal: new AbortController().signal,
      range: { ...range, identity: 'sha256:' + '0'.repeat(64) } })).rejects.toThrow();
  } finally { f.close(); }
});

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

it('offers and transfers a signed catalog file named by a relative path, as full-model seeding does', async () => {
  // Run 7: full-model seeding offers every catalog file, and signed catalogs name program files
  // under artifacts/...; the flat-name rule rejected the whole inventory ("Invalid file inventory").
  const f = await fixture(), [a, b] = f.owners, nested = { ...f.file, path: 'artifacts/program/host/text-generation.js', role: 'host-source' };
  try {
    b.offer([f.file, nested]); await vi.waitFor(() => expect(a.has(nested)).toBe(true));
    expect(await a.acquire(nested, { signal: new AbortController().signal })).toEqual(f.bytes);
    expect(a.has({ ...nested, path: 'artifacts/program/host/other.js' })).toBe(false);
  } finally { f.close(); }
});

it('ignores malformed inventories and rejects invalid descriptors before allocating a transfer', async () => {
  const f = await fixture(), [a, b] = f.owners;
  try {
    for (const artifact of [null, {}, { ...f.file, path: '../shard.bin' }, { ...f.file, path: '/abs/shard.bin' }, { ...f.file, path: 'a//shard.bin' },
      { ...f.file, path: 'a/./shard.bin' }, { ...f.file, path: 'a/../shard.bin' }, { ...f.file, path: 'artifacts/' }, { ...f.file, sizeBytes: -1 }]) {
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
    let settled = false;
    const stopping = b.stopSupply().then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    finish(f.bytes); await stopping; await failure;
    expect(f.receipts).toEqual([]); expect(b.getState().sharing).toBe(false);
  } finally { f.close(); }
});

it('replaces an approved inventory without advertising a false withdrawal', async () => {
  const observed = [], sharing = [];
  let capture = false;
  const f = await fixture({ onChange: index => {
    if (!capture) return;
    if (index === 0) observed.push(f.owners[0].has(f.file));
    if (index === 1) sharing.push(f.owners[1].getState().sharing);
  } });
  const [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    capture = true;
    b.offer([f.file]);
    await vi.waitFor(() => expect(observed.length).toBeGreaterThan(0));
    expect(observed.every(Boolean)).toBe(true);
    expect(sharing.every(Boolean)).toBe(true);
    capture = false;
    expect(await a.acquire(f.file, { signal: new AbortController().signal })).toEqual(f.bytes);
    b.offer([]); await vi.waitFor(() => expect(a.has(f.file)).toBe(false));
    await expect(a.acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow('No authorized peer');
  } finally { f.close(); }
});

it('replacing an inventory revokes a pending grant even when the file remains offered', async () => {
  const f = await fixture(), [a, b] = f.owners;
  let finish; f.reads.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    const acquisition = a.acquire(f.file, { signal: new AbortController().signal });
    const failure = expect(acquisition).rejects.toThrow('stopped');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    b.offer([f.file]); finish(f.bytes); await failure;
    expect(f.receipts).toEqual([]);
    expect(await a.acquire(f.file, { signal: new AbortController().signal })).toEqual(f.bytes);
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

it('persists the supply reservation before reading bytes or issuing a grant', async () => {
  const reserve = vi.fn(async () => { throw new Error('Durable budget unavailable'); });
  const f = await fixture({ supplyBudgets: [null, { getState: () => ({ reservedBytes: 0, maxBytes: 100 }), reserve }] });
  try {
    f.owners[1].offer([f.file]); await vi.waitFor(() => expect(f.owners[0].has(f.file)).toBe(true));
    await expect(f.owners[0].acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow('Durable budget unavailable');
    expect(reserve).toHaveBeenCalledWith(5); expect(f.reads).not.toHaveBeenCalled();
  } finally { await Promise.all(f.owners.map(owner => owner.close())); }
});


it.each(['false', 'throw'])('settles a supplier whose authorization response send returns %s', async mode => {
  let rejectOffer = true;
  const suppliers = [];
  const f = await fixture({
    sendResult: (_, peer, type, payload) => {
      if (rejectOffer && type === 'reploid:custody-response' && payload.authorization) {
        if (mode === 'throw') throw new Error('offer send threw');
        return false;
      }
      return true;
    },
    onSupplier: supplier => { vi.spyOn(supplier, 'close'); suppliers.push(supplier); }
  });
  const [a,b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    // More rejections than the simultaneous-transfer ceiling must leave no ghost owners.
    for (let i=0;i<3;i++) {
      await expect(a.acquire(f.file,{signal:new AbortController().signal})).rejects.toThrow(mode === 'throw' ? 'offer send threw' : 'File offer response could not be queued');
      expect(suppliers[i].close).toHaveBeenCalledOnce();
    }
    expect(b.getState().suppliedBytes).toBe(15); // A failed send cannot renew consent.
    rejectOffer = false;
    expect(await a.acquire(f.file,{signal:new AbortController().signal})).toEqual(f.bytes);
    expect(b.getState().suppliedBytes).toBe(20);
  } finally {await f.close();}
});

it('reserves acquisition chunks before transfer and charges no verified checkpoint hits', async () => {
  let reserved = 0, transferred = 0;
  const f = await fixture({ onSupplier: supplier => {
    const serve = supplier.serve.bind(supplier);
    vi.spyOn(supplier, 'serve').mockImplementation(async request => {
      expect(reserved).toBeGreaterThanOrEqual(transferred + request.sizeBytes);
      transferred += request.sizeBytes; return serve(request);
    });
  } });
  const [a, b] = f.owners;
  const reserveDownload = vi.fn(async bytes => { reserved += bytes; });
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    expect(await a.acquire(f.file, { signal: new AbortController().signal, reserveDownload })).toEqual(f.bytes);
    expect(reserved).toBe(5); expect(transferred).toBe(5);
    expect(await a.acquire(f.file, { signal: new AbortController().signal, reserveDownload })).toEqual(f.bytes);
    expect(reserved).toBe(5); expect(reserveDownload).toHaveBeenCalledTimes(3);
  } finally { await f.close(); }
});

it('failed acquisition reservations block payloads and retain their original accounting error', async () => {
  const serve = vi.fn();
  const f = await fixture({ count: 3, onSupplier: supplier => {
    const original = supplier.serve.bind(supplier);
    vi.spyOn(supplier, 'serve').mockImplementation(request => { serve(); return original(request); });
  } });
  try {
    for (const owner of f.owners.slice(1)) owner.offer([f.file]);
    const a = f.owners[0]; await vi.waitFor(() => expect(a.getState().peers).toHaveLength(2));
    const denied = Object.assign(new Error('Download allowance exhausted'), { code: 'CUSTODY_BUDGET_LIMIT' });
    await expect(a.acquire(f.file, { signal: new AbortController().signal, reserveDownload: async () => { throw denied; } })).rejects.toBe(denied);
    expect(serve).not.toHaveBeenCalled(); expect(f.reads).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});


it('settling local supply does not wait for unrelated acquisition', async () => {
  const f=await fixture(), [a,b]=f.owners;
  let finish;f.reads.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  try {
    b.offer([f.file]);await vi.waitFor(()=>expect(a.has(f.file)).toBe(true));
    const acquisition=a.acquire(f.file,{signal:new AbortController().signal});
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    await a.stopSupply();expect(a.getState().pending).toBe(1);
    finish(f.bytes);expect(await acquisition).toEqual(f.bytes);
  } finally {await f.close();}
});

it('retains failed chunk reservations when retrying another authorized supplier', async () => {
  let reserved=0;
  const f=await fixture({count:3,onSupplier:(supplier,index)=>{
    if(index===1)vi.spyOn(supplier,'serve').mockRejectedValue(new Error('Failed payload attempt'));
  }});
  const [a,b,c]=f.owners;
  try {
    b.offer([f.file]);c.offer([f.file]);await vi.waitFor(()=>expect(a.getState().peers).toHaveLength(2));
    expect(await a.acquire(f.file,{signal:new AbortController().signal,reserveDownload:async bytes=>{reserved+=bytes;}})).toEqual(f.bytes);
    expect(reserved).toBeGreaterThan(5);expect(f.receipts.some(r=>r.failure)).toBe(true);
  } finally {await f.close();}
});

// A supplier whose first answer for one chunk never arrives, as during a network stall.
const stallOnce = (chunkIndex, onStall = () => {}) => {
  let stalled = false;
  return supplier => {
    const serve = supplier.serve.bind(supplier);
    vi.spyOn(supplier, 'serve').mockImplementation(request => {
      if (request.chunkIndex !== chunkIndex || stalled) return serve(request);
      stalled = true; onStall(); return new Promise(() => {});
    });
  };
};

it('asks a stalled supplier again under a fresh grant and resumes from verified checkpoints', async () => {
  let reserved = 0;
  const f = await fixture({ timeoutMs: 200, onSupplier: stallOnce(2) }), [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    expect(await a.acquire(f.file, { signal: new AbortController().signal, reserveDownload: async bytes => { reserved += bytes; } })).toEqual(f.bytes);
    expect(f.requests).toHaveLength(2);
    expect(f.receipts).toHaveLength(2);
    expect(f.receipts[0].failure).toBe('Pack custody: no authorized supplier completed shard.bin chunk 2');
    expect(f.receipts[0].attempts.find(item => item.chunkIndex === 2).error).toBe('Pack custody: supplier timeout');
    expect(f.receipts[1]).toMatchObject({ cacheBytes: 4, receivedBytes: 1, source: 'cache-and-peer' });
    expect(f.receipts[0].transferId).not.toBe(f.receipts[1].transferId);
    // The stalled chunk stays charged; verified checkpoint hits are not charged again.
    expect(reserved).toBe(6);
  } finally { f.close(); }
});

it('waits for a disconnected supplier to offer the file again before asking it under a fresh grant', async () => {
  const down = new Set();
  const f = await fixture({ down, onSupplier: stallOnce(2, () => down.add('1')) }), [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    const acquisition = a.acquire(f.file, { signal: new AbortController().signal });
    await vi.waitFor(() => expect(f.receipts).toHaveLength(1), { timeout: 2000 });
    expect(a.has(f.file)).toBe(false);
    down.delete('1'); b.announce();
    expect(await acquisition).toEqual(f.bytes);
    expect(f.requests).toHaveLength(2);
    expect(f.receipts[1]).toMatchObject({ cacheBytes: 4, receivedBytes: 1 });
  } finally { f.close(); }
});

it('does not ask a supplier again after it delivered invalid bytes', async () => {
  const f = await fixture({ onSupplier: supplier => {
    const serve = supplier.serve.bind(supplier);
    vi.spyOn(supplier, 'serve').mockImplementation(async request => {
      const response = await serve(request);
      return { ...response, bytes: response.bytes.map(value => value ^ 1) };
    });
  } }), [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    await expect(a.acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow('no authorized supplier completed shard.bin');
    expect(f.requests).toHaveLength(1);
    expect(f.receipts).toHaveLength(1);
    expect(f.receipts[0].attempts.some(item => item.error === 'Pack custody: chunk integrity mismatch')).toBe(true);
  } finally { f.close(); }
});

it('stops after the configured number of grants when a supplier never answers', async () => {
  const f = await fixture({ timeoutMs: 100, onSupplier: supplier => {
    vi.spyOn(supplier, 'serve').mockImplementation(() => new Promise(() => {}));
  } }), [a, b] = f.owners;
  try {
    b.offer([f.file]); await vi.waitFor(() => expect(a.has(f.file)).toBe(true));
    const error = await a.acquire(f.file, { signal: new AbortController().signal }).catch(cause => cause);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(4);
    expect(error.errors.every(cause => cause.code === 'CUSTODY_SUPPLIER_UNAVAILABLE')).toBe(true);
    expect(f.requests).toHaveLength(4);
    expect(a.getState().pending).toBe(0);
  } finally { f.close(); }
});

describe('identity certificates beside custody grants', () => {
  const certifierFor = identities => i => identities[i] ? ({ custodyPeerId, custodyPublicKey }) => {
    const certifier = createCustodyKeyCertifier({ identity: identities[i] });
    return () => certifier.certify({ custodyPeerId, custodyPublicKey });
  } : null;
  const transfer = async f => {
    const [requester, supplier] = f.owners;
    supplier.offer([f.file]); await vi.waitFor(() => expect(requester.has(f.file)).toBe(true));
    await requester.acquire(f.file, { signal: new AbortController().signal });
    return { requesterRecord: f.deliveries.find(row => row.owner === 0), supplierRecord: f.deliveries.find(row => row.owner === 1) };
  };

  it('carries each party\'s certificate to the other and records transfer evidence on both sides', async () => {
    const identities = [await createSigningIdentity({ algorithm: 'ECDSA' }), await createSigningIdentity({ algorithm: 'Ed25519' })];
    const f = await fixture({ certify: certifierFor(identities) });
    try {
      const { requesterRecord, supplierRecord } = await transfer(f);
      const { requester, supplier } = requesterRecord.certificates;
      expect(requester).toMatchObject({ participantId: identities[0].peerId, custodyPeerId: '0' });
      expect(supplier).toMatchObject({ participantId: identities[1].peerId, custodyPeerId: '1' });
      // Each certificate is signed by its participant identity over the custody key the grant names.
      for (const [index, certificate] of [requester, supplier].entries()) {
        expect(await checkCustodyKeyCertificate(certificate, { publicJwk: identities[index].publicJwk, atMs: Date.now(),
          maxLifetimeMs: CUSTODY_CERTIFICATE_LIFETIME_MS, maxClockSkewMs: 0 })).toEqual([]);
      }
      expect(requester.custodyPublicKey).toBe(requesterRecord.authorization.requester.publicKey);
      expect(supplier.custodyPublicKey).toBe(requesterRecord.authorization.suppliers[0].publicKey);
      expect(requesterRecord).toMatchObject({ role: 'requester', peerId: '1', transferId: requesterRecord.authorization.transferId,
        receipt: { schema: 'reploid.pool.pack-custody-receipt/v1', transferId: requesterRecord.authorization.transferId } });
      expect(requesterRecord.index.artifactSetIdentity).toBe(requesterRecord.authorization.artifactSet.identity);
      // The supplier holds the same grant and the requester's certificate; certificates stay outside the grant.
      expect(supplierRecord).toMatchObject({ role: 'supplier', peerId: '0', receipt: null, certificates: { requester, supplier } });
      expect(supplierRecord.authorization).toEqual(requesterRecord.authorization);
      expect(JSON.stringify(requesterRecord.authorization)).not.toContain('certificate');
      expect(f.requests.at(-1).requesterCertificate).toEqual(requester);
    } finally { f.close(); }
  });

  it('interoperates with uncertified peers and drops certificates not bound to the grant key', async () => {
    const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
    const f = await fixture({ certify: certifierFor([null, identity]) });
    try {
      const { requesterRecord, supplierRecord } = await transfer(f);
      expect(requesterRecord.certificates).toMatchObject({ requester: null, supplier: { participantId: identity.peerId } });
      expect(supplierRecord.certificates.requester).toBeNull();
      expect(f.requests.at(-1)).not.toHaveProperty('requesterCertificate');
    } finally { f.close(); }

    // A certificate naming another custody key is neither sent by its host nor kept by a peer.
    const foreign = await createSigningKeyPair();
    const other = await createSigningIdentity({ algorithm: 'Ed25519' });
    const misbound = await createSigningIdentity({ algorithm: 'Ed25519' });
    const forged = await createCustodyKeyCertifier({ identity: misbound })
      .certify({ custodyPeerId: '0', custodyPublicKey: await exportPublicKey(foreign.publicKey) });
    const g = await fixture({
      certify: i => i === 1 ? ({ custodyPeerId, custodyPublicKey }) => {
        const certifier = createCustodyKeyCertifier({ identity: other });
        return () => certifier.certify({ custodyPeerId, custodyPublicKey: custodyPeerId === '1' ? 'not-this-key' : custodyPublicKey });
      } : null,
      sendResult: (from, peer, type, payload) => {
        if (type === 'reploid:custody-request' && payload.artifact) payload.requesterCertificate = forged;
        return true;
      }
    });
    try {
      const { requesterRecord, supplierRecord } = await transfer(g);
      expect(requesterRecord.certificates).toEqual({ requester: null, supplier: null });
      expect(supplierRecord.certificates).toEqual({ requester: null, supplier: null });
    } finally { g.close(); }
  });
});
