/** The persisted peer-room relay shape, shared by transactional storage adapters. */
export function createPeerRoomRelayRecord(message, { roomId, relayId, relaySequence, receivedAt, now = Date.now() }) {
  return {
    ...message, roomId, relayId, relaySequence,
    fromPeerId: message.fromPeerId || null,
    createdAt: Number(message.createdAt || now),
    expiresAt: message.expiresAt || null,
    receivedAt
  };
}
