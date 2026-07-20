import { describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import {
  ADAPTER_RUNTIME_CANARY_RECEIPT_SCHEMA,
  createSignedAdapterCanaryPublication,
  verifyAdapterCanaryPublication
} from '../../self/pool/adapter-canary-publication.js';
import { verifyAdapterPublication } from '../../self/pool/adapter-publication.js';
import {
  createSigningKeyPair,
  exportPublicKey
} from '../../self/pool/inference-receipt.js';
import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;

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
  const keyPair = await createSigningKeyPair();
  const publication = await createSignedAdapterCanaryPublication({
    canaryId: 'qwen35-0.8b-ner-json-lora',
    custody: {
      registrySchema: 'reploid.network-canary-custody/v2',
      registryPath: 'docs/artifact-custody/network-canaries-v1.json',
      registryHash: fakeHash('1'),
      artifactId: 'qwen35-0.8b-ner-json-lora'
    },
    artifact: {
      repoId: 'clocksmith/lora',
      revision: '2'.repeat(40),
      path: 'adapters/network-canaries/qwen35-0.8b-ner-json-lora/adapter_model.safetensors',
      sizeBytes: 43346432,
      sha256: fakeHash('3')
    },
    baseModel: {
      modelId: LAUNCH_MODEL.modelId,
      modelHash: LAUNCH_MODEL.modelHash,
      manifestHash: LAUNCH_MODEL.manifestHash,
      tokenizerHash: LAUNCH_MODEL.tokenizerHash,
      artifactIdentity: {
        sourceRepo: LAUNCH_MODEL.artifactIdentity.sourceRepo,
        sourceRevision: LAUNCH_MODEL.artifactIdentity.sourceRevision,
        weightPackId: LAUNCH_MODEL.artifactIdentity.weightPackId,
        weightPackHash: LAUNCH_MODEL.artifactIdentity.weightPackHash,
        manifestVariantId: LAUNCH_MODEL.artifactIdentity.manifestVariantId,
        conversionConfigDigest: LAUNCH_MODEL.artifactIdentity.conversionConfigDigest
      }
    },
    runtime: {
      packageName: 'doppler-gpu',
      packageVersion: '0.4.14',
      packageIntegrity: 'sha512-test-integrity',
      moduleUrl: 'https://esm.sh/doppler-gpu@0.4.14/src/client/doppler-api.js?bundle',
      kernelBaseUrl: 'https://esm.sh/doppler-gpu@0.4.14/src/gpu/kernels'
    },
    runtimeProof: {
      schema: ADAPTER_RUNTIME_CANARY_RECEIPT_SCHEMA,
      receiptPath: 'docs/status/qwen35-ner-lora-runtime-canary-2026-07-19.json',
      receiptHash: fakeHash('4'),
      sourceRevision: '5'.repeat(40),
      surface: 'chromium-webgpu'
    },
    claimBoundary: 'Runtime interoperability only; this is not model-quality or promotion evidence.',
    publisherId: 'publisher_canary',
    publisherPublicKey: await exportPublicKey(keyPair.publicKey),
    privateKey: keyPair.privateKey,
    createdAt: '2026-07-19T20:00:00.000Z'
  });
  return { keyPair, publication };
};

describe('Poolday adapter canary publication', () => {
  it('binds custody, runtime proof, exact base identity, and publisher signature', async () => {
    const { publication } = await createFixture();
    expect(await verifyAdapterCanaryPublication(publication)).toMatchObject({ ok: true });
    expect(publication).toMatchObject({
      routable: false,
      promotion: { state: 'canary_only', qualityClaim: false }
    });
  });

  it('cannot pass the promoted adapter publication contract or become routable', async () => {
    const { publication } = await createFixture();
    expect(await verifyAdapterPublication(publication)).toMatchObject({ ok: false });
    expect(await verifyAdapterCanaryPublication({ ...publication, routable: true })).toMatchObject({ ok: false });
    expect(await verifyAdapterCanaryPublication({
      ...publication,
      packHash: fakeHash('9')
    })).toMatchObject({ ok: false });
    expect(await verifyAdapterCanaryPublication({
      ...publication,
      runtime: { ...publication.runtime, moduleUrl: 'https://esm.sh/doppler-gpu@latest' }
    })).toMatchObject({ ok: false });
  });

  it('stores signed canaries separately and exposes public read-only discovery', async () => {
    const store = createPoolStore();
    const writeRouter = createPoolRouter({ store });
    const { publication } = await createFixture();
    const normalRoute = await dispatchJson(writeRouter, '/adapters', {
      method: 'POST',
      body: { publication }
    });
    expect(normalRoute.status).toBe(400);

    const created = await dispatchJson(writeRouter, '/adapter-canaries', {
      method: 'POST',
      body: { publication }
    });
    expect(created.status).toBe(201);
    expect((await store.getMetrics()).adapterCanaryPublications).toBe(1);

    const discoveryRouter = createPoolRouter({ store, requireAuth: true });
    const listed = await dispatchJson(discoveryRouter, `/adapter-canaries?canaryId=${encodeURIComponent(publication.canaryId)}`);
    expect(listed.status).toBe(200);
    expect(listed.body.publications).toHaveLength(1);
    const fetched = await dispatchJson(discoveryRouter, `/adapter-canaries/${encodeURIComponent(publication.publicationHash)}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.publication.publicationHash).toBe(publication.publicationHash);
  });
});
