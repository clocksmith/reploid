import { describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { DETERMINISTIC_GENERATION_CONFIG } from '../../server/pool/policy-router.js';
import { adapterRequirementFromPublication, createAdapterUseApproval, createAdapterRevocation, createSignedAdapterPublication } from '../../self/pool/adapter-publication.js';
import { modelSupportsAdapterRequirement, sealAdapterPack } from '../../self/pool/adapter-pack.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../../self/pool/inference-receipt.js';
import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';
import { createRoleDelegation, getDeviceRootIdentity } from '../../self/pool/device-identity.js';
import { createSignedParticipationProfile } from '../../self/pool/participation-profile.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;

const identityClaims = async ({ role, roleId, rolePublicKey, mode }) => {
  const deviceIdentity = await getDeviceRootIdentity();
  const participationProfile = await createSignedParticipationProfile({
    preferences: { mode },
    deviceId: deviceIdentity.deviceId,
    devicePublicKey: deviceIdentity.publicKey,
    privateKey: deviceIdentity.keyPair.privateKey
  });
  return {
    participationProfile,
    identityProof: await createRoleDelegation({
      deviceIdentity,
      role,
      roleId,
      rolePublicKey,
      capabilities: [role === 'provider' ? 'provide_inference' : 'request_inference'],
      participationProfileHash: participationProfile.profileHash
    })
  };
};

const dispatchJson = async (router, path, { method = 'GET', body = null } = {}) => {
  const url = new URL(path, 'http://reploid.test');
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: `${url.pathname}${url.search}`,
      originalUrl: `${url.pathname}${url.search}`,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {},
      body,
      ip: '127.0.0.1'
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      getHeader(name) { return this.headers[name.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      end(payload) { resolve({ status: this.statusCode, body: payload || null }); return this; }
    };
    router.handle(req, res, (error) => error ? reject(error) : resolve({ status: 404, body: {} }));
  });
};

const createFixture = async () => {
  const bytes = new TextEncoder().encode('route adapter bytes');
  const adapterHash = await sha256Hex(bytes);
  const pack = await sealAdapterPack({
    packId: 'route-pack',
    version: '1.0.0',
    adapter: {
      id: 'route-adapter',
      sha256: adapterHash,
      bytes: bytes.byteLength,
      format: 'peft_safetensors',
      rank: 4,
      alpha: 8,
      targetModules: ['q_proj']
    },
    baseModel: {
      modelId: LAUNCH_MODEL.modelId,
      modelHash: LAUNCH_MODEL.modelHash,
      manifestHash: LAUNCH_MODEL.manifestHash,
      checkpointSha256: fakeHash('1'),
      tokenizerHash: LAUNCH_MODEL.tokenizerHash || fakeHash('2'),
      moduleGraphHash: fakeHash('3')
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
      originUrl: 'https://example.invalid/route-adapter.safetensors',
      chunks: [{ index: 0, bytes: bytes.byteLength, sha256: adapterHash }]
    },
    runtimeManifest: {
      id: 'route-adapter',
      name: 'Route adapter',
      baseModel: LAUNCH_MODEL.modelId,
      rank: 4,
      alpha: 8,
      targetModules: ['q_proj'],
      checksum: adapterHash.replace(/^sha256:/, ''),
      checksumAlgorithm: 'sha256',
      weightsFormat: 'safetensors',
      weightsPath: 'route-adapter.safetensors',
      weightsSize: bytes.byteLength
    }
  });
  const publisherKeys = await createSigningKeyPair();
  const publication = await createSignedAdapterPublication({
    pack,
    publisherId: 'publisher_route',
    publisherPublicKey: await exportPublicKey(publisherKeys.publicKey),
    privateKey: publisherKeys.privateKey,
    visibility: 'public',
    originUrls: ['https://example.invalid/route-adapter.safetensors']
  });
  return { bytes, pack, publisherKeys, publication };
};

describe('Poolday adapter coordinator routes', () => {
  it('publishes, advertises, approves, and schedules one exact adapter', async () => {
    const store = createPoolStore();
    const router = createPoolRouter({ store });
    const fixture = await createFixture();
    const published = await dispatchJson(router, '/adapters', {
      method: 'POST',
      body: { publication: fixture.publication }
    });
    expect(published.status).toBe(201);

    const requirement = adapterRequirementFromPublication(fixture.publication, { state: 'cached' });
    const providerKeys = await createSigningKeyPair();
    const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
    const providerIdentity = await identityClaims({
      role: 'provider',
      roleId: 'provider_route',
      rolePublicKey: providerPublicKey,
      mode: 'contribute'
    });
    const provider = await dispatchJson(router, '/providers/register', {
      method: 'POST',
      body: {
        providerId: 'provider_route',
        publicKey: providerPublicKey,
        ...providerIdentity,
        models: [{ ...LAUNCH_MODEL, adapterPacks: [requirement] }],
        availability: { acceptedPolicies: ['fastest_receipt'] }
      }
    });
    expect(provider.status).toBe(200);

    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const requesterIdentity = await identityClaims({
      role: 'requester',
      roleId: 'requester_route',
      rolePublicKey: requesterPublicKey,
      mode: 'request'
    });
    const prompt = 'Use the exact published adapter';
    const modelRequirements = {
      modelId: LAUNCH_MODEL.modelId,
      modelHash: LAUNCH_MODEL.modelHash,
      manifestHash: LAUNCH_MODEL.manifestHash,
      runtime: LAUNCH_MODEL.runtime,
      backend: LAUNCH_MODEL.backend,
      adapter: { ...requirement, state: 'fetchable' }
    };
    const approval = await createAdapterUseApproval({
      adapterRequirement: modelRequirements.adapter,
      requesterId: 'requester_route',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      inputHash: await sha256Hex(prompt),
      modelRequirements
    });
    const registeredProvider = await store.getProvider('provider_route');
    expect(
      modelSupportsAdapterRequirement(registeredProvider.models[0], modelRequirements.adapter),
      JSON.stringify(registeredProvider)
    ).toBe(true);
    const job = await dispatchJson(router, '/jobs', {
      method: 'POST',
      body: {
        requesterId: 'requester_route',
        requesterPublicKey,
        ...requesterIdentity,
        prompt,
        policyId: 'fastest_receipt',
        modelRequirements,
        adapterUseApproval: approval,
        generationConfig: { ...DETERMINISTIC_GENERATION_CONFIG }
      }
    });
    expect(job.status, JSON.stringify(job.body)).toBe(200);
    expect(job.body.assignment.providerId).toBe('provider_route');
    expect(job.body.assignment.adapter.packHash).toBe(fixture.pack.packHash);
    expect(job.body.assignment.adapterUseApproval.approvalHash).toBe(approval.approvalHash);
  });

  it('rejects adapter jobs without signed use approval and after publisher revocation', async () => {
    const store = createPoolStore();
    const router = createPoolRouter({ store });
    const fixture = await createFixture();
    await dispatchJson(router, '/adapters', { method: 'POST', body: { publication: fixture.publication } });
    const requirement = adapterRequirementFromPublication(fixture.publication);
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const request = {
      requesterId: 'requester_reject',
      requesterPublicKey,
      prompt: 'Do not run without approval',
      policyId: 'fastest_receipt',
      modelRequirements: {
        modelId: LAUNCH_MODEL.modelId,
        modelHash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash,
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend,
        adapter: requirement
      },
      generationConfig: { ...DETERMINISTIC_GENERATION_CONFIG }
    };
    expect((await dispatchJson(router, '/jobs', { method: 'POST', body: request })).status).toBe(400);

    const revocation = await createAdapterRevocation({
      publication: fixture.publication,
      reason: 'withdrawn',
      privateKey: fixture.publisherKeys.privateKey
    });
    expect((await dispatchJson(router, `/adapters/${encodeURIComponent(fixture.pack.packHash)}/revoke`, {
      method: 'POST',
      body: { revocation }
    })).status).toBe(200);
    expect((await dispatchJson(router, `/adapters/${encodeURIComponent(fixture.pack.packHash)}`)).status).toBe(404);
  });
});
