import { describe, expect, it } from 'vitest';

import {
  candidateToPayload,
  createP2PTransport,
  defaultDeserialize,
  defaultSerialize,
  descriptionToPayload
} from '../../self/pool/p2p-transport.js';

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
});
