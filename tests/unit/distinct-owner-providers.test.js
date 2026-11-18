// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

import { participantIdFor } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { enrollComputers } from '../../server/fleet/contract.js';
import { planFleetPlacement, selectDistinctOwnerProviders } from '../../server/fleet/placement.js';
import { LAUNCH_MODEL } from '../../server/pool/model-contract.js';
import { getPolicy } from '../../server/pool/policy-router.js';
import { assignJob } from '../../server/pool/scheduler.js';
import { buildAcceptanceSummary } from '../../server/pool/services/acceptance.js';
import { createPoolStore } from '../../server/pool/store.js';
import { createFirestorePoolStore } from '../../server/pool/firebase-store.js';
import {
  countersignReceipt,
  createSigningKeyPair,
  exportPublicKey
} from '../../shared/pool/inference-receipt.js';
import { makePublicProteinJobFields } from '../helpers/pool-sequence-fixture.js';
import { createSettlementFirestore } from '../helpers/pool-settlement-firestore.js';

const MODEL_HASH = `sha256:${'a'.repeat(64)}`;
const PLAN_ID = `sha256:${'b'.repeat(64)}`;
const FLEET_MODEL = {
  id: 'qwen-small',
  identity: MODEL_HASH,
  plans: [{ id: PLAN_ID, stageCount: 2, activationBytesPerToken: 4096, requireDistinctOwners: true }]
};
const FLEET_POLICY = {
  maxMeasurementAgeMs: 60000,
  maxObservationAgeMs: 2000,
  minResidencyMs: 100,
  maxRouteCandidates: 100,
  queuedRequestsPerReplica: 2
};

async function enrolledProviderKey() {
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  const participantId = await participantIdFor(publicJwk);
  return { participantId, publicJwk };
}

function fleetObservation(id, participantId, { decodeTokensPerSecond = 10, mode = 'whole-model', stageIndex = null, ownerId = undefined } = {}) {
  return {
    id,
    ...(ownerId ? { ownerId } : {}),
    softwareIdentity: MODEL_HASH,
    participantId,
    observedAt: 9990,
    activeRequests: 0,
    resident: null,
    freeGpuBytes: 100,
    freeHostBytes: 100,
    maxStorageBufferBindingSize: 50,
    preferences: {
      enabled: true,
      models: [{ id: FLEET_MODEL.id, identity: MODEL_HASH }],
      maxGpuBytes: 100,
      maxHostBytes: 100
    },
    measurements: [{
      modelIdentity: MODEL_HASH,
      mode,
      stageIndex,
      planId: stageIndex === null ? null : PLAN_ID,
      softwareIdentity: MODEL_HASH,
      qualified: true,
      receipt: `receipt-${id}`,
      observedAt: 9990,
      maxPromptTokens: 30,
      maxOutputTokens: 10,
      prefillTokensPerSecond: 30,
      decodeTokensPerSecond,
      loadMs: 100,
      requiredGpuBytes: 80,
      requiredHostBytes: 20,
      largestBindingBytes: 40
    }]
  };
}

describe('distinct-owner rule across fleet placement and pool scheduling/settlement', () => {
  it('refuses two fleet computers with separate signing keys when enrolled under the same owner', async () => {
    const keyA1 = await enrolledProviderKey();
    const keyA2 = await enrolledProviderKey();
    const enrollment = await enrollComputers([
      { id: 'comp-a1', name: 'A1', ownerId: 'owner_alpha', providers: [keyA1] },
      { id: 'comp-a2', name: 'A2', ownerId: 'owner_alpha', providers: [keyA2] }
    ]);
    const computers = [
      fleetObservation('comp-a1', keyA1.participantId, { decodeTokensPerSecond: 25, ownerId: 'spoofed_other' }),
      fleetObservation('comp-a2', keyA2.participantId, { decodeTokensPerSecond: 20 })
    ];
    const result = selectDistinctOwnerProviders({
      enrollment,
      computers,
      model: FLEET_MODEL,
      workload: { promptTokens: 30, outputTokens: 10 },
      policy: FLEET_POLICY,
      now: 10000
    });
    expect(result).toEqual({
      ok: false,
      reason: 'insufficient-distinct-owner-providers',
      requiredOwners: 2,
      distinctOwners: 1,
      providers: []
    });
  });

  it('selects the fastest pair from pairwise-distinct enrolled owners and excludes the requester owner', async () => {
    const keyA1 = await enrolledProviderKey();
    const keyA2 = await enrolledProviderKey();
    const keyB1 = await enrolledProviderKey();
    const keyC1 = await enrolledProviderKey();
    const enrollment = await enrollComputers([
      { id: 'comp-a1', name: 'A1', ownerId: 'owner_alpha', providers: [keyA1] },
      { id: 'comp-a2', name: 'A2', ownerId: 'owner_alpha', providers: [keyA2] },
      { id: 'comp-b1', name: 'B1', ownerId: 'owner_beta', providers: [keyB1] },
      { id: 'comp-c1', name: 'C1', ownerId: 'owner_gamma', providers: [keyC1] }
    ]);
    const computers = [
      fleetObservation('comp-a1', keyA1.participantId, { decodeTokensPerSecond: 40 }),
      fleetObservation('comp-a2', keyA2.participantId, { decodeTokensPerSecond: 30 }),
      fleetObservation('comp-b1', keyB1.participantId, { decodeTokensPerSecond: 20 }),
      fleetObservation('comp-c1', keyC1.participantId, { decodeTokensPerSecond: 10 })
    ];
    const pair = selectDistinctOwnerProviders({
      enrollment,
      computers,
      model: FLEET_MODEL,
      workload: { promptTokens: 30, outputTokens: 10 },
      policy: FLEET_POLICY,
      now: 10000
    });
    expect(pair.ok).toBe(true);
    expect(pair.providers.map(row => row.computerId)).toEqual(['comp-a1', 'comp-b1']);
    expect(pair.owners).toEqual(['owner_alpha', 'owner_beta']);

    const excludingAlpha = selectDistinctOwnerProviders({
      enrollment,
      computers,
      model: FLEET_MODEL,
      workload: { promptTokens: 30, outputTokens: 10 },
      policy: FLEET_POLICY,
      now: 10000,
      requesterOwnerId: 'owner_alpha'
    });
    expect(excludingAlpha.ok).toBe(true);
    expect(excludingAlpha.providers.map(row => row.computerId)).toEqual(['comp-b1', 'comp-c1']);
    expect(excludingAlpha.owners).toEqual(['owner_beta', 'owner_gamma']);
  });

  it('enforces distinct owners on partition plans marked requireDistinctOwners', async () => {
    const k1 = await enrolledProviderKey();
    const k2 = await enrolledProviderKey();
    const k3 = await enrolledProviderKey();
    const sameOwnerA = fleetObservation('s0', k1.participantId, { mode: 'partition', stageIndex: 0, ownerId: 'owner_same' });
    const sameOwnerB = fleetObservation('s1', k2.participantId, { mode: 'partition', stageIndex: 1, ownerId: 'owner_same' });
    const otherOwnerB = fleetObservation('s2', k3.participantId, { mode: 'partition', stageIndex: 1, ownerId: 'owner_other' });
    const links = [
      { from: 's0', to: 's1', bytesPerSecond: 1e7, latencyMs: 2, observedAt: 9990 },
      { from: 's0', to: 's2', bytesPerSecond: 1e7, latencyMs: 5, observedAt: 9990 }
    ];
    const demand = [{ id: FLEET_MODEL.id, identity: MODEL_HASH, queued: 1, since: 9000, promptTokens: 30, outputTokens: 10 }];
    expect(planFleetPlacement({
      computers: [sameOwnerA, sameOwnerB],
      demand,
      models: [FLEET_MODEL],
      links,
      policy: FLEET_POLICY,
      now: 10000
    }).routes).toEqual([]);

    const admitted = planFleetPlacement({
      computers: [sameOwnerA, sameOwnerB, otherOwnerB],
      demand,
      models: [FLEET_MODEL],
      links,
      policy: FLEET_POLICY,
      now: 10000
    });
    expect(admitted.routes).toHaveLength(1);
    expect(admitted.routes[0].computers).toEqual(['s0', 's2']);
  });

  it('requires distinct provider owners for two-provider pool scheduling and disallowRequesterOwner', async () => {
    const store = createPoolStore();
    const policy = getPolicy('redundant_agreement');
    const sequenceFields = await makePublicProteinJobFields();
    const register = async (providerId, extra) => {
      const keys = await createSigningKeyPair();
      return store.registerProvider({
        providerId,
        publicKey: await exportPublicKey(keys.publicKey),
        models: [{ ...LAUNCH_MODEL }],
        availability: { acceptedPolicies: ['redundant_agreement'], maxTokensPerJob: 256 },
        ...extra
      });
    };

    // Two providers sharing the same ownerId (or devicePublicKey) cannot satisfy redundancy=2.
    await register('prov_same_1', { ownerId: 'owner_shared', participationProfile: { deviceId: 'dev_shared', devicePublicKey: 'pk_shared' } });
    await register('prov_same_2', { ownerId: 'owner_shared', participationProfile: { deviceId: 'dev_other', devicePublicKey: 'pk_shared' } });

    const job = store.createJob({
      jobId: 'job_two_provider',
      requesterId: 'req_1',
      requesterOwnerId: 'owner_requester',
      disallowRequesterOwner: true,
      policyId: 'redundant_agreement',
      modelRequirements: { ...LAUNCH_MODEL },
      ...sequenceFields
    });
    const blocked = await assignJob({ store, job, policy });
    expect(blocked).toMatchObject({
      ok: false,
      reason: 'not_enough_distinct_owner_providers',
      requiredProviders: 2,
      eligibleProviders: 1
    });

    // Adding a provider owned by the requester still leaves only one independent owner.
    await register('prov_requester', { ownerId: 'owner_requester' });
    expect((await assignJob({ store, job, policy })).ok).toBe(false);

    // Adding a provider under an independent second owner enables a two-provider assignment across distinct owners.
    await register('prov_independent', { ownerId: 'owner_second' });
    const assigned = await assignJob({ store, job, policy });
    expect(assigned.ok).toBe(true);
    expect(assigned.assignments).toHaveLength(2);
    const assignedIds = assigned.assignments.map(item => item.providerId);
    expect(assignedIds).toContain('prov_independent');
    expect(assignedIds.filter(id => id.startsWith('prov_same_'))).toHaveLength(1);
  });

  for (const kind of ['memory', 'firestore']) {
    it(`refuses ${kind} multi-provider receipt settlement when two providerIds share an owner`, async () => {
      const fake = kind === 'firestore' ? createSettlementFirestore() : null;
      const store = fake ? createFirestorePoolStore({ firestore: fake.firestore }) : createPoolStore();
      const requesterKeys = await createSigningKeyPair();
      await store.registerProvider({ providerId: 'prov_a', ownerId: 'owner_colluding' });
      await store.registerProvider({ providerId: 'prov_b', ownerId: 'owner_colluding' });
      await store.createJob({
        jobId: 'job_collude',
        requesterId: 'req_collude',
        requesterPublicKey: await exportPublicKey(requesterKeys.publicKey),
        policyId: 'redundant_agreement',
        maxPointSpend: 40
      });
      for (const [idx, providerId] of ['prov_a', 'prov_b'].entries()) {
        const assignmentId = `asg_${idx}`;
        const receiptHash = `rcpt_${idx}`;
        await store.createAssignment({
          assignmentId,
          jobId: 'job_collude',
          providerId,
          requesterId: 'req_collude',
          assignmentAttemptId: 1,
          policyId: 'redundant_agreement'
        });
        await store.updateAssignment(assignmentId, { status: 'receipt_verified' });
        await store.saveReceipt(receiptHash, {
          jobId: 'job_collude',
          assignmentId,
          assignmentAttemptId: 1,
          providerId,
          requesterId: 'req_collude',
          verifierDecision: { accepted: true },
          providerAdmission: { earningsCapPerAcceptance: 20 },
          receipt: { providerId, requesterId: 'req_collude', tokenCounts: { input: 8, output: 6 } }
        });
      }
      await store.updateJob('job_collude', {
        status: 'receipt_verified',
        receiptHash: 'rcpt_0',
        receiptHashes: ['rcpt_0', 'rcpt_1'],
        assignmentIds: ['asg_0', 'asg_1'],
        assignmentAttemptId: 1,
        agreement: { status: 'accepted', mode: 'redundant', receiptHashes: ['rcpt_0', 'rcpt_1'] }
      });
      const job = await store.getJob('job_collude');
      const summary = await buildAcceptanceSummary({ store, job, receiptHash: 'rcpt_0' });
      const acceptance = await countersignReceipt(
        { ...summary, receiptHash: 'rcpt_0', requesterId: job.requesterId, accepted: true },
        requesterKeys.privateKey
      );
      await expect(store.settleReceiptAcceptance({ receiptHash: 'rcpt_0', acceptance })).rejects.toMatchObject({
        status: 409
      });
      expect(await store.listLedger('req_collude')).toEqual([]);
    });
  }
});
