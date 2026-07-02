import { beforeEach, describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { LAUNCH_MODEL } from '../../server/pool/model-contract.js';
import { DETERMINISTIC_GENERATION_CONFIG, getPolicy } from '../../server/pool/policy-router.js';
import { assignJob } from '../../server/pool/scheduler.js';
import { runtimeProfileHash as serverRuntimeProfileHash } from '../../server/pool/runtime-profile.js';
import {
  buildAcceptanceSummary,
  buildPoolReceipt,
  countersignReceipt,
  createSigningKeyPair,
  exportPublicKey,
  signProviderReceipt
} from '../../self/pool/inference-receipt.js';
import {
  buildRuntimeProfile
} from '../../self/pool/runtime-profile.js';
import {
  buildAssignmentCommitmentPayload,
  buildAssignmentRevealPayload
} from '../../self/pool/p2p-payload.js';

const dispatchJson = async (router, path, { method = 'GET', body = null, headers = {} } = {}) => {
  const url = new URL(path, 'http://reploid.test');
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: `${url.pathname}${url.search}`,
      originalUrl: `${url.pathname}${url.search}`,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body,
      ip: '127.0.0.1'
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[name.toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload || null });
        return this;
      }
    };
    router.handle(req, res, (error) => {
      if (error) reject(error);
      else resolve({ status: 404, body: {} });
    });
  });
};

const launchModel = () => ({
  modelId: LAUNCH_MODEL.modelId,
  modelHash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  runtime: LAUNCH_MODEL.runtime,
  backend: LAUNCH_MODEL.backend
});

const registerRingProviders = async (store, count) => {
  const providers = new Map();
  const runtimeProfile = buildRuntimeProfile({
    modelInfo: launchModel(),
    runtimeInfo: {
      runtime: LAUNCH_MODEL.runtime,
      backend: LAUNCH_MODEL.backend,
      publicApi: 'generate',
      profile: { implementation: 'route-test-runtime' },
      kernelProfileHash: 'sha256:route-test-kernel'
    },
    deviceInfo: {
      hasWebGPU: true,
      probeStatus: 'ok',
      adapterInfo: {
        vendor: 'route-test-vendor',
        architecture: 'route-test-arch',
        device: 'route-test-device',
        description: 'route test adapter'
      },
      features: ['shader-f16'],
      limits: { maxBufferSize: 1024 },
      shaderProfile: 'route-test-shader'
    },
    browserProfile: {
      userAgent: 'route-test-browser',
      family: 'route-test-browser',
      majorVersion: '1',
      platform: 'route-test-platform',
      brands: ['RouteTest:1'],
      mobile: false
    }
  });
  const runtimeProfileHash = serverRuntimeProfileHash(runtimeProfile);
  for (let index = 0; index < count; index += 1) {
    const keyPair = await createSigningKeyPair();
    const providerId = `provider_${index}`;
    const provider = store.registerProvider({
      providerId,
      publicKey: await exportPublicKey(keyPair.publicKey),
      runtimeProfile,
      runtimeProfileHash,
      models: [launchModel()],
      availability: {
        acceptedPolicies: ['ring_quorum_receipt']
      }
    });
    store.updateReputation(providerId, {
      acceptedReceipts: 3,
      rejectedReceipts: 0,
      timeouts: 0,
      admissionLane: 'trusted_browser_provider',
      ringEligible: true
    });
    providers.set(providerId, { provider, keyPair });
  }
  return providers;
};

const createRingJob = async ({ store, providerCount = 4 } = {}) => {
  const providers = await registerRingProviders(store, providerCount);
  const requesterKeys = await createSigningKeyPair();
  const policy = getPolicy('ring_quorum_receipt');
  const job = store.createJob({
    requesterId: 'requester_ring',
    requesterPublicKey: await exportPublicKey(requesterKeys.publicKey),
    prompt: 'deterministic ring prompt',
    policyId: 'ring_quorum_receipt',
    modelRequirements: launchModel(),
    generationConfig: { ...DETERMINISTIC_GENERATION_CONFIG },
    verificationLevel: policy.verificationLevel,
    trustTier: policy.trustTier
  });
  const assignmentResult = await assignJob({ store, job, policy });
  return {
    providers,
    requesterKeys,
    policy,
    job: await store.getJob(job.jobId),
    assignments: assignmentResult.assignments
  };
};

const signedReceiptFor = async ({ assignment, providerKeys, outputText = 'same output', tokenIds = [1, 2, 3] }) => {
  const transcript = { outputText, tokenIds };
  const receipt = await buildPoolReceipt({
    assignment,
    provider: { device: {} },
    model: assignment.model,
    runtime: { runtime: 'doppler', backend: 'browser-webgpu' },
    execution: {
      outputText,
      tokenIds,
      transcript,
      tokenCounts: { input: 1, output: tokenIds.length },
      timing: {}
    }
  });
  receipt.verification.runtimeProfileHash = assignment.runtimeProfileHash;
  return {
    outputText,
    tokenIds,
    transcript,
    receipt: await signProviderReceipt(receipt, providerKeys.keyPair.privateKey)
  };
};

const submitReceipt = async (router, assignment, payload) => dispatchJson(router, `/assignments/${assignment.assignmentId}/receipt`, {
  method: 'POST',
  body: payload
});

const unlockRingP2pTransport = async (store, assignment) => {
  await store.updateJob(assignment.jobId, { ringPhase: 'reveal_open' });
  await store.updateAssignment(assignment.assignmentId, { status: 'reveal_open' });
};

const openRingReveal = async ({ router, assignments, providers, outputText = 'same output', tokenIds = [1, 2, 3] }) => {
  const payloads = new Map();
  const commitments = new Map();
  for (const assignment of assignments) {
    const payload = await signedReceiptFor({
      assignment,
      providerKeys: providers.get(assignment.providerId),
      outputText,
      tokenIds
    });
    payloads.set(assignment.assignmentId, payload);
    const execution = {
      outputText: payload.outputText,
      tokenIds: payload.tokenIds,
      transcript: payload.transcript
    };
    const commitment = await buildAssignmentCommitmentPayload({
      assignment,
      providerId: assignment.providerId,
      execution,
      receipt: payload.receipt,
      salt: `salt_${assignment.assignmentId}`
    });
    commitments.set(assignment.assignmentId, commitment);
    await dispatchJson(router, `/assignments/${assignment.assignmentId}/commit`, {
      method: 'POST',
      body: commitment
    });
  }
  for (const assignment of assignments) {
    const payload = payloads.get(assignment.assignmentId);
    const reveal = await buildAssignmentRevealPayload({
      assignment,
      providerId: assignment.providerId,
      execution: {
        outputText: payload.outputText,
        tokenIds: payload.tokenIds,
        transcript: payload.transcript
      },
      receipt: payload.receipt,
      salt: `salt_${assignment.assignmentId}`,
      commitmentHash: commitments.get(assignment.assignmentId).commitmentHash
    });
    await dispatchJson(router, `/assignments/${assignment.assignmentId}/reveal`, {
      method: 'POST',
      body: reveal
    });
  }
  return payloads;
};

describe('pool coordinator routes', () => {
  let store;
  let router;

  beforeEach(() => {
    store = createPoolStore();
    store.kind = 'firestore';
    router = createPoolRouter({ store });
  });

  it('keeps safe discovery routes public when persistent storage requires auth', async () => {
    const status = await dispatchJson(router, '/status');
    expect(status.status).toBe(200);
    expect(status.body.product).toBe('reploid_browser_inference_pool');

    const policies = await dispatchJson(router, '/policies');
    expect(policies.status).toBe(200);
    expect(policies.body.policies.map((policy) => policy.policyId)).toContain('fastest_receipt');
    const ringPolicy = policies.body.policies.find((policy) => policy.policyId === 'ring_quorum_receipt');
    expect(ringPolicy.adaptiveRing).toBe(true);
    expect(ringPolicy.maxRingSize).toBe(12);
    expect(ringPolicy.trustTier).toBe('adaptive_T1_to_T4_ring_quorum_receipt');
    expect(ringPolicy.policyTrustTier).toBe('T4_ring_quorum_receipt');

    const jobs = await dispatchJson(router, '/jobs', {
      method: 'POST',
      body: {}
    });
    expect(jobs.status).toBe(401);
    expect(jobs.body.error).toBe('Firebase auth token required');
  });

  it('rejects providers that do not advertise the exact launch model identity', async () => {
    store.kind = 'memory';
    const response = await dispatchJson(router, '/providers/register', {
      method: 'POST',
      body: {
        providerId: 'provider_local',
        publicKey: 'public-key',
        models: [{
          modelId: LAUNCH_MODEL.modelId,
          modelHash: 'sha256:wrong',
          manifestHash: LAUNCH_MODEL.manifestHash,
          runtime: LAUNCH_MODEL.runtime,
          backend: LAUNCH_MODEL.backend
        }]
      }
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('provider must advertise the exact launch model identity');
  });

  it('absorbs one invalid ring receipt while quorum remains possible', async () => {
    store.kind = 'memory';
    const { providers, assignments, job } = await createRingJob({ store, providerCount: 4 });
    const payloads = await openRingReveal({ router, assignments, providers });
    const [badAssignment, ...quorumAssignments] = assignments;
    const badPayload = payloads.get(badAssignment.assignmentId);
    const rejected = await submitReceipt(router, badAssignment, {
      ...badPayload,
      outputText: 'tampered output',
      transcript: {
        outputText: 'tampered output',
        tokenIds: badPayload.tokenIds
      }
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.routeDecision.agreement.status).toBe('pending');
    expect(rejected.body.routeDecision.agreement.remainingProviders).toBe(3);
    expect(rejected.body.routeDecision.reassignment.drained).toBe(0);
    expect((await store.getJob(job.jobId)).status).toBe('awaiting_ring_quorum_receipts');

    for (const assignment of quorumAssignments) {
      const validPayload = payloads.get(assignment.assignmentId);
      await submitReceipt(router, assignment, validPayload);
    }

    const acceptedJob = await store.getJob(job.jobId);
    expect(acceptedJob.status).toBe('receipt_verified');
    expect(acceptedJob.agreement.status).toBe('accepted');
    expect(acceptedJob.agreement.acceptedReceipts).toBe(3);
    expect(acceptedJob.agreement.rejectedReceipts).toBe(1);
    expect(acceptedJob.receiptHashes).toHaveLength(3);
  });

  it('rejects ring receipts before the assignment reveal is submitted', async () => {
    store.kind = 'memory';
    const { providers, assignments } = await createRingJob({ store, providerCount: 4 });
    const assignment = assignments[0];
    const payload = await signedReceiptFor({
      assignment,
      providerKeys: providers.get(assignment.providerId)
    });
    const rejected = await submitReceipt(router, assignment, payload);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toBe('ring reveal must be submitted before receipt');
  });

  it('does not downgrade an accepted ring agreement from a late invalid receipt', async () => {
    store.kind = 'memory';
    const { providers, assignments, job } = await createRingJob({ store, providerCount: 4 });
    const payloads = await openRingReveal({ router, assignments, providers });
    for (const assignment of assignments.slice(0, 3)) {
      const validPayload = payloads.get(assignment.assignmentId);
      await submitReceipt(router, assignment, validPayload);
    }
    const verifiedJob = await store.getJob(job.jobId);
    expect(verifiedJob.status).toBe('receipt_verified');
    expect(verifiedJob.agreement.status).toBe('accepted');

    const lateAssignment = assignments[3];
    expect((await store.getAssignment(lateAssignment.assignmentId)).status).toBe('superseded');
    const latePayload = payloads.get(lateAssignment.assignmentId);
    const lateRejected = await submitReceipt(router, lateAssignment, {
      ...latePayload,
      outputText: 'late tampered output',
      transcript: {
        outputText: 'late tampered output',
        tokenIds: latePayload.tokenIds
      }
    });
    expect(lateRejected.status).toBe(409);
    expect(lateRejected.body.error).toBe('assignment is not active');

    const stillVerifiedJob = await store.getJob(job.jobId);
    expect(stillVerifiedJob.status).toBe('receipt_verified');
    expect(stillVerifiedJob.verifierDecision.accepted).toBe(true);
    expect(stillVerifiedJob.agreement.status).toBe('accepted');
    expect(stillVerifiedJob.receiptHashes).toEqual(verifiedJob.receiptHashes);
  });

  it('rejects active-looking receipts from stale ring attempts after reassignment', async () => {
    store.kind = 'memory';
    const { providers, assignments, job } = await createRingJob({ store, providerCount: 4 });
    const payloads = await openRingReveal({ router, assignments, providers });
    for (const assignment of assignments.slice(0, 2)) {
      const badPayload = payloads.get(assignment.assignmentId);
      await submitReceipt(router, assignment, {
        ...badPayload,
        outputText: `tampered ${assignment.assignmentId}`,
        transcript: {
          outputText: `tampered ${assignment.assignmentId}`,
          tokenIds: badPayload.tokenIds
        }
      });
    }
    const retriedJob = await store.getJob(job.jobId);
    expect(retriedJob.assignmentAttemptId).toBeGreaterThan(assignments[2].assignmentAttemptId);
    expect(retriedJob.assignmentIds).not.toContain(assignments[2].assignmentId);

    await store.updateAssignment(assignments[2].assignmentId, { status: 'running' });
    const stalePayload = payloads.get(assignments[2].assignmentId);
    const stale = await submitReceipt(router, assignments[2], stalePayload);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('assignment does not match current job attempt');
    expect((await store.getAssignment(assignments[2].assignmentId)).status).toBe('stale');
  });

  it('uses ring-specific ledger reasons for accepted ring quorum receipts', async () => {
    store.kind = 'memory';
    const { providers, requesterKeys, assignments, job } = await createRingJob({ store, providerCount: 4 });
    const payloads = await openRingReveal({ router, assignments, providers });
    for (const assignment of assignments.slice(0, 3)) {
      const validPayload = payloads.get(assignment.assignmentId);
      await submitReceipt(router, assignment, validPayload);
    }
    const verifiedJob = await store.getJob(job.jobId);
    const receiptRecords = verifiedJob.receiptHashes.map((currentReceiptHash) => store.getReceipt(currentReceiptHash));
    const acceptanceSummary = await buildAcceptanceSummary({
      job: verifiedJob,
      receiptHash: verifiedJob.receiptHash,
      receiptRecords
    });
    const acceptance = await countersignReceipt({
      receiptHash: verifiedJob.receiptHash,
      requesterId: verifiedJob.requesterId,
      accepted: true,
      ...acceptanceSummary
    }, requesterKeys.privateKey);
    const accepted = await dispatchJson(router, `/receipts/${encodeURIComponent(verifiedJob.receiptHash)}/accept`, {
      method: 'POST',
      body: acceptance
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.ledgerEvents).toHaveLength(3);
    expect(accepted.body.ledgerEvents.every((event) => event.reason === 'ring_quorum_receipt_accepted')).toBe(true);
    expect(accepted.body.requesterSpendEvent.reason).toBe('ring_quorum_receipt_spend');
  });
});

describe('pool ring quorum timeout and acceptance binding', () => {
  let store;
  let router;

  beforeEach(() => {
    store = createPoolStore();
    store.kind = 'memory';
    router = createPoolRouter({ store });
  });

  it('keeps ring quorum pending when one current assignment expires and quorum is still reachable', async () => {
    const { assignments, job } = await createRingJob({ store, providerCount: 4 });
    store.updateAssignment(assignments[0].assignmentId, {
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });

    const expired = store.expireStaleAssignments();
    expect(expired).toHaveLength(1);

    const refreshedJob = store.getJob(job.jobId);
    expect(refreshedJob.status).toBe('awaiting_ring_quorum_receipts');
    expect(refreshedJob.retryable).toBe(false);
    expect(refreshedJob.failedAssignmentIds).toContain(assignments[0].assignmentId);
    expect(refreshedJob.agreement.status).toBe('pending');
    expect(refreshedJob.agreement.remainingProviders).toBe(3);
  });

  it('retires non-quorum assignments and does not let expiration downgrade an accepted ring quorum', async () => {
    const { providers, assignments, job } = await createRingJob({ store, providerCount: 4 });
    const payloads = await openRingReveal({ router, assignments, providers });
    for (const assignment of assignments.slice(0, 3)) {
      const validPayload = payloads.get(assignment.assignmentId);
      await submitReceipt(router, assignment, validPayload);
    }

    const verifiedJob = store.getJob(job.jobId);
    expect(verifiedJob.status).toBe('receipt_verified');
    expect(verifiedJob.agreement.status).toBe('accepted');
    expect(verifiedJob.supersededAssignmentIds).toContain(assignments[3].assignmentId);
    expect(store.getAssignment(assignments[3].assignmentId).status).toBe('superseded');

    store.updateAssignment(assignments[3].assignmentId, {
      status: 'running',
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });
    store.expireStaleAssignments();

    const stillVerifiedJob = store.getJob(job.jobId);
    expect(stillVerifiedJob.status).toBe('receipt_verified');
    expect(stillVerifiedJob.agreement.status).toBe('accepted');
    expect(stillVerifiedJob.receiptHashes).toEqual(verifiedJob.receiptHashes);
  });

  it('rejects requester acceptance that does not bind the accepted receipt set and spend', async () => {
    const { providers, assignments, job, requesterKeys } = await createRingJob({ store, providerCount: 4 });
    const payloads = await openRingReveal({ router, assignments, providers });
    for (const assignment of assignments.slice(0, 3)) {
      const validPayload = payloads.get(assignment.assignmentId);
      await submitReceipt(router, assignment, validPayload);
    }

    const verifiedJob = store.getJob(job.jobId);
    const receiptHash = verifiedJob.receiptHash;
    const weakAcceptance = await countersignReceipt({
      receiptHash,
      requesterId: verifiedJob.requesterId,
      accepted: true
    }, requesterKeys.privateKey);
    const weakResponse = await dispatchJson(router, `/receipts/${receiptHash}/accept`, {
      method: 'POST',
      body: weakAcceptance
    });
    expect(weakResponse.status).toBe(400);
    expect(weakResponse.body.verifierDecision.reasons).toContain('acceptance agreementHash mismatch');

    const receiptRecords = verifiedJob.receiptHashes.map((currentReceiptHash) => store.getReceipt(currentReceiptHash));
    const acceptanceSummary = await buildAcceptanceSummary({
      job: verifiedJob,
      receiptHash,
      receiptRecords
    });
    const strongAcceptance = await countersignReceipt({
      receiptHash,
      requesterId: verifiedJob.requesterId,
      accepted: true,
      ...acceptanceSummary
    }, requesterKeys.privateKey);
    const acceptedResponse = await dispatchJson(router, `/receipts/${receiptHash}/accept`, {
      method: 'POST',
      body: strongAcceptance
    });
    expect(acceptedResponse.status).toBe(200);
    expect(store.getJob(job.jobId).status).toBe('accepted');
  });
});

describe('pool hybrid p2p signaling routes', () => {
  let store;
  let router;

  beforeEach(() => {
    store = createPoolStore();
    store.kind = 'memory';
    router = createPoolRouter({ store });
  });

  it('creates assignment-bound signaling sessions and exchanges metadata messages', async () => {
    const { assignments } = await createRingJob({ store, providerCount: 1 });
    const assignment = assignments[0];
    await unlockRingP2pTransport(store, assignment);
    const created = await dispatchJson(router, '/signaling/sessions', {
      method: 'POST',
      body: { assignmentId: assignment.assignmentId }
    });
    expect(created.status).toBe(201);
    expect(created.body.session.assignmentId).toBe(assignment.assignmentId);
    expect(created.body.session.participantIds).toContain(assignment.requesterId);
    expect(created.body.session.participantIds).toContain(assignment.providerId);

    const sessionId = created.body.session.sessionId;
    const published = await dispatchJson(router, `/signaling/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: {
        type: 'offer',
        fromPeerId: assignment.requesterId,
        toPeerId: assignment.providerId,
        payload: { type: 'offer', sdp: 'v=0' },
        createdAt: 100
      }
    });
    expect(published.status).toBe(201);

    const listed = await dispatchJson(router, `/signaling/sessions/${sessionId}/messages?peerId=${encodeURIComponent(assignment.providerId)}`);
    expect(listed.status).toBe(200);
    expect(listed.body.messages).toHaveLength(1);
    expect(listed.body.messages[0].type).toBe('offer');
  });

  it('binds signaling message publishers to authenticated participants', async () => {
    router = createPoolRouter({
      store,
      requireAuth: true,
      verifyAuthToken: async (token) => ({ uid: token })
    });
    const { assignments } = await createRingJob({ store, providerCount: 1 });
    const assignment = assignments[0];
    await unlockRingP2pTransport(store, assignment);
    const created = await dispatchJson(router, '/signaling/sessions', {
      method: 'POST',
      headers: { authorization: 'Bearer ring' },
      body: { assignmentId: assignment.assignmentId }
    });
    expect(created.status).toBe(201);

    const sessionId = created.body.session.sessionId;
    const wrongPublisher = await dispatchJson(router, `/signaling/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { authorization: 'Bearer ring' },
      body: {
        type: 'offer',
        fromPeerId: assignment.providerId,
        toPeerId: assignment.requesterId,
        payload: { type: 'offer', sdp: 'v=0' }
      }
    });
    expect(wrongPublisher.status).toBe(403);
    expect(wrongPublisher.body.error).toBe('authenticated identity does not match signal fromPeerId');

    const providerPublisher = await dispatchJson(router, `/signaling/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { authorization: 'Bearer 0' },
      body: {
        type: 'answer',
        fromPeerId: assignment.providerId,
        toPeerId: assignment.requesterId,
        payload: { type: 'answer', sdp: 'v=0' }
      }
    });
    expect(providerPublisher.status).toBe(201);
    expect(providerPublisher.body.message.fromPeerId).toBe(assignment.providerId);
  });
});

describe('pool signaling production guards', () => {
  let store;
  let router;

  beforeEach(() => {
    store = createPoolStore();
    store.kind = 'memory';
    router = createPoolRouter({ store });
  });

  it('rejects signaling sessions for expired assignments', async () => {
    const { assignments } = await createRingJob({ store, providerCount: 1 });
    store.updateAssignment(assignments[0].assignmentId, {
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });

    const response = await dispatchJson(router, '/signaling/sessions', {
      method: 'POST',
      body: { assignmentId: assignments[0].assignmentId }
    });

    expect(response.status).toBe(410);
    expect(response.body.error).toBe('assignment expired');
  });

  it('rejects non-WebRTC signaling types and oversized metadata payloads', async () => {
    const { assignments } = await createRingJob({ store, providerCount: 1 });
    const assignment = assignments[0];
    await unlockRingP2pTransport(store, assignment);
    const created = await dispatchJson(router, '/signaling/sessions', {
      method: 'POST',
      body: { assignmentId: assignment.assignmentId }
    });
    const sessionId = created.body.session.sessionId;

    const invalidType = await dispatchJson(router, `/signaling/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: {
        type: 'prompt-payload',
        fromPeerId: assignment.requesterId,
        toPeerId: assignment.providerId,
        payload: { prompt: 'should not ride signaling' }
      }
    });
    expect(invalidType.status).toBe(400);
    expect(invalidType.body.error).toBe('signal type is not allowed');

    const oversized = await dispatchJson(router, `/signaling/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: {
        type: 'offer',
        fromPeerId: assignment.requesterId,
        toPeerId: assignment.providerId,
        payload: { sdp: 'x'.repeat(70 * 1024) }
      }
    });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toBe('signal payload exceeds metadata size limit');
  });

  it('relays peer-room rendezvous envelopes without accepting inference payloads', async () => {
    const roomId = 'peer_room_route_test';
    const published = await dispatchJson(router, `/peer/rooms/${roomId}/messages`, {
      method: 'POST',
      body: {
        peerRoomVersion: 'reploid_peer_room/v1',
        roomId,
        type: 'provider-advert',
        body: {
          advert: {
            fromPeerId: 'provider_route',
            body: {
              providerId: 'provider_route'
            }
          }
        },
        relay: {
          relayId: 'relay_route_1',
          fromPeerId: 'provider_route',
          createdAt: 1000,
          expiresAt: Date.now() + 10000
        }
      }
    });

    expect(published.status).toBe(201);
    expect(published.body.message).toMatchObject({
      roomId,
      fromPeerId: 'provider_route',
      type: 'provider-advert'
    });

    const listed = await dispatchJson(router, `/peer/rooms/${roomId}/messages?peerId=provider_route`);
    expect(listed.status).toBe(200);
    expect(listed.body.messages).toHaveLength(0);

    const listedForRequester = await dispatchJson(router, `/peer/rooms/${roomId}/messages?peerId=requester_route`);
    expect(listedForRequester.status).toBe(200);
    expect(listedForRequester.body.messages[0].message.type).toBe('provider-advert');

    const runRequest = await dispatchJson(router, `/peer/rooms/${roomId}/messages`, {
      method: 'POST',
      body: {
        peerRoomVersion: 'reploid_peer_room/v1',
        roomId,
        type: 'peer-run-request',
        body: {
          fromPeerId: 'stale_provider_field',
          requesterId: 'requester_route',
          providerId: 'provider_route',
          sessionId: 'session_route',
          assignmentId: 'assignment_route'
        },
        relay: {
          relayId: 'relay_route_2',
          fromPeerId: 'stale_provider_field',
          createdAt: 1001,
          expiresAt: Date.now() + 10000
        }
      }
    });
    expect(runRequest.status).toBe(201);
    expect(runRequest.body.message).toMatchObject({
      roomId,
      fromPeerId: 'requester_route',
      type: 'peer-run-request'
    });

    const listedForProvider = await dispatchJson(router, `/peer/rooms/${roomId}/messages?peerId=provider_route`);
    expect(listedForProvider.status).toBe(200);
    expect(listedForProvider.body.messages.some((message) => message.type === 'peer-run-request')).toBe(true);

    const summary = await dispatchJson(router, `/peer/rooms/${roomId}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      roomId,
      relay: 'server',
      messageCount: 2,
      peerCount: 2,
      providerCount: 1,
      typeCounts: {
        'provider-advert': 1,
        'peer-run-request': 1
      }
    });
    expect(summary.body.providers[0]).toMatchObject({
      providerId: 'provider_route'
    });

    const rooms = await dispatchJson(router, '/peer/rooms');
    expect(rooms.status).toBe(200);
    expect(rooms.body.rooms[0]).toMatchObject({
      roomId,
      messageCount: 2,
      peerCount: 2
    });

    const forbidden = await dispatchJson(router, `/peer/rooms/${roomId}/messages`, {
      method: 'POST',
      body: {
        peerRoomVersion: 'reploid_peer_room/v1',
        roomId,
        type: 'peer-run-request',
        body: {
          prompt: 'must not be relayed'
        }
      }
    });
    expect(forbidden.status).toBe(400);
    expect(forbidden.body.error).toContain('must not carry');
  });
});
