/**
 * @fileoverview Requester job submission and inspection route registration.
 *
 * This route family admits only a validated policy, exact model requirements,
 * and an approved adapter use. Scheduling remains a deterministic service.
 */

import { validateJobRequest } from '../policy-router.js';
import { assignJob } from '../scheduler.js';
import { POOL_CONFIG_HASH, POOL_CONFIG_VERSION } from '../config.js';
import { sha256Hex } from '../hash.js';
import {
  adapterRequirementFromPublication,
  publishedAdapterRequirementsEqual,
  validatePublishedAdapterRequirement,
  verifyAdapterPublication,
  verifyAdapterUseApproval
} from '../../../self/pool/adapter-publication.js';
import { verifyPoolIdentityClaims } from '../../../self/pool/identity-claims.js';
import { PARTICIPATION_CAPABILITIES } from '../../../self/pool/participation-profile.js';

export function registerJobRoutes(router, {
  store,
  asyncRoute,
  requireBoundAnyRole,
  recoverHostedAssignments
} = {}) {
  if (!router) throw new Error('job routes require an Express router');
  for (const [name, value] of Object.entries({ asyncRoute, requireBoundAnyRole, recoverHostedAssignments })) {
    if (typeof value !== 'function') throw new Error(`job routes require ${name}`);
  }

  router.post('/jobs', asyncRoute(async (req, res) => {
    await recoverHostedAssignments({ store });
    const validation = validateJobRequest(req.body || {});
    if (!validation.ok) return res.status(400).json({ error: 'invalid job request', reasons: validation.reasons });
    if (!requireBoundAnyRole(req, res, ['requester', 'agent'], req.body.requesterId)) return null;
    const requesterRole = req.body.identityProof?.role || 'requester';
    if (!['requester', 'agent'].includes(requesterRole)) {
      return res.status(400).json({ error: 'invalid requester participation role' });
    }
    const requesterIdentity = await verifyPoolIdentityClaims({
      participationProfile: req.body.participationProfile,
      identityProof: req.body.identityProof,
      role: requesterRole,
      roleId: req.body.requesterId,
      rolePublicKey: req.body.requesterPublicKey,
      requiredCapability: PARTICIPATION_CAPABILITIES.requestInference,
      allowLegacy: false
    });
    if (!requesterIdentity.ok) {
      return res.status(400).json({ error: 'invalid requester participation identity', reasons: requesterIdentity.reasons });
    }
    const sequenceInput = req.body.inputKind === 'sequence';
    const inputHash = sequenceInput ? req.body.inputHash : sha256Hex(req.body.prompt);
    const adapterRequirement = req.body.modelRequirements?.adapter || null;
    if (adapterRequirement) {
      const requirementValidation = validatePublishedAdapterRequirement(adapterRequirement);
      if (!requirementValidation.ok) {
        return res.status(400).json({ error: 'invalid published adapter requirement', reasons: requirementValidation.reasons });
      }
      const publication = await store.getAdapterPublication?.(adapterRequirement.packHash);
      if (!publication || publication.revoked === true) {
        return res.status(400).json({ error: 'adapter publication is missing or revoked' });
      }
      const publicationValidation = await verifyAdapterPublication(publication);
      if (!publicationValidation.ok) {
        return res.status(400).json({ error: 'registered adapter publication is invalid', reasons: publicationValidation.reasons });
      }
      const expected = adapterRequirementFromPublication(publication, { state: adapterRequirement.state });
      if (!publishedAdapterRequirementsEqual(adapterRequirement, expected)) {
        return res.status(400).json({ error: 'adapter requirement does not match its registered publication' });
      }
      const approval = await verifyAdapterUseApproval(req.body.adapterUseApproval, {
        adapterRequirement,
        requesterId: req.body.requesterId,
        inputHash,
        modelRequirements: req.body.modelRequirements
      });
      if (req.body.adapterUseApproval?.requesterPublicKey !== req.body.requesterPublicKey) {
        approval.reasons.push('adapter use public key does not match requester public key');
        approval.ok = false;
      }
      if (!approval.ok) return res.status(400).json({ error: 'invalid adapter use approval', reasons: approval.reasons });
    }
    const job = await store.createJob({
      requesterId: req.body.requesterId,
      prompt: sequenceInput ? null : req.body.prompt,
      inputKind: sequenceInput ? 'sequence' : 'prompt',
      inputHash,
      inputTransport: sequenceInput ? req.body.inputTransport : null,
      inputDisclosure: sequenceInput ? req.body.inputDisclosure : null,
      sequenceRequest: sequenceInput ? req.body.sequenceRequest : null,
      sequenceRequestHash: sequenceInput ? req.body.sequenceRequestHash : null,
      policyId: validation.policyId,
      policyConfigVersion: POOL_CONFIG_VERSION,
      policyConfigHash: POOL_CONFIG_HASH,
      requesterPublicKey: req.body.requesterPublicKey,
      participationProfile: req.body.participationProfile,
      identityProof: req.body.identityProof,
      modelRequirements: req.body.modelRequirements || {},
      adapterUseApproval: req.body.adapterUseApproval || null,
      generationConfig: req.body.generationConfig || {},
      maxPointSpend: req.body.maxPointSpend !== null
        && req.body.maxPointSpend !== undefined
        && Number.isFinite(Number(req.body.maxPointSpend))
        ? Number(req.body.maxPointSpend)
        : null,
      verificationLevel: validation.policy.verificationLevel,
      trustTier: validation.policy.trustTier
    });
    const assignmentResult = await assignJob({ store, job, policy: validation.policy });
    if (!assignmentResult.ok) {
      return res.status(202).json({
        job: await store.getJob(job.jobId), assignment: null, assignments: [],
        reason: assignmentResult.reason, requiredProviders: assignmentResult.requiredProviders,
        eligibleProviders: assignmentResult.eligibleProviders
      });
    }
    return res.json({ job: await store.getJob(job.jobId), assignment: assignmentResult.assignment, assignments: assignmentResult.assignments });
  }));

  router.get('/jobs/:jobId', asyncRoute(async (req, res) => {
    const recovery = await recoverHostedAssignments({ store, targetJobId: req.params.jobId });
    const job = await store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    if (!requireBoundAnyRole(req, res, ['requester', 'agent'], job.requesterId)) return null;
    return res.json({ job, assignmentRecovery: recovery.summary });
  }));
}

export default registerJobRoutes;
