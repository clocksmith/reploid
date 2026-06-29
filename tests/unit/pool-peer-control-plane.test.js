import { describe, expect, it } from 'vitest';

import {
  createSigningKeyPair,
  exportPublicKey,
  hashJson,
  SIGNATURE_DOMAINS,
  sha256Hex
} from '../../self/pool/inference-receipt.js';
import { createProviderClient } from '../../self/pool/provider-client.js';
import { createRequesterClient } from '../../self/pool/requester-client.js';
import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';
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
  verifyPeerMessage
} from '../../self/pool/peer-control-plane.js';
import { createReceiptPayload } from '../../self/pool/p2p-payload.js';
import {
  buildRuntimeProfile,
  hashRuntimeProfile
} from '../../self/pool/runtime-profile.js';

const runtimeModel = () => ({
  modelId: LAUNCH_MODEL.modelId,
  modelHash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  runtime: LAUNCH_MODEL.runtime,
  backend: LAUNCH_MODEL.backend,
  contextLength: LAUNCH_MODEL.contextLength,
  quantization: LAUNCH_MODEL.quantization
});

const fakeRuntime = () => ({
  isReady: () => true,
  getModelInfo: () => runtimeModel(),
  getRuntimeInfo: () => ({
    runtime: LAUNCH_MODEL.runtime,
    backend: LAUNCH_MODEL.backend,
    publicApi: 'generate',
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
        publicApi: 'generate',
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
  generate: async ({ prompt }) => ({
    outputText: `peer:${prompt}`,
    tokenIds: [7, 8, 9],
    transcript: {
      outputText: `peer:${prompt}`,
      tokenIds: [7, 8, 9]
    },
    tokenCounts: {
      input: 2,
      output: 3
    },
    timing: {
      startedAt: '2026-06-14T00:00:00.000Z',
      completedAt: '2026-06-14T00:00:01.000Z'
    },
    status: 'completed'
  })
});

const launchModelAdvert = () => ({
  modelId: LAUNCH_MODEL.modelId,
  modelHash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  runtime: LAUNCH_MODEL.runtime,
  backend: LAUNCH_MODEL.backend
});

describe('pool peer control plane', () => {
  it('creates signed job intents without leaking prompt text into the control plane', async () => {
    const keyPair = await createSigningKeyPair();
    const publicKey = await exportPublicKey(keyPair.publicKey);
    const prompt = 'private requester prompt';
    const result = await createSignedJobIntent({
      requesterId: 'requester_peer',
      requesterPublicKey: publicKey,
      privateKey: keyPair.privateKey,
      prompt,
      modelRequirements: launchModelAdvert()
    });

    expect(await verifyPeerMessage(result.intent)).toMatchObject({ ok: true });
    expect(result.inputHash).toBe(await sha256Hex(prompt));
    expect(result.intent.body.promptTransport).toBe('webrtc_datachannel');
    expect(JSON.stringify(result.intent)).not.toContain(prompt);
    expect(result.prompt).toBe(prompt);
  });

  it('builds deterministic peer assignment plans from signed provider adverts', async () => {
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const intent = await createSignedJobIntent({
      requesterId: 'requester_ring',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      prompt: 'ring peer prompt',
      policyId: 'ring_quorum_receipt',
      modelRequirements: launchModelAdvert()
    });
    const adverts = [];
    for (let index = 0; index < 4; index += 1) {
      const providerKeys = await createSigningKeyPair();
      const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
      adverts.push(await createSignedProviderAdvert({
        providerId: `provider_${index}`,
        providerPublicKey,
        privateKey: providerKeys.privateKey,
        models: [launchModelAdvert()],
        runtimeProfileHash: `sha256:runtime_${index}`,
        availability: {
          acceptedPolicies: ['ring_quorum_receipt']
        }
      }));
    }

    const first = await buildPeerAssignmentPlan({ jobIntent: intent.intent, providerAdverts: adverts });
    const second = await buildPeerAssignmentPlan({ jobIntent: intent.intent, providerAdverts: [...adverts].reverse() });

    expect(first.ok).toBe(true);
    expect(first.assignments).toHaveLength(4);
    expect(first.ring.ringSize).toBe(4);
    expect(first.ring.requiredAgreement).toBe(3);
    expect(first.assignments.map((assignment) => assignment.providerId)).toEqual(
      second.assignments.map((assignment) => assignment.providerId)
    );
    expect(first.assignments.map((assignment) => assignment.assignmentId)).toEqual(
      second.assignments.map((assignment) => assignment.assignmentId)
    );
    expect(first.assignments.every((assignment) => assignment.requiresPromptPayload === true)).toBe(true);
    expect(first.assignments.every((assignment) => assignment.prompt === undefined)).toBe(true);
  });

  it('forms receipt agreement and signed ledger events from matching peer receipts', async () => {
    const requesterKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const intent = await createSignedJobIntent({
      requesterId: 'requester_agreement',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      prompt: 'agreement prompt',
      policyId: 'ring_quorum_receipt',
      modelRequirements: launchModelAdvert()
    });
    const adverts = [];
    for (let index = 0; index < 3; index += 1) {
      const providerKeys = await createSigningKeyPair();
      const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
      adverts.push(await createSignedProviderAdvert({
        providerId: `provider_agreement_${index}`,
        providerPublicKey,
        privateKey: providerKeys.privateKey,
        models: [launchModelAdvert()],
        runtimeProfileHash: `sha256:runtime_agreement_${index}`,
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
      const receipt = {
        receiptVersion: 'reploid_browser_inference/v1',
        signatureDomain: SIGNATURE_DOMAINS.providerReceipt,
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        requesterId: assignment.requesterId,
        providerId: assignment.providerId,
        policyId: assignment.policyId,
        model: assignment.model,
        inputHash: assignment.inputHash,
        generationConfigHash: assignment.generationConfigHash,
        outputHash: 'sha256:matching_output',
        tokenIdsHash: 'sha256:matching_tokens',
        tokenCounts: {
          input: 8,
          output: 3
        },
        verification: {
          runtimeProfileHash: assignment.runtimeProfileHash
        },
        status: 'completed',
        providerSignature: `signature_${assignment.providerId}`
      };
      return createReceiptPayload({
        assignment,
        receiptRecord: {
          receiptHash: await hashJson(receipt),
          receipt,
          outputText: 'matching output',
          tokenIds: [1, 2, 3]
        },
        fromPeerId: assignment.providerId,
        toPeerId: assignment.requesterId
      });
    }));

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

  it('rejects peer receipt agreement when accepted receipts exceed requester point spend', async () => {
    const requesterKeys = await createSigningKeyPair();
    const providerKeys = await createSigningKeyPair();
    const requesterPublicKey = await exportPublicKey(requesterKeys.publicKey);
    const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
    const intent = await createSignedJobIntent({
      requesterId: 'requester_spend_limit',
      requesterPublicKey,
      privateKey: requesterKeys.privateKey,
      prompt: 'spend limited prompt',
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
    const receipt = {
      receiptVersion: 'reploid_browser_inference/v1',
      signatureDomain: SIGNATURE_DOMAINS.providerReceipt,
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      requesterId: assignment.requesterId,
      providerId: assignment.providerId,
      policyId: assignment.policyId,
      model: assignment.model,
      inputHash: assignment.inputHash,
      generationConfigHash: assignment.generationConfigHash,
      outputHash: 'sha256:spend_output',
      tokenIdsHash: 'sha256:spend_tokens',
      tokenCounts: {
        input: 8,
        output: 3
      },
      verification: {
        runtimeProfileHash: assignment.runtimeProfileHash
      },
      status: 'completed',
      providerSignature: 'signature_provider_spend_limit'
    };
    const receiptPayload = await createReceiptPayload({
      assignment,
      receiptRecord: {
        receiptHash: await hashJson(receipt),
        receipt,
        outputText: 'spend output',
        tokenIds: [1, 2, 3]
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
    const intent = await requester.createPeerJobIntent({
      prompt: 'peer-only prompt',
      modelRequirements: launchModelAdvert()
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
    const promptPayload = await requester.createPeerPromptPayload({
      assignment: plan.assignment,
      prompt: intent.prompt,
      toPeerId: plan.assignment.providerId
    });
    const result = await provider.executePeerAssignment(plan.assignment, { promptPayload });

    expect(plan.ok).toBe(true);
    expect(promptPayload.body.prompt).toBe('peer-only prompt');
    expect(result.transport).toBe('webrtc_peer_control');
    expect(result.execution.outputText).toBe('peer:peer-only prompt');
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
    const intent = await requesterPlane.publishJobIntent({
      prompt: 'bus prompt',
      modelRequirements: launchModelAdvert()
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
    const result = await createSignedJobIntent({
      requesterId: 'requester_datachannel',
      requesterPublicKey: publicKey,
      privateKey: keyPair.privateKey,
      prompt: 'datachannel prompt',
      modelRequirements: launchModelAdvert()
    });

    bus.send(result.intent);
    expect(sent).toHaveLength(1);
    messageHandler({ data: sent[0] });
    expect(received).toHaveLength(1);
    expect(received[0].messageHash).toBe(result.intent.messageHash);
  });
});
