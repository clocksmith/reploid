import {
  ownerPairingCode,
  ownerPairingRoomId,
  ownerParticipantId,
  requestOwnerPairing
} from '../../../shared/vendor/reploid/transport/index.js';
import { describeCircleHost } from './circle-invites.js';

const STORAGE_KEY = 'reploid.owner-paired-desktop:v1';
const DEFAULT_PEER_WAIT_MS = 6000;
const APPROVAL_WAIT_MS = 10 * 60 * 1000;
const PEER_POLL_MS = 40;
const validLabel = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128;

const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  function onAbort() {
    clearTimeout(timer);
    reject(signal.reason);
  }
  signal?.addEventListener('abort', onAbort, { once: true });
});

export function createOwnerPairingUrl({ hostParticipantId, code, hostLabel, roomId }, baseUrl = globalThis.location?.href || 'https://replo.id/') {
  if (!ownerParticipantId(hostParticipantId) || !ownerPairingCode(code)) {
    throw new Error('Valid desktop identity and 24-character pairing code are required');
  }
  if (roomId !== undefined && roomId !== null && roomId !== '' && !ownerPairingRoomId(roomId)) {
    throw new Error('Valid desktop room hint is required');
  }
  const url = new URL('/', baseUrl);
  const params = new URLSearchParams({ pair: code, host: hostParticipantId });
  if (validLabel(hostLabel) && hostLabel.trim() !== hostParticipantId) params.set('name', hostLabel.trim());
  if (ownerPairingRoomId(roomId)) params.set('room', roomId.trim());
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
  if (rawRoom !== null && !ownerPairingRoomId(rawRoom.trim())) return null;
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
    const roomId = ownerPairingRoomId(parsed.roomId) ? parsed.roomId : null;
    return {
      hostParticipantId: parsed.hostParticipantId,
      hostLabel,
      roomId,
      pairedAt: Number.isSafeInteger(parsed.pairedAt) ? parsed.pairedAt : null
    };
  } catch {
    return null;
  }
}

/**
 * Browser-side owner pairing over WebRTC without any local address or room-token file.
 * Room hints are treated strictly as routing metadata, never authority.
 * Persists only the confirmed desktop identity and optional routing room hint; pairing codes are never stored.
 */
export function createBrowserOwnerPairing({
  storage = globalThis.localStorage,
  getChannel = () => null,
  connect = null,
  onChange = () => {},
  peerWaitMs = DEFAULT_PEER_WAIT_MS,
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

  async function findAndVerifyHostPeer(channel, hostParticipantId, targetRoomId, signal, waitMs) {
    const deadline = now() + Math.max(0, waitMs);
    const checkedBindings = new Map();
    while (!closed) {
      signal.throwIfAborted();
      const active = getChannel() || channel;
      if (!active?.transport) throw new Error('Desktop connection unavailable');
      if (targetRoomId && active.roomId && active.roomId !== targetRoomId) {
        throw new Error('Swarm connection moved away from the requested desktop room');
      }
      const existing = resolveVerifiedPeer(active, hostParticipantId);
      if (existing) return { channel: active, hostPeer: existing.hostPeer };

      const peers = typeof active.getPeers === 'function' ? active.getPeers().map(peer => peer.peerId) : [];
      const connected = typeof active.transport?.getConnectedPeers === 'function'
        ? active.transport.getConnectedPeers().map(peer => peer.id) : [];
      const candidates = [...new Set([...peers, ...connected])];
      for (const peerId of candidates) {
        signal.throwIfAborted();
        const binding = active.transport?.getPeerBinding?.(peerId);
        if (!binding) continue;
        const bindingKey = JSON.stringify(binding);
        if (checkedBindings.get(peerId) === bindingKey) continue;
        checkedBindings.set(peerId, bindingKey);
        try {
          const verified = await active.verifyPeer(peerId, signal);
          if (verified === hostParticipantId) return { channel: active, hostPeer: peerId };
        } catch { /* Continue checking other connected peers without disclosing the code. */ }
      }
      if (now() >= deadline) break;
      await delay(Math.min(PEER_POLL_MS, Math.max(1, deadline - now())), signal);
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
        roomId: pendingTarget.roomId,
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
        roomId: null,
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
        roomId: saved.roomId,
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
      roomId: saved.roomId,
      hostPeer: null,
      disclosure,
      transportPath: null,
      readyModel: null,
      pairedAt: saved.pairedAt,
      error
    });
  }

  async function pair({ hostParticipantId, code, hostLabel, roomId, signal, peerWaitMs: customWaitMs } = {}) {
    if (closed) throw new Error('Owner pairing is closed');
    if (pairing) throw new Error('Pairing is already waiting for desktop confirmation');
    if (!ownerParticipantId(hostParticipantId) || !ownerPairingCode(code)) {
      throw new Error('Enter a valid desktop ID and 24-character pairing code');
    }
    const targetRoomId = typeof roomId === 'string' && roomId.trim() ? roomId.trim() : null;
    if (targetRoomId !== null && !ownerPairingRoomId(targetRoomId)) {
      throw new Error('Desktop room hint is invalid');
    }
    const label = validLabel(hostLabel) ? hostLabel.trim() : hostParticipantId;
    const controller = new AbortController();
    activeAbort = controller;
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    pairing = true;
    pendingTarget = { hostParticipantId, hostLabel: label, roomId: targetRoomId };
    error = '';
    onChange();
    try {
      let channel = getChannel();
      const needsRoomSwitch = Boolean(targetRoomId && channel?.roomId !== targetRoomId);
      if ((!channel || needsRoomSwitch) && typeof connect === 'function') {
        await connect(targetRoomId ? { roomId: targetRoomId } : {});
        channel = getChannel();
      }
      requestSignal.throwIfAborted();
      if (!channel?.transport || typeof channel.verifyPeer !== 'function' || typeof channel.currentPeer !== 'function') {
        throw new Error('Connect to the Reploid network before pairing your desktop');
      }
      if (targetRoomId && channel.roomId && channel.roomId !== targetRoomId) {
        throw new Error('Could not reach the desktop room specified in the pairing link');
      }
      const waitBudget = Number.isSafeInteger(customWaitMs) && customWaitMs >= 0 ? customWaitMs : peerWaitMs;
      const matched = await findAndVerifyHostPeer(channel, hostParticipantId, targetRoomId, requestSignal, waitBudget);
      const confirmed = await requestOwnerPairing({
        transport: matched.channel.transport,
        verifyPeer: matched.channel.verifyPeer,
        currentPeer: matched.channel.currentPeer,
        hostPeer: matched.hostPeer,
        hostParticipantId,
        code,
        signal: AbortSignal.any([requestSignal, AbortSignal.timeout(APPROVAL_WAIT_MS)])
      });
      if (closed) throw new Error('Owner pairing is closed');
      const resolvedRoom = targetRoomId || (ownerPairingRoomId(matched.channel.roomId) ? matched.channel.roomId : null);
      saved = {
        hostParticipantId: confirmed.hostParticipantId,
        hostLabel: label,
        roomId: resolvedRoom,
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

  async function reconnect() {
    if (closed || !saved || typeof connect !== 'function') return state();
    const channel = getChannel();
    const needsRoomSwitch = Boolean(saved.roomId && channel?.roomId !== saved.roomId);
    if (!channel || needsRoomSwitch) {
      await connect(saved.roomId ? { roomId: saved.roomId } : {});
    }
    if (!closed) onChange();
    return state();
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

  return Object.freeze({ state, pair, reconnect, unpair, close });
}
