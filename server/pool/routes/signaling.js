/**
 * @fileoverview Assignment-bound WebRTC signaling route registration.
 *
 * Cloud coordination carries only bounded signaling metadata. Prompt, output,
 * receipt, and model payloads remain outside this route family.
 */

export function registerSignalingRoutes(router, {
  store,
  asyncRoute,
  signalTypes,
  maxSignalPayloadBytes,
  maxMessagesPerPoll,
  toEpochMs,
  signalingSessionExpired,
  signalingParticipantAllowed,
  phaseProtocolForAssignment,
  boundedSignalSessionExpiry,
  requireSignalingParticipant,
  requireSignalFromPeer,
  jsonByteLength,
  hashJson,
  relayPageResponse
} = {}) {
  if (!router) throw new Error('signaling routes require an Express router');
  for (const [name, value] of Object.entries({
    asyncRoute,
    toEpochMs,
    signalingSessionExpired,
    signalingParticipantAllowed,
    phaseProtocolForAssignment,
    boundedSignalSessionExpiry,
    requireSignalingParticipant,
    requireSignalFromPeer,
    jsonByteLength,
    hashJson,
    relayPageResponse
  })) {
    if (typeof value !== 'function') throw new Error(`signaling routes require ${name}`);
  }

  router.post('/signaling/sessions', asyncRoute(async (req, res) => {
    if (typeof store?.createSignalingSession !== 'function') {
      return res.status(501).json({ error: 'signaling sessions are not supported by this store' });
    }
    const body = req.body || {};
    if (!body.assignmentId) return res.status(400).json({ error: 'assignmentId is required' });
    const assignment = await store.getAssignment(body.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (assignment.expiresAt && toEpochMs(assignment.expiresAt) < Date.now()) {
      return res.status(410).json({ error: 'assignment expired' });
    }
    if (!['assigned', 'running', 'commit_submitted', 'reveal_open', 'reveal_submitted'].includes(assignment.status)) {
      return res.status(409).json({
        error: 'assignment is not active for signaling',
        assignmentStatus: assignment.status
      });
    }
    const job = await store.getJob(assignment.jobId);
    const participantIds = Array.from(new Set([
      assignment.requesterId,
      assignment.providerId,
      ...(Array.isArray(assignment.ring?.providerIds) ? assignment.ring.providerIds : [])
    ].filter(Boolean)));
    if (!signalingParticipantAllowed(req.poolAuth, participantIds)) {
      return res.status(403).json({ error: 'authenticated identity is not a signaling session participant' });
    }
    const phaseProtocol = phaseProtocolForAssignment(assignment);
    if (assignment.ring
      && phaseProtocol?.signalingAllowedFromPhase === 'private_compute'
      && !['private_compute', 'commit_submitted', 'reveal_open', 'reveal_submitted'].includes(job?.ringPhase)) {
      return res.status(409).json({
        error: 'ring signaling is not open for assignment input',
        ringPhase: job?.ringPhase || null
      });
    }
    const session = await store.createSignalingSession({
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      policyId: assignment.policyId,
      requesterId: assignment.requesterId,
      providerId: assignment.providerId,
      participantIds,
      mode: assignment.ring ? 'ring_webrtc_datachannel' : 'requester_provider_webrtc_datachannel',
      transport: 'webrtc_datachannel',
      p2pClaim: 'assignment input may travel over WebRTC from private_compute; result evidence affects quorum only after commit-reveal; cloud stores only signaling metadata and later receipt anchors',
      signalingAllowedFromPhase: phaseProtocol?.signalingAllowedFromPhase || null,
      inputPayloadsAllowedFromPhase: phaseProtocol?.inputPayloadsAllowedFromPhase || null,
      resultEvidenceAdmissibleFromPhase: phaseProtocol?.resultEvidenceAdmissibleFromPhase || null,
      expiresAt: boundedSignalSessionExpiry({ assignment, requestedExpiresAt: body.expiresAt || null }),
      createdBy: req.body?.createdBy || assignment.requesterId,
      jobStatusAtCreate: job?.status || null
    });
    return res.status(201).json({ session });
  }));

  router.get('/signaling/sessions/:sessionId', asyncRoute(async (req, res) => {
    if (typeof store?.getSignalingSession !== 'function') {
      return res.status(501).json({ error: 'signaling sessions are not supported by this store' });
    }
    const session = await store.getSignalingSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'signaling session not found' });
    if (!requireSignalingParticipant(req, res, session)) return null;
    if (signalingSessionExpired(session)) return res.status(410).json({ error: 'signaling session expired' });
    return res.json({ session });
  }));

  router.post('/signaling/sessions/:sessionId/messages', asyncRoute(async (req, res) => {
    if (typeof store?.appendSignalMessage !== 'function') {
      return res.status(501).json({ error: 'signaling messages are not supported by this store' });
    }
    const session = await store.getSignalingSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'signaling session not found' });
    if (!requireSignalingParticipant(req, res, session)) return null;
    if (signalingSessionExpired(session)) return res.status(410).json({ error: 'signaling session expired' });
    const body = req.body || {};
    if (!body.type) return res.status(400).json({ error: 'signal type is required' });
    if (!signalTypes.has(body.type)) return res.status(400).json({ error: 'signal type is not allowed' });
    if (!body.fromPeerId) return res.status(400).json({ error: 'signal fromPeerId is required' });
    if (!requireSignalFromPeer(req, res, session, body.fromPeerId)) return null;
    if (body.toPeerId && !session.participantIds.includes(body.toPeerId)) {
      return res.status(400).json({ error: 'signal toPeerId is not a session participant' });
    }
    if (jsonByteLength(body.payload) > maxSignalPayloadBytes) {
      return res.status(413).json({ error: 'signal payload exceeds metadata size limit' });
    }
    let message;
    try {
      message = await store.appendSignalMessage(session.sessionId, {
        id: body.id || null,
        assignmentId: session.assignmentId,
        type: body.type,
        fromPeerId: body.fromPeerId,
        toPeerId: body.toPeerId || null,
        payload: body.payload ?? null,
        idempotencyHash: hashJson({
          sessionId: session.sessionId,
          id: body.id || null,
          assignmentId: session.assignmentId,
          type: body.type,
          fromPeerId: body.fromPeerId,
          toPeerId: body.toPeerId || null,
          payload: body.payload ?? null,
          createdAt: body.createdAt || null,
          expiresAt: body.expiresAt || null
        }),
        createdAt: Date.now(),
        expiresAt: body.expiresAt || null
      });
    } catch (error) {
      if (error?.code === 'relay_id_conflict') return res.status(409).json({ error: error.message });
      throw error;
    }
    return res.status(201).json({ message });
  }));

  router.get('/signaling/sessions/:sessionId/messages', asyncRoute(async (req, res) => {
    if (typeof store?.listSignalMessages !== 'function') {
      return res.status(501).json({ error: 'signaling messages are not supported by this store' });
    }
    const session = await store.getSignalingSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'signaling session not found' });
    if (!requireSignalingParticipant(req, res, session)) return null;
    if (signalingSessionExpired(session)) return res.status(410).json({ error: 'signaling session expired' });
    const peerId = req.query.peerId || null;
    if (peerId && !session.participantIds.includes(peerId)) {
      return res.status(400).json({ error: 'peerId is not a session participant' });
    }
    const messages = await store.listSignalMessages(session.sessionId, {
      after: Number(req.query.after || 0),
      afterId: String(req.query.afterId || ''),
      afterSequence: req.query.afterSequence === undefined ? null : Number(req.query.afterSequence),
      peerId,
      limit: maxMessagesPerPoll
    });
    return res.json(relayPageResponse(messages, 'id'));
  }));
}

export default registerSignalingRoutes;
