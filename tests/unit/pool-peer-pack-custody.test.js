import { describe, expect, it, vi } from 'vitest';
import { createPeerPackArtifactStore } from '../../self/pool/peer-pack-custody.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { sha256Hex, signCanonical } from '../../self/pool/inference-receipt.js';
import { createCustodyFixture } from '../fixtures/peer-pack-custody.js';

const digest = (digit) => `sha256:${digit.repeat(64)}`;
async function fixture(limits = {}) {
  const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7]);
  const artifacts = [{ artifactId: 'weights', role: 'weight-shard', path: 'weights.bin', hash: await sha256Hex(bytes), sizeBytes: bytes.length }];
  const pack = { schema: 'doppler.pack/v3', packId: 'fixture-pack', semanticRoot: digest('a'), envelopeDigest: digest('b'),
    artifactClosureDigest: await hashDopplerEvidence(artifacts), artifacts, requiredOperation: 'encodeSequence', acceptedTargetPlanDigests: [digest('c')] };
  return createCustodyFixture(pack, new Map([['weights', bytes]]), 2, limits);
}
const read = (store, f) => store.readArtifact(f.authorization.pack.artifacts[0]);

describe('peer-only exact Pack dependency custody', () => {
  it('reconstructs complementary peer chunks, rejects corruption and recovers supplier loss without fetch', async () => {
    const f = await fixture();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('origin disabled'));
    const store = await createPeerPackArtifactStore(f.options);
    try {
      expect(await read(store, f)).toEqual(f.artifactBytes.get('weights'));
      const receipt = store.getReceipt();
      expect(receipt.attempts.filter((item) => item.status === 'accepted').map((item) => item.peerId)).toEqual(['even', 'odd', 'even', 'odd']);
      expect(receipt.attempts.filter((item) => item.status === 'rejected')).toHaveLength(4);
      expect(receipt.attempts[0].error).toContain('integrity');
      expect(receipt.attempts[2].error).toContain('interruption');
      expect(receipt.reservedBytes).toBe(14);
      expect(receipt.attempts.reduce((sum, item) => sum + item.receivedBytes, 0)).toBe(11);
      expect(receipt.verificationBytes).toBe(18);
      expect(receipt.completed).toHaveLength(1);
      expect(receipt.relayBytes).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      receipt.completed.length = 0;
      expect(store.getReceipt().completed).toHaveLength(1);
    } finally { store.close(); fetchSpy.mockRestore(); }
  });

  it('rejects unpinned indexes, wrong closures, expiry, and duplicate or forged inventories before transfer', async () => {
    const f = await fixture();
    const transport = vi.fn();
    for (const field of ['envelopeDigest', 'artifactClosureDigest']) {
      const index = { ...f.index, [field]: digest('f') };
      await expect(createPeerPackArtifactStore({ ...f.options, index, requestChunk: transport })).rejects.toThrow('index');
    }
    const forgedIndex = structuredClone(f.index);
    forgedIndex.artifacts[0].chunks[0].hash = digest('f');
    await expect(createPeerPackArtifactStore({ ...f.options, index: forgedIndex })).rejects.toThrow('unauthorized');
    const forgedInventory = structuredClone(f.options.inventories);
    forgedInventory[0].maxBytes--;
    await expect(createPeerPackArtifactStore({ ...f.options, inventories: forgedInventory })).rejects.toThrow('signature');
    await expect(createPeerPackArtifactStore({ ...f.options, now: () => f.authorization.expiresAt })).rejects.toThrow('expired');
    await expect(createPeerPackArtifactStore({ ...f.options, inventories: [f.options.inventories[0], f.options.inventories[0]] })).rejects.toThrow('duplicate');
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects gaps even if the requester pinned the malformed index', async () => {
    const f = await fixture();
    const index = structuredClone(f.index);
    index.artifacts[0].chunks[1].offset++;
    const authorization = { ...f.authorization, indexDigest: await hashDopplerEvidence(index) };
    await expect(createPeerPackArtifactStore({ ...f.options, index, authorization })).rejects.toThrow('geometry');
  });

  it('rejects undeclared artifacts, unavailable chunks, and unauthorized serving requests', async () => {
    const f = await fixture();
    const store = await createPeerPackArtifactStore({ ...f.options, inventories: [f.options.inventories[1]] });
    try {
      await expect(store.readArtifact({ ...f.authorization.pack.artifacts[0], path: 'other' })).rejects.toThrow('closure');
      await expect(read(store, f)).rejects.toThrow('no authorized supplier');
      expect(store.getReceipt().completed).toEqual([]);
    } finally { store.close(); }
    const supplier = f.suppliers.get('even');
    const normal = await createPeerPackArtifactStore(f.options);
    await read(normal, f);
    const request = f.requests.find((item) => item.supplierPeerId === 'even');
    const forged = { ...request, sizeBytes: 100 };
    await expect(supplier.serve(forged)).rejects.toThrow('range');
    const wrongRequester = { ...request, requesterPeerId: 'intruder' };
    await expect(supplier.serve(wrongRequester)).rejects.toThrow('binding');
    const wrongAttempt = { ...request, attempt: 2 };
    await expect(supplier.serve(wrongAttempt)).rejects.toThrow('binding');
    const { signature, ...body } = request;
    await expect(supplier.serve({ ...body, signature: await signCanonical(body, f.keys[1].privateKey, { domain: body.schema }) })).rejects.toThrow('signature');
    normal.close();
  });

  it('rejects replayed responses while allowing a different authorized supplier to finish', async () => {
    const f = await fixture();
    let saved;
    const store = await createPeerPackArtifactStore({ ...f.options, requestChunk: async (peer, request) => {
      if (peer === 'faulty') {
        if (!saved) saved = await f.suppliers.get(peer).serve(request);
        return saved;
      }
      return f.suppliers.get(peer).serve(request);
    } });
    try {
      expect(await read(store, f)).toEqual(f.artifactBytes.get('weights'));
      expect(store.getReceipt().attempts.some((item) => item.error?.includes('binding mismatch'))).toBe(true);
    } finally { store.close(); }
  });

  it('rejects stale completions after close', async () => {
    const f = await fixture();
    let unblock;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const store = await createPeerPackArtifactStore({ ...f.options, requestChunk: async (peer, request) => {
      const response = await f.suppliers.get(peer).serve(request);
      entered();
      await new Promise((resolve) => { unblock = resolve; });
      return response;
    } });
    const pending = read(store, f);
    await started;
    const rejected = expect(pending).rejects.toThrow('closed or cancelled');
    store.close();
    unblock();
    await rejected;
    await expect(read(store, f)).rejects.toThrow('closed or cancelled');
    expect(store.getReceipt().completed).toEqual([]);
  });

  it('bounds unresponsive suppliers and uses remaining authorized sources', async () => {
    const f = await fixture({ requestTimeoutMs: 10 });
    const store = await createPeerPackArtifactStore({ ...f.options, requestChunk: (peer, request) => {
      if (peer === 'faulty') return new Promise(() => {});
      return f.suppliers.get(peer).serve(request);
    } });
    try {
      expect(await read(store, f)).toEqual(f.artifactBytes.get('weights'));
      expect(store.getReceipt().attempts.filter((item) => item.error?.includes('timeout'))).toHaveLength(4);
    } finally { store.close(); }
  });

  it('charges retries against the transfer budget and fails closed when it is exhausted', async () => {
    const f = await fixture({ maxTransferBytes: 14 });
    const store = await createPeerPackArtifactStore(f.options);
    try {
      await read(store, f);
      await expect(read(store, f)).rejects.toThrow('budget exhausted');
      expect(store.getReceipt().reservedBytes).toBe(14);
      // A supplier also limits repeated valid requests, independently of the receiver.
      const request = f.requests.find((item) => item.supplierPeerId === 'even');
      const supplier = f.suppliers.get('even');
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => supplier.serve(request)));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(3);
    } finally { store.close(); }
  });

  it('verifies final artifact bytes even when a pinned chunk index commits to wrong bytes', async () => {
    const f = await fixture();
    const wrong = new Map([['weights', Uint8Array.from([9, 2, 3, 4, 5, 6, 7])]]);
    const poisoned = await createCustodyFixture(f.authorization.pack, wrong);
    const store = await createPeerPackArtifactStore({ ...poisoned.options,
      requestChunk: (peer, request) => poisoned.suppliers.get(peer).serve(request) });
    try {
      await expect(read(store, poisoned)).rejects.toThrow('reconstructed artifact integrity mismatch');
      expect(store.getReceipt().completed).toHaveLength(0);
    } finally { store.close(); }
  });

  it('rejects expiry during a transfer and suppresses queued reads after cancellation', async () => {
    const f = await fixture();
    let currentTime = 1000;
    const controller = new AbortController();
    const store = await createPeerPackArtifactStore({ ...f.options, signal: controller.signal, now: () => currentTime,
      requestChunk: async (peer, request) => {
        const response = await f.suppliers.get(peer).serve(request);
        currentTime = f.authorization.expiresAt;
        return response;
      } });
    try {
      await expect(read(store, f)).rejects.toThrow('authorization expired');
      controller.abort();
      await expect(read(store, f)).rejects.toThrow('closed or cancelled');
      expect(store.getReceipt().completed).toEqual([]);
    } finally { store.close(); }
  });

  it('snapshots authorization and inventory so caller mutation cannot expand authority', async () => {
    const f = await fixture();
    const artifact = structuredClone(f.authorization.pack.artifacts[0]);
    const store = await createPeerPackArtifactStore(f.options);
    f.authorization.pack.artifacts[0].path = 'outside.bin';
    f.options.inventories[1].artifacts[0].chunkIndexes.length = 0;
    try { expect(await store.readArtifact(artifact)).toEqual(f.artifactBytes.get('weights')); }
    finally { store.close(); }
  });
});
