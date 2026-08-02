import { describe, expect, it, vi } from 'vitest';

import {
  createBroadcastPeerRoomBus,
  createInMemoryPeerRoomBusNetwork,
  createPeerRoomInviteUrl,
  createSdkPeerRoomRelayBus,
  parsePeerRoomInviteUrl,
  peerRoomMessageFromPeerId
} from '../../self/pool/peer-rendezvous.js';
import { createSigningKeyPair, exportPublicKey } from '../../self/pool/inference-receipt.js';
import { createSignedPeerMessage, PEER_MESSAGE_TYPES } from '../../self/pool/peer-protocol.js';

describe('pool peer rendezvous', () => {
  it('reports bounded local BroadcastChannel delivery counters', async () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const channels = new Map();
    class TestBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.listeners = new Set();
        this.closed = false;
        if (!channels.has(name)) channels.set(name, new Set());
        channels.get(name).add(this);
      }
      addEventListener(type, listener) {
        if (type === 'message') this.listeners.add(listener);
      }
      removeEventListener(type, listener) {
        if (type === 'message') this.listeners.delete(listener);
      }
      postMessage(data) {
        for (const peer of channels.get(this.name) || []) {
          if (peer === this || peer.closed) continue;
          queueMicrotask(() => {
            for (const listener of peer.listeners) listener({ data });
          });
        }
      }
      close() {
        this.closed = true;
        channels.get(this.name)?.delete(this);
      }
    }
    globalThis.BroadcastChannel = TestBroadcastChannel;
    try {
      const left = createBroadcastPeerRoomBus({ roomId: 'local-status-room' });
      const right = createBroadcastPeerRoomBus({ roomId: 'local-status-room' });
      const received = [];
      right.addEventListener('message', (event) => received.push(event.data));

      left.postMessage({ type: 'provider-advert', body: { providerId: 'provider_local' } });
      await new Promise((resolve) => queueMicrotask(resolve));

      expect(received).toHaveLength(1);
      expect(left.getStatus()).toMatchObject({
        relay: 'local_broadcast_channel',
        published: 1,
        publishLatencyCount: 1,
        received: 0
      });
      expect(right.getStatus()).toMatchObject({ received: 1, pollFailures: 0, reconnectSuccesses: 0 });
      left.close();
      right.close();
    } finally {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('extracts peer ids from signed room envelopes', () => {
    expect(peerRoomMessageFromPeerId({
      body: {
        advert: {
          body: {
            providerId: 'provider_1'
          }
        }
      }
    })).toBe('provider_1');
    expect(peerRoomMessageFromPeerId({
      body: {
        intent: {
          body: {
            requesterId: 'requester_1'
          }
        }
      }
    })).toBe('requester_1');
    expect(peerRoomMessageFromPeerId({
      type: 'peer-run-request',
      body: {
        fromPeerId: 'stale_provider_field',
        requesterId: 'requester_run',
        providerId: 'provider_run'
      }
    })).toBe('requester_run');
    expect(peerRoomMessageFromPeerId({
      type: 'peer-run-accepted',
      body: {
        requesterId: 'requester_run',
        providerId: 'provider_run'
      }
    })).toBe('provider_run');
  });

  it('creates a memory room bus that does not echo to the sender', async () => {
    const network = createInMemoryPeerRoomBusNetwork();
    const left = network.createBus({ roomId: 'memory_room' });
    const right = network.createBus({ roomId: 'memory_room' });
    const leftMessages = [];
    const rightMessages = [];
    left.addEventListener('message', (event) => leftMessages.push(event.data));
    right.addEventListener('message', (event) => rightMessages.push(event.data));

    left.postMessage({ type: 'provider-advert', body: { providerId: 'provider_memory' } });
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(leftMessages).toHaveLength(0);
    expect(rightMessages).toHaveLength(1);
    expect(rightMessages[0].body.providerId).toBe('provider_memory');
  });

  it('polls SDK relay messages and publishes relay metadata', async () => {
    vi.useFakeTimers();
    const published = [];
    const sdk = {
      publishPeerRoomMessage(roomId, message) {
        published.push({ roomId, message });
        return Promise.resolve({ message });
      },
      listPeerRoomMessages() {
        return Promise.resolve({
          messages: [{
            createdAt: 10,
            message: {
              peerRoomVersion: 'reploid_peer_room/v1',
              roomId: 'relay_room',
              type: 'provider-advert',
              body: {
                providerId: 'provider_relay'
              }
            }
          }]
        });
      }
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'relay_room',
      localPeerId: 'requester_relay',
      pollIntervalMs: 1000,
      now: () => 100
    });
    const received = [];
    bus.addEventListener('message', (event) => received.push(event.data));
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(received).toHaveLength(1);
    await bus.postMessage({
      peerRoomVersion: 'reploid_peer_room/v1',
      roomId: 'relay_room',
      type: 'provider-advert-request',
      body: {}
    });
    expect(published[0].roomId).toBe('relay_room');
    expect(published[0].message.relay).toMatchObject({
      version: 'reploid_peer_room_relay/v1',
      fromPeerId: 'requester_relay',
      createdAt: 100
    });
    expect(bus.getStatus()).toMatchObject({
      publishLatencyCount: 1,
      publishLatencyTotalMs: 0,
      deliveryLagCount: 1,
      deliveryLagTotalMs: 90,
      lastBacklogOldestAgeMs: 90
    });
    expect(bus.getStatus().backlogSampleCount).toBeGreaterThanOrEqual(1);
    bus.close();
    vi.useRealTimers();
  });

  it('bounds a stalled relay publish so provider startup can fail visibly', async () => {
    vi.useFakeTimers();
    const statuses = [];
    const sdk = {
      publishPeerRoomMessage: vi.fn(() => new Promise(() => {})),
      listPeerRoomMessages: () => Promise.resolve({ messages: [] })
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'stalled-publish-room',
      localPeerId: 'provider_1',
      publishAttempts: 2,
      retryBaseMs: 5,
      publishTimeoutMs: 10,
      onStatus: (status) => statuses.push(status)
    });

    const publish = bus.postMessage({
      peerRoomVersion: 'reploid_peer_room/v1',
      roomId: 'stalled-publish-room',
      type: 'provider-advert',
      body: { providerId: 'provider_1' }
    });
    const rejected = expect(publish).rejects.toThrow('peer-room relay publish timed out');
    await vi.advanceTimersByTimeAsync(30);
    await rejected;

    expect(sdk.publishPeerRoomMessage).toHaveBeenCalledTimes(2);
    expect(bus.getStatus()).toMatchObject({ publishRetries: 1, publishFailures: 1 });
    expect(statuses.map((status) => status.type)).toEqual(expect.arrayContaining([
      'relay-publish-retrying',
      'relay-publish-failed'
    ]));
    bus.close();
    vi.useRealTimers();
  });

  it('bounds a stalled relay poll and recovers on the next successful attempt', async () => {
    vi.useFakeTimers();
    const statuses = [];
    const sdk = {
      publishPeerRoomMessage: () => Promise.resolve({}),
      listPeerRoomMessages: vi.fn()
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue({ messages: [] })
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'stalled-poll-room',
      pollIntervalMs: 100,
      pollTimeoutMs: 5,
      failureThreshold: 1,
      pollBackoffBaseMs: 1,
      pollBackoffMaxMs: 10,
      onStatus: (status) => statuses.push(status)
    });
    bus.addEventListener('message', () => {});

    await vi.advanceTimersByTimeAsync(5);
    expect(bus.getStatus()).toMatchObject({
      circuitState: 'open',
      pollFailures: 1,
      consecutivePollFailures: 1
    });
    expect(statuses.map((status) => status.type)).toEqual(expect.arrayContaining([
      'relay-poll-failed',
      'relay-circuit-open'
    ]));

    await vi.advanceTimersByTimeAsync(2);
    await vi.waitFor(() => expect(sdk.listPeerRoomMessages.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(bus.getStatus()).toMatchObject({
      circuitState: 'closed',
      pollFailures: 1,
      consecutivePollFailures: 0
    });
    expect(statuses.map((status) => status.type)).toEqual(expect.arrayContaining([
      'relay-circuit-half-open',
      'relay-circuit-closed'
    ]));
    bus.close();
    vi.useRealTimers();
  });

  it('advances with the server page cursor instead of rereading an overlapping timestamp range', async () => {
    vi.useFakeTimers();
    const calls = [];
    const sdk = {
      publishPeerRoomMessage() {
        return Promise.resolve({});
      },
      listPeerRoomMessages(roomId, { after, afterId, afterSequence }) {
        calls.push({ roomId, after, afterId, afterSequence });
        if (calls.length === 1) {
          return Promise.resolve({
            messages: [{
              createdAt: 20000,
              relayId: 'relay_newer_advert',
              message: {
                peerRoomVersion: 'reploid_peer_room/v1',
                roomId,
                type: 'provider-advert',
                relay: { relayId: 'relay_newer_advert' },
                body: {}
              }
            }],
            nextCursor: {
              sequence: 1,
              createdAt: 20000,
              messageId: 'relay_newer_advert'
            }
          });
        }
        return Promise.resolve({
          messages: []
        });
      }
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'relay_reordering_room',
      localPeerId: 'requester_relay',
      pollIntervalMs: 1000
    });
    const received = [];
    bus.addEventListener('message', (event) => received.push(event.data));

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(calls[1].after).toBe(20000);
    expect(calls[1]).toMatchObject({ afterId: 'relay_newer_advert', afterSequence: 1 });
    expect(received.map((message) => message.type)).toEqual([
      'provider-advert'
    ]);
    bus.close();
    vi.useRealTimers();
  });

  it('uses bounded idempotent delivery and reports relay receipt acknowledgements', async () => {
    const published = [];
    const statuses = [];
    const providerKeys = await createSigningKeyPair();
    const providerPublicKey = await exportPublicKey(providerKeys.publicKey);
    let acknowledgementProof = null;
    const sdk = {
      publishPeerRoomMessage(roomId, message) {
        published.push({ roomId, message });
        return Promise.resolve({ message: { ...message, relaySequence: published.length } });
      },
      listPeerRoomMessages() {
        const relayId = published[0]?.message?.relay?.relayId;
        return Promise.resolve({
          messages: relayId ? [{
            relayId: 'provider-ack',
            relaySequence: 2,
            message: {
              peerRoomVersion: 'reploid_peer_room/v1',
              roomId: 'ack-room',
              type: 'relay-ack',
              relay: { relayId: 'provider-ack' },
              body: { relayId, relaySequence: 1, fromPeerId: 'provider_1', proof: acknowledgementProof }
            }
          }] : [],
          nextCursor: { sequence: 2, createdAt: 10, messageId: 'provider-ack' }
        });
      }
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'ack-room',
      localPeerId: 'requester_1',
      pollIntervalMs: 60_000,
      onStatus: (status) => statuses.push(status)
    });

    await bus.postMessage({
      peerRoomVersion: 'reploid_peer_room/v1',
      roomId: 'ack-room',
      type: 'provider-advert-request',
      body: { toPeerId: 'provider_1' }
    });
    const relayId = published[0].message.relay.relayId;
    acknowledgementProof = await createSignedPeerMessage({
      type: PEER_MESSAGE_TYPES.HEARTBEAT,
      fromPeerId: 'provider_1',
      publicKey: providerPublicKey,
      body: {
        schema: 'reploid.peer.relay_ack/v1',
        roomId: 'ack-room',
        relayId,
        relaySequence: 1
      },
      privateKey: providerKeys.privateKey
    });
    bus.addEventListener('message', () => {});
    await vi.waitFor(() => {
      expect(statuses.map((status) => status.type)).toContain('relay-acknowledged');
    });

    expect(bus.getStatus()).toMatchObject({ acknowledgements: 1, pendingAcknowledgements: 0 });
    bus.close();
  });

  it('retries a record when a consumer throws instead of suppressing it as a duplicate', async () => {
    vi.useFakeTimers();
    const statuses = [];
    const record = {
      relayId: 'retry-after-handler-error',
      relaySequence: 1,
      message: {
        peerRoomVersion: 'reploid_peer_room/v1',
        roomId: 'consumer-error-room',
        type: 'provider-advert',
        relay: { relayId: 'retry-after-handler-error' },
        body: {}
      }
    };
    let polls = 0;
    const sdk = {
      publishPeerRoomMessage: () => Promise.resolve({}),
      listPeerRoomMessages: () => {
        polls += 1;
        return Promise.resolve(polls <= 2 ? {
          messages: [record],
          nextCursor: { sequence: 1, createdAt: 1, messageId: record.relayId }
        } : { messages: [] });
      }
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'consumer-error-room',
      pollIntervalMs: 1,
      pollBackoffBaseMs: 1,
      pollBackoffMaxMs: 1,
      onStatus: (status) => statuses.push(status)
    });
    let deliveries = 0;
    bus.addEventListener('message', () => {
      deliveries += 1;
      if (deliveries === 1) throw new Error('transient consumer failure');
    });

    await vi.advanceTimersByTimeAsync(5);

    expect(deliveries).toBeGreaterThanOrEqual(2);
    expect(bus.getStatus()).toMatchObject({
      duplicateSuppressed: 0,
      pollFailures: 0,
      dispatchFailures: 1,
      circuitState: 'closed'
    });
    expect(statuses.map((status) => status.type)).toEqual(expect.arrayContaining([
      'relay-dispatch-retrying',
      'relay-dispatch-recovered'
    ]));
    bus.close();
    vi.useRealTimers();
  });

  it('keeps the cursor before a failed consumer record while retaining earlier delivery', async () => {
    vi.useFakeTimers();
    const first = {
      relayId: 'first-record',
      relaySequence: 1,
      createdAt: 10,
      message: {
        peerRoomVersion: 'reploid_peer_room/v1',
        roomId: 'partial-dispatch-room',
        type: 'provider-advert',
        relay: { relayId: 'first-record' },
        body: { providerId: 'provider_1' }
      }
    };
    const second = {
      relayId: 'second-record',
      relaySequence: 2,
      createdAt: 11,
      message: {
        peerRoomVersion: 'reploid_peer_room/v1',
        roomId: 'partial-dispatch-room',
        type: 'provider-advert',
        relay: { relayId: 'second-record' },
        body: { providerId: 'provider_2' }
      }
    };
    const calls = [];
    const sdk = {
      publishPeerRoomMessage: () => Promise.resolve({}),
      listPeerRoomMessages: (_roomId, cursor) => {
        calls.push(cursor);
        if (calls.length === 1) {
          return Promise.resolve({
            messages: [first, second],
            nextCursor: { sequence: 2, createdAt: 11, messageId: 'second-record' }
          });
        }
        if (calls.length === 2) {
          return Promise.resolve({
            messages: [second],
            nextCursor: { sequence: 2, createdAt: 11, messageId: 'second-record' }
          });
        }
        return Promise.resolve({ messages: [] });
      }
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'partial-dispatch-room',
      pollIntervalMs: 1,
      pollBackoffBaseMs: 1,
      pollBackoffMaxMs: 1
    });
    const delivered = [];
    bus.addEventListener('message', (event) => {
      const relayId = event.data.relay?.relayId;
      delivered.push(relayId);
      if (relayId === 'second-record' && delivered.filter((id) => id === relayId).length === 1) {
        throw new Error('temporary consumer error');
      }
    });

    await vi.advanceTimersByTimeAsync(5);

    expect(calls[1]).toMatchObject({ afterSequence: 1, after: 10, afterId: 'first-record' });
    expect(delivered).toEqual(['first-record', 'second-record', 'second-record']);
    expect(bus.getStatus()).toMatchObject({
      cursor: { sequence: 2, createdAt: 11, messageId: 'second-record' },
      pollFailures: 0,
      dispatchFailures: 1
    });
    bus.close();
    vi.useRealTimers();
  });

  it('opens the relay poll circuit after repeated failures and closes it after recovery', async () => {
    vi.useFakeTimers();
    const statuses = [];
    let polls = 0;
    const sdk = {
      publishPeerRoomMessage: () => Promise.resolve({}),
      listPeerRoomMessages: () => {
        polls += 1;
        if (polls <= 2) return Promise.reject(new Error('relay read unavailable'));
        return Promise.resolve({ messages: [] });
      }
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'poll-recovery-room',
      pollIntervalMs: 1,
      pollBackoffBaseMs: 1,
      pollBackoffMaxMs: 2,
      failureThreshold: 2,
      onStatus: (status) => statuses.push(status)
    });

    bus.addEventListener('message', () => {});
    await vi.advanceTimersByTimeAsync(10);

    expect(polls).toBeGreaterThanOrEqual(3);
    expect(bus.getStatus()).toMatchObject({
      circuitState: 'closed',
      consecutivePollFailures: 0,
      pollFailures: 2
    });
    expect(statuses.map((status) => status.type)).toEqual(expect.arrayContaining([
      'relay-poll-failed',
      'relay-circuit-open',
      'relay-circuit-half-open',
      'relay-circuit-closed'
    ]));
    bus.close();
    vi.useRealTimers();
  });

  it('honors a bounded relay retry deadline from the server', async () => {
    vi.useFakeTimers();
    const statuses = [];
    let polls = 0;
    const retryableError = Object.assign(new Error('relay rate limited'), { retryAfterMs: 8 });
    const bus = createSdkPeerRoomRelayBus({
      sdk: {
        publishPeerRoomMessage: () => Promise.resolve({}),
        listPeerRoomMessages: () => {
          polls += 1;
          return polls === 1 ? Promise.reject(retryableError) : Promise.resolve({ messages: [] });
        }
      },
      roomId: 'server-retry-after-room',
      pollIntervalMs: 1,
      pollBackoffBaseMs: 1,
      pollBackoffMaxMs: 10,
      onStatus: (status) => statuses.push(status)
    });
    bus.addEventListener('message', () => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toBe(1);
    expect(statuses.find((status) => status.type === 'relay-poll-failed')).toMatchObject({
      retryDelayMs: 8,
      retryAfterMs: 8
    });
    await vi.advanceTimersByTimeAsync(7);
    expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls).toBe(2);
    expect(bus.getStatus()).toMatchObject({
      circuitState: 'closed',
      lastPollRetryAfterMs: 0
    });
    bus.close();
    vi.useRealTimers();
  });

  it('keeps relay recovery independent from status observers', async () => {
    vi.useFakeTimers();
    const sdk = {
      publishPeerRoomMessage: () => Promise.resolve({}),
      listPeerRoomMessages: () => Promise.resolve({ messages: [] })
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'status-observer-room',
      pollIntervalMs: 1,
      onStatus: () => {
        throw new Error('status observer failed');
      }
    });
    bus.addEventListener('status', () => {
      throw new Error('status listener failed');
    });
    bus.addEventListener('message', () => {});

    await vi.advanceTimersByTimeAsync(3);

    expect(bus.getStatus()).toMatchObject({
      circuitState: 'closed',
      consecutivePollFailures: 0,
      pollFailures: 0
    });
    bus.close();
    vi.useRealTimers();
  });

  it('restores pending direct-delivery acknowledgement state after reload', async () => {
    const entries = new Map();
    const storage = {
      getItem: (key) => entries.get(key) || null,
      setItem: (key, value) => entries.set(key, value)
    };
    const sdk = {
      publishPeerRoomMessage: () => Promise.resolve({}),
      listPeerRoomMessages: () => Promise.resolve({ messages: [] })
    };
    const first = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'reload-room',
      localPeerId: 'requester_1',
      pendingAcknowledgementStorage: storage
    });
    await first.postMessage({
      peerRoomVersion: 'reploid_peer_room/v1',
      roomId: 'reload-room',
      type: 'webrtc-signal',
      body: { toPeerId: 'provider_1' }
    });
    expect(first.getStatus().pendingAcknowledgements).toBe(1);
    first.close();

    const restored = createSdkPeerRoomRelayBus({
      sdk,
      roomId: 'reload-room',
      localPeerId: 'requester_1',
      pendingAcknowledgementStorage: storage
    });
    expect(restored.getStatus().pendingAcknowledgements).toBe(1);
    restored.close();
  });

  it('clears malformed pending acknowledgement recovery state', () => {
    const entries = new Map();
    const storage = {
      getItem: (key) => entries.get(key) || null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key)
    };
    const roomId = 'malformed-ack-recovery-room';
    const localPeerId = 'requester_1';
    const storageKey = `reploid.peer-room.pending-acks/v1:${roomId}:${localPeerId}`;
    entries.set(storageKey, '{not valid json');

    const bus = createSdkPeerRoomRelayBus({
      sdk: {
        publishPeerRoomMessage: () => Promise.resolve({}),
        listPeerRoomMessages: () => Promise.resolve({ messages: [] })
      },
      roomId,
      localPeerId,
      pendingAcknowledgementStorage: storage
    });

    expect(bus.getStatus().pendingAcknowledgements).toBe(0);
    expect(entries.get(storageKey)).toBe('[]');
    bus.close();
  });

  it('expires stale pending acknowledgements during ordinary relay polling', async () => {
    const entries = new Map();
    const statuses = [];
    let timestamp = 0;
    const storage = {
      getItem: (key) => entries.get(key) || null,
      setItem: (key, value) => entries.set(key, value)
    };
    const bus = createSdkPeerRoomRelayBus({
      sdk: {
        publishPeerRoomMessage: () => Promise.resolve({}),
        listPeerRoomMessages: () => Promise.resolve({ messages: [] })
      },
      roomId: 'ack-expiry-poll-room',
      localPeerId: 'requester_1',
      dedupWindowMs: 10,
      pollIntervalMs: 60_000,
      pendingAcknowledgementStorage: storage,
      onStatus: (status) => statuses.push(status),
      now: () => timestamp
    });
    await bus.postMessage({
      peerRoomVersion: 'reploid_peer_room/v1',
      roomId: 'ack-expiry-poll-room',
      type: 'webrtc-signal',
      body: { toPeerId: 'provider_1' }
    });
    expect(bus.getStatus().pendingAcknowledgements).toBe(1);

    timestamp = 11;
    bus.addEventListener('message', () => {});
    await vi.waitFor(() => {
      expect(statuses.map((status) => status.type)).toContain('relay-ack-expired');
    });

    expect(bus.getStatus()).toMatchObject({
      pendingAcknowledgements: 0,
      acknowledgementExpired: 1
    });
    expect([...entries.values()].some((value) => value === '[]')).toBe(true);
    bus.close();
  });

  it('round-trips shareable room invite URLs', () => {
    const invite = createPeerRoomInviteUrl({
      roomId: 'invite_room',
      relay: 'server',
      baseUrl: 'https://reploid.example/ask'
    });
    expect(parsePeerRoomInviteUrl(invite)).toEqual({
      roomId: 'invite_room',
      relay: 'server'
    });
  });
});
