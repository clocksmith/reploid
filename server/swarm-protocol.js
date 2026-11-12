/**
 * The one signaling wire core. SignalingServer (Node, `ws`) and the Cloudflare
 * discovery adapter (Durable Object) apply these rules; each adapter keeps only
 * its runtime's connection, storage and timer mechanics. Runtime-neutral: no
 * Node or Workers imports.
 */

export const PEER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,127}$/i;
export const ROOM_ID_PATTERN = /^reploid-swarm-[a-z0-9][a-z0-9_-]{0,127}$/i;
export const MAX_CAPABILITY_LENGTH = 1024;
/** Negotiation message type -> the field carrying its payload. */
export const NEGOTIATION_FIELDS = Object.freeze({ offer: 'offer', answer: 'answer', 'ice-candidate': 'candidate' });
export const DISCOVERY_RELAY_ERROR = 'Discovery does not relay application data';

const encoder = new TextEncoder();
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** Discovery only: a page origin never grants execution or file access. */
export function allowsSwarmOrigin(origin, policy) {
  if (typeof origin !== 'string' || !origin) return false;
  if (policy.allowedOrigins.includes(origin)) return true;
  if (policy.allowLoopbackOrigins !== true) return false;
  try {
    const url = new URL(origin);
    // Require a serialized HTTP origin, never a suffix match or DNS lookup.
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

/** The namespace a discovery URL names; public is bound to the bootstrap room. */
export function discoveryNamespace(searchParams, bootstrap) {
  const scope = searchParams.get('scope');
  const roomId = searchParams.get('roomId') || (scope === 'public' ? bootstrap.publicRoomId : '');
  if (!['public', 'private'].includes(scope) || !ROOM_ID_PATTERN.test(roomId)) return null;
  if ((scope === 'public') !== (roomId === bootstrap.publicRoomId)) return null;
  return { scope, roomId };
}

/** Frame bounds checked before rate accounting. Returns { error, code } or null. */
export function frameError(raw, isBinary, maxBytes) {
  if (isBinary || typeof raw !== 'string') return { error: 'Binary frames are not supported', code: 1003 };
  if (encoder.encode(raw).byteLength > maxBytes) return { error: 'Message exceeds max size', code: 1009 };
  return null;
}

/** Parses one text frame into a message object. Returns { message } or { error, code }. */
export function parseFrame(raw) {
  let message;
  try { message = JSON.parse(raw); } catch { return { error: 'Invalid JSON payload', code: 1003 }; }
  if (!isObject(message)) return { error: 'Message must be a JSON object', code: 1008 };
  return { message };
}

/** Identity fields every join carries. */
export function joinIdentityError({ peerId, roomId, token }) {
  if (!peerId || !roomId) return 'Missing peerId or roomId';
  if (!PEER_ID_PATTERN.test(String(peerId))) return 'peerId is invalid';
  if (!ROOM_ID_PATTERN.test(String(roomId))) return 'roomId is invalid';
  if (typeof token !== 'string' || token.length < 32 || token.length > MAX_CAPABILITY_LENGTH) {
    return 'A high-entropy room capability is required';
  }
  return null;
}

/** Public discovery uses only the public room and marker; private never does. */
export function discoveryJoinError(namespace, { roomId, token }, bootstrap) {
  if (namespace.scope === 'public' && (roomId !== bootstrap.publicRoomId || token !== bootstrap.publicJoinMarker)) {
    return 'Public namespace required';
  }
  if (namespace.scope === 'private' && (roomId === bootstrap.publicRoomId || token === bootstrap.publicJoinMarker)) {
    return 'Private invitation capability required';
  }
  if (namespace.roomId && namespace.roomId !== roomId) return 'Connection namespace is fixed';
  return null;
}

/** A post-join message must name the identity its connection joined with. */
export function boundIdentityError(message, bound) {
  if (!bound.peerId || !bound.roomId) return 'Join is required before signaling';
  if (message.peerId !== bound.peerId) return 'peerId does not match the current connection';
  if (message.roomId && message.roomId !== bound.roomId) return 'roomId does not match the current connection';
  return null;
}

/** offer / answer / ice-candidate: a valid target and an object payload. */
export function negotiationError(message) {
  if (!PEER_ID_PATTERN.test(String(message.targetPeer || ''))) return 'targetPeer is required';
  const field = NEGOTIATION_FIELDS[message.type];
  return isObject(message[field]) ? null : `${field} payload is required`;
}

/** The record a target receives; nothing but the negotiation payload is forwarded. */
export function forwardedNegotiation(message, fromPeerId) {
  const field = NEGOTIATION_FIELDS[message.type];
  return { type: message.type, peerId: fromPeerId, targetPeer: message.targetPeer, [field]: message[field] };
}
