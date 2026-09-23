/** Pure discovery selection. Namespace membership grants no resource permission. */
export function resolveSwarmJoin({ location, storage, policy, randomId }) {
  const url = new URL(location.href);
  const mode = url.searchParams.get('swarm');
  const disabled = ['off', 'false'].includes(mode) || storage?.getItem('REPLOID_SWARM_ENABLED') === 'false';
  const privateRoom = mode && !['true', 'public', 'off', 'false'].includes(mode)
    ? mode : mode === 'public' ? null : url.searchParams.get('room');
  if (!privateRoom) return { scope: 'public', roomId: policy.publicRoomId,
    token: policy.publicJoinMarker, autoConnect: policy.autoConnect && !disabled };
  const roomId = privateRoom.startsWith('reploid-swarm-') ? privateRoom : `reploid-swarm-${privateRoom}`;
  const token = url.searchParams.get('swarmToken') || storage?.getItem(`REPLOID_SWARM_TOKEN:${roomId}`);
  if (!/^reploid-swarm-[a-z0-9][a-z0-9_-]{0,127}$/i.test(roomId) || roomId === policy.publicRoomId
    || typeof token !== 'string' || token.length < 32) throw new Error('Private invitation requires its room capability');
  return { scope: 'private', roomId, token, autoConnect: policy.autoConnect && !disabled };
}

export function resolveSwarmSignalingUrl({ location, policy, join, privateOverride }) {
  const page = new URL(location.href);
  const local = ['localhost', '127.0.0.1'].includes(page.hostname);
  const endpoint = join.scope === 'private' && privateOverride ? privateOverride
    : local ? `${page.protocol === 'https:' ? 'wss:' : 'ws:'}//${page.host}${policy.path}` : policy.signalingUrl;
  const url = new URL(endpoint, page);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Invalid swarm signaling endpoint');
  url.searchParams.set('scope', join.scope);
  return url.href;
}
