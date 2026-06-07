import { beforeEach, describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { LAUNCH_MODEL } from '../../server/pool/model-contract.js';
import { DETERMINISTIC_GENERATION_CONFIG, getPolicy } from '../../server/pool/policy-router.js';
import { assignJob } from '../../server/pool/scheduler.js';
import {
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
    expect(lateRejected.status).toBe(400);
    expect(lateRejected.body.routeDecision.mode).toBe('late_non_quorum_receipt_rejected');

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
    const acceptance = await countersignReceipt({
      receiptHash: verifiedJob.receiptHash,
      requesterId: verifiedJob.requesterId,
      accepted: true
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
