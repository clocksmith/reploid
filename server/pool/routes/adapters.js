/**
 * @fileoverview Poolday adapter-publication route registration.
 *
 * Adapter publication, revocation, and private artifact delivery stay separate
 * from protein model promotion. This module owns only the HTTP envelope.
 */

import {
  verifyAdapterPublication,
  verifyAdapterRevocation
} from '../../../self/pool/adapter-publication.js';
import { verifyAdapterCanaryPublication } from '../../../self/pool/adapter-canary-publication.js';

export function registerAdapterRoutes(router, {
  store,
  asyncRoute,
  requireBoundRole,
  canReadAdapterPublication,
  hasCoordinatorClaim,
  authMatchesRoleId,
  createAdapterDownloadUrl
} = {}) {
  if (!router) throw new Error('adapter routes require an Express router');
  if (typeof asyncRoute !== 'function') throw new Error('adapter routes require asyncRoute');
  if (typeof requireBoundRole !== 'function') throw new Error('adapter routes require requireBoundRole');
  if (typeof canReadAdapterPublication !== 'function') throw new Error('adapter routes require canReadAdapterPublication');
  if (typeof hasCoordinatorClaim !== 'function') throw new Error('adapter routes require hasCoordinatorClaim');
  if (typeof authMatchesRoleId !== 'function') throw new Error('adapter routes require authMatchesRoleId');

  router.post('/adapters', asyncRoute(async (req, res) => {
    if (typeof store?.saveAdapterPublication !== 'function') {
      return res.status(501).json({ error: 'adapter publication registry is not supported by this store' });
    }
    const publication = req.body?.publication || req.body;
    const verification = await verifyAdapterPublication(publication);
    if (!verification.ok) return res.status(400).json({ error: 'invalid adapter publication', reasons: verification.reasons });
    if (!requireBoundRole(req, res, 'publisher', publication.publisher.publisherId)) return null;
    const existing = await store.getAdapterPublication?.(publication.packHash);
    if (existing && existing.publicationHash !== publication.publicationHash) {
      return res.status(409).json({ error: 'adapter pack hash already has a different publication identity' });
    }
    return res.status(existing ? 200 : 201).json({
      publication: await store.saveAdapterPublication(publication)
    });
  }));

  router.post('/adapter-canaries', asyncRoute(async (req, res) => {
    if (typeof store?.saveAdapterCanaryPublication !== 'function') {
      return res.status(501).json({ error: 'adapter canary registry is not supported by this store' });
    }
    const publication = req.body?.publication || req.body;
    const verification = await verifyAdapterCanaryPublication(publication);
    if (!verification.ok) return res.status(400).json({ error: 'invalid adapter canary publication', reasons: verification.reasons });
    if (!requireBoundRole(req, res, 'publisher', publication.publisher.publisherId)) return null;
    const existing = await store.getAdapterCanaryPublication?.(publication.publicationHash);
    return res.status(existing ? 200 : 201).json({
      publication: existing || await store.saveAdapterCanaryPublication(publication)
    });
  }));

  router.get('/adapter-canaries', asyncRoute(async (req, res) => {
    if (typeof store?.listAdapterCanaryPublications !== 'function') {
      return res.status(501).json({ error: 'adapter canary registry is not supported by this store' });
    }
    return res.json({
      publications: await store.listAdapterCanaryPublications({
        canaryId: req.query.canaryId || null,
        publisherId: req.query.publisherId || null
      })
    });
  }));

  router.get('/adapter-canaries/:publicationHash', asyncRoute(async (req, res) => {
    if (typeof store?.getAdapterCanaryPublication !== 'function') {
      return res.status(501).json({ error: 'adapter canary registry is not supported by this store' });
    }
    const publication = await store.getAdapterCanaryPublication(req.params.publicationHash);
    if (!publication) return res.status(404).json({ error: 'adapter canary publication not found' });
    return res.json({ publication });
  }));

  router.get('/adapters', asyncRoute(async (req, res) => {
    if (typeof store?.listAdapterPublications !== 'function') {
      return res.status(501).json({ error: 'adapter publication registry is not supported by this store' });
    }
    const publications = await store.listAdapterPublications({
      capability: req.query.capability || null,
      publisherId: req.query.publisherId || null,
      visibility: req.query.visibility || null
    });
    return res.json({ publications: publications.filter((publication) => canReadAdapterPublication(req, publication)) });
  }));

  router.get('/adapters/:packHash', asyncRoute(async (req, res) => {
    if (typeof store?.getAdapterPublication !== 'function') {
      return res.status(501).json({ error: 'adapter publication registry is not supported by this store' });
    }
    const publication = await store.getAdapterPublication(req.params.packHash);
    if (!publication || publication.revoked === true) return res.status(404).json({ error: 'adapter publication not found' });
    if (!canReadAdapterPublication(req, publication)) {
      const assignmentId = String(req.query.assignmentId || '').trim();
      const assignment = assignmentId ? await store.getAssignment?.(assignmentId) : null;
      const requirement = assignment?.adapter || assignment?.model?.requirements?.adapter;
      if (!assignment || requirement?.packHash !== publication.packHash) {
        return res.status(404).json({ error: 'adapter publication not found' });
      }
      if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    }
    return res.json({ publication });
  }));

  router.post('/adapters/:packHash/download', asyncRoute(async (req, res) => {
    if (typeof store?.getAdapterPublication !== 'function') {
      return res.status(501).json({ error: 'adapter publication registry is not supported by this store' });
    }
    if (typeof createAdapterDownloadUrl !== 'function') {
      return res.status(503).json({ error: 'private adapter delivery signer is not configured' });
    }
    const publication = await store.getAdapterPublication(req.params.packHash);
    if (!publication || publication.revoked === true) return res.status(404).json({ error: 'adapter publication not found' });
    if (!canReadAdapterPublication(req, publication)
      && !['private', 'entitled'].includes(publication.visibility)) {
      return res.status(404).json({ error: 'adapter publication not found' });
    }
    const assignmentId = String(req.body?.assignmentId || '').trim();
    let assignment = null;
    if (!hasCoordinatorClaim(req.poolAuth)
      && !authMatchesRoleId(req.poolAuth, 'publisher', publication.publisher?.publisherId)) {
      if (!assignmentId) return res.status(400).json({ error: 'assignmentId is required for adapter delivery' });
      assignment = await store.getAssignment?.(assignmentId);
      const requirement = assignment?.adapter || assignment?.model?.requirements?.adapter;
      if (!assignment || requirement?.packHash !== publication.packHash) {
        return res.status(403).json({ error: 'assignment does not authorize this adapter artifact' });
      }
      if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    }
    const origin = publication.pack?.distribution?.primaryOrigin;
    if (!origin || JSON.stringify(req.body?.origin) !== JSON.stringify(origin)) {
      return res.status(409).json({ error: 'adapter primary origin identity mismatch' });
    }
    const delivery = await createAdapterDownloadUrl({ publication, origin, assignment, auth: req.poolAuth });
    if (JSON.stringify(delivery?.origin) !== JSON.stringify(origin)) {
      return res.status(500).json({ error: 'adapter signer returned a different origin identity' });
    }
    return res.json(delivery);
  }));

  router.post('/adapters/:packHash/revoke', asyncRoute(async (req, res) => {
    if (typeof store?.revokeAdapterPublication !== 'function') {
      return res.status(501).json({ error: 'adapter publication registry is not supported by this store' });
    }
    const publication = await store.getAdapterPublication?.(req.params.packHash);
    if (!publication) return res.status(404).json({ error: 'adapter publication not found' });
    if (!requireBoundRole(req, res, 'publisher', publication.publisher?.publisherId)) return null;
    const revocation = req.body?.revocation || req.body;
    const verification = await verifyAdapterRevocation(revocation, publication);
    if (!verification.ok) return res.status(400).json({ error: 'invalid adapter revocation', reasons: verification.reasons });
    return res.json({ publication: await store.revokeAdapterPublication(req.params.packHash, revocation) });
  }));
}

export default registerAdapterRoutes;
