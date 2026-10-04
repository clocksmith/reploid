/** Pure selection over observed capabilities. No transport or resource ownership. */
export function selectPartitionPlacement({ participantId, offer, localIndex, previous, capabilities }) {
  const eligibility = capabilities.map(peer => ({ participantId: peer.participantId, transportId: peer.transportId,
    observedAt: peer.observedAt, expiresAt: peer.expiresAt,
    reason: !peer.available ? peer.reason : peer.description.phase === 'failed' ? 'contributor-failed'
      : peer.description.offer?.id !== offer.id || peer.description.offer?.identity !== offer.identity
        ? 'model-mismatch' : 'approved-model-contribution',
    index: peer.description?.index ?? null }));
  const candidates = [{ id: participantId, index: localIndex },
    ...eligibility.filter(peer => peer.reason === 'approved-model-contribution')
      .map(peer => ({ id: peer.participantId, index: peer.index }))].sort((a, b) => a.id.localeCompare(b.id));
  const ids = candidates.map(peer => peer.id);
  const retainedA = previous && ids.includes(previous[0])
    && candidates.find(peer => peer.id === previous[0])?.index === 0 ? previous[0] : null;
  const a = retainedA || candidates.find(peer => peer.index === 0)?.id
    || candidates.find(peer => peer.index === null)?.id || ids[0];
  const b = participantId !== a ? participantId
    : previous?.[0] === a && ids.includes(previous[1]) ? previous[1]
      : candidates.find(peer => peer.id !== a && peer.index === 1)?.id || ids.find(id => id !== a);
  return { participants: b ? [a, b] : [], eligibility,
    reason: !b ? 'missing-complementary-contributor' : retainedA ? 'retain-input-owner' : 'select-input-owner' };
}
