/**
 * @fileoverview Public Poolday research-evidence route registration.
 *
 * This module owns the HTTP envelope only. Signed-record verification and
 * lifecycle-link validation remain in the shared evidence-network contract.
 */

import {
  projectAcceptedResearchMemory,
  projectCrossRoomSequenceEvidence,
  researchRecordTargetHashes,
  validateCrossRoomReuseOrigin,
  validateResearchRecordModelAdmission,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../../self/pool/evidence-network.js';

const MAX_RESEARCH_RECORD_BYTES = 1_000_000;

export function registerResearchRoutes(router, {
  store,
  asyncRoute,
  requireBoundRole
} = {}) {
  if (!router) throw new Error('research routes require an Express router');
  if (typeof asyncRoute !== 'function') throw new Error('research routes require asyncRoute');
  if (typeof requireBoundRole !== 'function') throw new Error('research routes require requireBoundRole');

  router.post('/research/records', asyncRoute(async (req, res) => {
    if (typeof store?.saveResearchRecord !== 'function') {
      return res.status(501).json({ error: 'research evidence registry is not supported by this store' });
    }
    const record = req.body?.record || req.body;
    if (Buffer.byteLength(JSON.stringify(record || {}), 'utf8') > MAX_RESEARCH_RECORD_BYTES) {
      return res.status(413).json({ error: 'research record exceeds the maximum size' });
    }
    const verification = await verifyResearchRecord(record);
    if (!verification.ok) return res.status(400).json({ error: 'invalid research record', reasons: verification.reasons });
    const admission = validateResearchRecordModelAdmission(record);
    if (!admission.ok) return res.status(409).json({ error: 'unadmitted research model contract', reasons: admission.reasons });
    if (!requireBoundRole(req, res, record.author.role, record.author.roleId)) return null;
    const roomRecords = typeof store.listResearchRecords === 'function'
      ? await store.listResearchRecords({ roomId: record.roomId, limit: 1000 })
      : [];
    const known = new Map(roomRecords.map((entry) => [entry.recordHash, entry]));
    for (const targetHash of researchRecordTargetHashes(record)) {
      if (known.has(targetHash)) continue;
      const target = await store.getResearchRecord?.(targetHash);
      if (target) {
        roomRecords.push(target);
        known.set(targetHash, target);
      }
    }
    const links = validateResearchRecordLinks(record, roomRecords);
    if (!links.ok) {
      return res.status(409).json({ error: 'invalid research record links', reasons: links.reasons });
    }
    const reuseContext = record.kind === 'research_prior_evidence'
      ? record.evidence?.reuseContext
      : null;
    if (reuseContext) {
      const originRecord = await store.getResearchRecord?.(reuseContext.originRecordHash);
      const originQuestion = await store.getResearchRecord?.(reuseContext.origin?.questionHash);
      const originLinks = validateCrossRoomReuseOrigin(record, originRecord, originQuestion);
      if (!originLinks.ok) {
        return res.status(409).json({ error: 'invalid cross-room reuse origin', reasons: originLinks.reasons });
      }
      const originRoomRecords = typeof store.listResearchRecords === 'function'
        ? await store.listResearchRecords({ roomId: reuseContext.origin.roomId, limit: 1000 })
        : [];
      if (!projectAcceptedResearchMemory(originRoomRecords).acceptedHashes.includes(reuseContext.originRecordHash)) {
        return res.status(409).json({
          error: 'invalid cross-room reuse origin',
          reasons: ['cross-room origin record is not active accepted decision memory']
        });
      }
    }
    const existing = await store.getResearchRecord?.(record.recordHash);
    return res.status(existing ? 200 : 201).json({
      record: existing || await store.saveResearchRecord(record)
    });
  }));

  router.get('/research/rooms/:roomId/records', asyncRoute(async (req, res) => {
    if (typeof store?.listResearchRecords !== 'function') {
      return res.status(501).json({ error: 'research evidence registry is not supported by this store' });
    }
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 250)));
    return res.json({
      roomId: req.params.roomId,
      records: await store.listResearchRecords({
        roomId: req.params.roomId,
        kind: req.query.kind || null,
        limit
      })
    });
  }));

  router.get('/research/sequences/:sequenceHash/evidence', asyncRoute(async (req, res) => {
    if (typeof store?.listResearchRecords !== 'function') {
      return res.status(501).json({ error: 'research evidence registry is not supported by this store' });
    }
    const requestedLimit = Number(req.query.limit || 1000);
    if (!Number.isFinite(requestedLimit)) {
      return res.status(400).json({ error: 'invalid sequence evidence query', reasons: ['limit must be a finite number'] });
    }
    const limit = Math.max(1, Math.min(1000, Math.floor(requestedLimit)));
    const records = await store.listResearchRecords({ limit: 1000 });
    try {
      return res.json(projectCrossRoomSequenceEvidence(records, req.params.sequenceHash, {
        currentRoomId: req.query.currentRoomId || null,
        limit
      }));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return res.status(400).json({ error: 'invalid sequence evidence query', reasons: [error.message] });
    }
  }));

  router.get('/research/records/:recordHash', asyncRoute(async (req, res) => {
    if (typeof store?.getResearchRecord !== 'function') {
      return res.status(501).json({ error: 'research evidence registry is not supported by this store' });
    }
    const record = await store.getResearchRecord(req.params.recordHash);
    if (!record) return res.status(404).json({ error: 'research record not found' });
    return res.json({ record });
  }));
}

export default registerResearchRoutes;
