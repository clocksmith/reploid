import { CIRCLE_JOIN_REQUEST, CIRCLE_JOIN_RESULT, circleInviteToken, circleJoinRequestId, ownerParticipantId }
  from '../../shared/vendor/reploid/transport/index.js';

/**
 * Host-side guest access over the mesh. A guest redeems a host invite once over a verified channel; afterwards
 * the host admits that guest's generation requests within the invite's limits. Admission is decided before the
 * prompt is disclosed, so a revoked or exhausted invite means no prompt bytes leave the guest's device.
 * Transport-agnostic: the invite store owns limits, request accounting and settlement.
 */
export function createGuestAccess({ invites, hostParticipantId, isBusy = () => false, onJoin = () => {} }) {
  if (!ownerParticipantId(hostParticipantId) || invites?.hostPeerId !== hostParticipantId
    || !['redeem', 'liveForGuest', 'admit', 'hasRequest', 'settle', 'lookup'].every(name => typeof invites[name] === 'function')) {
    throw Error('Guest access requires this host\'s invite store');
  }
  let attached = false, closed = false;
  const remaining = invite => Math.max(0, invite.maxRequests - invite.usedRequests);

  return Object.freeze({
    /** The guest's live invite on this host, or null. */
    inviteFor: participantId => closed || !ownerParticipantId(participantId) ? null : invites.liveForGuest(participantId),

    /**
     * Before disclosure: admit one request when the guest holds a live invite with requests left and the host is
     * free. A busy host refuses so the guest keeps the prompt and retries; nothing is reserved while it waits.
     */
    admit({ participantId, requestId }) {
      if (closed || !ownerParticipantId(participantId) || typeof requestId !== 'string' || !requestId) return false;
      const invite = invites.liveForGuest(participantId);
      if (!invite || isBusy()) return false;
      const admitted = invites.admit({ inviteId: invite.inviteId, guestPeerId: participantId, hostPeerId: hostParticipantId,
        requestId, maxOutputTokens: invite.maxOutputTokens });
      return admitted?.status === 'admitted' || admitted?.status === 'duplicate';
    },

    /** After disclosure: execute only a request admitted for this guest whose invite is still live. */
    mayExecute({ participantId, requestId }) {
      if (closed || !ownerParticipantId(participantId)) return false;
      return !!invites.liveForGuest(participantId) && invites.hasRequest({ guestPeerId: participantId, requestId });
    },

    /** Record a completed guest request against its invite (no-op for other requesters). */
    settle({ participantId, requestId, outcome = 'completed', outputTokens = 0, modelWeightBytes = 0 }) {
      if (closed || !ownerParticipantId(participantId) || !invites.hasRequest({ guestPeerId: participantId, requestId })) return null;
      const invite = invites.liveForGuest(participantId);
      if (!invite) return null;
      return invites.settle({ inviteId: invite.inviteId, guestPeerId: participantId, hostPeerId: hostParticipantId, requestId,
        outcome, outputTokens, modelWeightBytes });
    },

    attach({ transport, verifyPeer, currentPeer }) {
      if (closed) throw Error('Guest access is closed');
      if (attached) throw Error('Guest access is already connected');
      attached = true;
      transport.onMessage(CIRCLE_JOIN_REQUEST, (peer, input) => {
        void (async () => {
          if (closed || !circleJoinRequestId(input?.requestId) || !circleInviteToken(input?.token) || !transport.getPeerBinding(peer)) return;
          const { requestId, token } = input;
          const participantId = await verifyPeer(peer, AbortSignal.timeout(5000));
          if (closed || !ownerParticipantId(participantId) || currentPeer(peer) !== participantId) return;
          const invite = invites.redeem({ token, guestPeerId: participantId });
          if (closed || currentPeer(peer) !== participantId) return;
          if (!invite || invite.status !== 'active') {
            transport.sendToPeer(peer, CIRCLE_JOIN_RESULT, { requestId, joined: false, reason: 'invalid' });
            return;
          }
          transport.sendToPeer(peer, CIRCLE_JOIN_RESULT, { requestId, joined: true, invite: {
            inviteId: invite.inviteId, hostLabel: invite.hostLabel, expiresAt: invite.expiresAt,
            remainingRequests: remaining(invite), maxOutputTokens: invite.maxOutputTokens } });
          onJoin({ inviteId: invite.inviteId, participantId });
        })().catch(() => {});
      });
    },

    close() { closed = true; }
  });
}

/**
 * The one admission rule for a paired host: its owner always; an invited guest only within its invite, and only
 * before disclosure while the host is idle (so a waiting guest keeps its prompt). Without pairing, anyone the
 * room admits. Used by the native host runtime and its tests.
 */
export function createHostRequesterRule({ ownerPairing = null, guestAccess = null, verifyPeer, isIdle = () => true }) {
  return async (request, stage = 'admit') => {
    if (!ownerPairing) return true;
    const participantId = await verifyPeer(request.peerId);
    if (ownerPairing.isOwner(participantId)) return true;
    if (!guestAccess) return false;
    const requestId = request.request?.requestId;
    if (stage === 'execute') return guestAccess.mayExecute({ participantId, requestId });
    return isIdle() && guestAccess.admit({ participantId, requestId });
  };
}
