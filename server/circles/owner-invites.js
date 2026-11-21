/** Invoked by the owner's authenticated desktop control channel. */
export async function handleCircleInviteOwnerCommand({ invites, ownerPairing, authenticatePeer, peerId, command }) {
  const owner = await authenticatePeer(peerId);
  if (!owner || !ownerPairing.isOwner(owner)) throw Error('Only a paired owner can manage invites');

  switch (command?.op) {
    case 'circle-invites.list':
      return invites.list();
    case 'circle-invites.issue':
      return invites.issue({ expiresAt: command.expiresAt, maxRequests: command.maxRequests, maxOutputTokens: command.maxOutputTokens });
    case 'circle-invites.revoke':
      return invites.revoke(command.inviteId);
    default:
      throw Error('Unknown invite operation');
  }
}
