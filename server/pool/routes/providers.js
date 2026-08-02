/**
 * @fileoverview Provider admission and assignment pickup route registration.
 *
 * Provider registration verifies an exact browser-WebGPU model advert and a
 * delegated participation identity. It does not qualify a model for selection
 * or establish browser or scientific promotion evidence.
 */

import { getPolicy } from '../policy-router.js';
import { isLaunchModelRequirement } from '../model-contract.js';
import { deriveProviderAdmission, runtimeProfileHash, validateRuntimeProfileForPolicy } from '../runtime-profile.js';
import {
  adapterRequirementFromPublication,
  publishedAdapterRequirementsEqual,
  validatePublishedAdapterRequirement
} from '../../../self/pool/adapter-publication.js';
import { verifyPoolIdentityClaims, verifyAdvertisedLimitsAgainstProfile } from '../../../self/pool/identity-claims.js';
import { PARTICIPATION_CAPABILITIES } from '../../../self/pool/participation-profile.js';

const providerHasLaunchModel = (provider) => (provider?.models || []).find((model) => isLaunchModelRequirement(model));

export function registerProviderRoutes(router, {
  store,
  asyncRoute,
  requireBoundRole,
  roleIdForUid,
  assignQueuedJobs
} = {}) {
  if (!router) throw new Error('provider routes require an Express router');
  for (const [name, value] of Object.entries({ asyncRoute, requireBoundRole, roleIdForUid, assignQueuedJobs })) {
    if (typeof value !== 'function') throw new Error(`provider routes require ${name}`);
  }

  router.post('/providers/register', asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (!body.providerId && req.poolAuth?.verified) body.providerId = roleIdForUid('provider', req.poolAuth.uid);
    if (body.providerId && !requireBoundRole(req, res, 'provider', body.providerId)) return null;
    if (!Array.isArray(body.models) || body.models.length === 0) return res.status(400).json({ error: 'models are required' });
    const invalidModel = body.models.find((model) => (
      !model.modelId || !model.modelHash || !model.manifestHash || model.runtime !== 'doppler' || model.backend !== 'browser-webgpu'
    ));
    if (invalidModel) {
      return res.status(400).json({
        error: 'each model must include modelId, modelHash, manifestHash, runtime=doppler, backend=browser-webgpu'
      });
    }
    if (!providerHasLaunchModel(body)) return res.status(400).json({ error: 'provider must advertise the exact launch model identity' });
    for (const model of body.models) {
      for (const requirement of model.adapterPacks || []) {
        const requirementValidation = validatePublishedAdapterRequirement(requirement);
        if (!requirementValidation.ok) {
          return res.status(400).json({ error: 'invalid provider adapter advert', reasons: requirementValidation.reasons });
        }
        const publication = await store.getAdapterPublication?.(requirement.packHash);
        if (!publication || publication.revoked === true) {
          return res.status(400).json({ error: 'provider adapter publication is missing or revoked', packHash: requirement.packHash });
        }
        const expected = adapterRequirementFromPublication(publication, { state: requirement.state });
        if (!publishedAdapterRequirementsEqual(requirement, expected)) {
          return res.status(400).json({ error: 'provider adapter advert does not match the registered publication' });
        }
      }
    }
    if (!body.publicKey) return res.status(400).json({ error: 'publicKey is required' });
    const providerIdentity = await verifyPoolIdentityClaims({
      participationProfile: body.participationProfile,
      identityProof: body.identityProof,
      role: 'provider',
      roleId: body.providerId,
      rolePublicKey: body.publicKey,
      requiredCapability: PARTICIPATION_CAPABILITIES.provideInference,
      allowLegacy: false
    });
    const providerLimits = verifyAdvertisedLimitsAgainstProfile(body.availability || {}, body.participationProfile || null);
    if (!providerIdentity.ok || !providerLimits.ok) {
      return res.status(400).json({
        error: 'invalid provider participation identity',
        reasons: [...providerIdentity.reasons, ...providerLimits.reasons]
      });
    }
    const ringPolicy = getPolicy('ring_quorum_receipt');
    const acceptsRing = (body.availability?.acceptedPolicies || []).length === 0
      || (body.availability?.acceptedPolicies || []).includes('ring_quorum_receipt');
    if (body.runtimeProfile && body.runtimeProfileHash && runtimeProfileHash(body.runtimeProfile) !== body.runtimeProfileHash) {
      return res.status(400).json({ error: 'runtimeProfileHash does not match runtimeProfile' });
    }
    const providerInput = {
      ...body,
      authUid: body.authUid || req.poolAuth?.uid || null,
      identityClusterId: body.identityClusterId || (req.poolAuth?.uid ? `auth:${req.poolAuth.uid}` : body.providerId || null),
      runtimeProfileHash: body.runtimeProfile ? runtimeProfileHash(body.runtimeProfile) : body.runtimeProfileHash || null,
      admissionPolicyId: null,
      admissionLane: null,
      ringEligible: false
    };
    if (acceptsRing && ringPolicy) {
      const runtimeProfileReasons = validateRuntimeProfileForPolicy(providerInput, ringPolicy);
      if (runtimeProfileReasons.length > 0) {
        return res.status(400).json({
          error: 'runtime profile is required for ring_quorum_receipt providers',
          reasons: runtimeProfileReasons
        });
      }
      const admission = deriveProviderAdmission({ provider: providerInput, reputation: {}, policy: ringPolicy });
      providerInput.admissionPolicyId = admission.policyId;
      providerInput.admissionLane = admission.laneId;
      providerInput.ringEligible = admission.ringEligible;
    }
    const provider = await store.registerProvider(providerInput);
    const queuedAssignments = await assignQueuedJobs({ store });
    if (queuedAssignments.length > 0 && provider?.providerId) {
      const refreshedProvider = await store.getProvider(provider.providerId) || provider;
      return res.json({ ...refreshedProvider, assignmentDrain: { drained: queuedAssignments.length } });
    }
    return res.json(provider);
  }));

  router.post('/providers/heartbeat', asyncRoute(async (req, res) => {
    if (req.body?.providerId && !requireBoundRole(req, res, 'provider', req.body.providerId)) return null;
    const heartbeat = await store.heartbeat(req.body || {});
    if (!heartbeat) return res.status(404).json({ error: 'provider session not found' });
    return res.json(heartbeat);
  }));

  router.get('/providers/assignments/next', asyncRoute(async (req, res) => {
    await store.expireStaleAssignments();
    const providerId = String(req.query.providerId || '').trim();
    if (!providerId) return res.status(400).json({ error: 'providerId is required' });
    if (!requireBoundRole(req, res, 'provider', providerId)) return null;
    let assignment = await store.nextAssignmentForProvider(providerId);
    let assignmentDrain = [];
    if (!assignment) {
      assignmentDrain = await assignQueuedJobs({ store });
      assignment = await store.nextAssignmentForProvider(providerId);
    }
    return res.json({ assignment, assignmentDrain: { drained: assignmentDrain.length } });
  }));
}

export default registerProviderRoutes;
