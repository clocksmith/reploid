/** Stable UI pseudonyms, not authenticated owner names or hardware identity. */
const sessions = new WeakMap();
const createRegistry = () => ({ labels: new Map(), identities: new Map(), attempts: new Map(), names: new Map(), blocked: new Set() });
import { participantLabel } from '../../../../shared/vendor/reploid/mesh/computer-identity.js';
export { participantLabel };

export function setComputerNames(session, names) {
  if (!sessions.has(session)) sessions.set(session, createRegistry());
  sessions.get(session).names = new Map(Object.entries(names));
}

/** The ids blocked on this device (computer preferences): verified signing identities or connection ids. */
export function setBlockedComputers(session, ids) {
  if (!sessions.has(session)) sessions.set(session, createRegistry());
  sessions.get(session).blocked = new Set(ids);
}

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
    for (const peer of source?.connections || []) {
      if (!peer.attemptId || peer.phase !== 'connected' || registry.attempts.get(peer.id) !== peer.attemptId) {
        registry.identities.delete(peer.id);
        registry.labels.delete(peer.id);
      }
      registry.attempts.set(peer.id, peer.attemptId);
    }
    for (const peer of source?.peers || []) {
      // The mesh sets this only after a fresh, channel-bound signature check.
      // A reported GPU or advertised participant name cannot create an alias.
      if (peer.identityVerified === true && peer.participantId && peer.peerId) {
        addAliases([peer.participantId, peer.peerId]);
      }
      // A reused transport ID must not inherit a previous occupant's name.
      if (peer.peerId) registry.labels.set(peer.peerId, participantLabel(peer.peerId));
      if (peer.peerId) registry.identities.delete(peer.peerId);
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
  for (const group of groups) for (const alias of group) registry.identities.set(alias, group[0]);
  const canonical = new Set([...ids].map(id => groups.find(group => group.includes(id))?.[0] || registry.identities.get(id) || id));
  for (const id of [...canonical].sort()) {
    const aliases = [id, ...[...registry.identities].filter(([, key]) => key === id).map(([alias]) => alias)];
    const label = registry.names.get(id) || participantLabel(id);
    for (const alias of aliases) registry.labels.set(alias, label);
  }
  return registry.labels;
}

export function withComputerLabels(state, session) {
  if (!sessions.has(session)) sessions.set(session, createRegistry());
  const registry = sessions.get(session), computerLabels = collect(state, registry);
  return { ...state, computerLabels, computerIdentities: new Map(registry.identities), blockedComputers: new Set(registry.blocked) };
}

export function computerLabel(state, id) {
  const labels = state.computerLabels || collect(state, createRegistry());
  return labels.get(id) || participantLabel(id);
}
