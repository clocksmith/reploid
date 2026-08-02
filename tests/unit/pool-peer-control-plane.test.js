import { describe, expect, it } from 'vitest';

import {
  canonicalize,
  buildPoolReceipt,
  createSigningKeyPair,
  exportPublicKey,
  hashJson,
  SIGNATURE_DOMAINS,
  sha256Hex,
  signProviderReceipt
} from '../../self/pool/inference-receipt.js';
import { createProviderClient } from '../../self/pool/provider-client.js';
import { createRequesterClient } from '../../self/pool/requester-client.js';
import {
  LAUNCH_MODEL,
  buildLaunchProviderModel,
  getEnabledPoolModelContract
} from '../../self/pool/model-contract.js';
import { POOL_CONFIG_VERSION } from '../../self/pool/config.js';
import {
  PEER_MESSAGE_TYPES,
  buildPeerAssignmentPlan,
  buildPeerReceiptAgreement,
  createDataChannelPeerBus,
  createPeerEventReducer,
  createInMemoryPeerBus,
  createPeerLedgerEvents,
  createPeerControlPlane,
  createSignedJobIntent,
  createSignedProviderAdvert,
  validatePeerAssignmentForIntentAndAdvert,
  verifyPeerMessage
} from '../../self/pool/peer-control-plane.js';
import { createReceiptPayload } from '../../self/pool/p2p-payload.js';
import {
  buildRuntimeProfile,
  hashRuntimeProfile
} from '../../self/pool/runtime-profile.js';
import {
  TEST_PUBLIC_PROTEIN_SEQUENCE,
  makePublicProteinJobFields,
  makeSequenceExecution
} from '../helpers/pool-sequence-fixture.js';

const runtimeModel = () => buildLaunchProviderModel();

const fakeRuntime = () => ({
  isReady: () => true,
  getModelInfo: () => runtimeModel(),
  getRuntimeInfo: () => ({
    runtime: LAUNCH_MODEL.runtime,
    backend: LAUNCH_MODEL.backend,
    publicApi: 'encodeSequence',
    profile: { implementation: 'peer-test' }
  }),
  getDeviceInfo: async () => ({
    hasWebGPU: true,
    probeStatus: 'ok',
    adapterInfo: {
      vendor: 'peer-test-vendor',
      architecture: 'peer-test-arch',
      device: 'peer-test-device'
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
        profile: { implementation: 'peer-test' }
      },
      deviceInfo: {
        hasWebGPU: true,
        probeStatus: 'ok',
        adapterInfo: { vendor: 'peer-test-vendor' },
        features: ['shader-f16'],
        limits: { maxBufferSize: 1024 }
      },
      browserProfile: {
        userAgent: 'peer-test-browser',
        platform: 'peer-test-platform',
        brands: ['PeerTest:1'],
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
      startedAt: '2026-06-14T00:00:00.000Z',
      completedAt: '2026-06-14T00:00:01.000Z'
    }
  })
});

const launchModelAdvert = () => buildLaunchProviderModel();

const createSequenceJobIntent = async (options = {}) => {
  const sequenceFields = await makePublicProteinJobFields(options.sequence || TEST_PUBLIC_PROTEIN_SEQUENCE);
  return createSignedJobIntent({
    ...options,
    prompt: undefined,
    sequence: options.sequence || TEST_PUBLIC_PROTEIN_SEQUENCE,
    sequenceRequest: options.sequenceRequest || sequenceFields.sequenceRequest,
    modelRequirements: {
      ...launchModelAdvert(),
      ...(options.modelRequirements || {}),
      sequenceRequest: options.sequenceRequest || sequenceFields.sequenceRequest
    }
  });
};

const sequenceModelAdvert = () => {
  const model = getEnabledPoolModelContract('esm2-t12-35m-ur50d-f32-af32');
  return buildLaunchProviderModel({ modelId: model.modelId });
};

describe('pool peer control plane', () => {
  it('creates signed job intents without leaking prompt text into the control plane', async () => {
    const keyPair = await createSigningKeyPair();
    const publicKey = await exportPublicKey(keyPair.publicKey);
    const prompt = 'private requester prompt';
    const result = await createSequenceJobIntent({
      requesterId: 'requester_peer',
      requesterPublicKey: publicKey,
      privateKey: keyPair.privateKey,
      sequence: TEST_PUBLIC_PROTEIN_SEQUENCE,
      modelRequirements: launchModelAdvert()
    });

    expect(await verifyPeerMessage(result.intent)).toMatchObject({ ok: true });
    expect(result.inputHash).toBe(await sha256Hex(TEST_PUBLIC_PROTEIN_SEQUENCE));
    expect(result.intent.body.inputTransport).toBe('webrtc_datachannel');
    expect(result.intent.body.sequenceRequest).toMatchObject({ alphabet: 'amino_acid' });
    expect(JSON.stringify(result.intent)).not.toContain(TEST_PUBLIC_PROTEIN_SEQUENCE);
    expect(result.sequence).toBe(TEST_PUBLIC_PROTEIN_SEQUENCE);
  });

  it('advertises sequence capability without requiring request-specific sequence data', async () => {
    const keyPair = await createSigningKeyPair();
    const advert = await createSignedProviderAdvert({
      providerId: 'provider_sequence',
      providerPublicKey: await exportPublicKey(keyPair.publicKey),
      privateKey: keyPair.privateKey,
      models: [sequenceModelAdvert()]
    });

    expect(await verifyPeerMessage(advert)).toMatchObject({ ok: true });
    expect(advert.body.models[0]).toMatchObject({
      modelId: 'esm2-t12-35m-ur50d-f32-af32',
      workload: 'sequence.embedding.v1',
      executionMode: 'full_model_browser_sequence',
      sequence: {
        alphabet: 'amino_acid',
        pooledEmbedding: { mode: 'mean' }
      }
    });
    expect(advert.body.models[0]).not.toHaveProperty('sequenceRequest');
    expect(advert.body.availability.acceptedPolicyClasses).toContain('public_biological_sequence');
  });

  it('builds deterministic peer assignment plans from signed provider adverts', async () => {
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const intent = await createSequenceJobIntent({
      requesterId: 'requester_ring',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      policyId: 'ring_quorum_receipt',
      modelRequirements: launchModelAdvert()
    });
    const adverts = [];
    for (let index = 0; index < 14; index += 1) {
      const providerKeys = await createSigningKeyPair();
      const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
      adverts.push(await createSignedProviderAdvert({
        providerId: `provider_${index}`,
        providerPublicKey,
        privateKey: providerKeys.privateKey,
        models: [launchModelAdvert()],
        runtimeProfileHash: 'sha256:runtime_shared',
        availability: {
          acceptedPolicies: ['ring_quorum_receipt']
        }
      }));
    }

    const first = await buildPeerAssignmentPlan({ jobIntent: intent.intent, providerAdverts: adverts });
    const second = await buildPeerAssignmentPlan({ jobIntent: intent.intent, providerAdverts: [...adverts].reverse() });

    expect(first.ok).toBe(true);
    expect(first.assignments).toHaveLength(12);
    expect(first.ring.ringSize).toBe(12);
    expect(first.ring.requiredAgreement).toBe(7);
    expect(first.assignments.map((assignment) => assignment.providerId)).toEqual(
      second.assignments.map((assignment) => assignment.providerId)
    );
    expect(first.assignments.map((assignment) => assignment.assignmentId)).toEqual(
      second.assignments.map((assignment) => assignment.assignmentId)
    );
    expect(first.assignments.every((assignment) => assignment.requiresInputPayload === true)).toBe(true);
    expect(first.assignments.every((assignment) => assignment.requiresPromptPayload === false)).toBe(true);
    expect(first.assignments.every((assignment) => assignment.sequenceRequest?.alphabet === 'amino_acid')).toBe(true);
    expect(first.assignments.every((assignment) => (
      assignment.model.exactModelContractKey
      && assignment.model.modelId === LAUNCH_MODEL.modelId
      && assignment.model.tokenizerHash === LAUNCH_MODEL.tokenizerHash
    ))).toBe(true);
  });

  it('binds peer assignments to the advert, participation profile, limits, and route', async () => {
    const requesterKeys = await createSigningKeyPair();
    const providerKeys = await createSigningKeyPair();
    const intent = await createSequenceJobIntent({
      requesterId: 'requester_bound_assignment',
      requesterPublicKey: await exportPublicKey(requesterKeys.publicKey),
      privateKey: requesterKeys.privateKey,
      modelRequirements: launchModelAdvert()
    });
    const advert = await createSignedProviderAdvert({
      providerId: 'provider_bound_assignment',
      providerPublicKey: await exportPublicKey(providerKeys.publicKey),
      privateKey: providerKeys.privateKey,
      models: [launchModelAdvert()],
      runtimeProfileHash: 'sha256:runtime_bound_assignment',
      availability: {
        acceptedPolicies: ['fastest_receipt'],
        maxTokensPerJob: 128
      }
    });
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent.intent,
      providerAdverts: [advert]
    });

    expect((await validatePeerAssignmentForIntentAndAdvert({
      assignment: plan.assignment,
      jobIntent: intent.intent,
      providerAdvert: advert
    })).ok).toBe(true);
    const relayedAssignment = JSON.parse(JSON.stringify({
      ...plan.assignment,
      providerLimits: {
        maxTokensPerJob: plan.assignment.providerLimits.maxTokensPerJob,
        maxConcurrentJobs: plan.assignment.providerLimits.maxConcurrentJobs,
        bandwidthBudgetMbps: plan.assignment.providerLimits.bandwidthBudgetMbps,
        storageBudgetMiB: plan.assignment.providerLimits.storageBudgetMiB
      }
    }));
    expect((await validatePeerAssignmentForIntentAndAdvert({
      assignment: relayedAssignment,
      jobIntent: intent.intent,
      providerAdvert: advert
    })).ok).toBe(true);
    expect((await validatePeerAssignmentForIntentAndAdvert({
      assignment: { ...plan.assignment, routeDecisionHash: 'sha256:tampered' },
      jobIntent: intent.intent,
      providerAdvert: advert
    })).reasons).toContain('assignmentHash mismatch');
    const alteredContract = {
      ...plan.assignment,
      model: {
        ...plan.assignment.model,
        tokenizerHash: 'sha256:altered-tokenizer'
      }
    };
    expect((await validatePeerAssignmentForIntentAndAdvert({
      assignment: alteredContract,
      jobIntent: intent.intent,
      providerAdvert: advert
    })).reasons).toContain('assignment model fields do not match the enabled exact model contract');
  });

  it('selects a homogeneous runtime-profile group for strict ring quorum', async () => {
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const intent = await createSequenceJobIntent({
      requesterId: 'requester_runtime_group',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      policyId: 'ring_quorum_receipt',
      modelRequirements: launchModelAdvert()
    });
    const adverts = [];
    for (let index = 0; index < 5; index += 1) {
      const providerKeys = await createSigningKeyPair();
      const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
      adverts.push(await createSignedProviderAdvert({
        providerId: `provider_runtime_group_${index}`,
        providerPublicKey,
        privateKey: providerKeys.privateKey,
        models: [launchModelAdvert()],
        runtimeProfileHash: index < 3 ? 'sha256:runtime_group_a' : 'sha256:runtime_group_b',
        availability: {
          acceptedPolicies: ['ring_quorum_receipt']
        }
      }));
    }

    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent.intent,
      providerAdverts: adverts
    });

    expect(plan.ok).toBe(true);
    expect(plan.assignments).toHaveLength(3);
    expect(plan.ring.ringSize).toBe(3);
    expect(plan.ring.requiredAgreement).toBe(2);
    expect(plan.assignments.every((assignment) => assignment.runtimeProfileHash === 'sha256:runtime_group_a')).toBe(true);
  });

  it('forms receipt agreement and signed ledger events from matching peer receipts', async () => {
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const intent = await createSequenceJobIntent({
      requesterId: 'requester_agreement',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      policyId: 'ring_quorum_receipt',
      modelRequirements: launchModelAdvert()
    });
    const adverts = [];
    const providerKeysById = new Map();
    for (let index = 0; index < 3; index += 1) {
      const providerKeys = await createSigningKeyPair();
      const providerId = `provider_agreement_${index}`;
      providerKeysById.set(providerId, providerKeys);
      const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
      adverts.push(await createSignedProviderAdvert({
        providerId,
        providerPublicKey,
        privateKey: providerKeys.privateKey,
        models: [launchModelAdvert()],
        runtimeProfileHash: 'sha256:runtime_agreement_shared',
        availability: {
          acceptedPolicies: ['ring_quorum_receipt']
        }
      }));
    }
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent.intent,
      providerAdverts: adverts
    });
    const receiptPayloads = await Promise.all(plan.assignments.map(async (assignment) => {
      const keys = providerKeysById.get(assignment.providerId);
      const execution = await makeSequenceExecution({ assignment });
      const receipt = await signProviderReceipt(await buildPoolReceipt({
        assignment,
        provider: { device: {}, runtimeProfileHash: assignment.runtimeProfileHash },
        model: assignment.model,
        runtime: { runtime: LAUNCH_MODEL.runtime, backend: LAUNCH_MODEL.backend },
        execution
      }), keys.privateKey);
      return createReceiptPayload({
        assignment,
        receiptRecord: {
          receiptHash: await hashJson(receipt),
          providerId: assignment.providerId,
          requesterId: assignment.requesterId,
          receipt,
          ...execution
        },
        fromPeerId: assignment.providerId,
        toPeerId: assignment.requesterId
      });
    }));

    expect(receiptPayloads[0].body).toMatchObject({
      providerId: plan.assignments[0].providerId,
      requesterId: plan.assignments[0].requesterId
    });

    const agreement = await buildPeerReceiptAgreement({ plan, receiptPayloads });
    const ledgerEvents = await createPeerLedgerEvents({
      agreement,
      requesterId: 'requester_agreement',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey
    });
    const reduced = createPeerEventReducer().reduce([...ledgerEvents, ...ledgerEvents]);

    expect(agreement.accepted).toBe(true);
    expect(agreement.requiredAgreement).toBe(2);
    expect(agreement.policyConfigVersion).toBe(POOL_CONFIG_VERSION);
    expect(agreement.receiptHashes).toHaveLength(3);
    expect(agreement.agreementHash).toMatch(/^sha256:/);
    expect(ledgerEvents.filter((event) => event.type === PEER_MESSAGE_TYPES.POINTS_EVENT)).toHaveLength(4);
    expect(ledgerEvents.filter((event) => event.type === PEER_MESSAGE_TYPES.REPUTATION_EVENT)).toHaveLength(3);
    expect(reduced.points.requester_agreement).toBe(-15);
    for (const providerId of agreement.providerIds) {
      expect(reduced.points[providerId]).toBe(5);
      expect(reduced.reputation[providerId]).toMatchObject({
        providerId,
        acceptedReceipts: 1,
        points: 5
      });
    }
  });

  it('forms sequence agreement from matching signed sequence-result hashes', async () => {
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const intent = await createSequenceJobIntent({
      requesterId: 'requester_sequence_agreement',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      policyId: 'ring_quorum_receipt',
      modelRequirements: launchModelAdvert()
    });
    const adverts = [];
    const providerKeysById = new Map();
    for (let index = 0; index < 3; index += 1) {
      const providerKeys = await createSigningKeyPair();
      const providerId = `provider_sequence_${index}`;
      providerKeysById.set(providerId, providerKeys);
      const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
      adverts.push(await createSignedProviderAdvert({
        providerId,
        providerPublicKey,
        privateKey: providerKeys.privateKey,
        models: [launchModelAdvert()],
        runtimeProfileHash: 'sha256:runtime_sequence_shared',
        availability: {
          acceptedPolicies: ['ring_quorum_receipt']
        }
      }));
    }
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent.intent,
      providerAdverts: adverts
    });

    expect(plan.ok).toBe(true);
    expect(plan.ring.agreementField).toBe('sequenceResultHash');
    expect(plan.assignments.every((assignment) => assignment.workload === 'sequence.embedding.v1')).toBe(true);

    const receiptPayloads = await Promise.all(plan.assignments.map(async (assignment) => {
      const keys = providerKeysById.get(assignment.providerId);
      const execution = await makeSequenceExecution({ assignment });
      const receipt = await signProviderReceipt(await buildPoolReceipt({
        assignment,
        provider: { device: {}, runtimeProfileHash: assignment.runtimeProfileHash },
        model: assignment.model,
        runtime: { runtime: LAUNCH_MODEL.runtime, backend: LAUNCH_MODEL.backend },
        execution
      }), keys.privateKey);
      return createReceiptPayload({
        assignment,
        receiptRecord: {
          receiptHash: await hashJson(receipt),
          providerId: assignment.providerId,
          requesterId: assignment.requesterId,
          receipt,
          ...execution
        },
        fromPeerId: assignment.providerId,
        toPeerId: assignment.requesterId
      });
    }));

    const agreement = await buildPeerReceiptAgreement({ plan, receiptPayloads });

    expect(agreement.accepted).toBe(true);
    expect(agreement.agreementField).toBe('sequenceResultHash');
    expect(agreement.sequenceResultHash).toBe(receiptPayloads[0].body.sequenceResultHash);
    expect(agreement.tokenIdsHash).toBe(await hashJson([]));
  });

  it('rejects peer receipt agreement when accepted receipts exceed requester point spend', async () => {
    const requesterKeys = await createSigningKeyPair();
    const providerKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
    const intent = await createSequenceJobIntent({
      requesterId: 'requester_spend_limit',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      maxPointSpend: 1,
      modelRequirements: launchModelAdvert()
    });
    const advert = await createSignedProviderAdvert({
      providerId: 'provider_spend_limit',
      providerPublicKey,
      privateKey: providerKeys.privateKey,
      models: [launchModelAdvert()],
      runtimeProfileHash: 'sha256:runtime_spend_limit',
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent.intent,
      providerAdverts: [advert]
    });
    const assignment = plan.assignment;
    const execution = await makeSequenceExecution({ assignment });
    const receipt = await signProviderReceipt(await buildPoolReceipt({
      assignment,
      provider: { device: {}, runtimeProfileHash: assignment.runtimeProfileHash },
      model: assignment.model,
      runtime: { runtime: LAUNCH_MODEL.runtime, backend: LAUNCH_MODEL.backend },
      execution
    }), providerKeys.privateKey);
    const receiptPayload = await createReceiptPayload({
      assignment,
      receiptRecord: {
        receiptHash: await hashJson(receipt),
        receipt,
        ...execution
      },
      fromPeerId: assignment.providerId,
      toPeerId: assignment.requesterId
    });

    const agreement = await buildPeerReceiptAgreement({ plan, receiptPayloads: [receiptPayload] });
    const ledgerEvents = await createPeerLedgerEvents({
      agreement,
      requesterId: 'requester_spend_limit',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey
    });

    expect(agreement.accepted).toBe(false);
    expect(agreement.status).toBe('rejected');
    expect(agreement.pointSpend).toBe(5);
    expect(agreement.rejectionReasons[0]).toContain('exceeds maxPointSpend');
    expect(ledgerEvents).toHaveLength(0);
  });

  it('lets requester and provider clients complete a peer assignment without coordinator job submission', async () => {
    const requesterKeys = await createSigningKeyPair();
    const providerKeys = await createSigningKeyPair();
    const requester = createRequesterClient({
      requesterId: 'requester_peer_client',
      keyPair: requesterKeys,
      identity: null,
      sdk: {
        submitJob() {
          throw new Error('coordinator job submission should not run');
        }
      }
    });
    const provider = createProviderClient({
      providerId: 'provider_peer_client',
      keyPair: providerKeys,
      identity: null,
      runtime: fakeRuntime(),
      sdk: {
        submitReceipt() {
          throw new Error('coordinator receipt submission should not run');
        },
        reportAssignmentFailure() {
          throw new Error('coordinator failure report should not run');
        }
      }
    });
    const sequenceFields = await makePublicProteinJobFields();
    const intent = await requester.createPeerJobIntent({
      sequence: TEST_PUBLIC_PROTEIN_SEQUENCE,
      sequenceRequest: sequenceFields.sequenceRequest,
      modelRequirements: {
        ...launchModelAdvert(),
        sequenceRequest: sequenceFields.sequenceRequest
      }
    });
    const advert = await provider.createPeerProviderAdvert({
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent.intent,
      providerAdverts: [advert]
    });
    const sequencePayload = await requester.createPeerSequencePayload({
      assignment: plan.assignment,
      sequence: intent.sequence,
      toPeerId: plan.assignment.providerId
    });
    const result = await provider.executePeerAssignment(plan.assignment, { inputPayload: sequencePayload });

    expect(plan.ok).toBe(true);
    expect(sequencePayload.body.sequence).toBe(TEST_PUBLIC_PROTEIN_SEQUENCE);
    expect(result.transport).toBe('webrtc_peer_control');
    expect(result.execution.sequenceResult).toMatchObject({ workload: 'sequence.embedding.v1' });
    expect(result.receipt.inputHash).toBe(plan.assignment.inputHash);
    expect(result.receipt.providerSignature).toBeTruthy();
  });

  it('gossips signed peer messages over an in-memory bus for browser DataChannel parity', async () => {
    const requesterKeys = await createSigningKeyPair();
    const providerKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
    const bus = createInMemoryPeerBus();
    const requesterPlane = createPeerControlPlane({
      peerId: 'requester_bus',
      publicKey: requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      bus
    }).start();
    const providerPlane = createPeerControlPlane({
      peerId: 'provider_bus',
      publicKey: providerPublicKey,
      privateKey: providerKeys.privateKey,
      bus
    }).start();

    await providerPlane.publishProviderAdvert({
      models: [launchModelAdvert()],
      runtimeProfileHash: 'sha256:runtime_bus',
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });
    const sequenceFields = await makePublicProteinJobFields();
    const intent = await requesterPlane.publishJobIntent({
      sequence: TEST_PUBLIC_PROTEIN_SEQUENCE,
      sequenceRequest: sequenceFields.sequenceRequest,
      modelRequirements: {
        ...launchModelAdvert(),
        sequenceRequest: sequenceFields.sequenceRequest
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const plan = await requesterPlane.buildAssignmentPlan(intent.intent);
    expect(plan.ok).toBe(true);
    expect(providerPlane.messagesByType(PEER_MESSAGE_TYPES.JOB_INTENT)).toHaveLength(1);
    expect(requesterPlane.messagesByType(PEER_MESSAGE_TYPES.PROVIDER_ADVERT)).toHaveLength(1);

    requesterPlane.stop();
    providerPlane.stop();
  });

  it('wraps a DataChannel-compatible object as a peer message bus', async () => {
    let messageHandler = null;
    const sent = [];
    const dataChannel = {
      send(value) {
        sent.push(value);
      },
      addEventListener(type, handler) {
        if (type === 'message') messageHandler = handler;
      }
    };
    const bus = createDataChannelPeerBus(dataChannel);
    const received = [];
    bus.subscribe((message) => received.push(message));

    const keyPair = await createSigningKeyPair();
    const publicKey = await exportPublicKey(keyPair.publicKey);
    const result = await createSequenceJobIntent({
      requesterId: 'requester_datachannel',
      requesterPublicKey: publicKey,
      privateKey: keyPair.privateKey,
      modelRequirements: launchModelAdvert()
    });

    bus.send(result.intent);
    expect(sent).toHaveLength(1);
    messageHandler({ data: sent[0] });
    expect(received).toHaveLength(1);
    expect(received[0].messageHash).toBe(result.intent.messageHash);
  });
});
