import { describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { createSignedResearchSubmission } from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel, getPoolModelContract } from '../../self/pool/model-contract.js';

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

const makeSubmission = async ({
  roomId = 'route-room',
  sequence = 'MAPLALLLLGLVAGA'
} = {}) => createSignedResearchSubmission({
  identity: await requesterIdentity(),
  roomId,
  sequence,
  intent: { kind: 'question', text: 'Which related public records have reviewed evidence?' },
  consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
  modelContract: buildLaunchProviderModel(),
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

  it('projects exact public sequence evidence across rooms without admitting current-room records as reuse candidates', async () => {
    const store = createPoolStore();
    const first = await makeSubmission({ roomId: 'prior-room-a' });
    const duplicateSequence = await makeSubmission({ roomId: 'prior-room-b' });
    const unrelated = await makeSubmission({ roomId: 'unrelated-room', sequence: 'MKTIIALSYIFCLVFA' });
    for (const record of [first, duplicateSequence, unrelated]) store.saveResearchRecord(record);
    const publicReader = createPoolRouter({ store, requireAuth: true });

    const response = await dispatchJson(publicReader,
      `/research/sequences/${encodeURIComponent(first.sequence.hash)}/evidence?currentRoomId=prior-room-a&limit=50`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schema: 'poolday.cross_room_sequence_evidence/v1',
      currentRoomId: 'prior-room-a',
      complete: true
    });
    expect(response.body.rooms.map((room) => room.roomId)).toEqual(['prior-room-a', 'prior-room-b']);
    expect(response.body.rooms.find((room) => room.roomId === 'prior-room-a').currentRoom).toBe(true);
    expect(response.body.records.map((record) => record.recordHash).sort()).toEqual([
      first.recordHash,
      duplicateSequence.recordHash
    ].sort());
    expect(response.body.candidates).toEqual([]);

    const invalid = await dispatchJson(publicReader, '/research/sequences/not-a-hash/evidence');
    expect(invalid).toMatchObject({
      status: 400,
      body: {
        error: 'invalid sequence evidence query',
        reasons: ['sequenceHash must be a SHA-256 identity']
      }
    });
  });

  it('rejects unsigned or tampered public evidence', async () => {
    const router = createPoolRouter({ store: createPoolStore(), allowUnauthenticatedLocal: true });
    const record = await makeSubmission();
    const tampered = { ...record, requesterIntent: { ...record.requesterIntent, text: 'tampered' } };
    const response = await dispatchJson(router, '/research/records', { method: 'POST', body: { record: tampered } });
    expect(response.status).toBe(400);
    expect(response.body.reasons).toContain('record hash mismatch');
  });

  it('rejects a signed disabled-model record before it reaches the evidence registry', async () => {
    const router = createPoolRouter({ store: createPoolStore(), allowUnauthenticatedLocal: true });
    const candidate = getPoolModelContract('amplify-120m-f16-af32');
    const record = await createSignedResearchSubmission({
      identity: await requesterIdentity(),
      roomId: 'route-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'Candidate records must not publish before promotion.' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: candidate,
      policyId: 'redundant_agreement'
    });
    const response = await dispatchJson(router, '/research/records', { method: 'POST', body: { record } });
    expect(response).toMatchObject({
      status: 409,
      body: {
        error: 'unadmitted research model contract',
        reasons: ['model contract is not a currently enabled Poolday model']
      }
    });
  });
});
