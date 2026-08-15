import { describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import {
  createCrossRoomReuseContext,
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedResearchSubmission
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel, getPoolModelContract } from '../../self/pool/model-contract.js';

const recordIdentity = async (kind = 'requester', id = 'route') => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind,
      roleId: `${kind}_${id}`,
      userId: `user_${id}`,
      deviceId: `device_${id}`,
      identityRootId: `root_${id}`
    }),
    getSigningKeyPair: async () => keyPair
  };
};

const requesterIdentity = () => recordIdentity('requester', 'route');

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

  it('verifies a cross-room attachment against its active origin source', async () => {
    const store = createPoolStore();
    const router = createPoolRouter({ store, allowUnauthenticatedLocal: true });
    const originQuestion = await createSignedResearchSubmission({
      identity: await recordIdentity('requester', 'reuse-origin'),
      roomId: 'reuse-origin-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'What does catalog release seven report?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: buildLaunchProviderModel(),
      policyId: 'redundant_agreement'
    });
    const originSource = await createSignedPriorEvidence({
      identity: await recordIdentity('researcher', 'reuse-origin-source'),
      roomId: originQuestion.roomId,
      questionHash: originQuestion.recordHash,
      evidenceKind: 'annotation',
      summary: 'Release seven assigns this public domain annotation.',
      reference: { accession: 'PUBLIC:ROUTE:123', version: '7' },
      annotation: {
        scope: 'domain',
        ontology: { namespace: 'PUBLIC', termId: 'DOMAIN:ROUTE:123', version: '7' },
        sequence: { hash: originQuestion.sequence.hash, length: originQuestion.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_one_based_closed', sourceStart: 2, sourceEnd: 12 }
      },
      provenance: { retrievalMethod: 'version-pinned catalog API', license: 'CC BY 4.0' }
    });
    const originAcceptance = await createSignedHumanClaim({
      identity: await recordIdentity('reviewer', 'reuse-origin-reviewer'),
      roomId: originQuestion.roomId,
      targetHash: originSource.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Accept the source in its origin room.',
      confidence: 0.9,
      decision: 'accepted'
    });
    const currentQuestion = await createSignedResearchSubmission({
      identity: await recordIdentity('requester', 'reuse-current'),
      roomId: 'reuse-current-room',
      sequence: originQuestion.sequence.value,
      intent: { kind: 'question', text: 'Should this disputed domain annotation be retained?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: buildLaunchProviderModel(),
      policyId: 'redundant_agreement'
    });
    for (const record of [originQuestion, originSource, originAcceptance, currentQuestion]) {
      expect((await dispatchJson(router, '/research/records', { method: 'POST', body: { record } })).status)
        .toBe(201);
    }
    const reuseContext = await createCrossRoomReuseContext({
      originRecord: originSource,
      originQuestion,
      currentQuestion
    });
    const attach = async (context, id) => createSignedPriorEvidence({
      identity: await recordIdentity('researcher', id),
      roomId: currentQuestion.roomId,
      questionHash: currentQuestion.recordHash,
      evidenceKind: originSource.evidence.kind,
      summary: 'Attach the exact origin source for independent current-room review.',
      reference: { accession: 'reploid:reuse-origin-room:PUBLIC:ROUTE:123', contentHash: originSource.recordHash },
      annotation: originSource.evidence.annotation,
      reuseContext: context,
      provenance: { retrievalMethod: 'Reploid exact-sequence prior-room lookup', license: 'CC BY 4.0' }
    });
    const valid = await attach(reuseContext, 'reuse-valid-attachment');
    expect((await dispatchJson(router, '/research/records', { method: 'POST', body: { record: valid } })).status)
      .toBe(201);

    const mismatchedContext = structuredClone(reuseContext);
    mismatchedContext.originSource.reference.version = '8';
    const forged = await attach(mismatchedContext, 'reuse-forged-attachment');
    const rejected = await dispatchJson(router, '/research/records', { method: 'POST', body: { record: forged } });
    expect(rejected).toMatchObject({
      status: 409,
      body: {
        error: 'invalid cross-room reuse origin',
        reasons: ['cross-room declared source identity does not match the origin record']
      }
    });
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
