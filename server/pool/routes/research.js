/**
 * @fileoverview Public Poolday research-evidence route registration.
 *
 * This module owns the HTTP envelope only. Signed-record verification and
 * lifecycle-link validation remain in the shared evidence-network contract.
 */

import {
  researchRecordTargetHashes,
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
