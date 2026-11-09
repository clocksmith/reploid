/** Stable UI pseudonyms, not authenticated owner names or hardware identity. */
const sessions = new WeakMap();
import { participantLabel } from '../../../../shared/vendor/reploid/mesh/computer-identity.js';
export { participantLabel };

function collect(state, registry) {
  const groups = [];
  const addAliases = aliases => {
    const existing = groups.find(group => aliases.some(id => group.includes(id)));
    if (existing) existing.push(...aliases.filter(id => !existing.includes(id)));
    else groups.push(aliases);
  };
  for (const peer of state.network?.partitionPeers || []) {
    addAliases([peer.participantId, peer.description?.participantId, peer.transportId].filter(Boolean));
  }
  for (const source of [state.network, state.network?.consumer, state.network?.supplier]) {
    for (const peer of source?.peers || []) {
      // The mesh sets this only after a fresh, channel-bound signature check.
      // A reported GPU or advertised participant name cannot create an alias.
      if (peer.identityVerified === true && peer.participantId && peer.peerId) {
        addAliases([peer.participantId, peer.peerId]);
      }
      // A reused transport ID must not inherit a previous occupant's name.
      if (peer.peerId) registry.labels.set(peer.peerId, participantLabel(peer.peerId));
    }
  }
  const ids = new Set();
  const own = new Set([state.participantId, state.network?.consumer?.peerId, state.network?.supplier?.peerId]);
  for (const source of [state.network, state.network?.consumer, state.network?.supplier]) {
    for (const peer of source?.connections || []) if (!own.has(peer.id)) ids.add(peer.id);
    for (const peer of source?.peers || []) if (!own.has(peer.peerId)) ids.add(peer.peerId);
  }
  for (const thread of [...(state.threads || []), state.activeThread].filter(Boolean)) {
    for (const attempt of thread.attempts || []) {
      const execution = attempt.execution;
      const route = execution?.identity?.schema === 'reploid.partition-attempt/v2' ? execution.identity.route : null;
      for (const id of [execution?.participantA, execution?.participantB, execution?.peerId,
        ...(route?.stages || []).map(stage => stage.participantId)]) {
        if (id && id !== (execution?.identity?.requesterId || execution?.requesterId) && !own.has(id)) ids.add(id);
      }
    }
  }
  const canonical = new Set([...ids].map(id => groups.find(group => group.includes(id))?.[0] || id));
  for (const id of [...canonical].sort()) {
    const aliases = groups.find(group => group.includes(id)) || [id];
    const label = aliases.length > 1 ? participantLabel(id) : registry.labels.get(id) || participantLabel(id);
    for (const alias of aliases) registry.labels.set(alias, label);
  }
  return registry.labels;
}

export function withComputerLabels(state, session) {
  if (!sessions.has(session)) sessions.set(session, { labels: new Map() });
  return { ...state, computerLabels: collect(state, sessions.get(session)) };
}

export function computerLabel(state, id) {
  const labels = state.computerLabels || collect(state, { labels: new Map() });
  return labels.get(id) || participantLabel(id);
}
