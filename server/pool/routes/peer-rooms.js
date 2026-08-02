/**
 * @fileoverview Bounded at-least-once peer-room relay route registration.
 *
 * Peer rooms carry rendezvous metadata only. They never carry prompts, outputs,
 * receipts, tokens, or model bytes. A relay acknowledgement proves receipt of
 * that relay record, not delivery of a computation or scientific result.
 */

import { verifyPeerMessage } from '../../../self/pool/peer-protocol.js';

const peerRoomMessageFromPeerId = (message = {}) => {
  const body = message.body || {};
  if (message.type === 'webrtc-signal') return body.fromPeerId || body.signal?.fromPeerId || null;
  if (message.type === 'peer-run-request') return body.requesterId || body.intent?.body?.requesterId || body.assignment?.requesterId || null;
  if (message.type === 'peer-run-accepted') return body.providerId || body.assignment?.providerId || null;
  if (message.type === 'provider-advert') return body.advert?.fromPeerId || body.advert?.body?.providerId || body.providerId || null;
  return body.fromPeerId
    || body.requesterId
    || body.providerId
    || body.advert?.fromPeerId
    || body.advert?.body?.providerId
    || body.intent?.fromPeerId
    || body.intent?.body?.requesterId
    || body.assignment?.requesterId
    || body.assignment?.providerId
    || body.signal?.fromPeerId
    || null;
};

const validateRelayAcknowledgement = async (body = {}, roomId) => {
  const acknowledgement = body.body || {};
  const proof = acknowledgement.proof;
  if (!proof) return 'relay acknowledgement proof is required';
  const verification = await verifyPeerMessage(proof);
  if (!verification.ok) return `relay acknowledgement proof invalid: ${verification.reasons.join('; ')}`;
  const signed = proof.body || {};
  if (proof.type !== 'heartbeat') return 'relay acknowledgement proof type is invalid';
  if (proof.fromPeerId !== acknowledgement.fromPeerId) return 'relay acknowledgement signer mismatch';
  if (signed.schema !== 'reploid.peer.relay_ack/v1') return 'relay acknowledgement proof schema is invalid';
  if (signed.roomId !== roomId) return 'relay acknowledgement room mismatch';
  if (signed.relayId !== acknowledgement.relayId) return 'relay acknowledgement relay id mismatch';
  if (Number(signed.relaySequence) !== Number(acknowledgement.relaySequence)) {
    return 'relay acknowledgement sequence mismatch';
  }
  return null;
};

const peerRoomPayloadLooksForbidden = (message = {}) => {
  const text = JSON.stringify(message || {});
  return /"prompt"\s*:|"outputText"\s*:|"tokenIds"\s*:|"receipt"\s*:|"modelShard"\s*:/i.test(text);
};

export function registerPeerRoomRoutes(router, {
  store,
  asyncRoute,
  peerRoomMessageTypes,
  maxPeerRoomPayloadBytes,
  maxPeerRoomMessagesPerPoll,
  maxPeerRoomMessageTtlMs,
  jsonByteLength,
  hashJson,
  relayPageResponse
} = {}) {
  if (!router) throw new Error('peer-room routes require an Express router');
  if (!(peerRoomMessageTypes instanceof Set)) throw new Error('peer-room routes require message types');
  for (const [name, value] of Object.entries({ asyncRoute, jsonByteLength, hashJson, relayPageResponse })) {
    if (typeof value !== 'function') throw new Error(`peer-room routes require ${name}`);
  }

  router.get('/peer/rooms', asyncRoute(async (req, res) => {
    if (typeof store?.listPeerRooms !== 'function') {
      return res.status(501).json({ error: 'peer room index is not supported by this store' });
    }
    const limit = Math.min(Number(req.query.limit || 50), 100);
    return res.json({ rooms: await store.listPeerRooms({ limit }) });
  }));

  router.post('/peer/rooms/:roomId/messages', asyncRoute(async (req, res) => {
    if (typeof store?.appendPeerRoomMessage !== 'function') {
      return res.status(501).json({ error: 'peer room relay is not supported by this store' });
    }
    const roomId = String(req.params.roomId || '').trim();
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });
    const body = req.body || {};
    if (body.peerRoomVersion !== 'reploid_peer_room/v1') return res.status(400).json({ error: 'peerRoomVersion mismatch' });
    if (body.roomId && body.roomId !== roomId) return res.status(400).json({ error: 'roomId mismatch' });
    if (!peerRoomMessageTypes.has(body.type)) return res.status(400).json({ error: 'peer room message type is not allowed' });
    if (body.type === 'relay-ack') {
      const acknowledgementError = await validateRelayAcknowledgement(body, roomId);
      if (acknowledgementError) return res.status(400).json({ error: acknowledgementError });
    }
    if (jsonByteLength(body) > maxPeerRoomPayloadBytes) {
      return res.status(413).json({ error: 'peer room message exceeds metadata size limit' });
    }
    if (peerRoomPayloadLooksForbidden(body)) {
      return res.status(400).json({ error: 'peer room relay must not carry prompt, output, receipt, token, or model payloads' });
    }
    const now = Date.now();
    const requestedExpiresAt = Number(body.relay?.expiresAt || body.expiresAt || 0);
    const maxExpiresAt = now + maxPeerRoomMessageTtlMs;
    const expiresAt = Number.isFinite(requestedExpiresAt) && requestedExpiresAt > now
      ? Math.min(requestedExpiresAt, maxExpiresAt)
      : maxExpiresAt;
    let message;
    try {
      message = await store.appendPeerRoomMessage(roomId, {
        relayId: body.relay?.relayId || body.relayId || null,
        fromPeerId: peerRoomMessageFromPeerId(body) || body.relay?.fromPeerId || body.fromPeerId || null,
        idempotencyHash: hashJson({ roomId, body }),
        message: { ...body, roomId, relay: { ...(body.relay || {}), expiresAt } },
        type: body.type,
        // Cursor ordering is server-owned because client clocks can differ and
        // concurrent relay requests may become visible out of order.
        createdAt: now,
        expiresAt
      });
    } catch (error) {
      if (error?.code === 'relay_id_conflict') return res.status(409).json({ error: error.message });
      throw error;
    }
    return res.status(201).json({ message });
  }));

  router.get('/peer/rooms/:roomId/messages', asyncRoute(async (req, res) => {
    if (typeof store?.listPeerRoomMessages !== 'function') {
      return res.status(501).json({ error: 'peer room relay is not supported by this store' });
    }
    const roomId = String(req.params.roomId || '').trim();
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });
    const messages = await store.listPeerRoomMessages(roomId, {
      after: Number(req.query.after || 0),
      afterId: String(req.query.afterId || ''),
      afterSequence: req.query.afterSequence === undefined ? null : Number(req.query.afterSequence),
      notBefore: Date.now() - maxPeerRoomMessageTtlMs,
      peerId: req.query.peerId || null,
      limit: Math.min(Number(req.query.limit || maxPeerRoomMessagesPerPoll), maxPeerRoomMessagesPerPoll)
    });
    return res.json(relayPageResponse(messages, 'relayId'));
  }));

  router.get('/peer/rooms/:roomId/summary', asyncRoute(async (req, res) => {
    if (typeof store?.listPeerRoomMessages !== 'function') {
      return res.status(501).json({ error: 'peer room relay is not supported by this store' });
    }
    const roomId = String(req.params.roomId || '').trim();
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });
    const messages = await store.listPeerRoomMessages(roomId, {
      after: 0,
      notBefore: Date.now() - maxPeerRoomMessageTtlMs,
      peerId: null,
      limit: Math.min(Number(req.query.limit || maxPeerRoomMessagesPerPoll), maxPeerRoomMessagesPerPoll)
    });
    const peers = new Set();
    const providers = new Map();
    const typeCounts = {};
    const recent = [];
    for (const record of messages) {
      const message = record.message || record;
      const type = record.type || message.type || 'unknown';
      const fromPeerId = record.fromPeerId || message.relay?.fromPeerId || peerRoomMessageFromPeerId(message);
      if (fromPeerId) peers.add(fromPeerId);
      typeCounts[type] = Number(typeCounts[type] || 0) + 1;
      const advert = message.body?.advert || null;
      const providerId = advert?.body?.providerId || advert?.fromPeerId || null;
      if (type === 'provider-advert' && providerId) {
        providers.set(providerId, {
          providerId,
          models: (advert.body?.models || []).map((model) => ({
            modelId: model.modelId || model.id || 'unknown',
            modelHash: model.modelHash || model.hash || null,
            manifestHash: model.manifestHash || null,
            runtime: model.runtime || null,
            backend: model.backend || null
          })),
          runtimeProfileHash: advert.body?.runtimeProfileHash || null,
          availability: advert.body?.availability || null
        });
      }
      recent.push({ type, fromPeerId, createdAt: record.createdAt || message.createdAt || null });
    }
    return res.json({
      roomId,
      relay: 'server',
      messageCount: messages.length,
      peerCount: peers.size,
      providerCount: providers.size,
      peers: Array.from(peers).sort(),
      providers: Array.from(providers.values()).sort((left, right) => left.providerId.localeCompare(right.providerId)),
      typeCounts,
      recent: recent.slice(-10).reverse()
    });
  }));
}

export default registerPeerRoomRoutes;
