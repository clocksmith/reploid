import { beforeEach, describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { LAUNCH_MODEL } from '../../server/pool/model-contract.js';
import { DETERMINISTIC_GENERATION_CONFIG, getPolicy } from '../../server/pool/policy-router.js';
import { assignJob } from '../../server/pool/scheduler.js';
import {
  buildAcceptanceSummary,
  buildPoolReceipt,
  countersignReceipt,
  createSigningKeyPair,
  exportPublicKey,
  signProviderReceipt
} from '../../self/pool/inference-receipt.js';

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
  for (let index = 0; index < count; index += 1) {
    const keyPair = await createSigningKeyPair();
    const providerId = `provider_${index}`;
    const provider = store.registerProvider({
      providerId,
      publicKey: await exportPublicKey(keyPair.publicKey),
      models: [launchModel()],
      availability: {
        acceptedPolicies: ['ring_quorum_receipt']
      }
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
    expect(ringPolicy.maxRingSize).toBe(4);
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
    const [badAssignment, ...quorumAssignments] = assignments;
    const badPayload = await signedReceiptFor({
      assignment: badAssignment,
      providerKeys: providers.get(badAssignment.providerId)
    });
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
      const validPayload = await signedReceiptFor({
        assignment,
        providerKeys: providers.get(assignment.providerId)
      });
      await submitReceipt(router, assignment, validPayload);
    }

    const acceptedJob = await store.getJob(job.jobId);
    expect(acceptedJob.status).toBe('receipt_verified');
    expect(acceptedJob.agreement.status).toBe('accepted');
    expect(acceptedJob.agreement.acceptedReceipts).toBe(3);
    expect(acceptedJob.agreement.rejectedReceipts).toBe(1);
    expect(acceptedJob.receiptHashes).toHaveLength(3);
  });

  it('does not downgrade an accepted ring agreement from a late invalid receipt', async () => {
    store.kind = 'memory';
    const { providers, assignments, job } = await createRingJob({ store, providerCount: 4 });
    for (const assignment of assignments.slice(0, 3)) {
      const validPayload = await signedReceiptFor({
        assignment,
        providerKeys: providers.get(assignment.providerId)
      });
      await submitReceipt(router, assignment, validPayload);
    }
    const verifiedJob = await store.getJob(job.jobId);
    expect(verifiedJob.status).toBe('receipt_verified');
    expect(verifiedJob.agreement.status).toBe('accepted');

    const lateAssignment = assignments[3];
    expect((await store.getAssignment(lateAssignment.assignmentId)).status).toBe('superseded');
    const latePayload = await signedReceiptFor({
      assignment: lateAssignment,
      providerKeys: providers.get(lateAssignment.providerId)
    });
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
    for (const assignment of assignments.slice(0, 2)) {
      const badPayload = await signedReceiptFor({
        assignment,
        providerKeys: providers.get(assignment.providerId)
      });
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
    const stalePayload = await signedReceiptFor({
      assignment: assignments[2],
      providerKeys: providers.get(assignments[2].providerId)
    });
    const stale = await submitReceipt(router, assignments[2], stalePayload);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('assignment does not match current job attempt');
    expect((await store.getAssignment(assignments[2].assignmentId)).status).toBe('stale');
  });

  it('uses ring-specific ledger reasons for accepted ring quorum receipts', async () => {
    store.kind = 'memory';
    const { providers, requesterKeys, assignments, job } = await createRingJob({ store, providerCount: 4 });
    for (const assignment of assignments.slice(0, 3)) {
      const validPayload = await signedReceiptFor({
        assignment,
        providerKeys: providers.get(assignment.providerId)
      });
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
    for (const assignment of assignments.slice(0, 3)) {
      const validPayload = await signedReceiptFor({
        assignment,
        providerKeys: providers.get(assignment.providerId)
      });
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
    for (const assignment of assignments.slice(0, 3)) {
      const validPayload = await signedReceiptFor({
        assignment,
        providerKeys: providers.get(assignment.providerId)
      });
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
