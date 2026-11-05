/** Stable UI pseudonyms, not authenticated owner names or hardware identity. */
const sessions = new WeakMap();
const colors = ['Amber', 'Azure', 'Bronze', 'Cobalt', 'Copper', 'Coral', 'Crimson', 'Emerald',
  'Garnet', 'Golden', 'Indigo', 'Ivory', 'Jade', 'Lavender', 'Lilac', 'Lunar',
  'Mint', 'Moss', 'Onyx', 'Opal', 'Pearl', 'Plum', 'Quartz', 'Ruby',
  'Saffron', 'Sapphire', 'Scarlet', 'Silver', 'Slate', 'Teal', 'Violet', 'Viridian'];
const animals = ['Badger', 'Crane', 'Dolphin', 'Falcon', 'Finch', 'Fox', 'Gecko', 'Heron',
  'Ibis', 'Jaguar', 'Kestrel', 'Kingfisher', 'Lark', 'Lynx', 'Marten', 'Moth',
  'Otter', 'Owl', 'Panda', 'Puffin', 'Raven', 'Robin', 'Seal', 'Sparrow',
  'Starling', 'Swift', 'Tiger', 'Tern', 'Turtle', 'Whale', 'Wolf', 'Wren'];

/** Versioned spelling/order: names must not depend on discovery order or randomness. */
export function participantLabel(id) {
  if (typeof id !== 'string' || !id) return 'Remote device';
  let hash = 0x811c9dc5;
  const input = 'reploid-label-v1:' + id;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193) >>> 0;
  return `${colors[hash & 31]} ${animals[(hash >>> 5) & 31]} · ${(hash >>> 16).toString(16).padStart(4, '0').toUpperCase()}`;
}

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
