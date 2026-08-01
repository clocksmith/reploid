import { describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { createSignedResearchSubmission } from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;

const requesterIdentity = async () => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind: 'requester',
      roleId: 'requester_route',
      userId: 'user_route',
      deviceId: 'device_route',
      identityRootId: 'root_route'
    }),
    getSigningKeyPair: async () => keyPair
  };
};

const dispatchJson = async (router, path, { method = 'GET', body = null, ip = '127.0.0.1' } = {}) => {
  const url = new URL(path, 'http://reploid.test');
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: `${url.pathname}${url.search}`,
      originalUrl: `${url.pathname}${url.search}`,
      path: url.pathname,
      params: {},
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {},
      body,
      ip
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      end(payload) { resolve({ status: this.statusCode, body: payload || null }); return this; }
    };
    router.handle(req, res, (error) => error ? reject(error) : resolve({ status: 404, body: {} }));
  });
};

const makeSubmission = async () => createSignedResearchSubmission({
  identity: await requesterIdentity(),
  roomId: 'route-room',
  sequence: 'MAPLALLLLGLVAGA',
  intent: { kind: 'question', text: 'Which related public records have reviewed evidence?' },
  consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
  modelContract: {
    id: 'esm2-small',
    hash: fakeHash('1'),
    manifestHash: fakeHash('2'),
    runtime: 'doppler',
    backend: 'browser-webgpu',
    workload: 'sequence.embedding.v1',
    executionMode: 'full_model_browser_sequence',
    dimensions: 3
  },
  policyId: 'redundant_agreement'
});

describe('Poolday research evidence coordinator routes', () => {
  it('keeps public discovery read-only and requires authentication for publication', async () => {
    const router = createPoolRouter({ store: createPoolStore(), requireAuth: true });
    const record = await makeSubmission();
    const response = await dispatchJson(router, '/research/records', {
      method: 'POST',
      body: { record },
      ip: '203.0.113.10'
    });
    expect(response.status).toBe(401);
    expect(response.body.error).toContain('Firebase auth token required');
  });

  it('publishes immutable evidence and exposes public room discovery', async () => {
    const store = createPoolStore();
    const writer = createPoolRouter({ store, allowUnauthenticatedLocal: true });
    const record = await makeSubmission();

    const created = await dispatchJson(writer, '/research/records', { method: 'POST', body: { record } });
    expect(created.status).toBe(201);
    const duplicate = await dispatchJson(writer, '/research/records', { method: 'POST', body: { record } });
    expect(duplicate.status).toBe(200);

    const publicReader = createPoolRouter({ store, requireAuth: true });
    const listed = await dispatchJson(publicReader, '/research/rooms/route-room/records');
    expect(listed.status).toBe(200);
    expect(listed.body.records).toEqual([record]);
    const fetched = await dispatchJson(publicReader, `/research/records/${encodeURIComponent(record.recordHash)}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.record.recordHash).toBe(record.recordHash);
  });

  it('rejects unsigned or tampered public evidence', async () => {
    const router = createPoolRouter({ store: createPoolStore(), allowUnauthenticatedLocal: true });
    const record = await makeSubmission();
    const tampered = { ...record, requesterIntent: { ...record.requesterIntent, text: 'tampered' } };
    const response = await dispatchJson(router, '/research/records', { method: 'POST', body: { record: tampered } });
    expect(response.status).toBe(400);
    expect(response.body.reasons).toContain('record hash mismatch');
  });
});
