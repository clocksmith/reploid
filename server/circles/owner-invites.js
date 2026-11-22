const REVOCATION_POLICIES = new Set(['finish', 'stop']);

/** Invoked by the owner's authenticated desktop control channel. */
export async function handleCircleInviteOwnerCommand({
  invites,
  ownerPairing,
  authenticatePeer,
  getQueuedCount,
  getActiveCount,
  revocationPolicy = 'finish',
  peerId,
  command
}) {
  if (!REVOCATION_POLICIES.has(revocationPolicy)) throw Error('Invalid revocation policy');
  const owner = await authenticatePeer(peerId);
  if (!owner || !ownerPairing.isOwner(owner)) throw Error('Only a paired owner can manage invites');

  switch (command?.op) {
    case 'circle-invites.list':
      return invites.list().map(invite => ({
        ...invite,
        queuedRequests: getQueuedCount?.(invite.inviteId) ?? null,
        activeRequests: getActiveCount?.(invite.inviteId) ?? null,
        revocationPolicy
      }));
    case 'circle-invites.issue':
      return {
        ...invites.issue({
          expiresAt: command.expiresAt,
          maxRequests: command.maxRequests,
          maxOutputTokens: command.maxOutputTokens
        }),
        revocationPolicy
      };
    case 'circle-invites.revoke': {
      const revoked = invites.revoke(command.inviteId);
      return revoked ? { ...revoked, revocationPolicy } : null;
    }
    default:
      throw Error('Unknown invite operation');
  }
}
