/**
 * @fileoverview Pure projection from relay summaries to Poolday network visuals.
 */

import { POOLDAY_PARTICIPANT_NODE_IDS } from './constants.js';

const networkCount = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

const uniqueNetworkIds = (values = []) => [...new Set(values
  .map((value) => String(value || '').trim())
  .filter(Boolean))];

export function resolvePoolNetworkVisualState(summary = null) {
  const unavailable = Boolean(summary?.error);
  const providers = Array.isArray(summary?.providers) ? summary.providers : [];
  const providerIds = uniqueNetworkIds(providers.map((provider) => provider?.providerId));
  const recent = Array.isArray(summary?.recent) ? summary.recent : [];
  const peerIds = uniqueNetworkIds([
    ...(Array.isArray(summary?.peers) ? summary.peers : []),
    ...recent.map((entry) => entry?.fromPeerId),
    ...providerIds
  ]);
  const peerCount = unavailable ? 0 : Math.max(networkCount(summary?.peerCount), peerIds.length);
  const providerCount = unavailable ? 0 : Math.max(networkCount(summary?.providerCount), providerIds.length);
  const messageCount = unavailable ? 0 : networkCount(summary?.messageCount);
  const reportedParticipants = unavailable ? 0 : Math.max(peerCount, providerCount, peerIds.length);
  const liveParticipantCount = Math.min(POOLDAY_PARTICIPANT_NODE_IDS.length, reportedParticipants);
  const providerSet = new Set(providerIds);
  const orderedIds = uniqueNetworkIds([
    ...providerIds,
    ...peerIds.filter((id) => !providerSet.has(id))
  ]);
  const participants = Array.from({ length: liveParticipantCount }, (_, index) => {
    const id = orderedIds[index] || null;
    return {
      id,
      provider: id ? providerSet.has(id) : index < providerCount
    };
  });
  const hasLiveData = liveParticipantCount > 0 || messageCount > 0 || recent.length > 0;
  const mode = !hasLiveData
    ? 'simulation'
    : liveParticipantCount >= POOLDAY_PARTICIPANT_NODE_IDS.length
      ? 'live'
      : 'hybrid';
  return {
    mode,
    available: !unavailable,
    error: unavailable ? String(summary.error) : null,
    roomId: summary?.roomId || null,
    peerCount,
    providerCount,
    messageCount,
    liveParticipantCount,
    participants,
    recent: recent.slice(0, 10).map((entry) => ({
      type: String(entry?.type || 'unknown'),
      fromPeerId: entry?.fromPeerId ? String(entry.fromPeerId) : null,
      createdAt: entry?.createdAt || null
    }))
  };
}
