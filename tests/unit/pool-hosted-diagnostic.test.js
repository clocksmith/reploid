import { describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { createProviderClient } from '../../self/pool/provider-client.js';
import { createRequesterClient } from '../../self/pool/requester-client.js';
import {
  buildLaunchProviderModel,
  LAUNCH_MODEL
} from '../../self/pool/model-contract.js';
import {
  createSigningKeyPair,
  exportPublicKey
} from '../../self/pool/inference-receipt.js';
import {
  createRoleDelegation,
  getDeviceRootIdentity
} from '../../self/pool/device-identity.js';
import {
  createSignedParticipationProfile
} from '../../self/pool/participation-profile.js';
import {
  buildRuntimeProfile,
  hashRuntimeProfile
} from '../../self/pool/runtime-profile.js';
import {
  TEST_PUBLIC_PROTEIN_SEQUENCE,
  makePublicProteinJobFields,
  makeSequenceExecution
} from '../helpers/pool-sequence-fixture.js';

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

const unwrap = async (responsePromise) => {
  const response = await responsePromise;
  if (response.status >= 400) {
    const error = new Error(response.body?.error || `Pool route failed: ${response.status}`);
    error.status = response.status;
    error.payload = response.body;
    throw error;
  }
  return response.body;
};

const createRouteSdk = (router) => ({
  submitJob: (body) => unwrap(dispatchJson(router, '/jobs', { method: 'POST', body })),
  pollJob: (jobId) => unwrap(dispatchJson(router, `/jobs/${jobId}`)),
  registerProvider: (body) => unwrap(dispatchJson(router, '/providers/register', { method: 'POST', body })),
  heartbeatProvider: (body) => unwrap(dispatchJson(router, '/providers/heartbeat', { method: 'POST', body })),
  nextAssignment: (providerId) => unwrap(dispatchJson(
    router,
    `/providers/assignments/next?providerId=${encodeURIComponent(providerId)}`
  )),
  submitAssignmentCommitment: (assignmentId, body) => unwrap(dispatchJson(
    router,
    `/assignments/${assignmentId}/commit`,
    { method: 'POST', body }
  )),
  submitAssignmentReveal: (assignmentId, body) => unwrap(dispatchJson(
    router,
    `/assignments/${assignmentId}/reveal`,
    { method: 'POST', body }
  )),
  submitReceipt: (assignmentId, body) => unwrap(dispatchJson(
    router,
    `/assignments/${assignmentId}/receipt`,
    { method: 'POST', body }
  )),
  reportAssignmentFailure: (assignmentId, body) => unwrap(dispatchJson(
    router,
    `/assignments/${assignmentId}/failure`,
    { method: 'POST', body }
  )),
  createSignalingSession: (body) => unwrap(dispatchJson(
    router,
    '/signaling/sessions',
    { method: 'POST', body }
  )),
  getReceipt: (receiptHash) => unwrap(dispatchJson(router, `/receipts/${receiptHash}`)),
  acceptReceipt: (receiptHash, body) => unwrap(dispatchJson(
    router,
    `/receipts/${receiptHash}/accept`,
    { method: 'POST', body }
  ))
});

const createClientIdentity = async ({ role, roleId, roleKeyPair, mode }) => {
  const deviceIdentity = await getDeviceRootIdentity();
  const participationProfile = await createSignedParticipationProfile({
    preferences: { mode },
    deviceId: deviceIdentity.deviceId,
    devicePublicKey: deviceIdentity.publicKey,
    privateKey: deviceIdentity.keyPair.privateKey
  });
  const rolePublicKey = await exportPublicKey(roleKeyPair.publicKey);
  const identityProof = await createRoleDelegation({
    deviceIdentity,
    role,
    roleId,
    rolePublicKey,
    capabilities: [role === 'provider' ? 'provide_inference' : 'request_inference'],
    participationProfileHash: participationProfile.profileHash
  });
  return {
    getRoleId: async () => roleId,
    getSigningKeyPair: async () => roleKeyPair,
    getParticipationProfile: async () => participationProfile,
    getRoleProof: async () => identityProof
  };
};

const runtimeModel = () => buildLaunchProviderModel();

const fakeRuntime = () => ({
  isReady: () => true,
  getModelInfo: () => runtimeModel(),
  getRuntimeInfo: () => ({
    runtime: LAUNCH_MODEL.runtime,
    backend: LAUNCH_MODEL.backend,
    publicApi: 'encodeSequence',
    profile: { implementation: 'hosted-diagnostic-test' }
  }),
  getDeviceInfo: async () => ({
    hasWebGPU: true,
    probeStatus: 'ok',
    adapterInfo: {
      vendor: 'hosted-diagnostic-vendor',
      architecture: 'hosted-diagnostic-arch',
      device: 'hosted-diagnostic-device'
    },
    features: ['shader-f16'],
    limits: { maxBufferSize: 1024 }
  }),
  getRuntimeProfile: async () => {
    const runtimeProfile = buildRuntimeProfile({
      modelInfo: runtimeModel(),
      runtimeInfo: {
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend,
        publicApi: 'encodeSequence',
        profile: { implementation: 'hosted-diagnostic-test' }
      },
      deviceInfo: {
        hasWebGPU: true,
        probeStatus: 'ok',
        adapterInfo: { vendor: 'hosted-diagnostic-vendor' },
        features: ['shader-f16'],
        limits: { maxBufferSize: 1024 }
      },
      browserProfile: {
        userAgent: 'hosted-diagnostic-browser',
        family: 'hosted-diagnostic-browser',
        majorVersion: '1',
        platform: 'hosted-diagnostic-platform',
        brands: ['HostedDiagnostic:1'],
        mobile: false
      }
    });
    return {
      runtimeProfile,
      runtimeProfileHash: await hashRuntimeProfile(runtimeProfile)
    };
  },
  encodeSequence: async ({ sequence, request, assignment }) => makeSequenceExecution({
    assignment: { ...assignment, sequenceRequest: request },
    sequence,
    timing: {
      startedAt: '2026-08-15T00:00:00.000Z',
      completedAt: '2026-08-15T00:00:01.000Z'
    }
  })
});

describe('hosted diagnostic sequence episode', () => {
  it('recovers an expired attempt, transports input outside the coordinator, and reaches accepted quorum', async () => {
    const store = createPoolStore();
    store.kind = 'memory';
    const router = createPoolRouter({ store, allowUnauthenticatedLocal: true });
    const sdk = createRouteSdk(router);
    const providers = new Map();
    for (let index = 0; index < 4; index += 1) {
      const providerId = `provider_hosted_${index}`;
      const keyPair = await createSigningKeyPair();
      const provider = createProviderClient({
        providerId,
        keyPair,
        identity: await createClientIdentity({
          role: 'provider',
          roleId: providerId,
          roleKeyPair: keyPair,
          mode: 'contribute'
        }),
        runtime: fakeRuntime(),
        sdk
      });
      await provider.register({ availability: { acceptedPolicies: ['ring_quorum_receipt'] } });
      providers.set(providerId, provider);
    }

    const requesterId = 'requester_hosted_diagnostic';
    const requesterKeys = await createSigningKeyPair();
    const requester = createRequesterClient({
      requesterId,
      keyPair: requesterKeys,
      identity: await createClientIdentity({
        role: 'requester',
        roleId: requesterId,
        roleKeyPair: requesterKeys,
        mode: 'request'
      }),
      sdk
    });
    const sequenceFields = await makePublicProteinJobFields();
    const submitted = await requester.submitSequenceJob({
      sequence: TEST_PUBLIC_PROTEIN_SEQUENCE,
      sequenceRequest: sequenceFields.sequenceRequest,
      policyId: 'ring_quorum_receipt',
      modelRequirements: {
        ...runtimeModel(),
        sequenceRequest: sequenceFields.sequenceRequest
      }
    });
    const firstAttempt = submitted.assignments;
    expect(firstAttempt).toHaveLength(4);
    expect(JSON.stringify(submitted)).not.toContain(TEST_PUBLIC_PROTEIN_SEQUENCE);
    expect(JSON.stringify(store.getJob(submitted.job.jobId))).not.toContain(TEST_PUBLIC_PROTEIN_SEQUENCE);
    expect(store.getJob(submitted.job.jobId)).toMatchObject({
      inputKind: 'sequence',
      inputTransport: 'webrtc_datachannel',
      prompt: null,
      assignmentAttemptId: 1
    });

    for (const assignment of firstAttempt.slice(0, 2)) {
      const claimed = await providers.get(assignment.providerId).nextAssignment();
      expect(claimed.assignment.assignmentId).toBe(assignment.assignmentId);
    }
    for (const assignment of firstAttempt.slice(0, 2)) {
      store.updateAssignment(assignment.assignmentId, {
        expiresAt: new Date(Date.now() - 1_000).toISOString()
      });
    }
    const recovered = await requester.pollJob(submitted.job.jobId);
    expect(recovered.assignmentRecovery).toEqual({
      expired: 2,
      attempted: 1,
      assigned: 1,
      blocked: 0
    });
    expect(recovered.job).toMatchObject({ assignmentAttemptId: 2, status: 'assigned' });
    expect(recovered.job.recoveryHistory.at(-1)).toMatchObject({
      previousAssignmentAttemptId: 1,
      failureReasons: ['assignment_execution_expired']
    });

    const workerRuns = recovered.job.assignmentIds.map(async (assignmentId) => {
      const assignment = store.getAssignment(assignmentId);
      const signaling = await sdk.createSignalingSession({
        assignmentId,
        createdBy: requesterId
      });
      expect(signaling.session).toMatchObject({
        inputPayloadsAllowedFromPhase: 'private_compute',
        resultEvidenceAdmissibleFromPhase: 'reveal_open'
      });
      const inputPayload = await requester.createPeerSequencePayload({
        assignment,
        sequence: TEST_PUBLIC_PROTEIN_SEQUENCE
      });
      return providers.get(assignment.providerId).runWorkerStep({ inputPayload });
    });
    const results = await Promise.all(workerRuns);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === 'executed_assignment')).toBe(true);
    expect(results.every((result) => result.receiptResult.commitReveal?.revealResult?.reveal)).toBe(true);

    const verifiedJob = store.getJob(submitted.job.jobId);
    expect(verifiedJob).toMatchObject({
      status: 'receipt_verified',
      assignmentAttemptId: 2,
      agreement: { status: 'accepted', acceptedReceipts: 2 }
    });
    const accepted = await requester.acceptReceipt(verifiedJob.receiptHash, true);
    expect(accepted).toMatchObject({
      acceptance: { accepted: true },
      ledgerEvents: expect.arrayContaining([expect.objectContaining({ eventType: 'points_awarded' })])
    });
    expect(store.getJob(submitted.job.jobId).status).toBe('accepted');
  });
});
