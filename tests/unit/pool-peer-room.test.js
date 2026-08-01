import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSigningKeyPair,
  hashJson,
  sha256Hex
} from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel, LAUNCH_MODEL } from '../../self/pool/model-contract.js';
import { createProviderClient } from '../../self/pool/provider-client.js';
import { createRequesterClient } from '../../self/pool/requester-client.js';
import {
  createPeerProviderNode,
  runPeerJob as executePeerJob
} from '../../self/pool/peer-room.js';
import {
  buildRuntimeProfile,
  hashRuntimeProfile
} from '../../self/pool/runtime-profile.js';
import {
  createInMemoryPeerRoomBusNetwork,
  createPeerRoomBusFactory
} from '../../self/pool/peer-rendezvous.js';

const originalBroadcastChannel = globalThis.BroadcastChannel;

const hashFloat32Values = (values) => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return sha256Hex(bytes);
};

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
const sequenceRuntimeModel = () => buildLaunchProviderModel({
  modelId: 'esm2-t12-35m-ur50d-f32-af32'
});
const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const TEST_PUBLIC_SEQUENCE = 'MKTAYIAKQRQISFVKSHFSRQ';
const TEST_AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY';
const testSequenceFor = (label = '') => {
  const normalized = String(label || '').trim();
  if (!normalized) return TEST_PUBLIC_SEQUENCE;
  return [...normalized].map((character) => (
    TEST_AMINO_ACIDS[character.codePointAt(0) % TEST_AMINO_ACIDS.length]
  )).join('');
};
const testSequenceRequest = () => ({
  workload: 'sequence.embedding.v1',
  alphabet: 'amino_acid',
  sensitivity: 'public',
  includeTokenEmbeddings: false,
  includeLogits: false
});

const runPeerJob = (options = {}) => executePeerJob({
  ...options,
  prompt: undefined,
  sequence: options.sequence || testSequenceFor(options.prompt),
  sequenceRequest: options.sequenceRequest || testSequenceRequest()
});

const fetchableAdapterRequirement = () => ({
  schema: 'reploid.pool.adapter-requirement/v2',
  packHash: fakeHash('1'),
  adapterId: 'adapter-peer-room',
  adapterSha256: fakeHash('2'),
  baseModelId: LAUNCH_MODEL.modelId,
  baseModelHash: LAUNCH_MODEL.modelHash,
  baseManifestHash: LAUNCH_MODEL.manifestHash,
  baseTokenizerHash: LAUNCH_MODEL.tokenizerHash,
  baseSourceRepo: LAUNCH_MODEL.artifactIdentity.sourceRepo,
  baseSourceRevision: LAUNCH_MODEL.artifactIdentity.sourceRevision,
  baseWeightPackId: LAUNCH_MODEL.artifactIdentity.weightPackId,
  baseWeightPackHash: LAUNCH_MODEL.artifactIdentity.weightPackHash,
  baseManifestVariantId: LAUNCH_MODEL.artifactIdentity.manifestVariantId,
  baseConversionConfigDigest: LAUNCH_MODEL.artifactIdentity.conversionConfigDigest,
  humanPromotionReceiptHash: fakeHash('3'),
  dopplerParityReceiptHash: fakeHash('4'),
  gammaSelectionReceiptHash: fakeHash('5'),
  publicationHash: fakeHash('6'),
  publisherId: 'publisher-peer-room',
  state: 'fetchable'
});

const createFakeSequenceExecution = async ({
  sequence,
  request,
  outputText = '',
  tokenIds = []
} = {}) => {
  const seed = Number(tokenIds[0]);
  const pooledEmbedding = Number.isFinite(seed)
    ? [seed, -0.5, 0.75]
    : [0.25, -0.5, 0.75];
  const pooledEmbeddingHash = await hashFloat32Values(pooledEmbedding);
  const sequenceResult = {
    schema: 'reploid.pool.sequence_result/v1',
    workload: request.workload,
    alphabet: request.alphabet,
    sequenceHash: request.sequenceHash,
    sequenceLength: request.sequenceLength,
    tokenCount: sequence.length,
    tokensHash: await hashJson([...sequence].map((_, index) => index)),
    includedTokenCount: sequence.length,
    embeddingDim: pooledEmbedding.length,
    vocabSize: 33,
    pooledEmbeddingHash,
    tokenEmbeddingsHash: null,
    maskedLogitsHash: null
  };
  const sequenceResultHash = await hashJson(sequenceResult);
  return {
    outputKind: request.workload,
    outputText,
    tokenIds,
    vectorHash: pooledEmbeddingHash,
    sequenceResultHash,
    sequenceResult,
    sequenceOutput: {
      pooledEmbedding,
      tokenEmbeddings: null,
      maskedLogits: []
    },
    embeddingDimensions: pooledEmbedding.length,
    embeddingStats: {
      dimensions: pooledEmbedding.length,
      nonFiniteCount: 0,
      l2Norm: 0.935414
    },
    transcript: {
      outputKind: request.workload,
      sequenceResultHash,
      sequenceResult
    },
    tokenCounts: {
      input: sequence.length,
      output: 0
    },
    timing: {
      startedAt: '2026-07-25T00:00:00.000Z',
      completedAt: '2026-07-25T00:00:01.000Z'
    },
    status: 'completed'
  };
};

const fakeRuntime = ({ generate = null } = {}) => {
  const run = generate || (async ({ prompt }) => ({
    outputText: `room:${prompt}`,
    tokenIds: [11, 12, 13]
  }));
  const model = runtimeModel();
  return {
    isReady: () => true,
    getModelInfo: () => model,
    getRuntimeInfo: () => ({
      runtime: model.runtime,
      backend: model.backend,
      publicApi: 'encodeSequence',
      profile: { implementation: 'peer-room-test' }
    }),
    getRuntimeProfile: async () => {
      const runtimeProfile = buildRuntimeProfile({
        modelInfo: model,
        runtimeInfo: {
          runtime: model.runtime,
          backend: model.backend,
          publicApi: 'encodeSequence',
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
    generate: run,
    async encodeSequence({ sequence, request }) {
      const legacy = await run({ prompt: sequence });
      return createFakeSequenceExecution({
        sequence,
        request,
        outputText: legacy.outputText || '',
        tokenIds: legacy.tokenIds || []
      });
    }
  };
};

const fakeSequenceRuntime = () => {
  const model = sequenceRuntimeModel();
  return {
    isReady: () => true,
    getModelInfo: () => model,
    getRuntimeInfo: () => ({
      runtime: model.runtime,
      backend: model.backend,
      publicApi: 'encodeSequence',
      profile: { implementation: 'peer-room-sequence-test' }
    }),
    getRuntimeProfile: async () => {
      const runtimeProfile = buildRuntimeProfile({
        modelInfo: model,
        runtimeInfo: {
          runtime: model.runtime,
          backend: model.backend,
          publicApi: 'encodeSequence',
          profile: { implementation: 'peer-room-sequence-test' }
        },
        deviceInfo: {
          hasWebGPU: true,
          probeStatus: 'ok',
          adapterInfo: { vendor: 'peer-room-sequence-test' },
          features: [],
          limits: { maxBufferSize: 1024 }
        },
        browserProfile: {
          userAgent: 'peer-room-sequence-test-browser',
          platform: 'peer-room-sequence-test-platform',
          brands: ['PeerRoomSequence:1'],
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
    async encodeSequence({ sequence, request }) {
      return createFakeSequenceExecution({ sequence, request });
    }
  };
};

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

const createMemoryRelaySdk = () => {
  const messages = [];
  return {
    publishPeerRoomMessage(roomId, message) {
      const saved = {
        roomId,
        message,
        createdAt: Number(message.relay?.createdAt || Date.now()),
        relayId: message.relay?.relayId || `relay_${messages.length}`
      };
      messages.push(saved);
      return Promise.resolve({ message: saved });
    },
    listPeerRoomMessages(roomId, { after = 0, peerId = null } = {}) {
      return Promise.resolve({
        messages: messages.filter((entry) => (
          entry.roomId === roomId
          && Number(entry.createdAt || 0) > Number(after || 0)
          && (!peerId || entry.message?.relay?.fromPeerId !== peerId)
        ))
      });
    },
    messages
  };
};

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
        action: 'Start contributing in Compute to download and host esm2-t12-35m-ur50d-f32-af32 locally in this browser, or open another tab in room "empty-room-test".'
      }
    });
  });

  it('requires a live discovery response instead of routing to a cached provider advert', async () => {
    const roomId = 'cached-provider-room';
    const relaySdk = createMemoryRelaySdk();
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_that_closed'
    });
    const advert = await providerClient.createPeerProviderAdvert({
      models: [runtimeModel()],
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });
    relaySdk.messages.push({
      roomId,
      createdAt: Date.now() - 1000,
      relayId: 'cached-provider-advert',
      message: {
        peerRoomVersion: 'reploid_peer_room/v1',
        roomId,
        type: 'provider-advert',
        body: { advert },
        relay: {
          relayId: 'cached-provider-advert',
          fromPeerId: advert.body.providerId,
          createdAt: Date.now() - 1000
        }
      }
    });
    const roomBusFactory = createPeerRoomBusFactory({
      sdk: relaySdk,
      relay: 'server',
      pollIntervalMs: 1,
      relayTtlMs: 10000
    });

    await expect(runPeerJob({
      roomId,
      requesterClient: await createRoomRequesterClient('requester_cached_provider'),
      requesterTransportFactory: createFakeTransportFactories().requesterTransportFactory,
      roomBusFactory,
      prompt: 'do not route to a closed tab',
      policyId: 'fastest_receipt',
      modelRequirements: runtimeModel(),
      knownProviderAdverts: [advert],
      discoveryWindowMs: 20,
      sessionAcceptWindowMs: 10,
      receiptWindowMs: 100
    })).rejects.toMatchObject({
      code: 'peer_provider_not_found',
      payload: {
        roomId,
        observedProviderCount: 0
      }
    });
  });

  it('classifies a provider that answers discovery but not the run session as unavailable', async () => {
    const roomId = 'unresponsive-provider-room';
    const network = createInMemoryPeerRoomBusNetwork();
    const roomBusFactory = (options) => network.createBus(options);
    const providerBus = roomBusFactory({ roomId });
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_unresponsive'
    });
    const advert = await providerClient.createPeerProviderAdvert({
      models: [runtimeModel()],
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });
    providerBus.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type !== 'provider-advert-request') return;
      providerBus.postMessage({
        peerRoomVersion: 'reploid_peer_room/v1',
        roomId,
        type: 'provider-advert',
        body: {
          advert,
          discoveryRequestId: message.body.discoveryRequestId
        }
      });
    });

    try {
      await expect(runPeerJob({
        roomId,
        requesterClient: await createRoomRequesterClient('requester_unresponsive_provider'),
        requesterTransportFactory: createFakeTransportFactories().requesterTransportFactory,
        roomBusFactory,
        prompt: 'provider disappears after discovery',
        policyId: 'fastest_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 50,
        sessionAcceptWindowMs: 5,
        receiptWindowMs: 100
      })).rejects.toMatchObject({
        code: 'peer_provider_unresponsive',
        retryable: true,
        payload: {
          roomId,
          acceptedSessionCount: 0,
          requiredAcceptedSessions: 1,
          unresponsiveProviderIds: ['provider_unresponsive']
        }
      });
    } finally {
      providerBus.close();
      network.reset();
    }
  });

  it('preserves a WebRTC transport timeout as recoverable provider unavailability', async () => {
    installFakeBroadcastChannel();
    const roomId = 'transport-timeout-room';
    const requesterClient = await createRoomRequesterClient('requester_transport_timeout');
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_transport_timeout',
      runtime: fakeSequenceRuntime()
    });
    const transports = createFakeTransportFactories();
    const requesterTransportFactory = (options) => {
      const transport = transports.requesterTransportFactory(options);
      transport.connect = () => Promise.reject(new Error('simulated WebRTC transport timeout'));
      transport.getDiagnostics = () => ({ turnConfigured: true, state: 'connecting' });
      return transport;
    };
    const providerNode = createPeerProviderNode({
      roomId,
      providerClient,
      providerTransportFactory: transports.providerTransportFactory,
      advertIntervalMs: 100000
    });
    await providerNode.start({
      models: [sequenceRuntimeModel()],
      availability: { acceptedPolicies: ['fastest_receipt'] }
    });

    try {
      await expect(runPeerJob({
        roomId,
        requesterClient,
        requesterTransportFactory,
        sequence: 'MKTAYIAKQRQISFVKSHFSRQ',
        sequenceRequest: {
          workload: 'sequence.embedding.v1',
          alphabet: 'amino_acid',
          sensitivity: 'public'
        },
        policyId: 'fastest_receipt',
        modelRequirements: sequenceRuntimeModel(),
        discoveryWindowMs: 1000,
        transportConnectWindowMs: 10,
        receiptWindowMs: 100
      })).rejects.toMatchObject({
        code: 'peer_provider_unresponsive',
        retryable: true,
        payload: {
          roomId,
          validReceiptCount: 0,
          requiredAgreement: 1,
          failedProviderIds: ['provider_transport_timeout'],
          providerFailures: [
            expect.objectContaining({
              providerId: 'provider_transport_timeout',
              code: 'webrtc_connection_timeout',
              message: 'simulated WebRTC transport timeout'
            })
          ]
        },
        diagnostics: {
          providerFailures: [
            expect.objectContaining({
              diagnostics: { turnConfigured: true, state: 'connecting' }
            })
          ]
        }
      });
    } finally {
      await providerNode.stop();
    }
  });

  it('releases a provider session when a requester transport closes before input', async () => {
    installFakeBroadcastChannel();
    const roomId = 'transport-close-releases-provider-session';
    const requesterClient = await createRoomRequesterClient('requester_transport_close_release');
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_transport_close_release',
      runtime: fakeSequenceRuntime()
    });
    const transports = createFakeTransportFactories();
    let requesterConnects = 0;
    let providerClosedSessions = 0;
    const requesterTransportFactory = (options) => {
      const transport = transports.requesterTransportFactory(options);
      const connect = transport.connect.bind(transport);
      const close = transport.close.bind(transport);
      transport.connect = () => {
        requesterConnects += 1;
        if (requesterConnects === 1) {
          return Promise.reject(new Error('simulated requester connection failure'));
        }
        return connect();
      };
      transport.close = async (reason) => {
        await options.signaling.sendClose?.(reason);
        return close(reason);
      };
      return transport;
    };
    const providerTransportFactory = (options) => {
      const transport = transports.providerTransportFactory(options);
      const unsubscribe = options.signaling.subscribe((message) => {
        if (message.type === 'close') options.onStateChange?.('closed');
      });
      const close = transport.close.bind(transport);
      transport.close = async (reason) => {
        providerClosedSessions += 1;
        unsubscribe();
        options.onStateChange?.('closed');
        return close(reason);
      };
      return transport;
    };
    const providerNode = createPeerProviderNode({
      roomId,
      providerClient,
      providerTransportFactory,
      advertIntervalMs: 100000,
      maxActiveSessions: 1,
      maxQueuedSessions: 0
    });
    await providerNode.start({
      models: [sequenceRuntimeModel()],
      availability: { acceptedPolicies: ['fastest_receipt'], maxConcurrentJobs: 1 }
    });

    try {
      await expect(runPeerJob({
        roomId,
        requesterClient,
        requesterTransportFactory,
        sequence: TEST_PUBLIC_SEQUENCE,
        sequenceRequest: testSequenceRequest(),
        policyId: 'fastest_receipt',
        modelRequirements: sequenceRuntimeModel(),
        discoveryWindowMs: 1000,
        transportConnectWindowMs: 10,
        receiptWindowMs: 100
      })).rejects.toMatchObject({
        code: 'peer_provider_unresponsive'
      });
      await vi.waitFor(() => expect(providerClosedSessions).toBeGreaterThan(0));

      const result = await runPeerJob({
        roomId,
        requesterClient,
        requesterTransportFactory,
        sequence: TEST_PUBLIC_SEQUENCE,
        sequenceRequest: testSequenceRequest(),
        policyId: 'fastest_receipt',
        modelRequirements: sequenceRuntimeModel(),
        discoveryWindowMs: 1000,
        receiptWindowMs: 1000
      });

      expect(result.receiptHash).toMatch(/^sha256:/);
      expect(result.sequenceOutput?.pooledEmbedding).toHaveLength(3);
      expect(requesterConnects).toBe(2);
    } finally {
      await providerNode.stop();
    }
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

  it('does not route adapter work to a base-model-only contributor', async () => {
    installFakeBroadcastChannel();
    const requesterClient = createRequesterClient({
      requesterId: 'requester_adapter_mismatch',
      keyPair: await createSigningKeyPair(),
      identity: null,
      sdk: null
    });
    const providerClient = {
      async createPeerProviderAdvert() {
        return {
          messageHash: 'base_only_advert_hash',
          fromPeerId: 'provider_base_only',
          publicKey: 'test_public_key',
          body: {
            providerId: 'provider_base_only',
            models: [runtimeModel()],
            availability: { acceptedPolicies: ['fastest_receipt'] }
          }
        };
      }
    };
    const transports = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'adapter-mismatch-room',
      providerClient,
      providerTransportFactory: transports.providerTransportFactory,
      advertIntervalMs: 100000
    });
    await providerNode.start({
      models: [runtimeModel()],
      availability: { acceptedPolicies: ['fastest_receipt'] }
    });

    try {
      await expect(runPeerJob({
        roomId: 'adapter-mismatch-room',
        requesterClient,
        requesterTransportFactory: transports.requesterTransportFactory,
        prompt: 'Use the selected adapter',
        modelRequirements: {
          ...runtimeModel(),
          adapter: fetchableAdapterRequirement()
        },
        discoveryWindowMs: 10,
        receiptWindowMs: 100
      })).rejects.toMatchObject({
        code: 'peer_provider_model_mismatch',
        payload: {
          observedProviderCount: 1,
          observedProviders: [{ providerId: 'provider_base_only' }]
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
      expect(result.outputText).toBe(`room:${testSequenceFor('late provider prompt')}`);
      expect(result.assignment.providerId).toBe('provider_late_join');
    } finally {
      await providerNode.stop();
    }
  });

  it('uses a compatible known provider advert without repeating discovery', async () => {
    installFakeBroadcastChannel();
    const requesterClient = await createRoomRequesterClient('requester_known_provider');
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_already_ready'
    });
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'known-provider-room',
      providerClient,
      providerTransportFactory,
      advertIntervalMs: 100000
    });
    const started = await providerNode.start({
      models: [runtimeModel()],
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });
    const activity = [];

    try {
      const result = await runPeerJob({
        roomId: 'known-provider-room',
        requesterClient,
        requesterTransportFactory,
        prompt: 'start immediately',
        policyId: 'fastest_receipt',
        modelRequirements: runtimeModel(),
        knownProviderAdverts: [started.advert],
        discoveryWindowMs: 1,
        receiptWindowMs: 1000,
        onActivity: (event) => activity.push(event)
      });

      expect(result.outputText).toBe(`room:${testSequenceFor('start immediately')}`);
      expect(result.assignment.providerId).toBe('provider_already_ready');
      expect(activity).toContainEqual(expect.objectContaining({
        status: 'peer_provider_discovery_started',
        knownProviders: 1
      }));
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
    expect(error).toMatchObject({
      code: 'peer_provider_unresponsive',
      retryable: true,
      payload: {
        roomId: 'provider-leaves-room',
        validReceiptCount: 0,
        requiredAgreement: 1,
        failedProviderIds: ['provider_leaves_mid_job'],
        providerFailures: [
          expect.objectContaining({
            providerId: 'provider_leaves_mid_job',
            code: 'peer_receipt_timeout',
            message: 'No peer receipt returned before the delivery deadline'
          })
        ]
      }
    });
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
    const runActivity = [];
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
      receiptWindowMs: 1000,
      onActivity: (event) => runActivity.push(event)
    });
    const stopped = await providerNode.stop();

    expect(result.transport).toBe('webrtc_peer_room');
    expect(result.outputText).toBe(`room:${testSequenceFor('peer room prompt')}`);
    expect(result.assignment.providerId).toBe('provider_room');
    expect(result.assignment.requesterId).toBe('requester_room');
    expect(result.inputPayload.body.sequence).toBe(testSequenceFor('peer room prompt'));
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
    expect(runActivity.map(({ status, phase }) => `${status}:${phase}`)).toEqual([
      'peer_run_intent_created:prompt',
      'peer_provider_discovery_started:match',
      'peer_assignment_planned:match',
      'peer_inference_started:infer',
      'peer_receipts_received:verify',
      'peer_agreement_verified:verify',
      'peer_run_completed:answer'
    ]);
    expect(runActivity.every((event) => event.roomId === 'room-test')).toBe(true);
    expect(sessions.size).toBe(1);
    expect(stopped.status).toBe('peer_provider_stopped');
  });

  it('advertises and executes a public protein sequence through the browser room', async () => {
    installFakeBroadcastChannel();
    const sequence = 'MKTAYIAK';
    const requesterClient = await createRoomRequesterClient('requester_sequence_room');
    const providerClient = await createRoomProviderClient({
      providerId: 'provider_sequence_room',
      runtime: fakeSequenceRuntime()
    });
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'sequence-room-test',
      providerClient,
      providerTransportFactory,
      advertIntervalMs: 100000
    });

    try {
      await providerNode.start({
        models: [sequenceRuntimeModel()],
        availability: {
          acceptedPolicies: ['fastest_receipt']
        }
      });
      const result = await runPeerJob({
        roomId: 'sequence-room-test',
        requesterClient,
        requesterTransportFactory,
        sequence,
        sequenceRequest: {
          workload: 'sequence.embedding.v1',
          alphabet: 'amino_acid',
          sensitivity: 'public',
          includeTokenEmbeddings: false,
          includeLogits: false
        },
        modelRequirements: sequenceRuntimeModel(),
        discoveryWindowMs: 1000,
        receiptWindowMs: 1000
      });

      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.outputKind).toBe('sequence.embedding.v1');
      expect(result.sequenceResult).toMatchObject({
        schema: 'reploid.pool.sequence_result/v1',
        workload: 'sequence.embedding.v1',
        alphabet: 'amino_acid',
        sequenceLength: sequence.length,
        embeddingDim: 3
      });
      expect(result.sequenceResultHash).toMatch(/^sha256:/);
      expect(result.embeddingDimensions).toBe(3);
      expect(result.inputPayload.body.sequence).toBe(sequence);
      expect(JSON.stringify(result.receiptRecord.receipt)).not.toContain(sequence);
    } finally {
      await providerNode.stop();
    }
  });

  it('runs a browser room job through the SDK relay bus', async () => {
    const requesterClient = await createRoomRequesterClient('requester_relay_room');
    const providerClient = await createRoomProviderClient({ providerId: 'provider_relay_room' });
    const relaySdk = createMemoryRelaySdk();
    const relayBusFactory = createPeerRoomBusFactory({
      sdk: relaySdk,
      relay: 'server',
      pollIntervalMs: 1,
      relayTtlMs: 10000
    });
    const busRoles = [];
    const roomBusFactory = (options) => {
      busRoles.push(options.role);
      return relayBusFactory(options);
    };
    const {
      requesterTransportFactory,
      providerTransportFactory
    } = createFakeTransportFactories();
    const providerNode = createPeerProviderNode({
      roomId: 'relay-room-test',
      providerClient,
      providerTransportFactory,
      roomBusFactory,
      advertIntervalMs: 100000
    });

    await providerNode.start({
      models: [runtimeModel()],
      availability: {
        acceptedPolicies: ['fastest_receipt']
      }
    });
    try {
      const result = await runPeerJob({
        roomId: 'relay-room-test',
        requesterClient,
        requesterTransportFactory,
        roomBusFactory,
        prompt: 'relay room prompt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 1000,
        receiptWindowMs: 1000
      });

      expect(result.outputText).toBe(`room:${testSequenceFor('relay room prompt')}`);
      expect(result.assignment.providerId).toBe('provider_relay_room');
      expect(result.assignment.requesterId).toBe('requester_relay_room');
      expect(result.receiptHash).toMatch(/^sha256:/);
      expect(relaySdk.messages.some((entry) => entry.message.type === 'provider-advert')).toBe(true);
      expect(relaySdk.messages.some((entry) => entry.message.type === 'peer-run-request')).toBe(true);
      expect(relaySdk.messages.some((entry) => entry.message.type === 'peer-run-accepted')).toBe(true);
      expect(JSON.stringify(relaySdk.messages)).not.toContain(testSequenceFor('relay room prompt'));
      expect(JSON.stringify(relaySdk.messages)).not.toContain('outputText');
      expect(JSON.stringify(relaySdk.messages)).not.toContain('tokenIds');
      expect(busRoles).toEqual(['provider', 'requester']);
    } finally {
      await providerNode.stop();
    }
  });

  it('forwards relay health transitions to provider activity', async () => {
    const activity = [];
    const channel = {
      addEventListener() {},
      removeEventListener() {},
      postMessage: vi.fn(() => Promise.resolve()),
      close() {}
    };
    const providerNode = createPeerProviderNode({
      roomId: 'relay-health-room',
      providerClient: await createRoomProviderClient({ providerId: 'provider_relay_health' }),
      roomBusFactory: ({ onStatus }) => {
        onStatus?.({ type: 'relay-circuit-open', circuitState: 'open' });
        onStatus?.({ type: 'relay-circuit-closed', circuitState: 'closed' });
        return channel;
      },
      advertIntervalMs: 100000,
      onActivity: (event) => activity.push(event)
    });

    try {
      await providerNode.start({
        models: [runtimeModel()],
        availability: { acceptedPolicies: ['fastest_receipt'] }
      });
      expect(activity).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: 'relay-circuit-open',
          relayStatus: expect.objectContaining({ circuitState: 'open' })
        }),
        expect.objectContaining({
          status: 'relay-circuit-closed',
          relayStatus: expect.objectContaining({ circuitState: 'closed' })
        })
      ]));
    } finally {
      await providerNode.stop();
    }
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
        agreementField: 'sequenceResultHash'
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

  it('executes a twelve-provider browser-room ring quorum end to end', async () => {
    installFakeBroadcastChannel();
    const requesterClient = await createRoomRequesterClient('requester_room_ring_12');
    const {
      requesterTransportFactory,
      providerTransportFactory,
      sessions
    } = createFakeTransportFactories();
    const activity = [];
    const providerNodes = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const providerClient = await createRoomProviderClient({
        providerId: `provider_room_ring_12_${index}`,
        runtime: fakeRuntime()
      });
      const providerNode = createPeerProviderNode({
        roomId: 'room-ring-12-test',
        providerClient,
        providerTransportFactory,
        advertIntervalMs: 100000,
        onActivity: (event) => activity.push({
          ...event,
          providerId: `provider_room_ring_12_${index}`
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
        roomId: 'room-ring-12-test',
        requesterClient,
        requesterTransportFactory,
        prompt: 'peer room twelve provider prompt',
        policyId: 'ring_quorum_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 1000,
        receiptWindowMs: 2000
      });

      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.plan.ring).toMatchObject({
        ringSize: 12,
        requiredAgreement: 7
      });
      expect(result.assignments).toHaveLength(12);
      expect(result.inputPayloads).toHaveLength(12);
      expect(result.receiptPayloads).toHaveLength(12);
      expect(result.receiptHashes).toHaveLength(12);
      expect(result.agreement).toMatchObject({
        accepted: true,
        mode: 'ring_quorum',
        requiredAgreement: 7,
        acceptedProviderCount: 12,
        agreementField: 'sequenceResultHash'
      });
      expect(new Set(result.assignments.map((assignment) => assignment.providerId)).size).toBe(12);
      expect(new Set(result.receiptPayloads.map((payload) => payload.assignmentId)).size).toBe(12);
      expect(activity.filter((event) => event.status === 'peer_receipt_sent')).toHaveLength(12);
      expect(activity.filter((event) => event.status === 'peer_acceptance_received')).toHaveLength(12);
      expect(sessions.size).toBe(12);
    } finally {
      await Promise.all(providerNodes.map((providerNode) => providerNode.stop()));
    }
  });

  it('limits ring prompt dispatch until each active provider returns a receipt', async () => {
    installFakeBroadcastChannel();
    const requesterClient = await createRoomRequesterClient('requester_room_dispatch_limit');
    const {
      requesterTransportFactory,
      providerTransportFactory,
      sessions
    } = createFakeTransportFactories();
    const blockings = Array.from({ length: 3 }, () => createBlockingRuntime());
    const providerNodes = await Promise.all(blockings.map(async (blocking, index) => {
      const providerClient = await createRoomProviderClient({
        providerId: `provider_room_dispatch_limit_${index}`,
        runtime: blocking.runtime
      });
      const providerNode = createPeerProviderNode({
        roomId: 'room-dispatch-limit-test',
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
    const totalPrompts = () => blockings.reduce((sum, blocking) => sum + blocking.prompts.length, 0);
    const releaseStartedProvider = () => {
      for (const blocking of blockings) blocking.releaseNext();
    };

    try {
      const pending = runPeerJob({
        roomId: 'room-dispatch-limit-test',
        requesterClient,
        requesterTransportFactory,
        prompt: 'dispatch limited ring prompt',
        policyId: 'ring_quorum_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 1000,
        receiptWindowMs: 1000,
        promptDispatchConcurrency: 1
      });

      await expect.poll(totalPrompts).toBe(1);
      expect(totalPrompts()).toBe(1);
      releaseStartedProvider();
      await expect.poll(totalPrompts).toBe(2);
      expect(totalPrompts()).toBe(2);
      releaseStartedProvider();
      await expect.poll(totalPrompts).toBe(3);
      releaseStartedProvider();

      const result = await pending;
      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.receiptPayloads).toHaveLength(3);
      expect(result.agreement).toMatchObject({
        accepted: true,
        mode: 'ring_quorum',
        requiredAgreement: 2,
        acceptedProviderCount: 3
      });
      expect(sessions.size).toBe(3);
    } finally {
      releaseStartedProvider();
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
      const firstSettled = first.then(
        (result) => ({ result }),
        (error) => ({ error })
      );
      await expect.poll(() => blocking.prompts.length).toBe(1);

      const second = runPeerJob({
        roomId: 'room-queue-test',
        requesterClient,
        requesterTransportFactory,
        prompt: 'second queued prompt',
        policyId: 'fastest_receipt',
        modelRequirements: runtimeModel(),
        discoveryWindowMs: 1000,
        // The queue signal is asynchronous across two independent browser
        // transports. Keep this above a single event-loop turn so a loaded
        // unit suite does not turn expected backpressure into a false timeout.
        sessionAcceptWindowMs: 500,
        receiptWindowMs: 1000
      });
      const secondSettled = second.then(
        (result) => ({ result }),
        (error) => ({ error })
      );
      await expect.poll(() => activity.some((event) => event.status === 'peer_session_queued')).toBe(true);
      await expect.poll(() => sessions.size).toBe(2);
      expect(blocking.prompts).toEqual([testSequenceFor('first queued prompt')]);

      blocking.releaseNext();
      const firstOutcome = await firstSettled;
      if (firstOutcome.error) throw firstOutcome.error;
      const firstResult = firstOutcome.result;
      await expect.poll(() => blocking.prompts.length).toBe(2);
      blocking.releaseNext();
      const secondOutcome = await secondSettled;
      if (secondOutcome.error) throw secondOutcome.error;
      const secondResult = secondOutcome.result;

      expect(firstResult.outputText).toBe(`queued:${testSequenceFor('first queued prompt')}`);
      expect(secondResult.outputText).toBe(`queued:${testSequenceFor('second queued prompt')}`);
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
