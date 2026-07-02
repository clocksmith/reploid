import { describe, expect, it, vi } from 'vitest';

import {
  candidateToPayload,
  createAssignmentP2PPayloadChannel,
  createP2PTransport,
  defaultDeserialize,
  defaultSerialize,
  descriptionToPayload
} from '../../self/pool/p2p-transport.js';
import {
  P2P_PAYLOAD_TYPES,
  createP2PPayload
} from '../../self/pool/p2p-payload.js';
import { SIGNAL_TYPES } from '../../self/pool/p2p-signaling.js';

describe('pool p2p transport helpers', () => {
  it('serializes JSON values while preserving binary and plain string payloads', () => {
    const bytes = new Uint8Array([1, 2, 3]);

    expect(defaultSerialize('plain text')).toBe('plain text');
    expect(defaultSerialize(bytes)).toBe(bytes);
    expect(defaultSerialize({ ok: true })).toBe('{"ok":true}');
    expect(defaultDeserialize('{"ok":true}')).toEqual({ ok: true });
    expect(defaultDeserialize('plain text')).toBe('plain text');
    expect(defaultDeserialize(bytes)).toBe(bytes);
  });

  it('converts browser session descriptions and ICE candidates to transport payloads', () => {
    expect(descriptionToPayload({ type: 'offer', sdp: 'v=0' })).toEqual({
      type: 'offer',
      sdp: 'v=0'
    });
    expect(descriptionToPayload(null)).toBeNull();

    expect(candidateToPayload({
      toJSON: () => ({
        candidate: 'candidate:1',
        sdpMid: '0'
      })
    })).toEqual({
      candidate: 'candidate:1',
      sdpMid: '0'
    });
    expect(candidateToPayload({
      candidate: 'candidate:2',
      sdpMid: '1',
      sdpMLineIndex: 1,
      usernameFragment: 'ufrag'
    })).toEqual({
      candidate: 'candidate:2',
      sdpMid: '1',
      sdpMLineIndex: 1,
      usernameFragment: 'ufrag'
    });
    expect(candidateToPayload(null)).toBeNull();
  });

  it('requires a browser RTCPeerConnection implementation before creating a transport', () => {
    const signaling = {
      subscribe: () => () => {},
      sendOffer: () => {},
      sendAnswer: () => {},
      sendIceCandidate: () => {}
    };

    expect(() => createP2PTransport({
      signaling,
      initiator: true,
      RTCPeerConnectionImpl: null
    })).toThrow('RTCPeerConnection is not available in this browser context');
  });

  it('queues remote ICE candidates until the remote description is installed', async () => {
    let signalHandler = null;
    class FakeDataChannel {
      constructor() {
        this.readyState = 'connecting';
      }

      send() {}

      close() {
        this.readyState = 'closed';
      }
    }

    class FakePeerConnection {
      static instances = [];

      constructor() {
        this.localDescription = null;
        this.remoteDescription = null;
        this.connectionState = 'new';
        this.addedIceCandidates = [];
        FakePeerConnection.instances.push(this);
      }

      createDataChannel() {
        this.channel = new FakeDataChannel();
        return this.channel;
      }

      async createOffer() {
        return { type: 'offer', sdp: 'offer-sdp' };
      }

      async setLocalDescription(description) {
        this.localDescription = description;
      }

      async setRemoteDescription(description) {
        this.remoteDescription = description;
        if (this.channel) {
          this.channel.readyState = 'open';
          this.channel.onopen?.();
        }
      }

      async addIceCandidate(candidate) {
        if (!this.remoteDescription) throw new Error('remote description missing');
        this.addedIceCandidates.push(candidate);
      }

      close() {
        this.connectionState = 'closed';
      }
    }

    const signaling = {
      subscribe(callback) {
        signalHandler = callback;
        return () => {};
      },
      sendOffer: vi.fn(),
      sendAnswer: vi.fn(),
      sendIceCandidate: vi.fn()
    };

    const transport = createP2PTransport({
      signaling,
      initiator: true,
      RTCPeerConnectionImpl: FakePeerConnection,
      RTCSessionDescriptionImpl: null,
      RTCIceCandidateImpl: null
    });

    const ready = transport.connect();
    await Promise.resolve();
    await Promise.resolve();

    const pc = FakePeerConnection.instances[0];
    signalHandler({
      type: SIGNAL_TYPES.ICE_CANDIDATE,
      payload: { candidate: 'candidate:early', sdpMid: '0' }
    });
    await Promise.resolve();
    expect(pc.addedIceCandidates).toEqual([]);

    signalHandler({
      type: SIGNAL_TYPES.ANSWER,
      payload: { type: 'answer', sdp: 'answer-sdp' }
    });
    await ready;

    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' });
    expect(pc.addedIceCandidates).toEqual([{ candidate: 'candidate:early', sdpMid: '0' }]);
  });

  it('creates an assignment payload channel with cloud metadata signaling and DataChannel payload sends', async () => {
    const sentPayloads = [];
    let createdSessionRequest = null;
    let transportOptions = null;
    const sdk = {
      createSignalingSession(payload) {
        createdSessionRequest = payload;
        return {
          session: {
            sessionId: 'session_1',
            assignmentId: payload.assignmentId
          }
        };
      },
      publishSignal() {
        throw new Error('payloads must not be published through signaling');
      },
      listSignals() {
        return { messages: [] };
      }
    };
    const channel = await createAssignmentP2PPayloadChannel({
      sdk,
      assignment: {
        assignmentId: 'assignment_1',
        jobId: 'job_1'
      },
      localPeerId: 'requester_1',
      remotePeerId: 'provider_1',
      role: 'requester',
      transportFactory(options) {
        transportOptions = options;
        return {
          connect: () => Promise.resolve(),
          ready: () => Promise.resolve(),
          send: (payload) => sentPayloads.push(payload),
          close: () => {}
        };
      }
    });
    const payload = createP2PPayload({
      type: P2P_PAYLOAD_TYPES.PROMPT,
      assignmentId: 'assignment_1',
      jobId: 'job_1',
      fromPeerId: 'requester_1',
      toPeerId: 'provider_1',
      body: {
        inputHash: 'sha256:input'
      }
    });

    await channel.sendPayload(payload);

    expect(createdSessionRequest).toEqual({
      assignmentId: 'assignment_1',
      createdBy: 'requester_1'
    });
    expect(transportOptions.initiator).toBe(true);
    expect(transportOptions.signaling.sessionId).toBe('session_1');
    expect(sentPayloads).toEqual([payload]);
    await expect(channel.sendPayload({
      type: P2P_PAYLOAD_TYPES.PROMPT
    })).rejects.toThrow('payload version mismatch');
  });
});
