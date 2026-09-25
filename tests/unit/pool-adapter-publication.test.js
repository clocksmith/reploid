import { describe, expect, it } from 'vitest';

import { adapterRequirementFromPack, sealAdapterPack } from '../../self/pool/adapter-pack.js';
import {
  adapterRequirementFromPublication,
  createAdapterRevocation,
  createAdapterUseApproval,
  createSignedAdapterPublication,
  verifyAdapterPublication,
  verifyAdapterUseApproval
} from '../../self/pool/adapter-publication.js';
import {
  acquireAdapterForAssignment,
  createPublishedAdapterOriginFetcher,
  createAdapterRegistry
} from '../../self/pool/adapter-registry.js';
import {
  createSigningKeyPair,
  exportPublicKey,
  sha256Hex
} from '../../self/pool/inference-receipt.js';
import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;

const createFixture = async () => {
  const bytes = new TextEncoder().encode('signed Poolday adapter publication bytes');
  const pack = await sealAdapterPack({
    packId: 'publication-pack',
    version: '1.0.0',
    adapter: {
      id: 'publication-adapter',
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
      format: 'peft_safetensors',
      rank: 8,
      alpha: 16,
      targetModules: ['q_proj']
    },
    baseModel: {
      modelId: LAUNCH_MODEL.modelId,
      modelHash: LAUNCH_MODEL.modelHash,
      manifestHash: LAUNCH_MODEL.manifestHash,
      checkpointSha256: fakeHash('1'),
      tokenizerHash: LAUNCH_MODEL.tokenizerHash || fakeHash('2'),
      moduleGraphHash: fakeHash('3'),
      sourceRepo: LAUNCH_MODEL.artifactIdentity.sourceRepo,
      sourceRevision: LAUNCH_MODEL.artifactIdentity.sourceRevision,
      weightPackId: LAUNCH_MODEL.artifactIdentity.weightPackId,
      weightPackHash: LAUNCH_MODEL.artifactIdentity.weightPackHash,
      manifestVariantId: LAUNCH_MODEL.artifactIdentity.manifestVariantId,
      conversionConfigDigest: LAUNCH_MODEL.artifactIdentity.conversionConfigDigest
    },
    runtime: {
      name: 'doppler',
      minimumVersion: '0.4.10',
      allowedSurfaces: ['browser-webgpu']
    },
    evidence: {
      dopplerIdentityReceiptHash: fakeHash('4'),
      dopplerParityReceiptHash: fakeHash('5'),
      gammaSelectionReceiptHash: fakeHash('6'),
      humanPromotionReceiptHash: fakeHash('7')
    },
    promotion: { state: 'promoted', humanRequired: true },
    distribution: {
      visibility: 'public',
      primaryOrigin: {
        provider: 'huggingface',
        repoId: 'clocksmith/lora-publication-test',
        revision: 'a'.repeat(40),
        path: 'adapters/publication-adapter/adapter_model.safetensors'
      },
      preservationMirrors: [],
      chunks: [{ index: 0, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) }]
    },
    runtimeManifest: {
      id: 'publication-adapter',
      name: 'Publication adapter',
      baseModel: LAUNCH_MODEL.modelId,
      rank: 8,
      alpha: 16,
      targetModules: ['q_proj'],
      weightsFormat: 'safetensors',
      weightsPath: 'adapter.safetensors',
      weightsSize: bytes.byteLength,
      checksum: (await sha256Hex(bytes)).replace(/^sha256:/, ''),
      checksumAlgorithm: 'sha256'
    }
  });
  const publisherKeys = await createSigningKeyPair();
  const publisherPublicKey = await exportPublicKey(publisherKeys.publicKey);
  const publication = await createSignedAdapterPublication({
    pack,
    publisherId: 'publisher-test',
    publisherPublicKey,
    privateKey: publisherKeys.privateKey,
    visibility: 'public',
    capabilities: ['legal-summary']
  });
  return { bytes, pack, publisherKeys, publication };
};

describe('Poolday adapter publication and use consent', () => {
  it('binds publisher identity and explicit requester consent to one prompt and base model', async () => {
    const fixture = await createFixture();
    const requirement = adapterRequirementFromPublication(fixture.publication);
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const inputHash = await sha256Hex('run with this exact adapter');
    const approval = await createAdapterUseApproval({
      adapterRequirement: requirement,
      requesterId: 'requester-test',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      inputHash,
      modelRequirements: LAUNCH_MODEL
    });

    expect(await verifyAdapterPublication(fixture.publication)).toMatchObject({ ok: true });
    expect(await verifyAdapterUseApproval(approval, {
      adapterRequirement: requirement,
      requesterId: 'requester-test',
      inputHash,
      modelRequirements: LAUNCH_MODEL
    })).toMatchObject({ ok: true });
    expect(await verifyAdapterUseApproval(approval, {
      adapterRequirement: requirement,
      requesterId: 'requester-test',
      inputHash: await sha256Hex('another prompt'),
      modelRequirements: LAUNCH_MODEL
    })).toMatchObject({ ok: false });
  });

  it('acquires peer bytes once, reuses the verified cache, and honors signed revocation', async () => {
    const fixture = await createFixture();
    const requirement = adapterRequirementFromPublication(fixture.publication);
    const assignment = {
      assignmentId: 'assignment-publication',
      jobId: 'job-publication',
      routeDecisionHash: fakeHash('a'),
      adapter: requirement,
      model: {
        id: LAUNCH_MODEL.modelId,
        hash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash,
        requirements: { adapter: requirement }
      }
    };
    const registry = createAdapterRegistry();
    let peerFetches = 0;
    await acquireAdapterForAssignment({
      assignment,
      registry,
      fetchFromPeer: async () => {
        peerFetches += 1;
        return { publication: fixture.publication, bytes: fixture.bytes, sourcePeerId: 'seeder-test' };
      }
    });
    const cached = await acquireAdapterForAssignment({
      assignment: {
        ...assignment,
        assignmentId: 'assignment-publication-cache',
        routeDecisionHash: fakeHash('b')
      },
      registry,
      fetchFromPeer: async () => {
        peerFetches += 1;
        throw new Error('verified cache should win');
      }
    });
    expect(peerFetches).toBe(1);
    expect(cached.acquisition).toMatchObject({
      source: 'cache',
      routeDecisionHash: fakeHash('b')
    });
    expect(await registry.hasCached(requirement.packHash)).toBe(true);

    const revocation = await createAdapterRevocation({
      publication: fixture.publication,
      reason: 'test revocation',
      privateKey: fixture.publisherKeys.privateKey
    });
    await registry.revoke(requirement.packHash, revocation);
    expect(await registry.hasCached(requirement.packHash)).toBe(false);
  });

  it('keeps bare pack requirements distinct from published network requirements', async () => {
    const fixture = await createFixture();
    const bare = adapterRequirementFromPack(fixture.pack);
    const published = adapterRequirementFromPublication(fixture.publication);
    expect(bare.publicationHash).toBeUndefined();
    expect(published.publicationHash).toBe(fixture.publication.publicationHash);
    expect(published.publisherId).toBe('publisher-test');
  });

  it('uses authorized private GCS delivery without persisting the signed URL', async () => {
    const fixture = await createFixture();
    const privateOrigin = {
      provider: 'gcs',
      bucket: 'clocksmith-adapters-private',
      object: 'v1/adapters/qwen/private/adapter_model.safetensors',
      generation: '1720000000000000'
    };
    const privatePack = await sealAdapterPack({
      ...fixture.pack,
      distribution: {
        ...fixture.pack.distribution,
        visibility: 'private',
        primaryOrigin: privateOrigin,
        preservationMirrors: []
      }
    });
    const publication = await createSignedAdapterPublication({
      pack: privatePack,
      publisherId: 'publisher-test',
      publisherPublicKey: await exportPublicKey(fixture.publisherKeys.publicKey),
      privateKey: fixture.publisherKeys.privateKey,
      visibility: 'private'
    });
    const requirement = adapterRequirementFromPublication(publication);
    const sdk = {
      getAdapter: vi.fn().mockResolvedValue({ publication }),
      createAdapterDownload: vi.fn().mockResolvedValue({
        origin: privateOrigin,
        url: 'https://storage.googleapis.com/private/signed?X-Goog-Signature=secret'
      })
    };
    const fetchFromOrigin = createPublishedAdapterOriginFetcher({
      sdk,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => fixture.bytes.buffer.slice(
          fixture.bytes.byteOffset,
          fixture.bytes.byteOffset + fixture.bytes.byteLength
        )
      })
    });
    const assignment = {
      assignmentId: 'assignment-private-gcs',
      adapter: requirement,
      model: { requirements: { adapter: requirement } }
    };
    const acquired = await acquireAdapterForAssignment({
      assignment,
      registry: createAdapterRegistry(),
      fetchFromOrigin
    });
    expect(acquired.acquisition).toMatchObject({
      source: 'origin',
      origin: privateOrigin,
      sourceUrl: null,
      privateDelivery: true
    });
    expect(JSON.stringify(acquired.acquisition)).not.toContain('X-Goog-Signature');
  });
});

it('keeps verified publications and cached bytes private from callers', async () => {
  const f = await createFixture(), registry = createAdapterRegistry();
  const expectedBytes = f.bytes.slice(), expectedPublication = structuredClone(f.publication);
  await registry.cache({ publication: f.publication, bytes: f.bytes });
  f.bytes[0] ^= 255; f.publication.pack.runtimeManifest.rank = 999;
  expect(registry.getPublication(f.pack.packHash)).toEqual(expectedPublication);
  const first = await registry.getArtifact(f.pack.packHash);
  expect(first.bytes).toEqual(expectedBytes);
  first.bytes[0] ^= 255; first.publication.pack.runtimeManifest.rank = 888;
  registry.list()[0].revoked = true;
  expect((await registry.getArtifact(f.pack.packHash)).bytes).toEqual(expectedBytes);
  expect(registry.getPublication(f.pack.packHash)).toEqual(expectedPublication);
});

it('retains revocation when the original signed publication is replayed', async () => {
  const f = await createFixture(), registry = createAdapterRegistry();
  await registry.cache({ publication: f.publication, bytes: f.bytes });
  const revocation = await createAdapterRevocation({ publication: f.publication, reason: 'Withdrawn', privateKey: f.publisherKeys.privateKey });
  await registry.revoke(f.pack.packHash, revocation);
  await expect(registry.publish(f.publication)).rejects.toThrow('revoked');
  await expect(registry.cache({ publication: f.publication, bytes: f.bytes })).rejects.toThrow('revoked');
  expect(await registry.getArtifact(f.pack.packHash)).toBeNull();
});

it('rejects a mismatched assignment even when the requested adapter is cached', async () => {
  const f = await createFixture(), registry = createAdapterRegistry();
  await registry.cache({ publication: f.publication, bytes: f.bytes });
  const requirement = adapterRequirementFromPublication(f.publication);
  await expect(acquireAdapterForAssignment({ registry, assignment: { adapter: { ...requirement, adapterSha256: fakeHash('f') } } }))
    .rejects.toThrow('cached publication does not match assignment requirement');
});

it('orders revocation deletion after a pending write and rejects the late cache result', async () => {
  const f = await createFixture();
  let release, entered;
  const writing = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const disk = new Map();
  const registry = createAdapterRegistry({
    async writeBytes(key, bytes) { entered(); await gate; disk.set(key, bytes); },
    async deleteBytes(key) { disk.delete(key); }
  });
  const caching = registry.cache({ publication: f.publication, bytes: f.bytes });
  const rejected = expect(caching).rejects.toThrow('changed or revoked');
  await writing;
  const revocation = await createAdapterRevocation({ publication: f.publication, reason: 'Withdrawn', privateKey: f.publisherKeys.privateKey });
  const revoked = registry.revoke(f.pack.packHash, revocation);
  // Observe the synchronous in-memory revocation without releasing its disk queue.
  while (registry.getPublication(f.pack.packHash)) await new Promise(resolve => setTimeout(resolve, 0));
  expect(await registry.getArtifact(f.pack.packHash)).toBeNull();
  release(); await rejected; await revoked;
  expect(disk.size).toBe(0);
});

it('does not return a disk read that finishes after revocation', async () => {
  const f = await createFixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const registry = createAdapterRegistry({ readBytes: () => gate });
  await registry.publish(f.publication);
  const reading = registry.getArtifact(f.pack.packHash);
  const revocation = await createAdapterRevocation({ publication: f.publication, reason: 'Withdrawn', privateKey: f.publisherKeys.privateKey });
  await registry.revoke(f.pack.packHash, revocation);
  release(f.bytes);
  expect(await reading).toBeNull(); expect(await registry.hasCached(f.pack.packHash)).toBe(false);
});
