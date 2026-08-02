import { describe, expect, it, vi } from 'vitest';

import {
  adapterRequirementFromPack,
  modelSupportsAdapterRequirement,
  sealAdapterPack,
  verifyAdapterPack
} from '../../self/pool/adapter-pack.js';
import { buildPromotedAdapterPack } from '../../self/pool/adapter-pack-publisher.js';
import {
  adapterRequirementFromPublication,
  createAdapterUseApproval,
  createSignedAdapterPublication
} from '../../self/pool/adapter-publication.js';
import {
  acquireAdapterForAssignment,
  createAdapterRegistry,
  createPublishedAdapterOriginFetcher,
  listFetchableAdapterPublications
} from '../../self/pool/adapter-registry.js';
import { createDopplerRuntime } from '../../self/pool/doppler-runtime.js';
import {
  buildPoolReceipt,
  createSigningKeyPair,
  exportPublicKey,
  hashJson,
  sha256Hex,
  signProviderReceipt
} from '../../self/pool/inference-receipt.js';
import { exactModelContractKey, LAUNCH_MODEL } from '../../self/pool/model-contract.js';
import {
  assembleAdapterArtifact,
  createAdapterArtifactChunks,
  createAdapterArtifactRequest
} from '../../self/pool/p2p-artifact-transfer.js';
import {
  buildPeerAssignmentPlan,
  createSignedJobIntent,
  createSignedProviderAdvert
} from '../../self/pool/peer-control-plane.js';
import { createProviderClient } from '../../self/pool/provider-client.js';
import { DETERMINISTIC_GENERATION_CONFIG, getPolicy } from '../../server/pool/config.js';
import { assignJob } from '../../server/pool/scheduler.js';
import { createPoolStore } from '../../server/pool/store.js';
import { runtimeProfileHash } from '../../server/pool/runtime-profile.js';
import { verifyReceipt } from '../../server/pool/verifier.js';
import {
  TEST_PUBLIC_PROTEIN_SEQUENCE,
  makePublicProteinJobFields,
  makeSequenceExecution
} from '../helpers/pool-sequence-fixture.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;

const buildPack = async () => {
  const bytes = new TextEncoder().encode('governed-adapter-bytes');
  const first = bytes.slice(0, 10);
  const second = bytes.slice(10);
  const pack = await sealAdapterPack({
    packId: 'adapter-pack-unit',
    version: '1.0.0',
    adapter: {
      id: 'adapter-unit',
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
      format: 'peft_safetensors',
      rank: 8,
      alpha: 16,
      targetModules: ['q_proj', 'v_proj']
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
        repoId: 'clocksmith/lora-unit',
        revision: 'a'.repeat(40),
        path: 'adapters/adapter-unit/adapter_model.safetensors'
      },
      preservationMirrors: [],
      chunks: [
        { index: 0, bytes: first.byteLength, sha256: await sha256Hex(first) },
        { index: 1, bytes: second.byteLength, sha256: await sha256Hex(second) }
      ]
    },
    runtimeManifest: {
      id: 'adapter-unit',
      name: 'Adapter Unit',
      version: '1.0.0',
      baseModel: LAUNCH_MODEL.modelId,
      rank: 8,
      alpha: 16,
      targetModules: ['q_proj', 'v_proj'],
      checksum: (await sha256Hex(bytes)).replace('sha256:', ''),
      checksumAlgorithm: 'sha256',
      weightsFormat: 'safetensors',
      weightsPath: `adapter://${await sha256Hex(bytes)}`,
      weightsSize: bytes.byteLength
    }
  });
  return { pack, bytes };
};

const publishPack = async (pack, { state = 'fetchable' } = {}) => {
  const keys = await createSigningKeyPair();
  const publication = await createSignedAdapterPublication({
    pack,
    publisherId: 'publisher-unit',
    publisherPublicKey: await exportPublicKey(keys.publicKey),
    privateKey: keys.privateKey,
    visibility: 'public'
  });
  return {
    keys,
    publication,
    requirement: adapterRequirementFromPublication(publication, { state })
  };
};

const assignmentFor = (requirement) => ({
  assignmentId: 'assignment-adapter-unit',
  jobId: 'job-adapter-unit',
  requesterId: 'requester-unit',
  providerId: 'provider-unit',
  adapter: requirement,
  model: {
    ...LAUNCH_MODEL,
    id: LAUNCH_MODEL.modelId,
    hash: LAUNCH_MODEL.modelHash,
    exactModelContractKey: exactModelContractKey(LAUNCH_MODEL),
    requirements: { ...LAUNCH_MODEL, adapter: requirement }
  }
});

describe('governed Poolday adapter packs', () => {
  it('lists exact-model publications and acquires verified origin bytes for browser providers', async () => {
    const { pack, bytes } = await buildPack();
    const { publication, requirement } = await publishPack(pack);
    const sdk = {
      listAdapters: vi.fn().mockResolvedValue({ publications: [publication] }),
      getAdapter: vi.fn().mockResolvedValue({ publication })
    };
    const publications = await listFetchableAdapterPublications({ sdk, model: LAUNCH_MODEL });
    expect(publications.map((candidate) => candidate.packHash)).toEqual([pack.packHash]);

    const fetchFromOrigin = createPublishedAdapterOriginFetcher({
      sdk,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      })
    });
    const assignment = assignmentFor(requirement);
    const acquired = await acquireAdapterForAssignment({
      assignment,
      registry: createAdapterRegistry(),
      fetchFromOrigin
    });
    expect(Array.from(acquired.bytes)).toEqual(Array.from(bytes));
    expect(acquired.acquisition).toMatchObject({
      source: 'origin',
      packHash: requirement.packHash,
      adapterSha256: requirement.adapterSha256,
      bytes: bytes.byteLength
    });
  });

  it('publishes only a controller-approved NeuralCompiler registry entry', async () => {
    const { pack: template } = await buildPack();
    const approvalCore = {
      schema: 'reploid.trained-adapter-human-approval/v1',
      approvalId: 'approval-unit',
      approvedAt: '2026-07-18T00:00:00.000Z',
      source: 'hitl-controller',
      humanRequired: true,
      decision: 'approve',
      adapterId: template.adapter.id,
      adapterSha256: template.adapter.sha256.replace('sha256:', ''),
      dopplerIdentityReceiptHash: fakeHash('4').replace('sha256:', ''),
      dopplerParityReceiptHash: fakeHash('5').replace('sha256:', ''),
      gammaSelectionReceiptHash: fakeHash('6').replace('sha256:', '')
    };
    const entry = {
      manifest: {
        id: template.adapter.id,
        adapterSha256: template.adapter.sha256,
        bytes: template.adapter.bytes,
        format: template.adapter.format,
        rank: template.adapter.rank,
        alpha: template.adapter.alpha,
        targetModules: template.adapter.targetModules
      },
      metadata: {
        trainedAdapter: true,
        admissionState: 'promoted',
        trainedAdapterAdmission: {
          artifact: {
            adapterId: template.adapter.id,
            adapterSha256: template.adapter.sha256.replace('sha256:', ''),
            baseModelId: template.baseModel.modelId,
            baseCheckpointSha256: template.baseModel.checkpointSha256.replace('sha256:', '')
          },
          receipts: {
            identityReceiptHash: fakeHash('4').replace('sha256:', ''),
            parityReceiptHash: fakeHash('5').replace('sha256:', ''),
            gammaReceiptHash: fakeHash('6').replace('sha256:', '')
          }
        },
        humanApproval: {
          ...approvalCore,
          receiptSha256: (await hashJson(approvalCore)).replace('sha256:', '')
        }
      }
    };
    const published = await buildPromotedAdapterPack(entry, {
      version: '1.0.0',
      baseModel: template.baseModel,
      runtime: template.runtime,
      distribution: template.distribution,
      runtimeManifest: template.runtimeManifest
    });
    expect(await verifyAdapterPack(published)).toMatchObject({ ok: true });
    expect(published.evidence.humanPromotionReceiptHash).toBe(
      `sha256:${entry.metadata.humanApproval.receiptSha256}`
    );

    const forged = structuredClone(entry);
    forged.metadata.humanApproval.adapterId = 'forged';
    await expect(buildPromotedAdapterPack(forged, {
      version: '1.0.0',
      baseModel: template.baseModel,
      runtime: template.runtime,
      distribution: template.distribution
    })).rejects.toThrow('Human approval receipt hash mismatch');
  });

  it('binds promotion evidence and exact base-model compatibility', async () => {
    const { pack } = await buildPack();
    expect(await verifyAdapterPack(pack)).toMatchObject({ ok: true });
    const requirement = adapterRequirementFromPack(pack);
    expect(modelSupportsAdapterRequirement({
      ...LAUNCH_MODEL,
      adapterPacks: [{ ...requirement, state: 'active' }]
    }, requirement)).toBe(true);
    expect(modelSupportsAdapterRequirement({
      ...LAUNCH_MODEL,
      adapterPacks: [{ ...requirement, state: 'shadow' }]
    }, requirement)).toBe(false);

    const unpromoted = await sealAdapterPack({
      ...pack,
      promotion: { state: 'shadow', humanRequired: true }
    });
    expect((await verifyAdapterPack(unpromoted)).reasons).toContain('adapter pack is not promoted');
  });

  it('transfers exact adapter bytes between assignment peers and rejects corruption', async () => {
    const { pack, bytes } = await buildPack();
    const requirement = adapterRequirementFromPack(pack);
    const assignment = assignmentFor(requirement);
    const request = await createAdapterArtifactRequest({
      assignment,
      missingChunkIndexes: [0, 1],
      fromPeerId: 'provider-unit',
      toPeerId: 'seeder-unit'
    });
    expect(request.body.packHash).toBe(pack.packHash);
    const chunks = await createAdapterArtifactChunks({
      assignment,
      pack,
      bytes,
      fromPeerId: 'seeder-unit',
      toPeerId: 'provider-unit'
    });
    const assembled = await assembleAdapterArtifact({ assignment, pack, chunkPayloads: chunks });
    expect(Array.from(assembled.bytes)).toEqual(Array.from(bytes));
    expect(assembled.transferReceipt).toMatchObject({
      packHash: pack.packHash,
      adapterSha256: pack.adapter.sha256,
      source: 'peer',
      sourcePeerId: 'seeder-unit'
    });

    const corrupted = structuredClone(chunks);
    corrupted[0].body.dataBase64 = corrupted[0].body.dataBase64.replace(/^./, 'A');
    const { payloadHash, ...core } = corrupted[0];
    corrupted[0].payloadHash = await hashJson(core);
    await expect(assembleAdapterArtifact({ assignment, pack, chunkPayloads: corrupted }))
      .rejects.toThrow('integrity mismatch');
  });

  it('loads a promoted pack through the public Doppler LoRA surface', async () => {
    const { pack } = await buildPack();
    const loadLoRA = vi.fn().mockResolvedValue({ ok: true });
    const unloadLoRA = vi.fn().mockResolvedValue({ ok: true });
    const runtime = createDopplerRuntime({
      model: { ...LAUNCH_MODEL },
      runtime: { version: '0.4.10' },
      modelSession: {
        generate: vi.fn().mockResolvedValue({ outputText: 'adapted', tokenIds: [1] }),
        loadLoRA,
        unloadLoRA
      }
    });
    const active = await runtime.activateAdapterPack(pack, {
      source: pack.runtimeManifest,
      artifactSources: [{ source: 'peer', receiptHash: fakeHash('8') }]
    });
    expect(active).toMatchObject({
      packHash: pack.packHash,
      adapterSha256: pack.adapter.sha256,
      state: 'active'
    });
    expect(loadLoRA).toHaveBeenCalledWith(pack.runtimeManifest, {});
    expect(runtime.getModelInfo().adapterPacks).toEqual([active]);
    await runtime.deactivateAdapterPack();
    expect(unloadLoRA).toHaveBeenCalledOnce();
  });

  it('acquires peer bytes, activates Doppler, and receipts the exact source before execution', async () => {
    const { pack, bytes } = await buildPack();
    const { publication, requirement } = await publishPack(pack);
    const loadLoRA = vi.fn().mockResolvedValue({ ok: true });
    const runtime = createDopplerRuntime({
      model: { ...LAUNCH_MODEL },
      runtime: { version: '0.4.10' },
      modelSession: {
        encodeSequence: vi.fn().mockResolvedValue({
          alphabet: 'amino_acid',
          tokens: Uint32Array.from({ length: TEST_PUBLIC_PROTEIN_SEQUENCE.length }, (_, index) => index % 33),
          includedTokenCount: TEST_PUBLIC_PROTEIN_SEQUENCE.length,
          pooledEmbedding: new Float32Array([0.25, -0.5, 0.75]),
          embeddingDim: 3,
          vocabSize: 33
        }),
        loadLoRA,
        unloadLoRA: vi.fn().mockResolvedValue({ ok: true })
      }
    });
    const providerKeys = await createSigningKeyPair();
    const provider = createProviderClient({
      providerId: 'provider-adapter-peer',
      runtime,
      keyPair: providerKeys,
      identity: null,
      fetchAdapterFromPeer: vi.fn().mockResolvedValue({
        publication,
        bytes,
        transferReceipt: {
          schema: 'reploid.pool.adapter-acquisition/v1',
          source: 'peer',
          sourcePeerId: 'seeder-adapter-peer',
          packHash: requirement.packHash,
          adapterSha256: requirement.adapterSha256,
          bytes: bytes.byteLength,
          verifiedAt: '2026-07-18T00:00:00.000Z'
        }
      })
    });
    const requesterKeys = await createSigningKeyPair();
    const intent = await createSignedJobIntent({
      requesterId: 'requester-adapter-peer',
      requesterPublicKey: await exportPublicKey(requesterKeys.publicKey),
      privateKey: requesterKeys.privateKey,
      sequence: TEST_PUBLIC_PROTEIN_SEQUENCE,
      sequenceRequest: (await makePublicProteinJobFields()).sequenceRequest,
      modelRequirements: {
        modelId: LAUNCH_MODEL.modelId,
        modelHash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash,
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend,
        adapter: requirement
      }
    });
    const advert = await provider.createPeerProviderAdvert({
      models: [{ ...LAUNCH_MODEL, adapterPacks: [requirement] }],
      availability: { acceptedPolicies: ['fastest_receipt'] }
    });
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent,
      providerAdverts: [advert]
    });
    expect(plan.ok).toBe(true);

    const result = await provider.executePeerAssignment(plan.assignment, {
      sequence: TEST_PUBLIC_PROTEIN_SEQUENCE
    });
    expect(loadLoRA).toHaveBeenCalledOnce();
    const [, loadOptions] = loadLoRA.mock.calls[0];
    expect(Array.from(new Uint8Array(await loadOptions.fetchUrl()))).toEqual(Array.from(bytes));
    expect(result.receipt.adapter).toMatchObject({
      packHash: requirement.packHash,
      publicationHash: requirement.publicationHash,
      adapterUseApprovalHash: plan.assignment.adapterUseApproval.approvalHash,
      state: 'active',
      artifactSources: [{
        source: 'peer',
        sourcePeerId: 'seeder-adapter-peer',
        packHash: requirement.packHash,
        adapterSha256: requirement.adapterSha256
      }]
    });

    const store = createPoolStore();
    store.registerProvider({
      providerId: plan.assignment.providerId,
      publicKey: provider.getPublicKey()
    });
    expect((await verifyReceipt({
      store,
      assignment: plan.assignment,
      receipt: result.receipt,
      ...result.execution
    })).accepted).toBe(true);
  });

  it('schedules adapter work only to a provider with the active exact pack', async () => {
    const { pack } = await buildPack();
    const requirement = adapterRequirementFromPack(pack);
    const store = createPoolStore();
    const runtimeProfile = {};
    store.registerProvider({
      providerId: 'provider-shadow',
      timestamp: new Date().toISOString(),
      models: [{ ...LAUNCH_MODEL, adapterPacks: [{ ...requirement, state: 'shadow' }] }],
      runtimeProfile,
      runtimeProfileHash: runtimeProfileHash(runtimeProfile),
      availability: { acceptedPolicies: ['fastest_receipt'] }
    });
    store.registerProvider({
      providerId: 'provider-active',
      timestamp: new Date().toISOString(),
      models: [{ ...LAUNCH_MODEL, adapterPacks: [{ ...requirement, state: 'active' }] }],
      runtimeProfile,
      runtimeProfileHash: runtimeProfileHash(runtimeProfile),
      availability: { acceptedPolicies: ['fastest_receipt'] }
    });
    const sequenceFields = await makePublicProteinJobFields();
    const job = store.createJob({
      requesterId: 'requester-unit',
      policyId: 'fastest_receipt',
      ...sequenceFields,
      modelRequirements: {
        ...LAUNCH_MODEL,
        sequenceRequest: sequenceFields.sequenceRequest,
        adapter: requirement
      },
      generationConfig: { ...DETERMINISTIC_GENERATION_CONFIG }
    });
    const result = await assignJob({ store, job, policy: getPolicy('fastest_receipt') });
    expect(result.ok).toBe(true);
    expect(result.assignment.providerId).toBe('provider-active');
    expect(result.assignment.adapter).toEqual(requirement);
  });

  it('keeps the same exact-pack gate in coordinator-free peer assignment', async () => {
    const { pack } = await buildPack();
    const { requirement } = await publishPack(pack);
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const providerKeys = await createSigningKeyPair();
    const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
    const intent = await createSignedJobIntent({
      requesterId: 'requester-unit',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      sequence: TEST_PUBLIC_PROTEIN_SEQUENCE,
      sequenceRequest: (await makePublicProteinJobFields()).sequenceRequest,
      modelRequirements: {
        modelId: LAUNCH_MODEL.modelId,
        modelHash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash,
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend,
        adapter: requirement
      }
    });
    const peerRuntimeProfileHash = await hashJson({});
    const makeAdvert = (providerId, state) => createSignedProviderAdvert({
      providerId,
      providerPublicKey,
      privateKey: providerKeys.privateKey,
      models: [{ ...LAUNCH_MODEL, adapterPacks: [{ ...requirement, state }] }],
      runtimeProfile: {},
      runtimeProfileHash: peerRuntimeProfileHash,
      availability: { acceptedPolicies: ['fastest_receipt'] }
    });
    const wrong = await createSignedProviderAdvert({
      providerId: 'provider-wrong',
      providerPublicKey,
      privateKey: providerKeys.privateKey,
      models: [{
        ...LAUNCH_MODEL,
        adapterPacks: [{ ...requirement, adapterSha256: fakeHash('9'), state: 'cached' }]
      }],
      runtimeProfile: {},
      runtimeProfileHash: peerRuntimeProfileHash,
      availability: { acceptedPolicies: ['fastest_receipt'] }
    });
    const active = await makeAdvert('provider-active', 'active');
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent,
      providerAdverts: [wrong, active]
    });
    expect(plan.ok).toBe(true);
    expect(plan.assignment.providerId).toBe('provider-active');
    expect(plan.assignment.adapter).toEqual(requirement);
  });

  it('binds the active adapter and promotion receipt into provider evidence', async () => {
    const { pack } = await buildPack();
    const { requirement } = await publishPack(pack);
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const sequenceFields = await makePublicProteinJobFields();
    const modelRequirements = {
      ...LAUNCH_MODEL,
      sequenceRequest: sequenceFields.sequenceRequest,
      adapter: requirement
    };
    const inputHash = sequenceFields.inputHash;
    const adapterUseApproval = await createAdapterUseApproval({
      adapterRequirement: requirement,
      requesterId: 'requester-unit',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      inputHash,
      modelRequirements
    });
    const assignment = {
      ...assignmentFor(requirement),
      policyId: 'fastest_receipt',
      inputHash,
      sequenceRequest: sequenceFields.sequenceRequest,
      sequenceRequestHash: sequenceFields.sequenceRequestHash,
      generationConfigHash: await hashJson(DETERMINISTIC_GENERATION_CONFIG),
      verificationLevel: 'signed_receipt',
      adapterUseApproval,
      model: {
        ...assignmentFor(requirement).model,
        requirements: modelRequirements
      }
    };
    const keys = await createSigningKeyPair();
    const publicKey = await exportPublicKey(keys.publicKey);
    const store = createPoolStore();
    store.registerProvider({ providerId: assignment.providerId, publicKey });
    const execution = await makeSequenceExecution({ assignment });
    const receipt = await signProviderReceipt(await buildPoolReceipt({
      assignment,
      provider: { providerId: assignment.providerId, publicKey },
      model: assignment.model,
      runtime: { runtime: 'doppler', version: '0.4.10', backend: 'browser-webgpu' },
      execution: {
        ...execution,
        adapter: {
          ...requirement,
          state: 'active',
          adapterUseApprovalHash: adapterUseApproval.approvalHash,
          artifactSources: [{
            source: 'peer',
            receiptHash: fakeHash('8'),
            packHash: requirement.packHash,
            adapterSha256: requirement.adapterSha256
          }]
        }
      }
    }), keys.privateKey);
    expect((await verifyReceipt({
      store,
      assignment,
      receipt,
      ...execution
    })).accepted).toBe(true);

    const wrongIdentity = await signProviderReceipt({
      ...receipt,
      adapter: { ...receipt.adapter, packHash: fakeHash('9') },
      providerSignature: null
    }, keys.privateKey);
    const rejected = await verifyReceipt({
      store,
      assignment,
      receipt: wrongIdentity,
      ...execution
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.reasons).toContain('receipt adapter packHash mismatch');

    const wrongConvertedBase = await signProviderReceipt({
      ...receipt,
      adapter: { ...receipt.adapter, baseConversionConfigDigest: fakeHash('9') },
      providerSignature: null
    }, keys.privateKey);
    const convertedBaseRejected = await verifyReceipt({
      store,
      assignment,
      receipt: wrongConvertedBase,
      ...execution
    });
    expect(convertedBaseRejected.accepted).toBe(false);
    expect(convertedBaseRejected.reasons)
      .toContain('receipt adapter baseConversionConfigDigest mismatch');
  });
});
