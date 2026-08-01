import { describe, expect, it, vi } from 'vitest';

import {
  createInMemoryPeerRoomBusNetwork,
  createPeerRoomInviteUrl,
  createSdkPeerRoomRelayBus,
  parsePeerRoomInviteUrl,
  peerRoomMessageFromPeerId
} from '../../self/pool/peer-rendezvous.js';
import { createSigningKeyPair, exportPublicKey } from '../../self/pool/inference-receipt.js';
import { createSignedPeerMessage, PEER_MESSAGE_TYPES } from '../../self/pool/peer-protocol.js';

describe('pool peer rendezvous', () => {
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
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(statuses.map((status) => status.type)).toContain('relay-acknowledged');
    expect(bus.getStatus()).toMatchObject({ acknowledgements: 1, pendingAcknowledgements: 0 });
    bus.close();
  });

  it('retries a record when a consumer throws instead of suppressing it as a duplicate', async () => {
    vi.useFakeTimers();
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
      pollBackoffMaxMs: 1
    });
    let deliveries = 0;
    bus.addEventListener('message', () => {
      deliveries += 1;
      if (deliveries === 1) throw new Error('transient consumer failure');
    });

    await vi.advanceTimersByTimeAsync(5);

    expect(deliveries).toBeGreaterThanOrEqual(2);
    expect(bus.getStatus().duplicateSuppressed).toBe(0);
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
