import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSigningKeyPair
} from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel, LAUNCH_MODEL } from '../../self/pool/model-contract.js';
import { createProviderClient } from '../../self/pool/provider-client.js';
import { createRequesterClient } from '../../self/pool/requester-client.js';
import {
  createPeerProviderNode,
  runPeerJob
} from '../../self/pool/peer-room.js';
import {
  buildRuntimeProfile,
  hashRuntimeProfile
} from '../../self/pool/runtime-profile.js';

const originalBroadcastChannel = globalThis.BroadcastChannel;

class FakeBroadcastChannel {
  static channels = new Map();

  constructor(name) {
    this.name = name;
    this.closed = false;
    this.listeners = new Set();
    const channels = FakeBroadcastChannel.channels.get(name) || new Set();
    channels.add(this);
    FakeBroadcastChannel.channels.set(name, channels);
  }

  addEventListener(type, listener) {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'message') this.listeners.delete(listener);
  }

  postMessage(data) {
    const channels = FakeBroadcastChannel.channels.get(this.name) || new Set();
    for (const channel of channels) {
      if (channel === this || channel.closed) continue;
      queueMicrotask(() => {
        if (channel.closed) return;
        for (const listener of channel.listeners) listener({ data });
      });
    }
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    const channels = FakeBroadcastChannel.channels.get(this.name);
    if (!channels) return;
    channels.delete(this);
    if (channels.size === 0) FakeBroadcastChannel.channels.delete(this.name);
  }
}

function installFakeBroadcastChannel() {
  FakeBroadcastChannel.channels.clear();
  globalThis.BroadcastChannel = FakeBroadcastChannel;
}

function createFakeTransportFactories() {
  const sessions = new Map();
  const getSession = (sessionId) => {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const created = {};
    sessions.set(sessionId, created);
    return created;
  };
  const makeTransport = ({ signaling, initiator, onMessage }) => {
    const session = getSession(signaling.sessionId);
    const side = initiator ? 'requester' : 'provider';
    const peerSide = initiator ? 'provider' : 'requester';
    const transport = {
      closed: false,
      connect() {
        session[side] = transport;
        return Promise.resolve();
      },
      ready() {
        return Promise.resolve();
      },
      send(payload) {
        const peer = session[peerSide];
        if (!peer || peer.closed) throw new Error('fake peer transport is not connected');
        queueMicrotask(() => peer.onMessage(payload));
      },
      onMessage(payload) {
        onMessage?.(payload);
      },
      close() {
        transport.closed = true;
        return Promise.resolve();
      }
    };
    session[side] = transport;
    return transport;
  };
  return {
    requesterTransportFactory: makeTransport,
    providerTransportFactory: makeTransport,
    sessions
  };
}

const runtimeModel = () => buildLaunchProviderModel({ modelId: LAUNCH_MODEL.modelId });

const fakeRuntime = () => ({
  isReady: () => true,
  getModelInfo: () => runtimeModel(),
  getRuntimeInfo: () => ({
    runtime: LAUNCH_MODEL.runtime,
    backend: LAUNCH_MODEL.backend,
    publicApi: 'generate',
    profile: { implementation: 'peer-room-test' }
  }),
  getRuntimeProfile: async () => {
    const runtimeProfile = buildRuntimeProfile({
      modelInfo: runtimeModel(),
      runtimeInfo: {
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend,
        publicApi: 'generate',
        profile: { implementation: 'peer-room-test' }
      },
      deviceInfo: {
        hasWebGPU: true,
        probeStatus: 'ok',
        adapterInfo: { vendor: 'peer-room-test' },
        features: ['shader-f16'],
        limits: { maxBufferSize: 1024 }
      },
      browserProfile: {
        userAgent: 'peer-room-test-browser',
        platform: 'peer-room-test-platform',
        brands: ['PeerRoom:1'],
        mobile: false
      }
    });
    return {
      runtimeProfile,
      runtimeProfileHash: await hashRuntimeProfile(runtimeProfile)
    };
  },
  getDeviceInfo: async () => ({
    hasWebGPU: true,
    probeStatus: 'ok'
  }),
  generate: async ({ prompt }) => ({
    outputText: `room:${prompt}`,
    tokenIds: [11, 12, 13],
    transcript: {
      outputText: `room:${prompt}`,
      tokenIds: [11, 12, 13]
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

afterEach(() => {
  globalThis.BroadcastChannel = originalBroadcastChannel;
  FakeBroadcastChannel.channels.clear();
  vi.restoreAllMocks();
});

describe('pool peer room', () => {
  it('reports a clear submit error when no contributor advertises in the room', async () => {
    installFakeBroadcastChannel();
    const requesterKeys = await createSigningKeyPair();
    const requesterClient = createRequesterClient({
      requesterId: 'requester_empty_room',
      keyPair: requesterKeys,
      identity: null,
      sdk: {
        submitJob() {
          throw new Error('coordinator submitJob should not run');
        }
      }
    });

    await expect(runPeerJob({
      roomId: 'empty-room-test',
      requesterClient,
      requesterTransportFactory: createFakeTransportFactories().requesterTransportFactory,
      prompt: 'hello',
      modelRequirements: runtimeModel(),
      discoveryWindowMs: 1,
      receiptWindowMs: 100
    })).rejects.toMatchObject({
      code: 'peer_provider_not_found',
      retryable: true,
      payload: {
        roomId: 'empty-room-test',
        observedProviderCount: 0,
        action: 'Open Mesh in another tab with the same room, click Start, then run the request again.'
      }
    });
  });

  it('reports observed contributors when none match the requested model', async () => {
    installFakeBroadcastChannel();
    const requesterKeys = await createSigningKeyPair();
    const requesterClient = createRequesterClient({
      requesterId: 'requester_mismatch_room',
      keyPair: requesterKeys,
      identity: null,
      sdk: {
        submitJob() {
          throw new Error('coordinator submitJob should not run');
        }
      }
    });
    const providerClient = {
      async createPeerProviderAdvert() {
        return {
          messageHash: 'mismatch_advert_hash',
          fromPeerId: 'provider_mismatch_room',
          publicKey: 'test_public_key',
          body: {
            providerId: 'provider_mismatch_room',
            models: [
              {
                ...runtimeModel(),
                modelId: 'different-model'
              }
            ],
            availability: {
              acceptedPolicies: ['fastest_receipt']
            }
          }
        };
      }
    };
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'mismatch-room-test',
      providerClient,
      providerTransportFactory,
      advertIntervalMs: 100000
    });

    await providerNode.start({
      models: [runtimeModel()],
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });

    try {
      await expect(runPeerJob({
        roomId: 'mismatch-room-test',
        requesterClient,
        requesterTransportFactory,
        prompt: 'hello',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 10,
        receiptWindowMs: 100
      })).rejects.toMatchObject({
        code: 'peer_provider_model_mismatch',
        payload: {
          roomId: 'mismatch-room-test',
          observedProviderCount: 1,
          observedProviders: [
            {
              providerId: 'provider_mismatch_room',
              modelIds: ['different-model']
            }
          ]
        }
      });
    } finally {
      await providerNode.stop();
    }
  });

  it('runs a browser room job over peer discovery and DataChannel payloads without coordinator calls', async () => {
    installFakeBroadcastChannel();
    const requesterKeys = await createSigningKeyPair();
    const providerKeys = await createSigningKeyPair();
    const requesterClient = createRequesterClient({
      requesterId: 'requester_room',
      keyPair: requesterKeys,
      identity: null,
      sdk: {
        submitJob() {
          throw new Error('coordinator submitJob should not run');
        },
        acceptReceipt() {
          throw new Error('coordinator acceptReceipt should not run');
        }
      }
    });
    const providerClient = createProviderClient({
      providerId: 'provider_room',
      keyPair: providerKeys,
      identity: null,
      runtime: fakeRuntime(),
      sdk: {
        submitReceipt() {
          throw new Error('coordinator submitReceipt should not run');
        },
        reportAssignmentFailure() {
          throw new Error('coordinator reportAssignmentFailure should not run');
        }
      }
    });
    const {
      requesterTransportFactory,
      providerTransportFactory,
      sessions
    } = createFakeTransportFactories();
    const activity = [];
    const providerNode = createPeerProviderNode({
      roomId: 'room-test',
      providerClient,
      providerTransportFactory,
      advertIntervalMs: 100000,
      onActivity: (event) => activity.push(event)
    });

    await providerNode.start({
      models: [runtimeModel()],
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });
    const result = await runPeerJob({
      roomId: 'room-test',
      requesterClient,
      requesterTransportFactory,
      prompt: 'peer room prompt',
      modelRequirements: runtimeModel(),
      discoveryWindowMs: 1000,
      receiptWindowMs: 1000
    });
    const stopped = await providerNode.stop();

    expect(result.transport).toBe('webrtc_peer_room');
    expect(result.outputText).toBe('room:peer room prompt');
    expect(result.assignment.providerId).toBe('provider_room');
    expect(result.assignment.requesterId).toBe('requester_room');
    expect(result.promptPayload.body.prompt).toBe('peer room prompt');
    expect(result.receiptHash).toMatch(/^sha256:/);
    expect(result.requesterAcceptance).toMatchObject({
      receiptHash: result.receiptHash,
      requesterId: 'requester_room',
      accepted: true
    });
    expect(activity.map((event) => event.status)).toContain('peer_receipt_sent');
    expect(activity.map((event) => event.status)).toContain('peer_acceptance_received');
    expect(sessions.size).toBe(1);
    expect(stopped.status).toBe('peer_provider_stopped');
  });

  it('forms a browser-room ring quorum from multiple WebRTC providers', async () => {
    installFakeBroadcastChannel();
    const requesterKeys = await createSigningKeyPair();
    const requesterClient = createRequesterClient({
      requesterId: 'requester_room_ring',
      keyPair: requesterKeys,
      identity: null,
      sdk: {
        submitJob() {
          throw new Error('coordinator submitJob should not run');
        },
        acceptReceipt() {
          throw new Error('coordinator acceptReceipt should not run');
        }
      }
    });
    const {
      requesterTransportFactory,
      providerTransportFactory,
      sessions
    } = createFakeTransportFactories();
    const activity = [];
    const providerNodes = await Promise.all([0, 1, 2].map(async (index) => {
      const providerKeys = await createSigningKeyPair();
      const providerClient = createProviderClient({
        providerId: `provider_room_ring_${index}`,
        keyPair: providerKeys,
        identity: null,
        runtime: fakeRuntime(),
        sdk: {
          submitReceipt() {
            throw new Error('coordinator submitReceipt should not run');
          },
          reportAssignmentFailure() {
            throw new Error('coordinator reportAssignmentFailure should not run');
          }
        }
      });
      const providerNode = createPeerProviderNode({
        roomId: 'room-ring-test',
        providerClient,
        providerTransportFactory,
        advertIntervalMs: 100000,
        onActivity: (event) => activity.push({
          ...event,
          providerId: `provider_room_ring_${index}`
        })
      });
      await providerNode.start({
        models: [runtimeModel()],
        availability: {
          acceptedPolicies: ['ring_quorum_receipt']
        }
      });
      return providerNode;
    }));

    try {
      const result = await runPeerJob({
        roomId: 'room-ring-test',
        requesterClient,
        requesterTransportFactory,
        prompt: 'peer room ring prompt',
        policyId: 'ring_quorum_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 20,
        receiptWindowMs: 1000
      });

      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.plan.ring).toMatchObject({
        ringSize: 3,
        requiredAgreement: 2
      });
      expect(result.assignments).toHaveLength(3);
      expect(result.receiptPayloads).toHaveLength(3);
      expect(result.receiptHashes).toHaveLength(3);
      expect(result.agreement).toMatchObject({
        accepted: true,
        mode: 'ring_quorum',
        requiredAgreement: 2,
        acceptedProviderCount: 3,
        agreementField: 'tokenIdsHash'
      });
      expect(result.ledgerEvents.length).toBeGreaterThan(0);
      expect(result.requesterAcceptance).toMatchObject({
        accepted: true,
        receiptHashes: result.receiptHashes
      });
      expect(activity.map((event) => event.status)).toContain('peer_acceptance_received');
      expect(activity.filter((event) => event.status === 'peer_receipt_sent')).toHaveLength(3);
      expect(sessions.size).toBe(3);
    } finally {
      await Promise.all(providerNodes.map((providerNode) => providerNode.stop()));
    }
  });
});
