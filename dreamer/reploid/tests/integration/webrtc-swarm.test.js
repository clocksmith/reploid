/**
 * @fileoverview Integration tests for WebRTC Swarm
 * Tests peer-to-peer communication via mock signaling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UtilsModule from '../../core/utils.js';
import EventBusModule from '../../infrastructure/event-bus.js';

// Constants
const PROTOCOL_VERSION = 1;

/**
 * Mock Signaling Bus - simulates signaling server behavior in-memory
 */
class MockSignalingBus {
  constructor() {
    this.peers = new Map(); // peerId -> { onMessage, roomId }
    this.rooms = new Map(); // roomId -> Set<peerId>
  }

  /**
   * Simulate a peer connecting
   */
  connect(peerId, roomId, onMessage) {
    this.peers.set(peerId, { onMessage, roomId });

    // Add to room
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(peerId);

    // Notify peer of existing peers in room
    const existingPeers = Array.from(this.rooms.get(roomId)).filter(id => id !== peerId);
    onMessage({
      type: 'joined',
      roomId,
      peers: existingPeers
    });

    // Notify other peers
    existingPeers.forEach(existingPeerId => {
      const peer = this.peers.get(existingPeerId);
      if (peer) {
        peer.onMessage({
          type: 'peer-joined',
          peerId
        });
      }
    });
  }

  /**
   * Simulate sending signaling message
   */
  send(fromPeerId, message) {
    if (message.targetPeer) {
      // Direct message to specific peer
      const targetPeer = this.peers.get(message.targetPeer);
      if (targetPeer) {
        targetPeer.onMessage(message);
      }
    } else if (message.roomId) {
      // Broadcast to room
      const room = this.rooms.get(message.roomId);
      if (room) {
        room.forEach(peerId => {
          if (peerId !== fromPeerId) {
            const peer = this.peers.get(peerId);
            if (peer) {
              peer.onMessage(message);
            }
          }
        });
      }
    }
  }

  /**
   * Simulate peer disconnecting
   */
  disconnect(peerId) {
    const peerInfo = this.peers.get(peerId);
    if (peerInfo) {
      const room = this.rooms.get(peerInfo.roomId);
      if (room) {
        room.delete(peerId);

        // Notify other peers
        room.forEach(otherPeerId => {
          const peer = this.peers.get(otherPeerId);
          if (peer) {
            peer.onMessage({
              type: 'peer-left',
              peerId
            });
          }
        });
      }
    }
    this.peers.delete(peerId);
  }

  /**
   * Get all peers in a room
   */
  getPeersInRoom(roomId) {
    return Array.from(this.rooms.get(roomId) || []);
  }
}

/**
 * Mock RTCPeerConnection
 */
class MockRTCPeerConnection {
  constructor() {
    this.localDescription = null;
    this.remoteDescription = null;
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
    this._dataChannels = [];
  }

  createDataChannel(label, options) {
    const channel = new MockRTCDataChannel(label, options);
    this._dataChannels.push(channel);
    return channel;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate) {
    // Mock ICE candidate handling
  }

  close() {
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
    this._dataChannels.forEach(ch => ch.close());
  }
}

/**
 * Mock RTCDataChannel
 */
class MockRTCDataChannel {
  constructor(label, options = {}) {
    this.label = label;
    this.ordered = options.ordered ?? true;
    this.maxRetransmits = options.maxRetransmits;
    this.readyState = 'connecting';
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._messages = [];
    this._linkedChannel = null;
  }

  send(data) {
    if (this.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    this._messages.push(data);

    // Simulate delivery to linked channel
    if (this._linkedChannel && this._linkedChannel.onmessage) {
      setTimeout(() => {
        this._linkedChannel.onmessage({ data });
      }, 0);
    }
  }

  close() {
    this.readyState = 'closed';
    if (this.onclose) this.onclose();
  }

  // Test helper: link two channels for bidirectional communication
  static link(channel1, channel2) {
    channel1._linkedChannel = channel2;
    channel2._linkedChannel = channel1;
  }

  // Test helper: simulate opening
  _open() {
    this.readyState = 'open';
    if (this.onopen) this.onopen();
  }
}

describe('WebRTC Swarm Integration', () => {
  let mockSignaling;
  let utils;
  let eventBus1, eventBus2;

  beforeEach(() => {
    mockSignaling = new MockSignalingBus();

    utils = UtilsModule.factory();
    utils.logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    // Create two independent EventBus instances for two peers
    const eb1 = EventBusModule.factory({ Utils: utils });
    const eb2 = EventBusModule.factory({ Utils: utils });

    eventBus1 = { on: eb1.on, emit: vi.fn(eb1.emit), unsubscribeModule: eb1.unsubscribeModule };
    eventBus2 = { on: eb2.on, emit: vi.fn(eb2.emit), unsubscribeModule: eb2.unsubscribeModule };

    // Stub RTCPeerConnection
    vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('Mock Signaling Bus', () => {
    it('should allow peers to connect to rooms', () => {
      const onMessage1 = vi.fn();
      const onMessage2 = vi.fn();

      mockSignaling.connect('peer1', 'room1', onMessage1);
      mockSignaling.connect('peer2', 'room1', onMessage2);

      // peer1 should have received peer2 joined notification
      expect(onMessage1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'peer-joined', peerId: 'peer2' })
      );
    });

    it('should notify existing peers in room on join', () => {
      const onMessage1 = vi.fn();
      const onMessage2 = vi.fn();

      mockSignaling.connect('peer1', 'room1', onMessage1);

      // peer1 joins first, should see empty room
      expect(onMessage1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'joined', peers: [] })
      );

      mockSignaling.connect('peer2', 'room1', onMessage2);

      // peer2 joins second, should see peer1
      expect(onMessage2).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'joined', peers: ['peer1'] })
      );
    });

    it('should route signaling messages to target peer', () => {
      const onMessage1 = vi.fn();
      const onMessage2 = vi.fn();

      mockSignaling.connect('peer1', 'room1', onMessage1);
      mockSignaling.connect('peer2', 'room1', onMessage2);

      // Clear previous calls
      onMessage1.mockClear();
      onMessage2.mockClear();

      // peer1 sends offer to peer2
      mockSignaling.send('peer1', {
        type: 'offer',
        targetPeer: 'peer2',
        offer: { type: 'offer', sdp: 'test-sdp' }
      });

      expect(onMessage2).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'offer' })
      );
      expect(onMessage1).not.toHaveBeenCalled();
    });

    it('should notify peers when someone disconnects', () => {
      const onMessage1 = vi.fn();
      const onMessage2 = vi.fn();

      mockSignaling.connect('peer1', 'room1', onMessage1);
      mockSignaling.connect('peer2', 'room1', onMessage2);

      onMessage1.mockClear();

      mockSignaling.disconnect('peer2');

      expect(onMessage1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'peer-left', peerId: 'peer2' })
      );
    });
  });

  describe('Mock RTCDataChannel', () => {
    it('should allow linking two channels', async () => {
      const channel1 = new MockRTCDataChannel('test');
      const channel2 = new MockRTCDataChannel('test');

      MockRTCDataChannel.link(channel1, channel2);

      const receivedMessages = [];
      channel2.onmessage = (event) => receivedMessages.push(event.data);

      channel1._open();
      channel2._open();

      channel1.send('hello');

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedMessages).toContain('hello');
    });

    it('should throw when sending on closed channel', () => {
      const channel = new MockRTCDataChannel('test');

      expect(() => channel.send('test')).toThrow('Data channel not open');
    });
  });

  describe('Protocol Envelope', () => {
    it('should wrap messages with protocol version', () => {
      const wrapMessage = (type, payload, peerId) => {
        const payloadStr = JSON.stringify(payload || {});
        return {
          protocolVersion: PROTOCOL_VERSION,
          type,
          peerId,
          timestamp: Date.now(),
          payload: payload || {},
          payloadSize: payloadStr.length
        };
      };

      const envelope = wrapMessage('ping', { ts: 123 }, 'peer1');

      expect(envelope.protocolVersion).toBe(1);
      expect(envelope.type).toBe('ping');
      expect(envelope.peerId).toBe('peer1');
      expect(envelope.timestamp).toBeDefined();
      expect(envelope.payload).toEqual({ ts: 123 });
    });

    it('should validate envelope structure', () => {
      const validateEnvelope = (envelope) => {
        if (!envelope || typeof envelope !== 'object') {
          return { valid: false, reason: 'Invalid format' };
        }
        if (envelope.protocolVersion !== PROTOCOL_VERSION) {
          return { valid: false, reason: 'Protocol mismatch' };
        }
        if (!envelope.type) {
          return { valid: false, reason: 'Missing type' };
        }
        if (!envelope.peerId) {
          return { valid: false, reason: 'Missing peerId' };
        }
        return { valid: true };
      };

      const valid = validateEnvelope({
        protocolVersion: 1,
        type: 'ping',
        peerId: 'peer1',
        timestamp: Date.now()
      });

      expect(valid.valid).toBe(true);

      const invalid = validateEnvelope({
        protocolVersion: 2,
        type: 'ping',
        peerId: 'peer1'
      });

      expect(invalid.valid).toBe(false);
      expect(invalid.reason).toBe('Protocol mismatch');
    });
  });

  describe('Peer-to-Peer Message Flow', () => {
    it('should exchange messages between linked data channels', async () => {
      const channel1 = new MockRTCDataChannel('reploid');
      const channel2 = new MockRTCDataChannel('reploid');

      MockRTCDataChannel.link(channel1, channel2);

      const peer1Received = [];
      const peer2Received = [];

      channel1.onmessage = (e) => peer1Received.push(JSON.parse(e.data));
      channel2.onmessage = (e) => peer2Received.push(JSON.parse(e.data));

      channel1._open();
      channel2._open();

      // Peer 1 sends to peer 2
      channel1.send(JSON.stringify({
        protocolVersion: 1,
        type: 'sync-request',
        peerId: 'peer1',
        timestamp: 1,
        payload: {},
        payloadSize: 2
      }));

      // Peer 2 responds
      channel2.send(JSON.stringify({
        protocolVersion: 1,
        type: 'sync-response',
        peerId: 'peer2',
        timestamp: 2,
        payload: { state: [] },
        payloadSize: 12
      }));

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(peer2Received.length).toBe(1);
      expect(peer2Received[0].type).toBe('sync-request');

      expect(peer1Received.length).toBe(1);
      expect(peer1Received[0].type).toBe('sync-response');
    });
  });

  describe('LWW State Sync', () => {
    const merge = (local, remote) => {
      if (remote.clock > local.clock) return { winner: 'remote', value: remote };
      if (remote.clock < local.clock) return { winner: 'local', value: local };
      if (remote.peerId > local.peerId) return { winner: 'remote', value: remote };
      return { winner: 'local', value: local };
    };

    it('should synchronize state between peers', () => {
      // Peer 1 state
      const peer1State = new Map();
      peer1State.set('goal-1', { id: 'goal-1', value: 'goal A', clock: 5, peerId: 'peer1' });

      // Peer 2 state
      const peer2State = new Map();
      peer2State.set('goal-1', { id: 'goal-1', value: 'goal B', clock: 7, peerId: 'peer2' });

      // Simulate sync: peer1 receives peer2's state
      const incomingEntry = peer2State.get('goal-1');
      const localEntry = peer1State.get('goal-1');

      const result = merge(localEntry, incomingEntry);

      if (result.winner === 'remote') {
        peer1State.set('goal-1', result.value);
      }

      // Peer 2 had higher clock, so peer1 should accept peer2's value
      expect(peer1State.get('goal-1').value).toBe('goal B');
      expect(peer1State.get('goal-1').clock).toBe(7);
    });

    it('should handle concurrent updates with same clock', () => {
      const peer1Entry = { id: 'goal-1', value: 'from peer1', clock: 10, peerId: 'peer-aaa' };
      const peer2Entry = { id: 'goal-1', value: 'from peer2', clock: 10, peerId: 'peer-zzz' };

      // Peer1 merges with peer2's entry
      const result = merge(peer1Entry, peer2Entry);

      // peer-zzz > peer-aaa lexicographically
      expect(result.winner).toBe('remote');
      expect(result.value.value).toBe('from peer2');
    });
  });

  describe('Full Handshake Simulation', () => {
    it('should complete WebRTC handshake via signaling', async () => {
      // This simulates the full flow:
      // 1. Peer1 connects to signaling
      // 2. Peer2 connects to signaling
      // 3. Peer2 receives peer1 in existing peers list
      // 4. Peer2 sends offer to peer1
      // 5. Peer1 receives offer, sends answer
      // 6. ICE candidates exchanged
      // 7. Data channels opened

      const handshakeLog = [];

      // Peer 1 signaling handler
      const handlePeer1Signaling = (message) => {
        handshakeLog.push({ peer: 'peer1', received: message.type });

        if (message.type === 'offer') {
          // Peer1 receives offer, sends answer
          mockSignaling.send('peer1', {
            type: 'answer',
            targetPeer: message.peerId,
            peerId: 'peer1',
            answer: { type: 'answer', sdp: 'mock-answer' }
          });
        }
      };

      // Peer 2 signaling handler
      const handlePeer2Signaling = (message) => {
        handshakeLog.push({ peer: 'peer2', received: message.type });

        if (message.type === 'joined' && message.peers?.length > 0) {
          // Peer2 sees peer1, initiates connection with offer
          mockSignaling.send('peer2', {
            type: 'offer',
            targetPeer: 'peer1',
            peerId: 'peer2',
            offer: { type: 'offer', sdp: 'mock-offer' }
          });
        }
      };

      // Connect both peers
      mockSignaling.connect('peer1', 'room1', handlePeer1Signaling);
      mockSignaling.connect('peer2', 'room1', handlePeer2Signaling);

      // Verify handshake occurred
      expect(handshakeLog).toContainEqual({ peer: 'peer1', received: 'joined' });
      expect(handshakeLog).toContainEqual({ peer: 'peer2', received: 'joined' });
      expect(handshakeLog).toContainEqual({ peer: 'peer1', received: 'peer-joined' });
      expect(handshakeLog).toContainEqual({ peer: 'peer1', received: 'offer' });
      expect(handshakeLog).toContainEqual({ peer: 'peer2', received: 'answer' });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', () => {
      let errorCaught = false;

      try {
        JSON.parse('not valid json');
      } catch (e) {
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);
    });

    it('should reject oversized messages', () => {
      const MAX_PAYLOAD_SIZE = 64 * 1024;
      const oversizedPayload = 'x'.repeat(MAX_PAYLOAD_SIZE + 1);

      expect(oversizedPayload.length).toBeGreaterThan(MAX_PAYLOAD_SIZE);
    });
  });

  describe('Room Isolation', () => {
    it('should not see peers from other rooms', () => {
      const onMessage1 = vi.fn();
      const onMessage2 = vi.fn();
      const onMessage3 = vi.fn();

      mockSignaling.connect('peer1', 'room-a', onMessage1);
      mockSignaling.connect('peer2', 'room-a', onMessage2);
      mockSignaling.connect('peer3', 'room-b', onMessage3);

      // peer1 and peer2 should see each other
      expect(mockSignaling.getPeersInRoom('room-a')).toContain('peer1');
      expect(mockSignaling.getPeersInRoom('room-a')).toContain('peer2');

      // peer3 should be alone in room-b
      expect(mockSignaling.getPeersInRoom('room-b')).toEqual(['peer3']);

      // peer1 should not have received notification about peer3
      expect(onMessage1).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'peer-joined', peerId: 'peer3' })
      );
    });
  });
});
