import { describe, expect, it } from 'vitest';

import {
  SIGNAL_TYPES,
  createCallbackSignalingAdapter,
  createSignalMessage,
  createSignalingChannel,
  isSignalForPeer,
  normalizeSignalMessage
} from '../../self/pool/p2p-signaling.js';

describe('pool p2p signaling helpers', () => {
  it('normalizes signal messages into immutable typed records', () => {
    const message = createSignalMessage({
      id: 'sig_1',
      sessionId: 'session_1',
      assignmentId: 'assignment_1',
      type: SIGNAL_TYPES.OFFER,
      fromPeerId: 'requester_1',
      toPeerId: 'provider_1',
      payload: { type: 'offer', sdp: 'v=0' },
      createdAt: 100,
      expiresAt: 200
    });

    expect(Object.isFrozen(message)).toBe(true);
    expect(message).toEqual({
      id: 'sig_1',
      sessionId: 'session_1',
      assignmentId: 'assignment_1',
      type: 'offer',
      fromPeerId: 'requester_1',
      toPeerId: 'provider_1',
      payload: { type: 'offer', sdp: 'v=0' },
      createdAt: 100,
      expiresAt: 200
    });

    expect(() => normalizeSignalMessage({ ...message, type: 'unsupported' })).toThrow('unsupported signal type');
    expect(() => normalizeSignalMessage({ ...message, sessionId: '' })).toThrow('signal sessionId');
  });

  it('filters signals by session, peer direction, and expiration', () => {
    const message = createSignalMessage({
      id: 'sig_2',
      sessionId: 'session_1',
      type: SIGNAL_TYPES.ANSWER,
      fromPeerId: 'requester_1',
      toPeerId: 'provider_1',
      createdAt: 100,
      expiresAt: 200
    });

    expect(isSignalForPeer(message, {
      sessionId: 'session_1',
      localPeerId: 'provider_1',
      remotePeerId: 'requester_1',
      now: 150
    })).toBe(true);

    expect(isSignalForPeer(message, {
      sessionId: 'session_2',
      localPeerId: 'provider_1',
      remotePeerId: 'requester_1',
      now: 150
    })).toBe(false);

    expect(isSignalForPeer(message, {
      sessionId: 'session_1',
      localPeerId: 'requester_1',
      remotePeerId: 'provider_1',
      now: 150
    })).toBe(false);

    expect(isSignalForPeer(message, {
      sessionId: 'session_1',
      localPeerId: 'provider_2',
      remotePeerId: 'requester_1',
      now: 150
    })).toBe(false);

    expect(isSignalForPeer(message, {
      sessionId: 'session_1',
      localPeerId: 'provider_1',
      remotePeerId: 'requester_1',
      now: 200
    })).toBe(false);
  });

  it('publishes typed channel messages and only delivers matching remote peer signals', async () => {
    const published = [];
    let listener = null;
    let unsubscribeCalled = false;
    let now = 1000;
    const adapter = createCallbackSignalingAdapter({
      publish(message) {
        published.push(message);
        return message;
      },
      subscribe(onMessage) {
        listener = onMessage;
        return () => {
          unsubscribeCalled = true;
        };
      }
    });
    const channel = createSignalingChannel({
      sessionId: 'session_1',
      assignmentId: 'assignment_1',
      localPeerId: 'provider_1',
      remotePeerId: 'requester_1',
      adapter,
      signalTtlMs: 50,
      now: () => now
    });

    const received = [];
    const unsubscribe = channel.subscribe((message) => received.push(message));
    const sent = await channel.sendAnswer({ type: 'answer', sdp: 'v=0' });

    expect(published).toHaveLength(1);
    expect(sent).toMatchObject({
      assignmentId: 'assignment_1',
      type: SIGNAL_TYPES.ANSWER,
      fromPeerId: 'provider_1',
      toPeerId: 'requester_1',
      payload: { type: 'answer', sdp: 'v=0' },
      createdAt: 1000,
      expiresAt: 1050
    });

    listener([
      createSignalMessage({
        id: 'sig_remote',
        sessionId: 'session_1',
        type: SIGNAL_TYPES.OFFER,
        fromPeerId: 'requester_1',
        toPeerId: 'provider_1',
        payload: { type: 'offer', sdp: 'v=0' },
        createdAt: 1001
      }),
      createSignalMessage({
        id: 'sig_own',
        sessionId: 'session_1',
        type: SIGNAL_TYPES.PING,
        fromPeerId: 'provider_1',
        toPeerId: 'requester_1',
        createdAt: 1002
      }),
      createSignalMessage({
        id: 'sig_other',
        sessionId: 'session_1',
        type: SIGNAL_TYPES.PING,
        fromPeerId: 'requester_2',
        toPeerId: 'provider_1',
        createdAt: 1003
      })
    ]);

    expect(received.map((message) => message.id)).toEqual(['sig_remote']);

    unsubscribe();
    expect(unsubscribeCalled).toBe(true);

    channel.close();
    now = 1100;
    await expect(channel.sendPing()).rejects.toThrow('signaling channel is closed');
  });
});
