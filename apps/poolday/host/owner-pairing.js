import {
  ownerPairingCode,
  ownerParticipantId,
  requestOwnerPairing
} from '../../../shared/vendor/reploid/transport/index.js';
import { describeCircleHost } from './circle-invites.js';

const STORAGE_KEY = 'reploid.owner-paired-desktop:v1';
const validLabel = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128;
const validRoom = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128;

export function createOwnerPairingUrl({ hostParticipantId, code, hostLabel, roomId }, baseUrl = globalThis.location?.href || 'https://replo.id/') {
  if (!ownerParticipantId(hostParticipantId) || !ownerPairingCode(code)) {
    throw new Error('Valid desktop identity and 24-character pairing code are required');
  }
  const url = new URL('/', baseUrl);
  const params = new URLSearchParams({ pair: code, host: hostParticipantId });
  if (validLabel(hostLabel) && hostLabel.trim() !== hostParticipantId) params.set('name', hostLabel.trim());
  if (validRoom(roomId)) params.set('room', roomId.trim());
  url.hash = params.toString();
  return url.href;
}

export function parseOwnerPairingUrl(value = globalThis.location?.href || '') {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.getAll('pair').length !== 1 || fragment.getAll('host').length !== 1) return null;
  if (fragment.getAll('name').length > 1 || fragment.getAll('room').length > 1) return null;
  const code = fragment.get('pair'), hostParticipantId = fragment.get('host');
  if (!ownerPairingCode(code) || !ownerParticipantId(hostParticipantId)) return null;
  const rawName = fragment.get('name'), rawRoom = fragment.get('room');
  if (rawName !== null && !validLabel(rawName)) return null;
  if (rawRoom !== null && !validRoom(rawRoom)) return null;
  return {
    code,
    hostParticipantId,
    ...(rawName ? { hostLabel: rawName.trim() } : {}),
    ...(rawRoom ? { roomId: rawRoom.trim() } : {})
  };
}

function loadSaved(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) || 'null');
    if (!parsed || !ownerParticipantId(parsed.hostParticipantId)) return null;
    const hostLabel = validLabel(parsed.hostLabel) ? parsed.hostLabel.trim() : parsed.hostParticipantId;
    return {
      hostParticipantId: parsed.hostParticipantId,
      hostLabel,
      pairedAt: Number.isSafeInteger(parsed.pairedAt) ? parsed.pairedAt : null
    };
  } catch {
    return null;
  }
}

/**
 * Browser-side owner pairing over WebRTC without any local address or room-token file.
 * Persists only the confirmed desktop identity; single-use pairing codes are never stored.
 */
export function createBrowserOwnerPairing({
  storage = globalThis.localStorage,
  getChannel = () => null,
  connect = null,
  onChange = () => {},
  now = Date.now
} = {}) {
  let saved = loadSaved(storage);
  let pairing = false;
  let pendingTarget = null;
  let error = '';
  let closed = false;
  let activeAbort = null;

  function resolveVerifiedPeer(channel, hostParticipantId) {
    if (!channel?.transport) return null;
    const peers = typeof channel.getPeers === 'function' ? channel.getPeers() : [];
    const states = typeof channel.getPeerStates === 'function' ? channel.getPeerStates() : [];
    const connected = typeof channel.transport.getConnectedPeers === 'function'
      ? channel.transport.getConnectedPeers().map(peer => peer.id) : [];
    const candidateIds = [...new Set([...peers.map(peer => peer.peerId), ...connected])];
    for (const peerId of candidateIds) {
      if (!channel.transport.getPeerBinding?.(peerId)) continue;
      if (channel.currentPeer?.(peerId) !== hostParticipantId) continue;
      const peerInfo = peers.find(peer => peer.peerId === peerId) || null;
      const linkState = states.find(item => item.id === peerId) || null;
      return {
        hostPeer: peerId,
        transportPath: linkState?.path || 'connected',
        readyModel: peerInfo?.readiness === 'ready' ? (peerInfo.model || null) : null
      };
    }
    return null;
  }

  async function findAndVerifyHostPeer(channel, hostParticipantId, signal) {
    const existing = resolveVerifiedPeer(channel, hostParticipantId);
    if (existing) return existing.hostPeer;
    const peers = typeof channel.getPeers === 'function' ? channel.getPeers().map(peer => peer.peerId) : [];
    const connected = typeof channel.transport?.getConnectedPeers === 'function'
      ? channel.transport.getConnectedPeers().map(peer => peer.id) : [];
    const candidates = [...new Set([...peers, ...connected])];
    for (const peerId of candidates) {
      signal.throwIfAborted();
      if (!channel.transport?.getPeerBinding?.(peerId)) continue;
      try {
        const verified = await channel.verifyPeer(peerId, signal);
        if (verified === hostParticipantId) return peerId;
      } catch { /* Continue checking other connected peers without disclosing the code. */ }
    }
    throw new Error('Could not find the verified desktop on this connection. Confirm it is online and retry.');
  }

  function state() {
    if (pairing && pendingTarget) {
      const disclosure = describeCircleHost(pendingTarget.hostLabel, pendingTarget.hostParticipantId);
      return Object.freeze({
        status: 'pairing',
        paired: false,
        canSend: false,
        hostParticipantId: pendingTarget.hostParticipantId,
        hostLabel: disclosure.hostLabel,
        disclosure,
        transportPath: null,
        readyModel: null,
        pairedAt: null,
        error
      });
    }
    if (!saved) {
      return Object.freeze({
        status: 'unpaired',
        paired: false,
        canSend: false,
        hostParticipantId: null,
        hostLabel: null,
        disclosure: null,
        transportPath: null,
        readyModel: null,
        pairedAt: null,
        error
      });
    }
    const disclosure = describeCircleHost(saved.hostLabel, saved.hostParticipantId);
    const live = resolveVerifiedPeer(getChannel(), saved.hostParticipantId);
    if (live) {
      return Object.freeze({
        status: 'online',
        paired: true,
        canSend: true,
        hostParticipantId: saved.hostParticipantId,
        hostLabel: disclosure.hostLabel,
        hostPeer: live.hostPeer,
        disclosure,
        transportPath: live.transportPath,
        readyModel: live.readyModel,
        pairedAt: saved.pairedAt,
        error
      });
    }
    return Object.freeze({
      status: 'offline',
      paired: true,
      canSend: false,
      hostParticipantId: saved.hostParticipantId,
      hostLabel: disclosure.hostLabel,
      hostPeer: null,
      disclosure,
      transportPath: null,
      readyModel: null,
      pairedAt: saved.pairedAt,
      error
    });
  }

  async function pair({ hostParticipantId, code, hostLabel, signal } = {}) {
    if (closed) throw new Error('Owner pairing is closed');
    if (pairing) throw new Error('Pairing is already waiting for desktop confirmation');
    if (!ownerParticipantId(hostParticipantId) || !ownerPairingCode(code)) {
      throw new Error('Enter a valid desktop ID and 24-character pairing code');
    }
    const label = validLabel(hostLabel) ? hostLabel.trim() : hostParticipantId;
    const controller = new AbortController();
    activeAbort = controller;
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    pairing = true;
    pendingTarget = { hostParticipantId, hostLabel: label };
    error = '';
    onChange();
    try {
      let channel = getChannel();
      if (!channel && typeof connect === 'function') {
        await connect();
        channel = getChannel();
      }
      requestSignal.throwIfAborted();
      if (!channel?.transport || typeof channel.verifyPeer !== 'function' || typeof channel.currentPeer !== 'function') {
        throw new Error('Connect to the Reploid network before pairing your desktop');
      }
      const hostPeer = await findAndVerifyHostPeer(channel, hostParticipantId, requestSignal);
      const confirmed = await requestOwnerPairing({
        transport: channel.transport,
        verifyPeer: channel.verifyPeer,
        currentPeer: channel.currentPeer,
        hostPeer,
        hostParticipantId,
        code,
        signal: requestSignal
      });
      if (closed) throw new Error('Owner pairing is closed');
      saved = {
        hostParticipantId: confirmed.hostParticipantId,
        hostLabel: label,
        pairedAt: now()
      };
      storage?.setItem?.(STORAGE_KEY, JSON.stringify(saved));
      error = '';
      return {
        ...saved,
        disclosure: describeCircleHost(saved.hostLabel, saved.hostParticipantId)
      };
    } catch (cause) {
      error = cause?.message || 'Owner pairing failed';
      throw cause;
    } finally {
      if (activeAbort === controller) activeAbort = null;
      pairing = false;
      pendingTarget = null;
      if (!closed) onChange();
    }
  }

  function unpair() {
    activeAbort?.abort(new Error('Owner pairing cancelled'));
    saved = null;
    error = '';
    storage?.removeItem?.(STORAGE_KEY);
    if (!closed) onChange();
  }

  function close() {
    if (closed) return;
    closed = true;
    activeAbort?.abort(new Error('Owner pairing closed'));
    activeAbort = null;
  }

  return Object.freeze({ state, pair, unpair, close });
}
