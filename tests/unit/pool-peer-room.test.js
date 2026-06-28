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

const fakeRuntime = ({ generate = null } = {}) => ({
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
  generate: generate || (async ({ prompt }) => ({
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
  }))
});

const createBlockingRuntime = () => {
  const releases = [];
  const prompts = [];
  return {
    runtime: fakeRuntime({
      generate: ({ prompt }) => new Promise((resolve) => {
        prompts.push(prompt);
        releases.push(() => resolve({
          outputText: `queued:${prompt}`,
          tokenIds: [21, 22, prompts.length],
          transcript: {
            outputText: `queued:${prompt}`,
            tokenIds: [21, 22, prompts.length]
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
        }));
      })
    }),
    prompts,
    releaseNext() {
      const release = releases.shift();
      if (release) release();
    }
  };
};

const noCoordinatorRequesterSdk = () => ({
  submitJob() {
    throw new Error('coordinator submitJob should not run');
  },
  acceptReceipt() {
    throw new Error('coordinator acceptReceipt should not run');
  }
});

const noCoordinatorProviderSdk = () => ({
  submitReceipt() {
    throw new Error('coordinator submitReceipt should not run');
  },
  reportAssignmentFailure() {
    throw new Error('coordinator reportAssignmentFailure should not run');
  }
});

const createRoomRequesterClient = async (requesterId) => createRequesterClient({
  requesterId,
  keyPair: await createSigningKeyPair(),
  identity: null,
  sdk: noCoordinatorRequesterSdk()
});

const createRoomProviderClient = async ({ providerId, runtime = fakeRuntime() }) => createProviderClient({
  providerId,
  keyPair: await createSigningKeyPair(),
  identity: null,
  runtime,
  sdk: noCoordinatorProviderSdk()
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

  it('accepts a provider that joins after requester discovery starts', async () => {
    installFakeBroadcastChannel();
    const requesterClient = await createRoomRequesterClient('requester_late_provider');
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_late_join'
    });
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'late-provider-room',
      providerClient,
      providerTransportFactory,
      advertIntervalMs: 100000
    });

    const pending = runPeerJob({
      roomId: 'late-provider-room',
      requesterClient,
      requesterTransportFactory,
      prompt: 'late provider prompt',
      policyId: 'fastest_receipt',
      modelRequirements: runtimeModel(),
      discoveryWindowMs: 1000,
      receiptWindowMs: 1000
    });
    await expect.poll(() => FakeBroadcastChannel.channels.get('reploid-peer-room:late-provider-room')?.size || 0).toBeGreaterThan(0);
    await providerNode.start({
      models: [runtimeModel()],
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });

    try {
      const result = await pending;
      expect(result.outputText).toBe('room:late provider prompt');
      expect(result.assignment.providerId).toBe('provider_late_join');
    } finally {
      await providerNode.stop();
    }
  });

  it('ignores providers advertising in a different room', async () => {
    installFakeBroadcastChannel();
    const requesterClient = await createRoomRequesterClient('requester_wrong_room');
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_wrong_room'
    });
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'provider-only-room',
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
        roomId: 'requester-only-room',
        requesterClient,
        requesterTransportFactory,
        prompt: 'wrong room prompt',
        policyId: 'fastest_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 5,
        receiptWindowMs: 100
      })).rejects.toMatchObject({
        code: 'peer_provider_not_found',
        payload: {
          roomId: 'requester-only-room',
          observedProviderCount: 0
        }
      });
    } finally {
      await providerNode.stop();
    }
  });

  it('does not accept a job when the provider leaves before receipt', async () => {
    installFakeBroadcastChannel();
    const requesterClient = await createRoomRequesterClient('requester_provider_leaves');
    const blocking = createBlockingRuntime();
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_leaves_mid_job',
      runtime: blocking.runtime
    });
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'provider-leaves-room',
      providerClient,
      providerTransportFactory,
      advertIntervalMs: 100000,
      maxActiveSessions: 1
    });
    await providerNode.start({
      models: [runtimeModel()],
      availability: {
        maxConcurrentJobs: 1,
        acceptedPolicies: ['fastest_receipt']
      }
    });

    const pending = runPeerJob({
      roomId: 'provider-leaves-room',
      requesterClient,
      requesterTransportFactory,
      prompt: 'provider leaves prompt',
      policyId: 'fastest_receipt',
      modelRequirements: runtimeModel(),
      discoveryWindowMs: 1000,
      receiptWindowMs: 25
    }).catch((error) => error);
    await expect.poll(() => blocking.prompts.length).toBe(1);
    await providerNode.stop();
    blocking.releaseNext();

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/No peer receipt returned|Peer receipt agreement failed/);
  });

  it('returns provider runtime failures to the requester', async () => {
    installFakeBroadcastChannel();
    const requesterClient = await createRoomRequesterClient('requester_runtime_failure');
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_runtime_failure',
      runtime: fakeRuntime({
        generate: async () => {
          throw new Error('synthetic generate failure');
        }
      })
    });
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'runtime-failure-room',
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
        roomId: 'runtime-failure-room',
        requesterClient,
        requesterTransportFactory,
        prompt: 'runtime failure prompt',
        policyId: 'fastest_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 1000,
        receiptWindowMs: 1000
      })).rejects.toThrow(/synthetic generate failure/);
    } finally {
      await providerNode.stop();
    }
  });

  it('rejects ring quorum when provider receipts do not agree', async () => {
    installFakeBroadcastChannel();
    const requesterClient = await createRoomRequesterClient('requester_no_quorum');
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNodes = await Promise.all([0, 1, 2].map(async (index) => {
      const providerClient = await createRoomProviderClient({
        providerId: `provider_no_quorum_${index}`,
        runtime: fakeRuntime({
          generate: async ({ prompt }) => ({
            outputText: `provider-${index}:${prompt}`,
            tokenIds: [index, index + 100],
            transcript: {
              outputText: `provider-${index}:${prompt}`,
              tokenIds: [index, index + 100]
            },
            tokenCounts: {
              input: 2,
              output: 2
            },
            timing: {
              startedAt: '2026-06-14T00:00:00.000Z',
              completedAt: '2026-06-14T00:00:01.000Z'
            },
            status: 'completed'
          })
        })
      });
      const providerNode = createPeerProviderNode({
        roomId: 'no-quorum-room',
        providerClient,
        providerTransportFactory,
        advertIntervalMs: 100000
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
      await expect(runPeerJob({
        roomId: 'no-quorum-room',
        requesterClient,
        requesterTransportFactory,
        prompt: 'no quorum prompt',
        policyId: 'ring_quorum_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 20,
        receiptWindowMs: 1000
      })).rejects.toThrow(/Peer receipt agreement failed/);
    } finally {
      await Promise.all(providerNodes.map((providerNode) => providerNode.stop()));
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
    expect(result.receiptRecord.providerPublicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(result.receiptRecord.peerDecision).toMatchObject({
      accepted: true,
      source: 'provider_signed_peer_execution'
    });
    expect(result.receiptRecord.receipt).toMatchObject({
      assignmentId: result.assignment.assignmentId,
      jobId: result.assignment.jobId,
      providerId: 'provider_room',
      requesterId: 'requester_room',
      policyId: result.assignment.policyId,
      inputHash: result.assignment.inputHash,
      generationConfigHash: result.assignment.generationConfigHash,
      model: {
        id: LAUNCH_MODEL.modelId,
        hash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash
      }
    });
    expect(result.receiptRecord.receipt.outputHash).toMatch(/^sha256:/);
    expect(result.receiptRecord.receipt.tokenIdsHash).toMatch(/^sha256:/);
    expect(result.ledgerEvents.every((event) => event.body?.receiptHash || event.body?.agreementHash)).toBe(true);
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

  it('queues concurrent peer sessions when provider concurrency is saturated', async () => {
    installFakeBroadcastChannel();
    const requesterKeys = await createSigningKeyPair();
    const providerKeys = await createSigningKeyPair();
    const requesterClient = createRequesterClient({
      requesterId: 'requester_room_queue',
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
    const blocking = createBlockingRuntime();
    const providerClient = createProviderClient({
      providerId: 'provider_room_queue',
      keyPair: providerKeys,
      identity: null,
      runtime: blocking.runtime,
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
      roomId: 'room-queue-test',
      providerClient,
      providerTransportFactory,
      advertIntervalMs: 100000,
      maxActiveSessions: 1,
      onActivity: (event) => activity.push(event)
    });

    await providerNode.start({
      models: [runtimeModel()],
      availability: {
        maxConcurrentJobs: 1,
        acceptedPolicies: ['fastest_receipt']
      }
    });

    try {
      const first = runPeerJob({
        roomId: 'room-queue-test',
        requesterClient,
        requesterTransportFactory,
        prompt: 'first queued prompt',
        policyId: 'fastest_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 1000,
        receiptWindowMs: 1000
      });
      await expect.poll(() => blocking.prompts.length).toBe(1);

      const second = runPeerJob({
        roomId: 'room-queue-test',
        requesterClient,
        requesterTransportFactory,
        prompt: 'second queued prompt',
        policyId: 'fastest_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 1000,
        receiptWindowMs: 1000
      });
      await expect.poll(() => activity.some((event) => event.status === 'peer_session_queued')).toBe(true);
      expect(blocking.prompts).toEqual(['first queued prompt']);

      blocking.releaseNext();
      const firstResult = await first;
      await expect.poll(() => blocking.prompts.length).toBe(2);
      blocking.releaseNext();
      const secondResult = await second;

      expect(firstResult.outputText).toBe('queued:first queued prompt');
      expect(secondResult.outputText).toBe('queued:second queued prompt');
      expect(firstResult.assignment.providerId).toBe('provider_room_queue');
      expect(secondResult.assignment.providerId).toBe('provider_room_queue');
      expect(activity.map((event) => event.status)).toContain('peer_session_dequeued');
      expect(activity.filter((event) => event.status === 'peer_receipt_sent')).toHaveLength(2);
      expect(sessions.size).toBe(2);
    } finally {
      await providerNode.stop();
    }
  });

  it('rejects unsupported split-model peer requirements before routing', async () => {
    installFakeBroadcastChannel();
    const requesterKeys = await createSigningKeyPair();
    const requesterClient = createRequesterClient({
      requesterId: 'requester_room_split',
      keyPair: requesterKeys,
      identity: null,
      sdk: {
        submitJob() {
          throw new Error('coordinator submitJob should not run');
        }
      }
    });

    await expect(runPeerJob({
      roomId: 'room-split-test',
      requesterClient,
      requesterTransportFactory: createFakeTransportFactories().requesterTransportFactory,
      prompt: 'split this model',
      policyId: 'fastest_receipt',
      modelRequirements: {
        ...runtimeModel(),
        executionMode: 'model_split',
        splitPlan: {
          kind: 'tensor_parallel',
          partitions: 2
        }
      },
      discoveryWindowMs: 1000,
      receiptWindowMs: 1000
    })).rejects.toThrow(/not supported/);
  });
});
