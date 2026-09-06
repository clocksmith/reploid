import { adapterCustodyFixture as custody } from '../fixtures/peer-adapter-custody.js';
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../../self/pool/pool-config.json' with { type: 'json' };
import { peerAdapterFixture } from '../fixtures/peer-adapter.js';
import { operationFixture, operationCapabilities, operationResources, packPeerIdentity } from '../fixtures/peer-pack-operation.js';
import { normalizeExecutionAdapterSet, executionAdapterArtifact, executionAdapterArtifactSet } from '../../self/pool/adapter-execution.js';
import { createPackProviderAdvert, createPackPeerJob, verifyPackPeerJob, packPeerModel } from '../../self/pool/peer-pack-job.js';
import { createPeerAdapterResolver } from '../../self/pool/peer-adapter-execution.js';
import { createAdapterRegistry } from '../../self/pool/adapter-registry.js';
import { createPeerPackSupplier } from '../../self/pool/peer-pack-custody.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
const policy = config.peerJobs.execution.adapters;
const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 30000 };

async function fixture() {
  const operation = await operationFixture('generate');
  return { ...operation, ...await peerAdapterFixture(operation.model) };
}

describe('remote adapter composition and shared custody', () => {
  it('binds exact publication, base and adapter identities before provider selection', async () => {
    const f = await fixture(), provider = await packPeerIdentity(), requester = await packPeerIdentity();
    const capabilities = await operationCapabilities(f.model);
    capabilities.adapters = [{ identity: f.entry.identity, availability: 'fetchable' }];
    const advert = await createPackProviderAdvert({ identity: provider, models: [f.model], limits, capabilities, expiresAt: Date.now() + 30000 });
    const job = await createPackPeerJob({ identity: requester, advert, model: f.model, input: f.input, options: f.options,
      limits: { ...limits, deadlineAt: Date.now() + 30000 }, consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true,
        providerIds: [provider.keyId] }, comparisonPolicy: f.policy, resources: operationResources, adapterSet: [f.entry] });
    await verifyPackPeerJob(job, { providerId: provider.keyId, models: [f.model] });
    expect(job.body.assignment.adapterSet[0].identity).toBe(f.pack.packHash);
    expect(job.body.request.adapterSet[0].baseModel.semanticRoot).toBe(f.model.modelHash);
    expect(job.body.intent.planning.plan.selectedProviderId).toBe(provider.keyId);
    const context = { model: packPeerModel(f.model), policy };
    await expect(normalizeExecutionAdapterSet([{ ...f.entry, baseModelIdentity: f.pack.adapter.sha256 }], context)).rejects.toThrow('base model');
    await expect(normalizeExecutionAdapterSet([f.entry, f.entry], context)).rejects.toThrow('count');
    await expect(normalizeExecutionAdapterSet([{ ...f.entry, publication: { ...f.publication, revoked: true } }], context)).rejects.toThrow('revoked');
    await expect(normalizeExecutionAdapterSet([f.entry], { ...context, policy: { ...policy, maxAdapterBytes: 1 } })).rejects.toThrow('byte limit');
  });

  it('uses verified chunks after reopening and never asks custody for base model bytes', async () => {
    const f = await fixture(), ports = await custody(f), registry = createAdapterRegistry();
    await registry.publish(f.publication);
    const persisted = new Map(); let received = 0;
    const openCheckpoints = async () => ({ async getChunk(chunk) { return persisted.get(chunk.hash)?.slice() ?? null; },
      async putChunk(chunk, bytes) { persisted.set(chunk.hash, bytes.slice()); }, async deleteChunk(chunk) { persisted.delete(chunk.hash); }, close() {} });
    const resolver = () => createPeerAdapterResolver({ registry, policy, openCheckpoints, resolveCustody: async () => ({ ...ports,
      requestChunk: async (...args) => { received++; return ports.requestChunk(...args); } }) });
    const args = { model: packPeerModel(f.model), adapterSet: [f.entry], signal: new AbortController().signal };
    const first = await resolver().prepare(args);
    expect(await first.artifactStore.readArtifact(executionAdapterArtifact(f.entry))).toEqual(f.bytes);
    expect(received).toBe(1);
    first.close();
    const second = await resolver().prepare(args);
    expect(await second.artifactStore.readArtifact(executionAdapterArtifact(f.entry))).toEqual(f.bytes);
    expect(received).toBe(1);
    expect(second.receipts[0]).toMatchObject({ source: 'cache', cacheBytes: f.bytes.length, receivedBytes: 0 });
    await expect(second.artifactStore.readArtifact(f.model.executablePack.artifacts[0])).rejects.toThrow('outside');
    second.close();
  });
});
