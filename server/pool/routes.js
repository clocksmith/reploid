/**
 * @fileoverview Pool coordinator routes for receipt-backed browser inference.
 */

import express from 'express';
import poolStore from './store.js';
import { DETERMINISTIC_GENERATION_CONFIG, getPolicy, listPolicies, validateJobRequest } from './policy-router.js';
import { LAUNCH_MODEL, isLaunchModelRequirement } from './model-contract.js';
import { assignJob } from './scheduler.js';
import { verifyReceipt, verifyRequesterAcceptance } from './verifier.js';
import { awardAcceptedReceipt, calculateReceiptPoints, chargeRequester, penalizeProvider } from './points.js';
import { recordAcceptedReceipt, recordRejectedReceipt } from './reputation.js';
import { attachAuditAssignment, createCanaryChallenge, verifyCanaryResult, applyCanaryReputation } from './audits.js';
import { hashJson, sha256Hex } from './hash.js';
import { POOL_CONFIG, POOL_CONFIG_HASH, POOL_CONFIG_VERSION, getLedgerReasons, getRingPhaseProtocol, validatePoolConfig } from './config.js';
import { buildCommitmentHash, revealMatchesCommitment, validateCommitmentInput, validateRevealInput } from './commit-reveal.js';
import { deriveProviderAdmission, runtimeProfileHash, validateRuntimeProfileForPolicy } from './runtime-profile.js';

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
  policyTrustTier: policy.policyTrustTier || policy.trustTier,
  allowedModels: policy.allowedModels,
  verificationLevel: policy.verificationLevel,
  redundancy: policy.redundancy,
  adaptiveRing: policy.adaptiveRing === true,
  minRingSize: policy.minRingSize || null,
  maxRingSize: policy.maxRingSize || null,
  quorum: policy.quorum || null,
  agreementField: policy.agreementField || null,
  agreementMode: policy.agreementMode || null,
  determinismProfileId: policy.determinismProfileId || null,
  ringPhaseProtocolId: policy.ringPhaseProtocolId || null,
  providerAdmissionPolicyId: policy.providerAdmissionPolicyId || null,
  stateModeId: policy.stateModeId || null,
  evidence: policy.evidence || null,
  effectiveTrustByRingSize: policy.effectiveTrustByRingSize || null,
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

const isPublicDiscoveryRoute = (req) => (
  req.path === '/peer/rooms'
  || req.path.startsWith('/peer/rooms/')
  || (req.method === 'GET'
    && (req.path === '/deployment/check' || req.path === '/status' || req.path === '/policies' || req.path === '/config'))
);

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

const signalingRoles = Object.freeze(['requester', 'agent', 'provider']);

const signalingParticipantAllowed = (auth, participantIds = []) => {
  if (!auth?.verified || !auth.uid) return true;
  if (hasCoordinatorClaim(auth)) return true;
  return participantIds.some((participantId) => authMatchesAnyRoleId(auth, signalingRoles, participantId));
};

const requireSignalingParticipant = (req, res, session) => {
  if (signalingParticipantAllowed(req.poolAuth, session?.participantIds || [])) return true;
  res.status(403).json({ error: 'authenticated identity is not a signaling session participant' });
  return false;
};

const requireSignalFromPeer = (req, res, session, fromPeerId) => {
  const participantIds = session?.participantIds || [];
  if (!participantIds.includes(fromPeerId)) {
    res.status(400).json({ error: 'signal fromPeerId is not a session participant' });
    return false;
  }
  if (!req.poolAuth?.verified || !req.poolAuth.uid || hasCoordinatorClaim(req.poolAuth)) return true;
  if (authMatchesAnyRoleId(req.poolAuth, signalingRoles, fromPeerId)) return true;
  res.status(403).json({ error: 'authenticated identity does not match signal fromPeerId' });
  return false;
};

const providerHasLaunchModel = (provider) => (provider?.models || []).find((model) => isLaunchModelRequirement(model));

const activeAssignmentStatuses = new Set(['assigned', 'running', 'commit_submitted', 'reveal_open', 'reveal_submitted']);
const finalizedJobStatuses = new Set(['accepted', 'acceptance_processing', 'rejected_by_requester']);
const activeTransportConfig = POOL_CONFIG.transportModes?.[POOL_CONFIG.activeTransportMode] || {};
const deploymentSignalingConfig = POOL_CONFIG.deployment?.signaling || {};
const SIGNAL_TYPES = new Set(activeTransportConfig.signalingAllowedTypes || []);
const MAX_SIGNAL_PAYLOAD_BYTES = Number(process.env.POOL_MAX_SIGNAL_PAYLOAD_BYTES || deploymentSignalingConfig.maxPayloadBytes || 64 * 1024);
const MAX_SIGNAL_MESSAGES_PER_POLL = Number(process.env.POOL_MAX_SIGNAL_MESSAGES_PER_POLL || deploymentSignalingConfig.maxMessagesPerPoll || 100);
const MAX_SIGNAL_SESSION_TTL_MS = Number(process.env.POOL_SIGNAL_SESSION_TTL_MS || deploymentSignalingConfig.sessionTtlMs || 10 * 60 * 1000);
const MAX_PEER_ROOM_PAYLOAD_BYTES = Number(process.env.POOL_MAX_PEER_ROOM_PAYLOAD_BYTES || deploymentSignalingConfig.maxPeerRoomPayloadBytes || 64 * 1024);
const MAX_PEER_ROOM_MESSAGES_PER_POLL = Number(process.env.POOL_MAX_PEER_ROOM_MESSAGES_PER_POLL || deploymentSignalingConfig.maxPeerRoomMessagesPerPoll || 100);
const MAX_PEER_ROOM_MESSAGE_TTL_MS = Number(process.env.POOL_PEER_ROOM_MESSAGE_TTL_MS || deploymentSignalingConfig.peerRoomMessageTtlMs || 2 * 60 * 1000);
const PEER_ROOM_MESSAGE_TYPES = new Set([
  'provider-advert-request',
  'provider-advert',
  'peer-run-request',
  'peer-run-accepted',
  'webrtc-signal'
]);

const jsonByteLength = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

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

const peerRoomPayloadLooksForbidden = (message = {}) => {
  const text = JSON.stringify(message || {});
  return /"prompt"\s*:|"outputText"\s*:|"tokenIds"\s*:|"receipt"\s*:|"modelShard"\s*:/i.test(text);
};

const toEpochMs = (value) => {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const configuredEnvValue = (...names) => names
  .map((name) => process.env[name])
  .find((value) => {
    const normalized = String(value || '').trim();
    return normalized && !normalized.startsWith('<required-');
  }) || null;

const signalingSessionExpired = (session = {}) => (
  session?.expiresAt && toEpochMs(session.expiresAt) < Date.now()
);

const boundedSignalSessionExpiry = ({ assignment, requestedExpiresAt = null } = {}) => {
  const now = Date.now();
  const candidates = [
    now + MAX_SIGNAL_SESSION_TTL_MS,
    requestedExpiresAt ? toEpochMs(requestedExpiresAt) : null,
    assignment?.expiresAt ? toEpochMs(assignment.expiresAt) : null
  ].filter((value) => Number.isFinite(value) && value > now);
  return new Date(Math.min(...candidates)).toISOString();
};

const assignmentMatchesCurrentJobAttempt = (assignment = {}, job = {}) => {
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  if (currentAssignmentIds.size > 0 && !currentAssignmentIds.has(assignment.assignmentId)) return false;
  if (job.assignmentAttemptId !== undefined
    && assignment.assignmentAttemptId !== undefined
    && Number(job.assignmentAttemptId) !== Number(assignment.assignmentAttemptId)) {
    return false;
  }
  if (job.ringAttemptId
    && assignment.ringAttemptId
    && job.ringAttemptId !== assignment.ringAttemptId) {
    return false;
  }
  return true;
};

const currentReceiptsForJob = async (store, job = {}) => {
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  return (await store.listReceiptsForJob(job.jobId)).filter((record) => {
    if (currentAssignmentIds.size > 0 && !currentAssignmentIds.has(record.assignmentId)) return false;
    if (job.assignmentAttemptId !== undefined
      && record.assignmentAttemptId !== undefined
      && Number(job.assignmentAttemptId) !== Number(record.assignmentAttemptId)) {
      return false;
    }
    if (job.ringAttemptId && record.ringAttemptId && job.ringAttemptId !== record.ringAttemptId) return false;
    return true;
  });
};

const currentFailedAssignmentIds = (job = {}) => {
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  return new Set((Array.isArray(job.failedAssignmentIds) ? job.failedAssignmentIds : []).filter((assignmentId) => (
    currentAssignmentIds.size === 0 || currentAssignmentIds.has(assignmentId)
  )));
};

const currentCommitmentsForJob = async (store, job = {}) => {
  if (typeof store.listCommitmentsForJob !== 'function') return [];
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  return (await store.listCommitmentsForJob(job.jobId)).filter((record) => {
    if (currentAssignmentIds.size > 0 && !currentAssignmentIds.has(record.assignmentId)) return false;
    if (job.assignmentAttemptId !== undefined
      && record.assignmentAttemptId !== undefined
      && Number(job.assignmentAttemptId) !== Number(record.assignmentAttemptId)) {
      return false;
    }
    if (job.ringAttemptId && record.ringAttemptId && job.ringAttemptId !== record.ringAttemptId) return false;
    return true;
  });
};

const currentRevealsForJob = async (store, job = {}) => {
  if (typeof store.listRevealsForJob !== 'function') return [];
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  return (await store.listRevealsForJob(job.jobId)).filter((record) => {
    if (currentAssignmentIds.size > 0 && !currentAssignmentIds.has(record.assignmentId)) return false;
    if (job.assignmentAttemptId !== undefined
      && record.assignmentAttemptId !== undefined
      && Number(job.assignmentAttemptId) !== Number(record.assignmentAttemptId)) {
      return false;
    }
    if (job.ringAttemptId && record.ringAttemptId && job.ringAttemptId !== record.ringAttemptId) return false;
    return true;
  });
};

const phaseProtocolForAssignment = (assignment = {}) => (
  assignment?.ring?.ringPhaseProtocolId ? getRingPhaseProtocol(assignment.ring.ringPhaseProtocolId) : null
);

const commitmentBarrierReached = async ({ store, job, assignment } = {}) => {
  const protocol = phaseProtocolForAssignment(assignment);
  if (!protocol) return { reached: true, commitments: [], required: 0 };
  const commitments = await currentCommitmentsForJob(store, job);
  const required = protocol.minCommitments === 'requiredAgreement'
    ? Number(job?.agreement?.requiredAgreement || assignment?.requiredAgreement || 1)
    : Number(protocol.minCommitments || job?.agreement?.requiredAgreement || assignment?.requiredAgreement || 1);
  return {
    reached: commitments.length >= required,
    commitments,
    required
  };
};

const ensureAgreementCommitRevealReady = async ({ store, job, agreedRecords = [] } = {}) => {
  const reasons = [];
  if (job?.agreement?.mode !== 'ring_quorum') return reasons;
  const protocol = job?.ring?.ringPhaseProtocolId ? getRingPhaseProtocol(job.ring.ringPhaseProtocolId) : null;
  if (!protocol?.requireCommitmentForLedgerAward) return reasons;
  for (const record of agreedRecords) {
    const commitment = await store.getAssignmentCommitment?.(record.assignmentId);
    const reveal = await store.getAssignmentReveal?.(record.assignmentId);
    if (!commitment) reasons.push(`commitment missing for ${record.assignmentId}`);
    if (!reveal) reasons.push(`reveal missing for ${record.assignmentId}`);
    if (commitment && reveal) {
      const match = revealMatchesCommitment({ commitment, reveal });
      if (!match.ok) reasons.push(`reveal commitment mismatch for ${record.assignmentId}`);
    }
  }
  return reasons;
};

const statusForPendingAgreement = (agreement = {}) => (
  agreement.mode === 'ring_quorum' ? 'awaiting_ring_quorum_receipts' : 'awaiting_redundant_receipts'
);

const statusForRejectedAgreement = (agreement = {}) => (
  agreement.mode === 'ring_quorum' ? 'ring_quorum_disagreement' : 'redundant_disagreement'
);

const mismatchReasonForAgreement = (agreement = {}) => (
  agreement.mode === 'ring_quorum' ? 'ring quorum mismatch' : 'redundant agreement mismatch'
);

const penaltyReasonForAgreement = (agreement = {}) => (
  getLedgerReasons(agreement.mode || 'redundant').mismatchPenalty || 'receipt_rejected'
);

const acceptedLedgerReasonForJob = (job = {}, receiptCount = 1) => {
  if (receiptCount <= 1) return getLedgerReasons('single').award || 'accepted_receipt';
  return getLedgerReasons(job?.agreement?.mode || 'redundant').award || 'accepted_receipt';
};

const spendLedgerReasonForJob = (job = {}, receiptCount = 1) => {
  if (receiptCount <= 1) return getLedgerReasons('single').spend || 'accepted_receipt_spend';
  return getLedgerReasons(job?.agreement?.mode || 'redundant').spend || 'accepted_receipt_spend';
};

const compactAgreementForAcceptance = (agreement = null) => {
  if (!agreement) return null;
  return {
    mode: agreement.mode || null,
    status: agreement.status || null,
    requiredAgreement: Number(agreement.requiredAgreement || agreement.requiredProviders || 1),
    providerCount: Number(agreement.providerCount || 1),
    agreementField: agreement.agreementField || 'tokenIdsHash',
    outputHash: agreement.outputHash || null,
    tokenIdsHash: agreement.tokenIdsHash || null,
    vectorHash: agreement.vectorHash || null,
    effectiveTrustTier: agreement.effectiveTrustTier || null
  };
};

const buildAcceptanceSummary = async ({ store, job, receiptHash } = {}) => {
  const receiptHashes = Array.isArray(job?.agreement?.receiptHashes) && job.agreement.status === 'accepted'
    ? job.agreement.receiptHashes
    : [receiptHash];
  const agreedRecords = [];
  for (const currentReceiptHash of receiptHashes) {
    const agreedRecord = await store.getReceipt(currentReceiptHash);
    if (agreedRecord?.verifierDecision?.accepted) agreedRecords.push(agreedRecord);
  }
  const multiplier = 1 / Math.max(1, receiptHashes.length);
  const providerPoints = [];
  for (const record of agreedRecords) {
    const provider = await store.getProvider?.(record.providerId);
    const reputation = await store.getReputation?.(record.providerId);
    const admission = deriveProviderAdmission({
      provider: provider || {},
      reputation: reputation || {},
      policy: getPolicy(job?.policyId) || {}
    });
    const uncappedPoints = calculateReceiptPoints(record, { multiplier });
    const cap = record.providerAdmission?.earningsCapPerAcceptance ?? admission?.lane?.earningsCapPerAcceptance;
    providerPoints.push({
      receiptHash: record.receiptHash,
      providerId: record.providerId,
      points: Number.isFinite(Number(cap)) ? Math.min(uncappedPoints, Number(cap)) : uncappedPoints
    });
  }
  const pointSpend = providerPoints.reduce((sum, entry) => sum + entry.points, 0);
  const payload = {
    jobId: job?.jobId || null,
    requesterId: job?.requesterId || null,
    policyId: job?.policyId || null,
    policyConfigVersion: job?.policyConfigVersion || POOL_CONFIG_VERSION,
    policyConfigHash: job?.policyConfigHash || POOL_CONFIG_HASH,
    receiptHash,
    receiptHashes,
    agreement: compactAgreementForAcceptance(job?.agreement || null),
    pointSpend,
    providerPoints
  };
  return {
    ...payload,
    agreementHash: hashJson(payload),
    agreedRecords,
    multiplier,
    totalProviderPoints: pointSpend
  };
};

const retireSupersededAssignments = async ({ store, job, agreement } = {}) => {
  const currentAssignmentIds = Array.isArray(job?.assignmentIds) ? job.assignmentIds : [];
  if (currentAssignmentIds.length === 0 || agreement?.status !== 'accepted') return [];
  const acceptedReceiptHashes = new Set(Array.isArray(agreement.receiptHashes) ? agreement.receiptHashes : []);
  const receiptRecords = await currentReceiptsForJob(store, job);
  const acceptedAssignmentIds = new Set(receiptRecords
    .filter((record) => acceptedReceiptHashes.has(record.receiptHash))
    .map((record) => record.assignmentId)
    .filter(Boolean));
  const supersededAssignmentIds = [];
  for (const assignmentId of currentAssignmentIds) {
    if (acceptedAssignmentIds.has(assignmentId)) continue;
    const sibling = await store.getAssignment(assignmentId);
    if (!sibling || !activeAssignmentStatuses.has(sibling.status)) continue;
    await store.updateAssignment(assignmentId, {
      status: 'superseded',
      supersededByReceiptHashes: Array.from(acceptedReceiptHashes),
      supersededAt: new Date().toISOString()
    });
    if (sibling.providerId) await store.setProviderStatus(sibling.providerId, 'available');
    supersededAssignmentIds.push(assignmentId);
  }
  return supersededAssignmentIds;
};

const evaluateAgreement = async ({ store, job, policy }) => {
  const currentAssignmentIds = new Set(Array.isArray(job?.assignmentIds) ? job.assignmentIds : []);
  const receiptRecords = await currentReceiptsForJob(store, job);
  const commitmentRecords = await currentCommitmentsForJob(store, job);
  const revealRecords = await currentRevealsForJob(store, job);
  const acceptedRecords = receiptRecords.filter((record) => record.verifierDecision?.accepted);
  const rejectedRecords = receiptRecords.filter((record) => record.verifierDecision && !record.verifierDecision.accepted);
  const failedAssignmentIds = currentFailedAssignmentIds(job);
  const blockedAssignmentIds = new Set([
    ...receiptRecords.map((record) => record.assignmentId).filter(Boolean),
    ...failedAssignmentIds
  ]);
  const required = Number(job?.agreement?.requiredAgreement || job?.agreement?.requiredProviders || policy.redundancy || 1);
  const providerCount = Number(job?.providerCount || job?.providerIds?.length || required);
  const agreementField = job?.agreement?.agreementField || policy.agreementField || 'tokenIdsHash';
  const mode = job?.agreement?.mode || (policy.adaptiveRing ? 'ring_quorum' : 'redundant');
  const groups = new Map();
  for (const record of acceptedRecords) {
    const primary = record.receipt?.[agreementField] || record.receipt?.tokenIdsHash || '';
    const key = `${primary}::${record.receipt?.outputHash || ''}`;
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  const matchingGroup = Array.from(groups.values()).find((group) => group.length >= required);
  const receiptHashes = acceptedRecords.map((record) => record.receiptHash);
  const rejectedReceiptHashes = rejectedRecords.map((record) => record.receiptHash);
  const failedAssignments = Array.from(failedAssignmentIds);
  const largestGroupSize = Math.max(0, ...Array.from(groups.values()).map((group) => group.length));
  const remainingProviders = Math.max(0, providerCount - blockedAssignmentIds.size);
  const base = {
    mode,
    requiredProviders: required,
    requiredAgreement: required,
    providerCount,
    agreementField,
    acceptedReceipts: acceptedRecords.length,
    rejectedReceipts: rejectedRecords.length,
    commitments: commitmentRecords.length,
    reveals: revealRecords.length,
    commitmentHashes: commitmentRecords.map((record) => record.commitmentHash),
    failedAssignments: failedAssignments.length,
    remainingProviders,
    receiptHashes,
    rejectedReceiptHashes,
    failedAssignmentIds: failedAssignments,
    effectiveTrustTier: job?.effectiveTrustTier || job?.trustTier || policy.trustTier
  };
  if (matchingGroup) {
    const agreementValue = matchingGroup[0].receipt?.[agreementField] || matchingGroup[0].receipt?.tokenIdsHash || null;
    return {
      ...base,
      status: 'accepted',
      acceptedReceipts: matchingGroup.length,
      receiptHash: matchingGroup[0].receiptHash,
      receiptHashes: matchingGroup.slice(0, required).map((record) => record.receiptHash),
      outputHash: matchingGroup[0].receipt?.outputHash,
      tokenIdsHash: matchingGroup[0].receipt?.tokenIdsHash,
      vectorHash: matchingGroup[0].receipt?.vectorHash || null,
      agreementValue
    };
  }
  if (largestGroupSize + remainingProviders >= required) {
    return {
      ...base,
      status: 'pending',
      reason: mode === 'ring_quorum' ? 'waiting for possible ring quorum' : 'waiting for possible redundant agreement'
    };
  }
  return {
    ...base,
    status: 'rejected',
    reason: mode === 'ring_quorum' ? 'ring quorum receipts cannot reach quorum' : 'redundant receipts cannot reach agreement'
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
      const supersededAssignmentIds = await retireSupersededAssignments({ store, job, agreement });
      await store.updateJob(assignment.jobId, {
        status: 'receipt_verified',
        receiptHash: agreement.receiptHash,
        receiptHashes: agreement.receiptHashes,
        outputText: representative?.outputText || receiptRecord.outputText,
        trustTier: agreement.effectiveTrustTier,
        effectiveTrustTier: agreement.effectiveTrustTier,
        agreement,
        supersededAssignmentIds,
        verifierDecision: { accepted: true, reasons: [], verifiedAt: new Date().toISOString(), agreement }
      });
    } else if (agreement.status === 'rejected') {
      const disagreeingReceipts = await currentReceiptsForJob(store, job);
      const rejectedProviderIds = Array.from(new Set(disagreeingReceipts
        .filter((entry) => entry.verifierDecision?.accepted)
        .map((entry) => entry.providerId)
        .filter(Boolean)
        .concat(Array.isArray(job?.rejectedProviderIds) ? job.rejectedProviderIds : [])));
      for (const record of disagreeingReceipts.filter((entry) => entry.verifierDecision?.accepted)) {
        await recordRejectedReceipt({
          store,
          providerId: record.providerId,
          reasons: [mismatchReasonForAgreement(agreement)]
        });
        await penalizeProvider({
          store,
          providerId: record.providerId,
          requesterId: record.requesterId,
          receiptHash: record.receiptHash,
          assignmentId: record.assignmentId,
          reason: penaltyReasonForAgreement(agreement),
          points: -2,
          evidence: { agreement }
        });
      }
      await store.updateJob(assignment.jobId, {
        status: statusForRejectedAgreement(agreement),
        reason: agreement.reason,
        retryable: true,
        receiptHashes: agreement.receiptHashes,
        rejectedReceiptHashes: agreement.rejectedReceiptHashes,
        failedAssignmentIds: agreement.failedAssignmentIds,
        rejectedProviderIds,
        agreement,
        verifierDecision: { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
      });
    } else {
      await store.updateJob(assignment.jobId, {
        status: statusForPendingAgreement(agreement),
        receiptHashes: agreement.receiptHashes,
        rejectedReceiptHashes: agreement.rejectedReceiptHashes,
        failedAssignmentIds: agreement.failedAssignmentIds,
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
    return res.json({
      configVersion: POOL_CONFIG_VERSION,
      configHash: POOL_CONFIG_HASH,
      policies: listPolicies().map(publicPolicy),
      launchModel: LAUNCH_MODEL
    });
  }));

  router.get('/config', asyncRoute(async (req, res) => {
    return res.json({
      configVersion: POOL_CONFIG_VERSION,
      configHash: POOL_CONFIG_HASH,
      config: POOL_CONFIG
    });
  }));

  router.get('/status', asyncRoute(async (req, res) => {
    const storageMode = store.kind || 'unknown';
    const authVerifierConfigured = typeof verifyAuthToken === 'function';
    return res.json({
      product: 'reploid_browser_inference_pool',
      claim: 'receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference',
      configVersion: POOL_CONFIG_VERSION,
      configHash: POOL_CONFIG_HASH,
      storageMode,
      transport: {
        controlPlane: 'cloud_run_firestore',
        payloadMode: 'hybrid_p2p_anchor',
        signaling: 'assignment_bound_metadata_only',
        offloadedModelArtifacts: true,
        modelArtifactBaseConfigured: Boolean(process.env.REPLOID_POOL_MODEL_BASE_URL || process.env.POOL_MODEL_BASE_URL)
      },
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

  router.post('/signaling/sessions', asyncRoute(async (req, res) => {
    if (typeof store.createSignalingSession !== 'function') {
      return res.status(501).json({ error: 'signaling sessions are not supported by this store' });
    }
    const body = req.body || {};
    if (!body.assignmentId) return res.status(400).json({ error: 'assignmentId is required' });
    const assignment = await store.getAssignment(body.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (assignment.expiresAt && toEpochMs(assignment.expiresAt) < Date.now()) {
      return res.status(410).json({ error: 'assignment expired' });
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
      && phaseProtocol?.p2pPayloadsAllowedAfterPhase === 'reveal_open'
      && job?.ringPhase !== 'reveal_open'
      && job?.ringPhase !== 'reveal_submitted') {
      return res.status(409).json({
        error: 'ring p2p payload transport is locked until reveal_open',
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
      p2pClaim: 'prompt/output/full receipt payloads should travel over WebRTC; cloud stores only signaling metadata and later receipt anchors',
      expiresAt: boundedSignalSessionExpiry({ assignment, requestedExpiresAt: body.expiresAt || null }),
      createdBy: req.body?.createdBy || assignment.requesterId,
      jobStatusAtCreate: job?.status || null
    });
    return res.status(201).json({ session });
  }));

  router.get('/signaling/sessions/:sessionId', asyncRoute(async (req, res) => {
    if (typeof store.getSignalingSession !== 'function') {
      return res.status(501).json({ error: 'signaling sessions are not supported by this store' });
    }
    const session = await store.getSignalingSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'signaling session not found' });
    if (!requireSignalingParticipant(req, res, session)) return null;
    if (signalingSessionExpired(session)) return res.status(410).json({ error: 'signaling session expired' });
    return res.json({ session });
  }));

  router.post('/signaling/sessions/:sessionId/messages', asyncRoute(async (req, res) => {
    if (typeof store.appendSignalMessage !== 'function') {
      return res.status(501).json({ error: 'signaling messages are not supported by this store' });
    }
    const session = await store.getSignalingSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'signaling session not found' });
    if (!requireSignalingParticipant(req, res, session)) return null;
    if (signalingSessionExpired(session)) return res.status(410).json({ error: 'signaling session expired' });
    const body = req.body || {};
    if (!body.type) return res.status(400).json({ error: 'signal type is required' });
    if (!SIGNAL_TYPES.has(body.type)) return res.status(400).json({ error: 'signal type is not allowed' });
    if (!body.fromPeerId) return res.status(400).json({ error: 'signal fromPeerId is required' });
    if (!requireSignalFromPeer(req, res, session, body.fromPeerId)) return null;
    if (body.toPeerId && !session.participantIds.includes(body.toPeerId)) {
      return res.status(400).json({ error: 'signal toPeerId is not a session participant' });
    }
    if (jsonByteLength(body.payload) > MAX_SIGNAL_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'signal payload exceeds metadata size limit' });
    }
    const message = await store.appendSignalMessage(session.sessionId, {
      id: body.id || null,
      assignmentId: session.assignmentId,
      type: body.type,
      fromPeerId: body.fromPeerId,
      toPeerId: body.toPeerId || null,
      payload: body.payload ?? null,
      createdAt: Number(body.createdAt || Date.now()),
      expiresAt: body.expiresAt || null
    });
    return res.status(201).json({ message });
  }));

  router.get('/signaling/sessions/:sessionId/messages', asyncRoute(async (req, res) => {
    if (typeof store.listSignalMessages !== 'function') {
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
      peerId,
      limit: MAX_SIGNAL_MESSAGES_PER_POLL
    });
    return res.json({ messages });
  }));

  router.get('/peer/rooms', asyncRoute(async (req, res) => {
    if (typeof store.listPeerRooms !== 'function') {
      return res.status(501).json({ error: 'peer room index is not supported by this store' });
    }
    const limit = Math.min(Number(req.query.limit || 50), 100);
    return res.json({
      rooms: await store.listPeerRooms({ limit })
    });
  }));

  router.post('/peer/rooms/:roomId/messages', asyncRoute(async (req, res) => {
    if (typeof store.appendPeerRoomMessage !== 'function') {
      return res.status(501).json({ error: 'peer room relay is not supported by this store' });
    }
    const roomId = String(req.params.roomId || '').trim();
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });
    const body = req.body || {};
    if (body.peerRoomVersion !== 'reploid_peer_room/v1') {
      return res.status(400).json({ error: 'peerRoomVersion mismatch' });
    }
    if (body.roomId && body.roomId !== roomId) {
      return res.status(400).json({ error: 'roomId mismatch' });
    }
    if (!PEER_ROOM_MESSAGE_TYPES.has(body.type)) {
      return res.status(400).json({ error: 'peer room message type is not allowed' });
    }
    if (jsonByteLength(body) > MAX_PEER_ROOM_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'peer room message exceeds metadata size limit' });
    }
    if (peerRoomPayloadLooksForbidden(body)) {
      return res.status(400).json({ error: 'peer room relay must not carry prompt, output, receipt, token, or model payloads' });
    }
    const now = Date.now();
    const requestedExpiresAt = Number(body.relay?.expiresAt || body.expiresAt || 0);
    const maxExpiresAt = now + MAX_PEER_ROOM_MESSAGE_TTL_MS;
    const expiresAt = Number.isFinite(requestedExpiresAt) && requestedExpiresAt > now
      ? Math.min(requestedExpiresAt, maxExpiresAt)
      : maxExpiresAt;
    const message = await store.appendPeerRoomMessage(roomId, {
      relayId: body.relay?.relayId || body.relayId || null,
      fromPeerId: peerRoomMessageFromPeerId(body) || body.relay?.fromPeerId || body.fromPeerId || null,
      message: {
        ...body,
        roomId,
        relay: {
          ...(body.relay || {}),
          expiresAt
        }
      },
      type: body.type,
      createdAt: Number(body.relay?.createdAt || body.createdAt || now),
      expiresAt
    });
    return res.status(201).json({ message });
  }));

  router.get('/peer/rooms/:roomId/messages', asyncRoute(async (req, res) => {
    if (typeof store.listPeerRoomMessages !== 'function') {
      return res.status(501).json({ error: 'peer room relay is not supported by this store' });
    }
    const roomId = String(req.params.roomId || '').trim();
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });
    const messages = await store.listPeerRoomMessages(roomId, {
      after: Number(req.query.after || 0),
      peerId: req.query.peerId || null,
      limit: Math.min(Number(req.query.limit || MAX_PEER_ROOM_MESSAGES_PER_POLL), MAX_PEER_ROOM_MESSAGES_PER_POLL)
    });
    return res.json({ messages });
  }));

  router.get('/peer/rooms/:roomId/summary', asyncRoute(async (req, res) => {
    if (typeof store.listPeerRoomMessages !== 'function') {
      return res.status(501).json({ error: 'peer room relay is not supported by this store' });
    }
    const roomId = String(req.params.roomId || '').trim();
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });
    const limit = Math.min(Number(req.query.limit || MAX_PEER_ROOM_MESSAGES_PER_POLL), MAX_PEER_ROOM_MESSAGES_PER_POLL);
    const messages = await store.listPeerRoomMessages(roomId, {
      after: 0,
      peerId: null,
      limit
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
      recent.push({
        type,
        fromPeerId,
        createdAt: record.createdAt || message.createdAt || null
      });
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
    const authRequired = requireAuth || storageMode === 'firestore';
    const modelArtifactBaseConfigured = Boolean(configuredEnvValue('REPLOID_POOL_MODEL_BASE_URL', 'POOL_MODEL_BASE_URL'));
    const dopplerModuleConfigured = Boolean(configuredEnvValue('REPLOID_DOPPLER_MODULE_URL', 'POOL_DOPPLER_MODULE_URL'));
    const dopplerKernelBaseConfigured = Boolean(configuredEnvValue('REPLOID_DOPPLER_KERNEL_BASE_URL', 'POOL_DOPPLER_KERNEL_BASE_URL'));
    const configValidation = validatePoolConfig();
    const readinessConfig = POOL_CONFIG.deployment || {};
    const commitRevealSupported = typeof store.saveAssignmentCommitment === 'function'
      && typeof store.getAssignmentCommitment === 'function'
      && typeof store.saveAssignmentReveal === 'function'
      && typeof store.getAssignmentReveal === 'function';
    const poolEventsSupported = typeof store.appendPoolEvent === 'function'
      && typeof store.listPoolEventsForJob === 'function';
    const productionReady = configValidation.ok
      && (!readinessConfig.requiresFirestore || storageMode === 'firestore')
      && (!readinessConfig.requiresFirebaseAuthVerifier || authVerifierConfigured)
      && (!readinessConfig.requiresAuthForNonDiscoveryRoutes || authRequired)
      && (!readinessConfig.requiresOffloadedModelArtifactBase || modelArtifactBaseConfigured)
      && (!readinessConfig.requiresDopplerModuleConfiguration || dopplerModuleConfigured)
      && (!readinessConfig.requiresDopplerKernelBaseConfiguration || dopplerKernelBaseConfigured)
      && (!readinessConfig.requiresCommitRevealStore || commitRevealSupported);
    return res.json({
      ok: productionReady,
      configVersion: POOL_CONFIG_VERSION,
      configHash: POOL_CONFIG_HASH,
      configValidation,
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
        authRequired,
        modelArtifactBaseConfigured,
        modelArtifactBaseEnv: modelArtifactBaseConfigured ? 'configured' : 'missing',
        dopplerModuleConfigured,
        dopplerModuleEnv: dopplerModuleConfigured ? 'configured' : 'missing',
        dopplerKernelBaseConfigured,
        dopplerKernelBaseEnv: dopplerKernelBaseConfigured ? 'configured' : 'missing',
        hybridP2PAnchor: true,
        signaling: {
          supported: typeof store.createSignalingSession === 'function'
            && typeof store.appendSignalMessage === 'function'
            && typeof store.listSignalMessages === 'function',
          maxPayloadBytes: MAX_SIGNAL_PAYLOAD_BYTES,
          maxMessagesPerPoll: MAX_SIGNAL_MESSAGES_PER_POLL,
          sessionTtlMs: MAX_SIGNAL_SESSION_TTL_MS
        },
        commitReveal: {
          supported: commitRevealSupported,
          activeProtocolId: POOL_CONFIG.ringPhaseProtocols?.activeProtocolId || null
        },
        eventSourcing: {
          supported: poolEventsSupported,
          activeStateModeId: POOL_CONFIG.stateModes?.activeModeId || null,
          appendOnlyEventSourcedModeEnabled: POOL_CONFIG.stateModes?.modes?.append_only_event_sourced_v1?.enabled === true
        },
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
      policyConfigVersion: POOL_CONFIG_VERSION,
      policyConfigHash: POOL_CONFIG_HASH,
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

  router.post('/assignments/:assignmentId/commit', asyncRoute(async (req, res) => {
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    if (!assignment.ring) return res.status(400).json({ error: 'assignment does not use ring commit-reveal' });
    if (!['assigned', 'running'].includes(assignment.status)) {
      return res.status(409).json({
        error: 'assignment is not in private compute phase',
        assignmentStatus: assignment.status
      });
    }
    const job = await store.getJob(assignment.jobId);
    if (!job) return res.status(404).json({ error: 'job not found', jobId: assignment.jobId });
    if (!assignmentMatchesCurrentJobAttempt(assignment, job)) {
      return res.status(409).json({ error: 'assignment does not match current job attempt' });
    }
    const protocol = phaseProtocolForAssignment(assignment);
    if (!protocol) return res.status(400).json({ error: 'assignment has no configured ring phase protocol' });
    const existingReveals = await currentRevealsForJob(store, job);
    if (protocol.rejectLateCommitmentsAfterRevealOpen && job.ringPhase === 'reveal_open' && existingReveals.length > 0) {
      return res.status(409).json({ error: 'late commitments are rejected after reveal payloads exist' });
    }
    if (await store.getAssignmentCommitment?.(assignment.assignmentId)) {
      return res.status(409).json({ error: 'assignment commitment already submitted' });
    }
    const input = {
      jobId: assignment.jobId,
      assignmentId: assignment.assignmentId,
      ringAttemptId: assignment.ringAttemptId,
      providerId: assignment.providerId,
      commitmentHash: req.body?.commitmentHash || null
    };
    const reasons = validateCommitmentInput(input);
    if (reasons.length > 0) return res.status(400).json({ error: 'invalid commitment', reasons });
    const commitment = await store.saveAssignmentCommitment(assignment.assignmentId, {
      ...input,
      requesterId: assignment.requesterId,
      policyId: assignment.policyId,
      policyConfigVersion: job.policyConfigVersion || POOL_CONFIG_VERSION,
      policyConfigHash: job.policyConfigHash || POOL_CONFIG_HASH,
      assignmentAttemptId: assignment.assignmentAttemptId || null,
      phaseProtocolId: assignment.ring.ringPhaseProtocolId,
      status: 'commit_submitted'
    });
    await store.updateAssignment(assignment.assignmentId, {
      status: 'commit_submitted',
      commitmentHash: commitment.commitmentHash,
      committedAt: new Date().toISOString()
    });
    const barrier = await commitmentBarrierReached({ store, job, assignment });
    const jobPatch = {
      ringPhase: barrier.reached ? 'reveal_open' : 'commit_submitted',
      commitmentHashes: barrier.commitments.map((entry) => entry.commitmentHash),
      agreement: {
        ...(job.agreement || {}),
        commitments: barrier.commitments.length,
        requiredCommitments: barrier.required,
        phase: barrier.reached ? 'reveal_open' : 'commit_submitted'
      }
    };
    if (barrier.reached) {
      for (const entry of barrier.commitments) {
        const committedAssignment = await store.getAssignment(entry.assignmentId);
        if (committedAssignment && committedAssignment.status === 'commit_submitted') {
          await store.updateAssignment(entry.assignmentId, {
            status: 'reveal_open',
            revealOpenedAt: new Date().toISOString()
          });
        }
      }
    }
    await store.updateJob(job.jobId, jobPatch);
    return res.status(201).json({
      commitment,
      ringPhase: jobPatch.ringPhase,
      commitments: barrier.commitments.length,
      requiredCommitments: barrier.required
    });
  }));

  router.post('/assignments/:assignmentId/reveal', asyncRoute(async (req, res) => {
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    if (!assignment.ring) return res.status(400).json({ error: 'assignment does not use ring commit-reveal' });
    const job = await store.getJob(assignment.jobId);
    if (!job) return res.status(404).json({ error: 'job not found', jobId: assignment.jobId });
    if (!assignmentMatchesCurrentJobAttempt(assignment, job)) {
      return res.status(409).json({ error: 'assignment does not match current job attempt' });
    }
    if (job.ringPhase !== 'reveal_open' && assignment.status !== 'reveal_open') {
      return res.status(409).json({
        error: 'ring reveal phase is not open',
        ringPhase: job.ringPhase || null,
        assignmentStatus: assignment.status
      });
    }
    const commitment = await store.getAssignmentCommitment?.(assignment.assignmentId);
    if (!commitment) return res.status(409).json({ error: 'assignment commitment missing' });
    if (await store.getAssignmentReveal?.(assignment.assignmentId)) {
      return res.status(409).json({ error: 'assignment reveal already submitted' });
    }
    const revealInput = {
      jobId: assignment.jobId,
      assignmentId: assignment.assignmentId,
      ringAttemptId: assignment.ringAttemptId,
      providerId: assignment.providerId,
      outputHash: req.body?.outputHash || null,
      tokenIdsHash: req.body?.tokenIdsHash || null,
      vectorHash: req.body?.vectorHash || null,
      transcriptHash: req.body?.transcriptHash || null,
      salt: req.body?.salt || null
    };
    const reasons = validateRevealInput(revealInput);
    const match = revealMatchesCommitment({ commitment, reveal: revealInput });
    if (!match.ok) reasons.push('reveal does not match prior commitment');
    if (reasons.length > 0) {
      if (!match.ok) {
        const rejectedProviderIds = Array.from(new Set([
          ...(Array.isArray(job?.rejectedProviderIds) ? job.rejectedProviderIds : []),
          assignment.providerId
        ].filter(Boolean)));
        const failedAssignmentIds = Array.from(new Set([
          ...(Array.isArray(job?.failedAssignmentIds) ? job.failedAssignmentIds : []),
          assignment.assignmentId
        ].filter(Boolean)));
        await store.updateAssignment(assignment.assignmentId, {
          status: 'reveal_rejected',
          failureReason: 'ring_commit_reveal_mismatch',
          revealRejectedAt: new Date().toISOString()
        });
        await store.setProviderStatus(assignment.providerId, 'available');
        await recordRejectedReceipt({
          store,
          providerId: assignment.providerId,
          reasons
        });
        await penalizeProvider({
          store,
          providerId: assignment.providerId,
          requesterId: assignment.requesterId,
          assignmentId: assignment.assignmentId,
          reason: 'ring_commit_reveal_mismatch',
          points: -2,
          evidence: { reasons, commitmentCheck: match }
        });
        await store.updateJob(job.jobId, {
          rejectedProviderIds,
          failedAssignmentIds
        });
        const policy = getPolicy(assignment.policyId);
        if (policy) {
          const refreshedJob = await store.getJob(job.jobId);
          const agreement = await evaluateAgreement({ store, job: refreshedJob, policy });
          await store.updateJob(job.jobId, {
            status: agreement.status === 'rejected' ? statusForRejectedAgreement(agreement) : statusForPendingAgreement(agreement),
            reason: agreement.status === 'rejected' ? agreement.reason : 'ring commit-reveal mismatch',
            retryable: agreement.status === 'rejected',
            receiptHashes: agreement.receiptHashes,
            rejectedReceiptHashes: agreement.rejectedReceiptHashes,
            failedAssignmentIds: agreement.failedAssignmentIds,
            agreement,
            verifierDecision: agreement.status === 'rejected'
              ? { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
              : undefined
          });
        }
      }
      return res.status(400).json({
        error: 'invalid reveal',
        reasons,
        commitmentCheck: match
      });
    }
    const reveal = await store.saveAssignmentReveal(assignment.assignmentId, {
      ...revealInput,
      requesterId: assignment.requesterId,
      policyId: assignment.policyId,
      policyConfigVersion: job.policyConfigVersion || POOL_CONFIG_VERSION,
      policyConfigHash: job.policyConfigHash || POOL_CONFIG_HASH,
      assignmentAttemptId: assignment.assignmentAttemptId || null,
      phaseProtocolId: assignment.ring.ringPhaseProtocolId,
      commitmentHash: commitment.commitmentHash,
      status: 'reveal_submitted'
    });
    await store.updateAssignment(assignment.assignmentId, {
      status: 'reveal_submitted',
      revealHash: buildCommitmentHash(revealInput),
      revealedAt: new Date().toISOString()
    });
    const reveals = await currentRevealsForJob(store, job);
    await store.updateJob(job.jobId, {
      ringPhase: reveals.length >= Number(job?.agreement?.requiredAgreement || assignment.requiredAgreement || 1)
        ? 'reveal_submitted'
        : 'reveal_open',
      revealHashes: reveals.map((entry) => buildCommitmentHash(entry)),
      agreement: {
        ...(job.agreement || {}),
        reveals: reveals.length,
        phase: reveals.length >= Number(job?.agreement?.requiredAgreement || assignment.requiredAgreement || 1)
          ? 'reveal_submitted'
          : 'reveal_open'
      }
    });
    return res.status(201).json({ reveal });
  }));

  router.post('/assignments/:assignmentId/receipt', asyncRoute(async (req, res) => {
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    const policy = getPolicy(assignment.policyId);
    if (!policy) return res.status(400).json({ error: 'assignment policy is no longer supported' });
    if (!activeAssignmentStatuses.has(assignment.status)) {
      return res.status(409).json({
        error: 'assignment is not active',
        assignmentStatus: assignment.status,
        assignmentId: assignment.assignmentId
      });
    }
    const assignmentJob = await store.getJob(assignment.jobId);
    if (!assignmentJob) return res.status(404).json({ error: 'job not found', jobId: assignment.jobId });
    if (!assignmentMatchesCurrentJobAttempt(assignment, assignmentJob)) {
      await store.updateAssignment(assignment.assignmentId, {
        status: 'stale',
        staleReason: 'assignment_attempt_mismatch',
        staleAt: new Date().toISOString()
      });
      await store.setProviderStatus(assignment.providerId, 'available');
      return res.status(409).json({
        error: 'assignment does not match current job attempt',
        assignmentId: assignment.assignmentId,
        assignmentAttemptId: assignment.assignmentAttemptId || null,
        currentAssignmentAttemptId: assignmentJob.assignmentAttemptId || null,
        ringAttemptId: assignment.ringAttemptId || null,
        currentRingAttemptId: assignmentJob.ringAttemptId || null
      });
    }
    if (finalizedJobStatuses.has(assignmentJob.status)) {
      return res.status(409).json({
        error: 'job is already finalized',
        jobId: assignment.jobId,
        jobStatus: assignmentJob.status
      });
    }
    const phaseProtocol = phaseProtocolForAssignment(assignment);
    if (phaseProtocol?.requireRevealBeforeReceipt && assignment.status !== 'reveal_submitted') {
      return res.status(409).json({
        error: 'ring reveal must be submitted before receipt',
        assignmentStatus: assignment.status,
        ringPhase: assignmentJob.ringPhase || null
      });
    }
    const receipt = req.body?.receipt;
    const outputText = req.body?.outputText || '';
    const tokenIds = Array.isArray(req.body?.tokenIds) ? req.body.tokenIds : [];
    const outputKind = req.body?.outputKind || receipt?.outputKind || 'text_generation';
    const vectorHash = req.body?.vectorHash || receipt?.vectorHash || null;
    const transcript = req.body?.transcript || { outputText, tokenIds };
    const provider = await store.getProvider(assignment.providerId);
    const decision = await verifyReceipt({
      store,
      assignment,
      receipt,
      outputText,
      tokenIds,
      vectorHash,
      transcript
    });
    const receiptRecord = await store.saveReceipt(decision.receiptHash, {
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId,
      assignmentAttemptId: assignment.assignmentAttemptId || null,
      ringAttemptId: assignment.ringAttemptId || null,
      policyConfigVersion: assignmentJob.policyConfigVersion || POOL_CONFIG_VERSION,
      policyConfigHash: assignmentJob.policyConfigHash || POOL_CONFIG_HASH,
      effectiveTrustTier: assignment.ring?.effectiveTrustTier || assignment.trustTier || assignmentJob.effectiveTrustTier || assignmentJob.trustTier || null,
      providerAdmission: assignment.providerAdmission || null,
      outputText,
      tokenIds,
      outputKind,
      vectorHash,
      embeddingDimensions: req.body?.embeddingDimensions || receipt?.embedding?.dimensions || null,
      embeddingStats: req.body?.embeddingStats || receipt?.embedding?.stats || null,
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
    if (assignmentJob.agreement?.status === 'accepted') {
      if (!decision.accepted) {
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
          reason: 'late_non_quorum_receipt_rejected',
          points: -1,
          evidence: { reasons: decision.reasons, agreement: assignmentJob.agreement }
        });
      }
      routeDecision = {
        mode: decision.accepted ? 'late_non_quorum_receipt_ignored' : 'late_non_quorum_receipt_rejected',
        agreement: assignmentJob.agreement
      };
      return res.status(decision.accepted ? 409 : 400).json({ receipt: receiptRecord, verifierDecision: decision, routeDecision });
    }

    if (!decision.accepted) {
      const currentJob = await store.getJob(assignment.jobId);
      const rejectedProviderIds = Array.from(new Set([
        ...(Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []),
        assignment.providerId
      ].filter(Boolean)));
      await store.updateJob(assignment.jobId, {
        receiptHash: decision.receiptHash,
        rejectedProviderIds
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
      const refreshedJob = await store.getJob(assignment.jobId);
      if (Number(refreshedJob?.agreement?.requiredAgreement || policy.redundancy || 1) > 1) {
        const agreement = await evaluateAgreement({ store, job: refreshedJob, policy });
        if (agreement.status === 'rejected') {
          await store.updateJob(assignment.jobId, {
            status: statusForRejectedAgreement(agreement),
            reason: agreement.reason,
            retryable: true,
            receiptHashes: agreement.receiptHashes,
            rejectedReceiptHashes: agreement.rejectedReceiptHashes,
            failedAssignmentIds: agreement.failedAssignmentIds,
            agreement,
            verifierDecision: { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
          });
          routeDecision = {
            mode: agreement.mode,
            agreement,
            reassignment: { drained: (await assignQueuedJobs({ store })).length }
          };
        } else {
          await store.updateJob(assignment.jobId, {
            status: statusForPendingAgreement(agreement),
            retryable: false,
            receiptHashes: agreement.receiptHashes,
            rejectedReceiptHashes: agreement.rejectedReceiptHashes,
            failedAssignmentIds: agreement.failedAssignmentIds,
            agreement
          });
          routeDecision = {
            mode: agreement.mode,
            agreement,
            reassignment: { drained: 0 }
          };
        }
      } else {
        await store.updateJob(assignment.jobId, {
          status: 'receipt_rejected',
          outputText,
          verifierDecision: decision,
          retryable: true,
          rejectedProviderIds
        });
        routeDecision = {
          mode: 'receipt_rejected',
          reassignment: { drained: (await assignQueuedJobs({ store })).length }
        };
      }
    } else {
      routeDecision = await updateJobAfterVerifiedReceipt({ store, assignment, receiptRecord, policy });
    }
    return res.status(decision.accepted ? 200 : 400).json({ receipt: receiptRecord, verifierDecision: decision, routeDecision });
  }));

  router.post('/assignments/:assignmentId/failure', asyncRoute(async (req, res) => {
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    if (!activeAssignmentStatuses.has(assignment.status)) {
      return res.status(409).json({
        error: 'assignment is not active',
        assignmentStatus: assignment.status,
        assignmentId: assignment.assignmentId
      });
    }
    const currentJob = await store.getJob(assignment.jobId);
    if (!currentJob) return res.status(404).json({ error: 'job not found', jobId: assignment.jobId });
    if (!assignmentMatchesCurrentJobAttempt(assignment, currentJob)) {
      await store.updateAssignment(assignment.assignmentId, {
        status: 'stale',
        staleReason: 'assignment_attempt_mismatch',
        staleAt: new Date().toISOString()
      });
      await store.setProviderStatus(assignment.providerId, 'available');
      return res.status(409).json({
        error: 'assignment does not match current job attempt',
        assignmentId: assignment.assignmentId,
        assignmentAttemptId: assignment.assignmentAttemptId || null,
        currentAssignmentAttemptId: currentJob.assignmentAttemptId || null,
        ringAttemptId: assignment.ringAttemptId || null,
        currentRingAttemptId: currentJob.ringAttemptId || null
      });
    }
    const reason = String(req.body?.reason || 'provider_execution_failed').slice(0, 300);
    const providerFault = req.body?.providerFault !== false;
    const rejectedProviderIds = providerFault
      ? Array.from(new Set([
        ...(Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []),
        assignment.providerId
      ].filter(Boolean)))
      : (Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []);
    const failedAssignmentIds = Array.from(new Set([
      ...(Array.isArray(currentJob?.failedAssignmentIds) ? currentJob.failedAssignmentIds : []),
      assignment.assignmentId
    ].filter(Boolean)));
    await store.updateAssignment(assignment.assignmentId, {
      status: 'failed',
      failureReason: reason,
      providerFault,
      failedAt: new Date().toISOString()
    });
    await store.updateJob(assignment.jobId, {
      rejectedProviderIds,
      failedAssignmentIds,
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
    const refreshedJob = await store.getJob(assignment.jobId);
    let routeDecision = null;
    let reassignment = [];
    const policy = getPolicy(assignment.policyId);
    if (policy && Number(refreshedJob?.agreement?.requiredAgreement || policy.redundancy || 1) > 1) {
      const agreement = await evaluateAgreement({ store, job: refreshedJob, policy });
      if (agreement.status === 'rejected') {
        await store.updateJob(assignment.jobId, {
          status: statusForRejectedAgreement(agreement),
          reason: agreement.reason,
          retryable: true,
          receiptHashes: agreement.receiptHashes,
          rejectedReceiptHashes: agreement.rejectedReceiptHashes,
          failedAssignmentIds: agreement.failedAssignmentIds,
          agreement,
          verifierDecision: { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
        });
        reassignment = await assignQueuedJobs({ store });
      } else {
        await store.updateJob(assignment.jobId, {
          status: statusForPendingAgreement(agreement),
          reason,
          retryable: false,
          receiptHashes: agreement.receiptHashes,
          rejectedReceiptHashes: agreement.rejectedReceiptHashes,
          failedAssignmentIds: agreement.failedAssignmentIds,
          agreement
        });
      }
      routeDecision = { mode: agreement.mode, agreement };
    } else {
      await store.updateJob(assignment.jobId, {
        status: 'failed',
        reason,
        retryable: true,
        rejectedProviderIds,
        failedAssignmentIds
      });
      reassignment = await assignQueuedJobs({ store });
      routeDecision = { mode: 'provider_execution_failed' };
    }
    return res.json({
      assignment: await store.getAssignment(assignment.assignmentId),
      job: await store.getJob(assignment.jobId),
      reputation,
      penalty,
      routeDecision,
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
    let acceptanceSummary = null;
    if (acceptancePayload.accepted === true) {
      if (job?.agreement && job.agreement.status !== 'accepted') {
        return res.status(409).json({
          error: 'selected policy has not reached an accepted final state',
          agreement: job.agreement
        });
      }
      acceptanceSummary = await buildAcceptanceSummary({
        store,
        job,
        receiptHash: req.params.receiptHash
      });
      if (!acceptanceSummary.receiptHashes.includes(req.params.receiptHash)) {
        return res.status(400).json({ error: 'receipt is not part of the accepted agreement set' });
      }
      if (acceptanceSummary.agreedRecords.length !== acceptanceSummary.receiptHashes.length) {
        return res.status(409).json({
          error: 'accepted agreement set is missing verifier-accepted receipts',
          receiptHashes: acceptanceSummary.receiptHashes
        });
      }
      const commitRevealReasons = await ensureAgreementCommitRevealReady({
        store,
        job,
        agreedRecords: acceptanceSummary.agreedRecords
      });
      if (commitRevealReasons.length > 0) {
        return res.status(409).json({
          error: 'accepted agreement set is missing required commit-reveal evidence',
          reasons: commitRevealReasons
        });
      }
    }
    const acceptanceDecision = await verifyRequesterAcceptance({
      job,
      acceptance: acceptancePayload,
      expectedAcceptance: acceptanceSummary
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

    const {
      receiptHashes,
      agreedRecords,
      multiplier,
      totalProviderPoints
    } = acceptanceSummary;
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
        points: acceptanceSummary.providerPoints.find((entry) => entry.receiptHash === agreedRecord.receiptHash)?.points,
        reason: acceptedLedgerReasonForJob(job, receiptHashes.length)
      });
      const reputation = await recordAcceptedReceipt({
        store,
        providerId: agreedRecord.providerId,
        points: ledgerEvent.points
      });
      await store.saveReceipt(agreedRecord.receiptHash, {
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
      reason: spendLedgerReasonForJob(job, receiptHashes.length)
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
