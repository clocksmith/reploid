import { describe, expect, it, vi } from 'vitest';

import {
  createInMemoryPeerRoomBusNetwork,
  createPeerRoomInviteUrl,
  createSdkPeerRoomRelayBus,
  parsePeerRoomInviteUrl,
  peerRoomMessageFromPeerId
} from '../../self/pool/peer-rendezvous.js';

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

  it('round-trips shareable room invite URLs', () => {
    const invite = createPeerRoomInviteUrl({
      roomId: 'invite_room',
      relay: 'server',
      baseUrl: 'https://reploid.example/run'
    });
    expect(parsePeerRoomInviteUrl(invite)).toEqual({
      roomId: 'invite_room',
      relay: 'server'
    });
  });
});
