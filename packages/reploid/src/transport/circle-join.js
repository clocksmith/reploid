import { ownerParticipantId, ownerPairingRequestId } from './owner-pairing.js';

export const CIRCLE_JOIN_REQUEST = 'reploid:circle-join-request';
export const CIRCLE_JOIN_RESULT = 'reploid:circle-join-result';
/** Host invite tokens are 32 random bytes, base64url without padding. */
export const circleInviteToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

const replies = new WeakMap();

/**
 * Redeem a host invite over a freshly verified channel to the pinned host. The token goes to that host only;
 * the host binds the invite to this requester's verified identity and answers with the invite's limits.
 */
export async function requestCircleJoin({ transport, verifyPeer, currentPeer, hostPeer, hostParticipantId, token,
  signal = AbortSignal.timeout(30000) }) {
  if (!ownerParticipantId(hostParticipantId) || !circleInviteToken(token)) throw Error('Invalid host invite details');
  const channel = transport.getPeerBinding(hostPeer);
  if (!channel || await verifyPeer(hostPeer, signal) !== hostParticipantId) throw Error('Could not verify the invited computer');
  const assertChannel = () => {
    signal.throwIfAborted();
    if (currentPeer(hostPeer) !== hostParticipantId) throw Error('Connection to the invited computer changed');
  };
  assertChannel();
  const requestId = crypto.randomUUID();
  let waiting = replies.get(transport);
  if (!waiting) {
    waiting = new Map();
    replies.set(transport, waiting);
    transport.onMessage(CIRCLE_JOIN_RESULT, (peer, result) => waiting.get(result?.requestId)?.(peer, result));
  }
  return new Promise((resolve, reject) => {
    const abort = () => finish(signal.reason);
    const finish = (error, result) => {
      waiting.delete(requestId);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    waiting.set(requestId, (peer, result) => {
      if (peer !== hostPeer) return;
      try {
        assertChannel();
        if (result.joined !== true) throw Error(result.reason === 'invalid'
          ? 'This invite is invalid, expired, revoked or already used on another device' : 'The invited computer declined');
        const limits = result.invite || {};
        finish(null, {
          hostParticipantId,
          hostLabel: typeof limits.hostLabel === 'string' && limits.hostLabel.trim() ? limits.hostLabel.trim().slice(0, 128) : hostParticipantId,
          inviteId: typeof limits.inviteId === 'string' ? limits.inviteId : null,
          expiresAt: Number.isSafeInteger(limits.expiresAt) ? limits.expiresAt : null,
          remainingRequests: Number.isSafeInteger(limits.remainingRequests) ? limits.remainingRequests : null,
          maxOutputTokens: Number.isSafeInteger(limits.maxOutputTokens) ? limits.maxOutputTokens : null
        });
      } catch (error) { finish(error); }
    });
    signal.addEventListener('abort', abort, { once: true });
    try {
      assertChannel();
      if (!transport.sendToPeer(hostPeer, CIRCLE_JOIN_REQUEST, { requestId, token })) throw Error('Invited computer unavailable');
    } catch (error) { finish(error); }
  });
}

export const circleJoinRequestId = ownerPairingRequestId;
