import { ownerPairingRoomId } from '../../../shared/vendor/reploid/transport/index.js';
import { promptDisclosure } from './decisions/prompt-disclosure.js';
// Browser entry points for host invitations and the guest's admitted HTTP turn.
export { sendCircleChat } from './circle-http-client.js';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const validHost = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validLabel = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128;

export function describeCircleHost(hostLabel, hostPeerId = '') {
  let label = 'invited computer';
  if (validLabel(hostLabel)) label = hostLabel.trim();
  else if (validHost(hostPeerId)) label = hostPeerId;
  return Object.freeze({
    hostLabel: label,
    readableBy: `Readable by: ${label}`,
    notice: promptDisclosure({ site: 'invite', operator: label })
  });
}

/** A guest link. A guest is a stranger to the host, so the link names the host by its peer ID only, never by name. */
export function createCircleInviteUrl({ token, hostPeerId, roomId }, baseUrl = globalThis.location.href) {
  if (!tokenPattern.test(token) || !validHost(hostPeerId)) throw Error('Invalid host invitation');
  const url = new URL('/', baseUrl);
  const params = new URLSearchParams({ circle: token, host: hostPeerId });
  if (ownerPairingRoomId(roomId)) params.set('room', roomId);
  url.hash = params.toString();
  return url.href;
}

export function parseCircleInviteUrl(value = globalThis.location.href) {
  const url = new URL(value);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.getAll('circle').length !== 1 || fragment.getAll('host').length !== 1) return null;
  if (fragment.getAll('name').length > 1) return null;
  const token = fragment.get('circle'), hostPeerId = fragment.get('host');
  if (!tokenPattern.test(token) || !validHost(hostPeerId)) return null;
  const rawName = fragment.get('name'), rawRoom = fragment.get('room');
  if (rawName !== null && !validLabel(rawName)) return null;
  // The room is routing only: it says where the host listens and grants nothing.
  if (fragment.getAll('room').length > 1 || rawRoom !== null && !ownerPairingRoomId(rawRoom)) return null;
  return { token, hostPeerId, ...(rawName ? { hostLabel: rawName.trim() } : {}), ...(rawRoom ? { roomId: rawRoom } : {}) };
}

/** request() is the current paired desktop's authenticated owner command port. */
export function createCircleInviteOwner({ request, baseUrl }) {
  return Object.freeze({
    list: () => request({ op: 'circle-invites.list' }),
    async issue({ expiresAt, maxRequests, maxOutputTokens }) {
      const created = await request({ op: 'circle-invites.issue', expiresAt, maxRequests, maxOutputTokens });
      return {
        inviteId: created.inviteId,
        hostLabel: created.hostLabel || created.hostPeerId,
        link: createCircleInviteUrl(created, baseUrl)
      };
    },
    revoke: inviteId => request({ op: 'circle-invites.revoke', inviteId })
  });
}
