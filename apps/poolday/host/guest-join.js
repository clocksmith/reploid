import { circleInviteToken, ownerPairingRoomId, ownerParticipantId, requestCircleJoin }
  from '../../../shared/vendor/reploid/transport/index.js';
import { describeCircleHost } from './circle-invites.js';
import { findVerifiedHostPeer, resolveVerifiedPeer } from './verified-host-peer.js';

const STORAGE_KEY = 'reploid.guest-host:v1';
const PEER_WAIT_MS = 8000;
const validLabel = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128;

function loadSaved(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) || 'null');
    if (!parsed || !ownerParticipantId(parsed.hostParticipantId)) return null;
    if (Number.isSafeInteger(parsed.expiresAt) && parsed.expiresAt <= Date.now()) return null;
    return {
      hostParticipantId: parsed.hostParticipantId,
      hostLabel: validLabel(parsed.hostLabel) ? parsed.hostLabel.trim() : parsed.hostParticipantId,
      roomId: ownerPairingRoomId(parsed.roomId) ? parsed.roomId : null,
      expiresAt: Number.isSafeInteger(parsed.expiresAt) ? parsed.expiresAt : null
    };
  } catch { return null; }
}

/**
 * Browser side of a host invite. Joining sends the one-time token only to the verified host; afterwards this
 * device remembers which computer invited it (never the token) and reconnects to that host's room on load.
 */
export function createBrowserGuestJoin({ storage = globalThis.localStorage, getChannel = () => null, connect = null,
  onChange = () => {}, now = Date.now } = {}) {
  let saved = loadSaved(storage), joining = null, error = '', closed = false, activeAbort = null;

  function state() {
    const target = joining || saved;
    if (!target) return Object.freeze({ status: 'none', joined: false, hostParticipantId: null, hostLabel: null, roomId: null, error });
    const live = saved && !joining ? resolveVerifiedPeer(getChannel(), saved.hostParticipantId) : null;
    return Object.freeze({
      status: joining ? 'joining' : live ? 'online' : 'offline',
      joined: !!saved && !joining,
      hostParticipantId: target.hostParticipantId,
      hostLabel: target.hostLabel,
      roomId: target.roomId,
      readyModel: live?.readyModel ?? null,
      transportPath: live?.transportPath ?? null,
      disclosure: describeCircleHost(target.hostLabel, target.hostParticipantId),
      error
    });
  }

  async function join({ hostPeerId, token, hostLabel, roomId, signal } = {}) {
    if (closed) throw new Error('Guest join is closed');
    if (joining) throw new Error('Already joining');
    if (!ownerParticipantId(hostPeerId) || !circleInviteToken(token)) throw new Error('This invite link is incomplete');
    const targetRoomId = ownerPairingRoomId(roomId) ? roomId : null;
    const label = validLabel(hostLabel) ? hostLabel.trim() : hostPeerId;
    const controller = new AbortController();
    activeAbort = controller;
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    joining = { hostParticipantId: hostPeerId, hostLabel: label, roomId: targetRoomId };
    error = '';
    onChange();
    try {
      let channel = getChannel();
      if ((!channel || targetRoomId && channel.roomId !== targetRoomId) && typeof connect === 'function') {
        await connect(targetRoomId ? { roomId: targetRoomId } : {});
        channel = getChannel();
      }
      requestSignal.throwIfAborted();
      if (!channel?.transport) throw new Error('Could not connect to the network. Check your connection and retry.');
      const matched = await findVerifiedHostPeer({ getChannel, channel, hostParticipantId: hostPeerId, targetRoomId,
        signal: requestSignal, waitMs: PEER_WAIT_MS, now, isClosed: () => closed,
        notFound: `${label} is not reachable right now. Ask them to keep Reploid running and retry.` });
      const joined = await requestCircleJoin({ transport: matched.channel.transport, verifyPeer: matched.channel.verifyPeer,
        currentPeer: matched.channel.currentPeer, hostPeer: matched.hostPeer, hostParticipantId: hostPeerId, token,
        signal: AbortSignal.any([requestSignal, AbortSignal.timeout(30000)]) });
      if (closed) throw new Error('Guest join is closed');
      saved = { hostParticipantId: hostPeerId, hostLabel: validLabel(hostLabel) ? label : joined.hostLabel,
        roomId: targetRoomId || (ownerPairingRoomId(matched.channel.roomId) ? matched.channel.roomId : null), expiresAt: joined.expiresAt };
      storage?.setItem?.(STORAGE_KEY, JSON.stringify(saved));
      return { ...saved, remainingRequests: joined.remainingRequests, maxOutputTokens: joined.maxOutputTokens };
    } catch (cause) {
      error = cause?.message || 'Could not join';
      throw cause;
    } finally {
      if (activeAbort === controller) activeAbort = null;
      joining = null;
      if (!closed) onChange();
    }
  }

  async function reconnect() {
    if (closed || !saved || typeof connect !== 'function') return state();
    const channel = getChannel();
    if (!channel || saved.roomId && channel.roomId !== saved.roomId) await connect(saved.roomId ? { roomId: saved.roomId } : {});
    if (!closed) onChange();
    return state();
  }

  function leave() {
    activeAbort?.abort(new Error('Left the invited computer'));
    saved = null; error = '';
    storage?.removeItem?.(STORAGE_KEY);
    onChange();
  }

  function close() {
    closed = true;
    activeAbort?.abort(new Error('Guest join closed'));
  }

  return Object.freeze({ state, join, reconnect, leave, close });
}
