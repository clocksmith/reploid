/**
 * @fileoverview Coordinator-gated audit creation and inspection routes.
 *
 * Audit challenges test declared receipt behavior. They do not establish
 * scientific correctness, biological truth, or hardware honesty.
 */

import { DETERMINISTIC_GENERATION_CONFIG } from '../policy-router.js';
import { LAUNCH_MODEL, isLaunchModelRequirement } from '../model-contract.js';
import { createCanaryChallenge, createChallengeRerun } from '../audits.js';
import { isSequenceWorkload } from '../../../self/pool/sequence-workload.js';

const providerHasLaunchModel = (provider) => (provider?.models || []).find((model) => isLaunchModelRequirement(model));

export function registerAuditRoutes(router, {
  store,
  asyncRoute,
  allowCanaryCreation,
  hasCoordinatorClaim,
  authMatchesRoleId,
  scheduleAuditExecution
} = {}) {
  if (!router) throw new Error('audit routes require an Express router');
  for (const [name, value] of Object.entries({ asyncRoute, hasCoordinatorClaim, authMatchesRoleId, scheduleAuditExecution })) {
    if (typeof value !== 'function') throw new Error(`audit routes require ${name}`);
  }

  router.post('/audits/canary', asyncRoute(async (req, res) => {
    if (!allowCanaryCreation && !hasCoordinatorClaim(req.poolAuth)) {
      return res.status(403).json({ error: 'canary creation requires coordinator authorization' });
    }
    const body = req.body || {};
    if (!body.providerId) return res.status(400).json({ error: 'providerId is required' });
    if (!body.prompt) return res.status(400).json({ error: 'prompt is required' });
    if (body.expectedOutputText === undefined) return res.status(400).json({ error: 'expectedOutputText is required' });
    const provider = await store.getProvider(body.providerId);
    if (!provider) return res.status(404).json({ error: 'provider not found' });
    const model = providerHasLaunchModel(provider);
    if (!model) return res.status(400).json({ error: 'provider does not advertise the launch model identity' });
    const audit = await createCanaryChallenge({
      store,
      providerId: body.providerId,
      prompt: body.prompt,
      expectedOutputText: body.expectedOutputText,
      expectedTokenIds: body.expectedTokenIds,
      modelRequirements: body.modelRequirements || {
        modelId: LAUNCH_MODEL.modelId,
        modelHash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash,
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend
      },
      generationConfig: body.generationConfig || DETERMINISTIC_GENERATION_CONFIG,
      policyId: 'fastest_receipt',
      metadata: body.metadata || {}
    });
    return res.json(await scheduleAuditExecution({ store, provider, model, audit }));
  }));

  router.post('/audits/challenge', asyncRoute(async (req, res) => {
    if (!allowCanaryCreation && !hasCoordinatorClaim(req.poolAuth)) {
      return res.status(403).json({ error: 'challenge creation requires coordinator authorization' });
    }
    const body = req.body || {};
    if (!body.receiptHash) return res.status(400).json({ error: 'receiptHash is required' });
    const sourceReceipt = await store.getReceipt(body.receiptHash);
    if (!sourceReceipt) return res.status(404).json({ error: 'source receipt not found' });
    const sourceJob = await store.getJob(sourceReceipt.jobId);
    if (!sourceJob) return res.status(404).json({ error: 'source job not found' });
    if (isSequenceWorkload(sourceJob.modelRequirements?.workload)) {
      return res.status(409).json({
        error: 'sequence challenge rerun requires requester-mediated peer input',
        retryable: false,
        action: 'Ask the requester to submit a new public sequence challenge through the peer-room lane. Poolday does not retain raw sequences for coordinator reruns.'
      });
    }
    const providerId = body.providerId || sourceReceipt.providerId;
    const provider = await store.getProvider(providerId);
    if (!provider) return res.status(404).json({ error: 'provider not found' });
    const model = providerHasLaunchModel(provider);
    if (!model) return res.status(400).json({ error: 'provider does not advertise the launch model identity' });
    const audit = await createChallengeRerun({ store, providerId, sourceReceipt, sourceJob, metadata: body.metadata || {} });
    return res.json(await scheduleAuditExecution({ store, provider, model, audit }));
  }));

  router.get('/audits/:auditId', asyncRoute(async (req, res) => {
    const audit = await store.getAuditChallenge(req.params.auditId);
    if (!audit) return res.status(404).json({ error: 'audit not found' });
    if (req.poolAuth?.verified && !hasCoordinatorClaim(req.poolAuth)) {
      if (!audit.providerId || !authMatchesRoleId(req.poolAuth, 'provider', audit.providerId)) {
        return res.status(403).json({ error: 'authenticated identity is not allowed to inspect this audit' });
      }
    }
    return res.json({ audit });
  }));
}

export default registerAuditRoutes;
