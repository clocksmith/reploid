import { describe, expect, it, vi } from 'vitest';

import {
  SIGNAL_TYPES,
  createCallbackSignalingAdapter,
  createPollingSignalingAdapter,
  createPoolSdkSignalingAdapter,
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

  it('advances polling with the server tuple cursor for same-millisecond signals', async () => {
    vi.useFakeTimers();
    const calls = [];
    const pages = [
      {
        messages: [
          createSignalMessage({ id: 'signal-a', sessionId: 'session_1', type: SIGNAL_TYPES.OFFER, fromPeerId: 'requester_1', createdAt: 100 }),
          createSignalMessage({ id: 'signal-b', sessionId: 'session_1', type: SIGNAL_TYPES.ICE_CANDIDATE, fromPeerId: 'requester_1', createdAt: 100 })
        ],
        nextCursor: { sequence: 2, createdAt: 100, messageId: 'signal-b' }
      },
      {
        messages: [
          createSignalMessage({ id: 'signal-c', sessionId: 'session_1', type: SIGNAL_TYPES.ICE_CANDIDATE, fromPeerId: 'requester_1', createdAt: 100 })
        ],
        nextCursor: { sequence: 3, createdAt: 100, messageId: 'signal-c' }
      }
    ];
    const adapter = createPollingSignalingAdapter({
      publishSignal: () => Promise.resolve(),
      listSignals(options) {
        calls.push(options);
        return Promise.resolve(pages.shift() || { messages: [] });
      },
      pollIntervalMs: 1
    });
    const received = [];
    const unsubscribe = adapter.subscribe((message) => received.push(message.id));

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(calls[1]).toMatchObject({ after: 100, afterId: 'signal-b', afterSequence: 2 });
    expect(received).toEqual(['signal-a', 'signal-b', 'signal-c']);
    unsubscribe();
    vi.useRealTimers();
  });

  it('forwards the tuple cursor through the Pool SDK signaling adapter', async () => {
    vi.useFakeTimers();
    const calls = [];
    const pages = [
      {
        messages: [
          createSignalMessage({ id: 'signal-a', sessionId: 'session_1', type: SIGNAL_TYPES.OFFER, fromPeerId: 'requester_1', createdAt: 100 })
        ],
        nextCursor: { createdAt: 100, messageId: 'signal-a' }
      },
      { messages: [] }
    ];
    const adapter = createPoolSdkSignalingAdapter({
      sdk: {
        publishSignal: () => Promise.resolve(),
        listSignals(sessionId, options) {
          calls.push({ sessionId, ...options });
          return Promise.resolve(pages.shift());
        }
      },
      sessionId: 'session_1',
      peerId: 'provider_1',
      pollIntervalMs: 1
    });
    const unsubscribe = adapter.subscribe(() => {});

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(calls[1]).toMatchObject({
      sessionId: 'session_1',
      after: 100,
      afterId: 'signal-a',
      peerId: 'provider_1'
    });
    unsubscribe();
    vi.useRealTimers();
  });

  it('backs off signaling polls, exposes circuit recovery, and returns to normal cadence', async () => {
    vi.useFakeTimers();
    const statuses = [];
    let calls = 0;
    const adapter = createPollingSignalingAdapter({
      publishSignal: () => Promise.resolve(),
      listSignals: () => {
        calls += 1;
        if (calls <= 2) return Promise.reject(new Error('synthetic signaling outage'));
        return Promise.resolve({ messages: [] });
      },
      pollIntervalMs: 1,
      pollBackoffBaseMs: 5,
      pollBackoffMaxMs: 10,
      failureThreshold: 2,
      onStatus: (status) => statuses.push(status)
    });
    const unsubscribe = adapter.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(adapter.getStatus()).toMatchObject({
      circuitState: 'retrying',
      consecutivePollFailures: 1
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(calls).toBe(2);
    expect(adapter.getStatus()).toMatchObject({
      circuitState: 'open',
      consecutivePollFailures: 2
    });

    await vi.advanceTimersByTimeAsync(9);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    expect(adapter.getStatus()).toMatchObject({
      circuitState: 'closed',
      consecutivePollFailures: 0
    });
    expect(statuses.map((status) => status.type)).toEqual(expect.arrayContaining([
      'signaling-poll-failed',
      'signaling-circuit-open',
      'signaling-circuit-half-open',
      'signaling-poll-recovered',
      'signaling-circuit-closed'
    ]));

    unsubscribe();
    vi.useRealTimers();
  });

  it('honors a bounded server retry deadline while polling signaling', async () => {
    vi.useFakeTimers();
    const statuses = [];
    let calls = 0;
    const retryableError = Object.assign(new Error('signaling rate limited'), { retryAfterMs: 8 });
    const adapter = createPollingSignalingAdapter({
      publishSignal: () => Promise.resolve(),
      listSignals: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(retryableError) : Promise.resolve({ messages: [] });
      },
      pollIntervalMs: 1,
      pollBackoffBaseMs: 1,
      pollBackoffMaxMs: 10,
      onStatus: (status) => statuses.push(status)
    });
    const unsubscribe = adapter.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(statuses.find((status) => status.type === 'signaling-poll-failed')).toMatchObject({
      retryDelayMs: 8,
      retryAfterMs: 8
    });
    await vi.advanceTimersByTimeAsync(7);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    expect(adapter.getStatus()).toMatchObject({
      circuitState: 'closed',
      lastPollRetryAfterMs: 0
    });
    unsubscribe();
    vi.useRealTimers();
  });
});
