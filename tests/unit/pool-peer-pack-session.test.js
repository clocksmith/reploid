import { describe, expect, it, vi } from 'vitest';
import { openPeerPack } from '../../self/pool/peer-pack-session.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { sha256Hex } from '../../self/pool/inference-receipt.js';
import { createCustodyFixture } from '../fixtures/peer-pack-custody.js';
import { resolveDopplerExecutionContract } from '../../self/config/doppler-execution-contracts.js';

// Real signed chunk custody; synthetic runtime isolates the composition contract.
async function fixture(schema = 'doppler.pack/v3') {
  const contract = resolveDopplerExecutionContract(schema);
  const digest = value => `sha256:${value.repeat(64)}`;
  const bytes = Uint8Array.from([1, 2, 3]);
  const artifacts = [{ artifactId: 'weights', role: 'weight-shard', path: 'weights.bin', sizeBytes: 3, hash: await sha256Hex(bytes) }];
  const binding = { schema, [contract.identityFields[1]]: 'session-test', semanticRoot: digest('a'), envelopeDigest: digest('b'),
    artifactClosureDigest: await hashDopplerEvidence(artifacts), artifacts, requiredOperation: 'embed', acceptedTargetPlanDigests: [digest('c')] };
  const pack = { schema: 'synthetic-pack-envelope', artifacts };
  const envelope = new TextEncoder().encode(JSON.stringify(pack));
  const envelopeArtifact = { artifactId: 'envelope', role: 'pack-envelope', path: 'pack.json', sizeBytes: envelope.length, hash: await sha256Hex(envelope) };
  const f = await createCustodyFixture(binding, new Map([['weights', bytes], ['envelope', envelope]]), 128, {}, envelopeArtifact);
  const persisted = new Map();
  const checkpoints = { getChunk: async chunk => persisted.get(chunk.hash)?.slice() ?? null,
    putChunk: async (chunk, value) => { persisted.set(chunk.hash, value.slice()); },
    deleteChunk: async chunk => { persisted.delete(chunk.hash); },
    getStats: async () => ({ chunks: persisted.size }), close: vi.fn() };
  const identity = { [contract.receiptIdentity]: binding, targetPlanDigest: digest('c'), artifactReceipts: artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })) };
  const session = { schema: contract.sessionSchema, loaded: true, [contract.sessionIdentity]: binding,
    selectedTargetPlanDigest: digest('c'), verification: identity, executeOperation: vi.fn() };
  const service = { prepare: vi.fn(async () => ({ version: 'fixture-runtime' })),
    [contract.openMethod]: vi.fn(async ({ source, options }) => {
      expect(source).toEqual(pack);
      expect(await options.artifactStore.readArtifact(artifacts[0])).toEqual(bytes);
      return session;
    }), close: vi.fn(async () => {}) };
  return { ...f, checkpoints, session, service, persisted, contract,
    options: { ...f.options, service, openCheckpoints: async () => checkpoints,
      trustedSigners: { publisher: { public: 'fixture-key' } }, runtimeVersion: 'fixture-runtime', maxCacheBytes: 4096 } };
}

describe('durable peer acquisition to public local Pack opening', () => {
  it.each(['doppler.pack/v3', 'doppler.capsule/v3'])('reopens from verified checkpoints without fetching model bytes again (%s)', async schema => {
    const f = await fixture(schema);
    const first = await openPeerPack(f.options);
    const receipt = await first.getAcquisitionReceipt();
    expect(receipt.completed.map(row => row.artifactId)).toEqual(['envelope', 'weights']);
    expect(receipt.storage.chunks).toBeGreaterThan(0);
    expect(f.service[f.contract.openMethod].mock.calls[0][0].options.trustedSigners).toEqual(f.options.trustedSigners);
    expect(f.service.prepare).toHaveBeenCalledWith(null, { bindingSchema: schema });
    await first.close();
    const unavailable = vi.fn(async () => { throw new Error('All suppliers disappeared'); });
    const resumed = await openPeerPack({ ...f.options, requestChunk: unavailable });
    expect((await resumed.getAcquisitionReceipt()).source).toBe('cache');
    expect(unavailable).not.toHaveBeenCalled();
    await resumed.close();
    await resumed.close();
    expect(f.service.close).toHaveBeenCalledTimes(2);
    await expect(resumed.run({})).rejects.toThrow('closed');
  });

  it('closes acquired resources when version, runtime identity, or cancellation rejects opening', async () => {
    for (const failure of ['version', 'identity', 'cancel']) {
      const f = await fixture();
      const controller = new AbortController();
      if (failure === 'version') f.service.prepare.mockResolvedValue({ version: 'other-release' });
      if (failure === 'identity') f.session.selectedTargetPlanDigest = `sha256:${'d'.repeat(64)}`;
      if (failure === 'cancel') f.service.prepare.mockImplementation(async () => {
        controller.abort(new Error('Cancelled during runtime preparation'));
        return { version: 'fixture-runtime' };
      });
      const error = await openPeerPack({ ...f.options, signal: controller.signal }).catch(error => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.acquisitionReceipt.timeToRunnableMs).toBe(null);
      expect(error.acquisitionReceipt.storage.chunks).toBeGreaterThan(0);
      expect(error.acquisitionReceipt.completed[0].artifactId).toBe('envelope');
      expect(f.service.close).toHaveBeenCalledTimes(1);
      expect(f.checkpoints.close).toHaveBeenCalledTimes(1);
      if (failure !== 'identity') expect(f.service.openPack).not.toHaveBeenCalled();
    }
  });

  it('keeps the original failure and closes storage when receipt observation or cleanup fails', async () => {
    const f = await fixture();
    f.service.prepare.mockRejectedValue(new Error('Runtime preparation failed'));
    f.checkpoints.getStats = async () => { throw new Error('Storage observation failed'); };
    f.service.close.mockRejectedValue(new Error('Runtime cleanup failed'));
    const error = await openPeerPack(f.options).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map(item => item.message)).toEqual([
      'Runtime preparation failed', 'Storage observation failed', 'Runtime cleanup failed'
    ]);
    expect(error.acquisitionReceipt).toBeUndefined();
    expect(f.checkpoints.close).toHaveBeenCalledTimes(1);
  });

  it('rejects absent trust and unauthorized concurrency before opening a model', async () => {
    const f = await fixture();
    await expect(openPeerPack({ ...f.options, trustedSigners: {} })).rejects.toThrow('trust');
    await expect(openPeerPack({ ...f.options, maxConcurrentChunks: 2 })).rejects.toThrow('concurrency');
    expect(f.service.openPack).not.toHaveBeenCalled();
  });
});
