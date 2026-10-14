/** Session-local display names. These never establish placement or hardware identity. */
const sessions = new WeakMap();

function collect(state, registry) {
  const groups = [];
  for (const peer of state.network?.partitionPeers || []) {
    const aliases = [peer.participantId, peer.description?.participantId, peer.transportId].filter(Boolean);
    const existing = groups.find(group => aliases.some(id => group.includes(id)));
    if (existing) existing.push(...aliases.filter(id => !existing.includes(id)));
    else groups.push(aliases);
  }
  const ids = new Set();
  const own = new Set([state.participantId, state.network?.consumer?.peerId, state.network?.supplier?.peerId]);
  for (const source of [state.network?.consumer, state.network?.supplier]) {
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
      // Reviewed recipients of a pending approval need the same stable names the ribbon shows later.
      for (const id of attempt.approval?.recipients || []) if (id && !own.has(id)) ids.add(id);
    }
  }
  const canonical = new Set([...ids].map(id => groups.find(group => group.includes(id))?.[0] || id));
  for (const id of [...canonical].sort()) {
    const aliases = groups.find(group => group.includes(id)) || [id];
    const label = aliases.map(alias => registry.labels.get(alias)).find(Boolean)
      || `Computer ${registry.next++}`;
    for (const alias of aliases) registry.labels.set(alias, label);
  }
  return registry.labels;
}

export function withComputerLabels(state, session) {
  if (!sessions.has(session)) sessions.set(session, { labels: new Map(), next: 1 });
  return { ...state, computerLabels: collect(state, sessions.get(session)) };
}

export function computerLabel(state, id) {
  const labels = state.computerLabels || collect(state, { labels: new Map(), next: 1 });
  return labels.get(id) || 'Computer';
}
