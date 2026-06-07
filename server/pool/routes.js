/**
 * @fileoverview Pool coordinator routes for receipt-backed browser inference.
 */

import express from 'express';
import poolStore from './store.js';
import { DETERMINISTIC_GENERATION_CONFIG, getPolicy, listPolicies, validateJobRequest } from './policy-router.js';
import { LAUNCH_MODEL } from './model-contract.js';
import { assignJob } from './scheduler.js';
import { verifyReceipt, verifyRequesterAcceptance } from './verifier.js';
import { awardAcceptedReceipt, calculateReceiptPoints, chargeRequester, penalizeProvider } from './points.js';
import { recordAcceptedReceipt, recordRejectedReceipt } from './reputation.js';
import { attachAuditAssignment, createCanaryChallenge, verifyCanaryResult, applyCanaryReputation } from './audits.js';
import { hashJson, sha256Hex } from './hash.js';

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const createPoolRateLimiter = ({ maxRequests = 30, bucketMs = 1000 } = {}) => {
  const buckets = new Map();
  return (req, res, next) => {
    const key = String(req.headers['x-reploid-client-id'] || req.body?.requesterId || req.body?.providerId || req.ip || 'unknown');
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + bucketMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + bucketMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > maxRequests) {
      return res.status(429).json({ error: 'pool rate limit exceeded', retryable: true });
    }
    return next();
  };
};

const publicPolicy = (policy) => ({
  policyId: policy.policyId,
  trustTier: policy.trustTier,
  allowedModels: policy.allowedModels,
  verificationLevel: policy.verificationLevel,
  redundancy: policy.redundancy,
  adaptiveRing: policy.adaptiveRing === true,
  minRingSize: policy.minRingSize || null,
  maxRingSize: policy.maxRingSize || null,
  quorum: policy.quorum || null,
  agreementField: policy.agreementField || null,
  requireCanaryEligibleProvider: policy.requireCanaryEligibleProvider,
  allowFallbackModel: policy.allowFallbackModel,
  allowServerProvider: policy.allowServerProvider,
  allowBrowserProvider: policy.allowBrowserProvider,
  deterministicGenerationConfig: policy.deterministicGenerationConfig
});

const extractBearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

const isPublicDiscoveryRoute = (req) => req.method === 'GET'
  && (req.path === '/deployment/check' || req.path === '/status' || req.path === '/policies');

const normalizeUid = (uid) => String(uid || '').replace(/[^a-z0-9_-]/gi, '_');
const roleIdForUid = (role, uid) => `${role}_${normalizeUid(uid)}`;

const authMatchesRoleId = (auth, role, roleId) => {
  if (hasCoordinatorClaim(auth)) return true;
  if (!auth?.verified || !auth.uid) return true;
  return roleId === roleIdForUid(role, auth.uid);
};

const authMatchesAnyRoleId = (auth, roles, roleId) => {
  if (!auth?.verified || !auth.uid) return true;
  return roles.some((role) => authMatchesRoleId(auth, role, roleId));
};

const requireBoundRole = (req, res, role, roleId) => {
  if (authMatchesRoleId(req.poolAuth, role, roleId)) return true;
  res.status(403).json({
    error: 'authenticated identity does not match requested pool role',
    expectedRole: role,
    requestedRoleId: roleId
  });
  return false;
};

const requireBoundAnyRole = (req, res, roles, roleId) => {
  if (authMatchesAnyRoleId(req.poolAuth, roles, roleId)) return true;
  res.status(403).json({
    error: 'authenticated identity does not match requested pool role',
    expectedRoles: roles,
    requestedRoleId: roleId
  });
  return false;
};

const hasCoordinatorClaim = (auth) => auth?.decoded?.admin === true
  || auth?.decoded?.poolCoordinator === true
  || auth?.decoded?.coordinator === true;

const providerHasLaunchModel = (provider) => (provider?.models || []).find((model) => (
  model.modelId === LAUNCH_MODEL.modelId
  && model.modelHash === LAUNCH_MODEL.modelHash
  && model.manifestHash === LAUNCH_MODEL.manifestHash
  && model.runtime === LAUNCH_MODEL.runtime
  && model.backend === LAUNCH_MODEL.backend
));

const evaluateAgreement = async ({ store, job, policy }) => {
  const currentAssignmentIds = new Set(Array.isArray(job?.assignmentIds) ? job.assignmentIds : []);
  const receiptRecords = (await store.listReceiptsForJob(job.jobId)).filter((record) => (
    currentAssignmentIds.size === 0 || currentAssignmentIds.has(record.assignmentId)
  ));
  const acceptedRecords = receiptRecords.filter((record) => record.verifierDecision?.accepted);
  const required = Number(job?.agreement?.requiredAgreement || job?.agreement?.requiredProviders || policy.redundancy || 1);
  const providerCount = Number(job?.providerCount || job?.providerIds?.length || required);
  const agreementField = job?.agreement?.agreementField || policy.agreementField || 'tokenIdsHash';
  const mode = job?.agreement?.mode || (policy.adaptiveRing ? 'ring_quorum' : 'redundant');
  if (acceptedRecords.length < required) {
    return {
      status: 'pending',
      mode,
      requiredProviders: required,
      requiredAgreement: required,
      providerCount,
      agreementField,
      acceptedReceipts: acceptedRecords.length,
      receiptHashes: acceptedRecords.map((record) => record.receiptHash)
    };
  }
  const groups = new Map();
  for (const record of acceptedRecords) {
    const primary = record.receipt?.[agreementField] || record.receipt?.tokenIdsHash || '';
    const key = `${primary}::${record.receipt?.outputHash || ''}`;
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  const matchingGroup = Array.from(groups.values()).find((group) => group.length >= required);
  if (!matchingGroup) {
    const remaining = Math.max(0, providerCount - acceptedRecords.length);
    const largestGroupSize = Math.max(0, ...Array.from(groups.values()).map((group) => group.length));
    if (largestGroupSize + remaining >= required) {
      return {
        status: 'pending',
        mode,
        reason: 'waiting for possible quorum',
        requiredProviders: required,
        requiredAgreement: required,
        providerCount,
        agreementField,
        acceptedReceipts: acceptedRecords.length,
        receiptHashes: acceptedRecords.map((record) => record.receiptHash)
      };
    }
    return {
      status: 'rejected',
      mode,
      reason: mode === 'ring_quorum' ? 'ring quorum receipts did not agree' : 'redundant receipts did not agree',
      requiredProviders: required,
      requiredAgreement: required,
      providerCount,
      agreementField,
      acceptedReceipts: acceptedRecords.length,
      receiptHashes: acceptedRecords.map((record) => record.receiptHash)
    };
  }
  return {
    status: 'accepted',
    mode,
    requiredProviders: required,
    requiredAgreement: required,
    providerCount,
    agreementField,
    acceptedReceipts: matchingGroup.length,
    receiptHash: matchingGroup[0].receiptHash,
    receiptHashes: matchingGroup.slice(0, required).map((record) => record.receiptHash),
    outputHash: matchingGroup[0].receipt?.outputHash,
    tokenIdsHash: matchingGroup[0].receipt?.tokenIdsHash
  };
};

const updateJobAfterVerifiedReceipt = async ({ store, assignment, receiptRecord, policy }) => {
  if (assignment.auditId) {
    const canary = await verifyCanaryResult({
      store,
      auditId: assignment.auditId,
      providerId: assignment.providerId,
      outputText: receiptRecord.outputText,
      tokenIds: receiptRecord.tokenIds
    });
    const reputation = await applyCanaryReputation({
      store,
      providerId: assignment.providerId,
      accepted: canary.accepted,
      reasons: canary.reasons
    });
    const penaltyEvent = canary.accepted ? null : await penalizeProvider({
      store,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId,
      receiptHash: receiptRecord.receiptHash,
      assignmentId: assignment.assignmentId,
      reason: 'canary_failed',
      points: -5,
      evidence: { reasons: canary.reasons }
    });
    await store.saveReceipt(receiptRecord.receiptHash, {
      ...receiptRecord,
      canaryDecision: canary,
      reputation,
      penaltyEvent
    });
    await store.updateAssignment(assignment.assignmentId, {
      status: canary.accepted ? 'audit_passed' : 'audit_failed',
      receiptHash: receiptRecord.receiptHash,
      canaryDecision: canary
    });
    await store.updateJob(assignment.jobId, {
      status: canary.accepted ? 'audit_passed' : 'audit_failed',
      receiptHash: receiptRecord.receiptHash,
      outputText: receiptRecord.outputText,
      canaryDecision: canary,
      retryable: !canary.accepted
    });
    return { mode: 'canary', canary, reputation };
  }

  const job = await store.getJob(assignment.jobId);
  if (Number(job?.agreement?.requiredAgreement || policy.redundancy || 1) > 1) {
    const agreement = await evaluateAgreement({ store, job, policy });
    if (agreement.status === 'accepted') {
      const representative = await store.getReceipt(agreement.receiptHash);
      await store.updateJob(assignment.jobId, {
        status: 'receipt_verified',
        receiptHash: agreement.receiptHash,
        receiptHashes: agreement.receiptHashes,
        outputText: representative?.outputText || receiptRecord.outputText,
        agreement,
        verifierDecision: { accepted: true, reasons: [], verifiedAt: new Date().toISOString(), agreement }
      });
    } else if (agreement.status === 'rejected') {
      const disagreeingReceipts = await store.listReceiptsForJob(assignment.jobId);
      const rejectedProviderIds = Array.from(new Set(disagreeingReceipts
        .filter((entry) => entry.verifierDecision?.accepted)
        .map((entry) => entry.providerId)
        .filter(Boolean)
        .concat(Array.isArray(job?.rejectedProviderIds) ? job.rejectedProviderIds : [])));
      for (const record of disagreeingReceipts.filter((entry) => entry.verifierDecision?.accepted)) {
        await recordRejectedReceipt({
          store,
          providerId: record.providerId,
          reasons: [agreement.mode === 'ring_quorum' ? 'ring quorum mismatch' : 'redundant agreement mismatch']
        });
        await penalizeProvider({
          store,
          providerId: record.providerId,
          requesterId: record.requesterId,
          receiptHash: record.receiptHash,
          assignmentId: record.assignmentId,
          reason: agreement.mode === 'ring_quorum' ? 'ring_quorum_mismatch' : 'redundant_agreement_mismatch',
          points: -2,
          evidence: { agreement }
        });
      }
      await store.updateJob(assignment.jobId, {
        status: agreement.mode === 'ring_quorum' ? 'ring_quorum_disagreement' : 'redundant_disagreement',
        reason: agreement.reason,
        retryable: true,
        receiptHashes: agreement.receiptHashes,
        rejectedProviderIds,
        agreement,
        verifierDecision: { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
      });
    } else {
      await store.updateJob(assignment.jobId, {
        status: 'awaiting_redundant_receipts',
        receiptHashes: agreement.receiptHashes,
        agreement
      });
    }
    return { mode: agreement.mode || 'redundant', agreement };
  }

  await store.updateJob(assignment.jobId, {
    status: 'receipt_verified',
    receiptHash: receiptRecord.receiptHash,
    receiptHashes: [receiptRecord.receiptHash],
    outputText: receiptRecord.outputText,
    verifierDecision: receiptRecord.verifierDecision
  });
  return { mode: 'single' };
};

const assignQueuedJobs = async ({ store, limit = 5 } = {}) => {
  if (typeof store.listJobs !== 'function') return [];
  const jobs = await store.listJobs();
  const canRetry = (job = {}) => job.status === 'queued'
    || (job.retryable === true && ['failed', 'receipt_rejected', 'redundant_disagreement', 'ring_quorum_disagreement'].includes(job.status));
  const queued = jobs
    .filter(canRetry)
    .slice(0, limit);
  const results = [];
  for (const job of queued) {
    const claimedJob = typeof store.claimJobForAssignment === 'function'
      ? await store.claimJobForAssignment(job.jobId)
      : job;
    if (!claimedJob) continue;
    const policy = getPolicy(claimedJob.policyId);
    if (!policy) {
      await store.updateJob(claimedJob.jobId, {
        status: 'failed',
        reason: 'unsupported_policy',
        retryable: false
      });
      results.push({ jobId: claimedJob.jobId, ok: false, reason: 'unsupported_policy' });
      continue;
    }
    const assignmentResult = await assignJob({ store, job: claimedJob, policy });
    if (!assignmentResult.ok) {
      await store.updateJob(claimedJob.jobId, {
        status: 'queued',
        assignmentBlockedReason: assignmentResult.reason,
        requiredProviders: assignmentResult.requiredProviders,
        eligibleProviders: assignmentResult.eligibleProviders
      });
    }
    results.push({ jobId: claimedJob.jobId, ...assignmentResult });
  }
  return results;
};

export function createPoolRouter({ store = poolStore, verifyAuthToken = null, requireAuth = false, allowCanaryCreation = false } = {}) {
  const router = express.Router();
  router.use(createPoolRateLimiter());
  router.use(asyncRoute(async (req, res, next) => {
    const authOptional = isPublicDiscoveryRoute(req);
    const routeRequiresAuth = requireAuth || store.kind === 'firestore';
    const token = extractBearerToken(req);
    if (!token) {
      if (routeRequiresAuth && !authOptional) return res.status(401).json({ error: 'Firebase auth token required' });
      req.poolAuth = { verified: false, tokenPresent: false };
      return next();
    }
    if (typeof verifyAuthToken !== 'function') {
      if (routeRequiresAuth) return res.status(503).json({ error: 'Firebase auth verifier unavailable' });
      req.poolAuth = { verified: false, tokenPresent: true };
      return next();
    }
    try {
      const decoded = await verifyAuthToken(token);
      req.poolAuth = { verified: true, tokenPresent: true, uid: decoded?.uid || null, decoded };
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Firebase auth token invalid', reason: error.message });
    }
  }));

  router.get('/policies', asyncRoute(async (req, res) => {
    return res.json({ policies: listPolicies().map(publicPolicy), launchModel: LAUNCH_MODEL });
  }));

  router.get('/status', asyncRoute(async (req, res) => {
    const storageMode = store.kind || 'unknown';
    const authVerifierConfigured = typeof verifyAuthToken === 'function';
    return res.json({
      product: 'reploid_browser_inference_pool',
      claim: 'receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference',
      storageMode,
      auth: {
        required: requireAuth || storageMode === 'firestore',
        verifierConfigured: authVerifierConfigured,
        roleBinding: true
      },
      policies: listPolicies().map(publicPolicy),
      launchModel: LAUNCH_MODEL,
      canaryCreation: {
        browserEnabled: allowCanaryCreation,
        coordinatorClaimRequired: !allowCanaryCreation
      }
    });
  }));

  router.get('/metrics', asyncRoute(async (req, res) => {
    if (req.poolAuth?.verified && !hasCoordinatorClaim(req.poolAuth)) {
      return res.status(403).json({ error: 'pool metrics require coordinator authorization' });
    }
    return res.json(await store.getMetrics());
  }));

  router.get('/deployment/check', asyncRoute(async (req, res) => {
    const metrics = await store.getMetrics();
    const storageMode = store.kind || 'unknown';
    const authVerifierConfigured = typeof verifyAuthToken === 'function';
    const productionReady = storageMode === 'firestore' && authVerifierConfigured;
    return res.json({
      ok: productionReady,
      claim: 'receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference',
      forbiddenClaims: ['trustless', 'hardware-attested', 'guaranteed honest GPU execution'],
      policies: listPolicies().map((policy) => policy.policyId),
      deterministicGenerationConfig: DETERMINISTIC_GENERATION_CONFIG,
      launchModel: LAUNCH_MODEL,
      store: {
        asyncCompatible: true,
        mode: storageMode,
        productionReady,
        productionRequirement: 'Use POOL_STORE=firestore with Firebase Admin credentials for hosted production.',
        metricsAvailable: !!metrics
      },
      identity: {
        serverAuth: {
          required: requireAuth || storageMode === 'firestore',
          explicitRequired: requireAuth,
          requiredByPersistentStore: storageMode === 'firestore',
          verifierConfigured: authVerifierConfigured,
          roleBinding: true
        },
        canaryCreation: {
          browserEnabled: allowCanaryCreation,
          coordinatorClaimRequired: !allowCanaryCreation
        },
        browserRequirement: 'Use Firebase Auth anonymous identity when available; local anonymous identity is fallback only.',
        signingKeys: 'Browser role signing keys are persisted locally per role and used for provider receipts and requester acceptance.'
      },
      metrics: hasCoordinatorClaim(req.poolAuth) ? metrics : {
        providers: metrics.providers,
        jobs: metrics.jobs,
        receipts: metrics.receipts,
        generatedAt: metrics.generatedAt,
        redacted: true
      }
    });
  }));

  router.post('/providers/register', asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (!body.providerId && req.poolAuth?.verified) {
      body.providerId = roleIdForUid('provider', req.poolAuth.uid);
    }
    if (body.providerId && !requireBoundRole(req, res, 'provider', body.providerId)) return null;
    if (!Array.isArray(body.models) || body.models.length === 0) {
      return res.status(400).json({ error: 'models are required' });
    }
    const invalidModel = body.models.find((model) => (
      !model.modelId || !model.modelHash || !model.manifestHash || model.runtime !== 'doppler' || model.backend !== 'browser-webgpu'
    ));
    if (invalidModel) {
      return res.status(400).json({
        error: 'each model must include modelId, modelHash, manifestHash, runtime=doppler, backend=browser-webgpu'
      });
    }
    if (!providerHasLaunchModel(body)) {
      return res.status(400).json({ error: 'provider must advertise the exact launch model identity' });
    }
    if (!body.publicKey) {
      return res.status(400).json({ error: 'publicKey is required' });
    }
    const provider = await store.registerProvider(body);
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

  router.post('/jobs', asyncRoute(async (req, res) => {
    await store.expireStaleAssignments();
    const validation = validateJobRequest(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ error: 'invalid job request', reasons: validation.reasons });
    }
    if (!requireBoundAnyRole(req, res, ['requester', 'agent'], req.body.requesterId)) return null;
    const job = await store.createJob({
      requesterId: req.body.requesterId,
      prompt: req.body.prompt,
      policyId: validation.policyId,
      requesterPublicKey: req.body.requesterPublicKey,
      modelRequirements: req.body.modelRequirements || {},
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
      return res.status(202).json({ job: await store.getJob(job.jobId), assignment: null, assignments: [], reason: assignmentResult.reason, requiredProviders: assignmentResult.requiredProviders, eligibleProviders: assignmentResult.eligibleProviders });
    }
    return res.json({ job: await store.getJob(job.jobId), assignment: assignmentResult.assignment, assignments: assignmentResult.assignments });
  }));

  router.get('/jobs/:jobId', asyncRoute(async (req, res) => {
    await store.expireStaleAssignments();
    const job = await store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    if (!requireBoundAnyRole(req, res, ['requester', 'agent'], job.requesterId)) return null;
    return res.json({ job });
  }));

  router.post('/assignments/:assignmentId/receipt', asyncRoute(async (req, res) => {
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    const policy = getPolicy(assignment.policyId);
    if (!policy) return res.status(400).json({ error: 'assignment policy is no longer supported' });
    if (assignment.status !== 'assigned' && assignment.status !== 'running') {
      return res.status(409).json({
        error: 'assignment is not active',
        assignmentStatus: assignment.status,
        assignmentId: assignment.assignmentId
      });
    }
    const assignmentJob = await store.getJob(assignment.jobId);
    if (assignmentJob?.status === 'accepted' || assignmentJob?.status === 'acceptance_processing' || assignmentJob?.status === 'rejected_by_requester') {
      return res.status(409).json({
        error: 'job is already finalized',
        jobId: assignment.jobId,
        jobStatus: assignmentJob.status
      });
    }
    const receipt = req.body?.receipt;
    const outputText = req.body?.outputText || '';
    const tokenIds = Array.isArray(req.body?.tokenIds) ? req.body.tokenIds : [];
    const transcript = req.body?.transcript || { outputText, tokenIds };
    const provider = await store.getProvider(assignment.providerId);
    const decision = await verifyReceipt({
      store,
      assignment,
      receipt,
      outputText,
      tokenIds,
      transcript
    });
    const receiptRecord = await store.saveReceipt(decision.receiptHash, {
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId,
      outputText,
      tokenIds,
      transcript,
      receipt,
      providerPublicKey: provider?.publicKey || null,
      verifierDecision: decision
    });
    await store.updateAssignment(assignment.assignmentId, {
      status: decision.accepted ? 'receipt_verified' : 'receipt_rejected',
      receiptHash: decision.receiptHash
    });
    await store.setProviderStatus(assignment.providerId, 'available');

    let routeDecision = null;
    if (!decision.accepted) {
      const currentJob = await store.getJob(assignment.jobId);
      await store.updateJob(assignment.jobId, {
        status: 'receipt_rejected',
        receiptHash: decision.receiptHash,
        outputText,
        verifierDecision: decision,
        retryable: true,
        rejectedProviderIds: Array.from(new Set([
          ...(Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []),
          assignment.providerId
        ].filter(Boolean)))
      });
      await recordRejectedReceipt({
        store,
        providerId: assignment.providerId,
        reasons: decision.reasons
      });
      await penalizeProvider({
        store,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId,
        receiptHash: decision.receiptHash,
        assignmentId: assignment.assignmentId,
        reason: 'receipt_rejected',
        points: -1,
        evidence: { reasons: decision.reasons }
      });
      routeDecision = {
        mode: 'receipt_rejected',
        reassignment: { drained: (await assignQueuedJobs({ store })).length }
      };
    } else {
      routeDecision = await updateJobAfterVerifiedReceipt({ store, assignment, receiptRecord, policy });
    }
    return res.status(decision.accepted ? 200 : 400).json({ receipt: receiptRecord, verifierDecision: decision, routeDecision });
  }));

  router.post('/assignments/:assignmentId/failure', asyncRoute(async (req, res) => {
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    if (assignment.status !== 'assigned' && assignment.status !== 'running') {
      return res.status(409).json({
        error: 'assignment is not active',
        assignmentStatus: assignment.status,
        assignmentId: assignment.assignmentId
      });
    }
    const reason = String(req.body?.reason || 'provider_execution_failed').slice(0, 300);
    const providerFault = req.body?.providerFault !== false;
    const currentJob = await store.getJob(assignment.jobId);
    const rejectedProviderIds = providerFault
      ? Array.from(new Set([
        ...(Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []),
        assignment.providerId
      ].filter(Boolean)))
      : (Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []);
    await store.updateAssignment(assignment.assignmentId, {
      status: 'failed',
      failureReason: reason,
      providerFault,
      failedAt: new Date().toISOString()
    });
    await store.updateJob(assignment.jobId, {
      status: 'failed',
      reason,
      retryable: true,
      rejectedProviderIds,
      providerFailure: {
        providerId: assignment.providerId,
        assignmentId: assignment.assignmentId,
        reason,
        providerFault
      }
    });
    await store.setProviderStatus(assignment.providerId, 'available');
    let reputation = await store.getReputation(assignment.providerId);
    let penalty = null;
    if (providerFault) {
      reputation = await recordRejectedReceipt({
        store,
        providerId: assignment.providerId,
        reasons: [reason]
      });
      penalty = await penalizeProvider({
        store,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId,
        assignmentId: assignment.assignmentId,
        reason: 'provider_execution_failed',
        points: -1,
        evidence: { reason }
      });
    }
    const reassignment = await assignQueuedJobs({ store });
    return res.json({
      assignment: await store.getAssignment(assignment.assignmentId),
      job: await store.getJob(assignment.jobId),
      reputation,
      penalty,
      reassignment: { drained: reassignment.length }
    });
  }));

  router.post('/receipts/:receiptHash/accept', asyncRoute(async (req, res) => {
    const receiptRecord = await store.getReceipt(req.params.receiptHash);
    if (!receiptRecord) return res.status(404).json({ error: 'receipt not found' });
    if (!receiptRecord.verifierDecision?.accepted) {
      return res.status(400).json({ error: 'receipt is not verifier-accepted' });
    }
    const job = await store.getJob(receiptRecord.jobId);
    if (job?.requesterId && !requireBoundAnyRole(req, res, ['requester', 'agent'], job.requesterId)) return null;
    if (job?.status === 'accepted' || job?.status === 'acceptance_processing' || job?.status === 'rejected_by_requester') {
      return res.status(409).json({ error: 'job already finalized', job });
    }
    const acceptancePayload = {
      ...req.body,
      accepted: req.body?.accepted === true,
      requesterId: req.body?.requesterId || receiptRecord.requesterId
    };
    const acceptanceDecision = await verifyRequesterAcceptance({
      job,
      acceptance: acceptancePayload
    });
    if (!acceptanceDecision.accepted) {
      return res.status(400).json({
        error: 'requester acceptance rejected',
        verifierDecision: acceptanceDecision
      });
    }
    if (acceptancePayload.accepted !== true) {
      const acceptance = await store.saveAcceptance(req.params.receiptHash, acceptancePayload);
      await store.saveReceipt(req.params.receiptHash, {
        ...receiptRecord,
        requesterAcceptance: acceptance,
        ledgerEvent: null
      });
      await store.updateJob(receiptRecord.jobId, {
        status: 'rejected_by_requester',
        requesterAcceptance: acceptance
      });
      return res.json({ acceptance, ledgerEvent: null, reputation: await store.getReputation(receiptRecord.providerId) });
    }

    if (job?.agreement && job.agreement.status !== 'accepted') {
      return res.status(409).json({
        error: 'selected policy has not reached an accepted final state',
        agreement: job.agreement
      });
    }
    const receiptHashes = Array.isArray(job?.agreement?.receiptHashes) && job.agreement.status === 'accepted'
      ? job.agreement.receiptHashes
      : [req.params.receiptHash];
    if (!receiptHashes.includes(req.params.receiptHash)) {
      return res.status(400).json({ error: 'receipt is not part of the accepted agreement set' });
    }
    const multiplier = 1 / receiptHashes.length;
    const agreedRecords = [];
    for (const receiptHash of receiptHashes) {
      const agreedRecord = await store.getReceipt(receiptHash);
      if (agreedRecord?.verifierDecision?.accepted) agreedRecords.push(agreedRecord);
    }
    const totalProviderPoints = agreedRecords.reduce((sum, record) => (
      sum + calculateReceiptPoints(record, { multiplier })
    ), 0);
    if (job?.maxPointSpend !== null && job?.maxPointSpend !== undefined && totalProviderPoints > Number(job.maxPointSpend)) {
      return res.status(402).json({
        error: 'accepted result exceeds requester maxPointSpend',
        maxPointSpend: job.maxPointSpend,
        requiredPoints: totalProviderPoints
      });
    }
    if (typeof store.claimJobForAcceptance === 'function') {
      const claimedJob = await store.claimJobForAcceptance(job.jobId);
      if (!claimedJob) {
        return res.status(409).json({ error: 'job acceptance was already claimed', job: await store.getJob(job.jobId) });
      }
    }
    const acceptance = await store.saveAcceptance(req.params.receiptHash, acceptancePayload);
    const ledgerEvents = [];
    const reputations = [];
    for (const agreedRecord of agreedRecords) {
      const ledgerEvent = await awardAcceptedReceipt({
        store,
        receiptRecord: agreedRecord,
        acceptance,
        multiplier,
        reason: receiptHashes.length > 1 ? 'redundant_agreement_accepted' : 'accepted_receipt'
      });
      const reputation = await recordAcceptedReceipt({
        store,
        providerId: agreedRecord.providerId,
        points: ledgerEvent.points
      });
      await store.saveReceipt(receiptHash, {
        ...agreedRecord,
        requesterAcceptance: acceptance,
        ledgerEvent,
        reputation
      });
      ledgerEvents.push(ledgerEvent);
      reputations.push(reputation);
    }
    const requesterSpendEvent = await chargeRequester({
      store,
      requesterId: job.requesterId,
      receiptHash: req.params.receiptHash,
      receiptHashes,
      points: totalProviderPoints,
      acceptance,
      reason: receiptHashes.length > 1 ? 'redundant_agreement_spend' : 'accepted_receipt_spend'
    });
    await store.updateJob(receiptRecord.jobId, {
      status: 'accepted',
      requesterAcceptance: acceptance,
      ledgerEvents,
      requesterSpendEvent,
      acceptedReceiptHashes: receiptHashes
    });
    return res.json({ acceptance, ledgerEvents, requesterSpendEvent, reputations });
  }));

  router.get('/receipts/:receiptHash', asyncRoute(async (req, res) => {
    const receipt = await store.getReceipt(req.params.receiptHash);
    if (!receipt) return res.status(404).json({ error: 'receipt not found' });
    if (req.poolAuth?.verified && !hasCoordinatorClaim(req.poolAuth)) {
      const participant = authMatchesRoleId(req.poolAuth, 'provider', receipt.providerId)
        || authMatchesAnyRoleId(req.poolAuth, ['requester', 'agent'], receipt.requesterId);
      if (!participant) return res.status(403).json({ error: 'authenticated identity is not a receipt participant' });
    }
    return res.json(receipt);
  }));

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
    const generationConfig = body.generationConfig || DETERMINISTIC_GENERATION_CONFIG;
    const modelRequirements = body.modelRequirements || {
      modelId: LAUNCH_MODEL.modelId,
      modelHash: LAUNCH_MODEL.modelHash,
      manifestHash: LAUNCH_MODEL.manifestHash,
      runtime: LAUNCH_MODEL.runtime,
      backend: LAUNCH_MODEL.backend
    };
    const audit = await createCanaryChallenge({
      store,
      providerId: body.providerId,
      prompt: body.prompt,
      expectedOutputText: body.expectedOutputText,
      expectedTokenIds: body.expectedTokenIds,
      modelRequirements,
      generationConfig,
      policyId: 'fastest_receipt',
      metadata: body.metadata || {}
    });
    const job = await store.createJob({
      requesterId: 'coordinator_audit',
      requesterPublicKey: null,
      prompt: body.prompt,
      policyId: 'fastest_receipt',
      modelRequirements,
      generationConfig,
      verificationLevel: 'canary',
      trustTier: 'T2_canary_audited',
      auditId: audit.auditId
    });
    const inputHash = sha256Hex(body.prompt);
    const generationConfigHash = hashJson(generationConfig);
    const assignment = await store.createAssignment({
      jobId: job.jobId,
      requesterId: job.requesterId,
      providerId: provider.providerId,
      modelId: model.modelId,
      policyId: 'fastest_receipt',
      inputHash,
      generationConfigHash,
      verificationLevel: 'canary',
      trustTier: 'T2_canary_audited',
      auditId: audit.auditId,
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      prompt: body.prompt,
      generationConfig,
      model: {
        id: model.modelId,
        hash: model.modelHash,
        manifestHash: model.manifestHash,
        runtime: model.runtime,
        backend: model.backend,
        requirements: modelRequirements
      }
    });
    await attachAuditAssignment({ store, auditId: audit.auditId, assignmentId: assignment.assignmentId, providerId: provider.providerId });
    await store.updateJob(job.jobId, {
      status: 'assigned',
      assignmentId: assignment.assignmentId,
      assignmentIds: [assignment.assignmentId],
      providerId: provider.providerId,
      providerIds: [provider.providerId],
      inputHash,
      generationConfigHash
    });
    return res.json({ audit: await store.getAuditChallenge(audit.auditId), job: await store.getJob(job.jobId), assignment });
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

  router.get('/points/:userId', asyncRoute(async (req, res) => {
    if (!requireBoundAnyRole(req, res, ['requester', 'agent', 'provider'], req.params.userId)) return null;
    const events = await store.listLedger(req.params.userId);
    const total = events.reduce((sum, event) => sum + Number(event.points || 0), 0);
    return res.json({ userId: req.params.userId, total, events });
  }));

  router.get('/reputation/:providerId', asyncRoute(async (req, res) => {
    return res.json(await store.getReputation(req.params.providerId));
  }));

  return router;
}

export default createPoolRouter;
