import { registerPoolAdmission, asyncRoute, effectivePoolAuthPolicy, roleIdForUid, authMatchesRoleId, authMatchesAnyRoleId, requireBoundRole, requireBoundAnyRole, canReadAdapterPublication, hasCoordinatorClaim } from './http-admission.js';
import { registerPoolMetadataRoutes, registerPoolDeploymentRoutes } from './routes/metadata.js';
import { registerPoolAccountViews } from './routes/account-views.js';
/**
 * @fileoverview Pool coordinator routes for receipt-backed browser inference.
 */

import express from 'express';
import poolStore from './store.js';
import { resolvePoolRateLimits } from '../../shared/pool/config-contract.js';
import { getPolicy } from './policy-router.js';

import { verifyReceipt } from './verifier.js';
import { penalizeProvider } from './points.js';
import { recordRejectedReceipt } from './reputation.js';
import { hashJson } from './hash.js';
import { POOL_CONFIG, POOL_CONFIG_HASH, POOL_CONFIG_VERSION } from './config.js';
import { buildCoordinatorRuntimeBundle } from './release-identity.js';
import { buildCommitmentHash, revealMatchesCommitment, validateCommitmentInput, validateRevealInput } from './commit-reveal.js';
import {
  assignQueuedJobs,
  recoverHostedAssignments,
  scheduleAuditExecution
} from './services/job-assignment.js';
import {
  assignmentMatchesCurrentJobAttempt,
  commitmentBarrierReached,
  currentRevealsForJob,
  evaluateAgreement,
  phaseProtocolForAssignment,
  statusForPendingAgreement,
  statusForRejectedAgreement,
  updateJobAfterVerifiedReceipt
} from './services/agreement-lifecycle.js';

import { registerAdapterRoutes } from './routes/adapters.js';
import { registerAuditRoutes } from './routes/audits.js';
import { registerCommitRevealRoutes } from './routes/commit-reveal.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerPeerRoomRoutes, relayPageResponse } from './routes/peer-rooms.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerReceiptRoutes } from './routes/receipts.js';
import { registerResearchRoutes } from './routes/research.js';



// Reporting and enforcement use the same exceptions. The legacy requireAuth
// option records host intent; false never makes protected routes anonymous.

const activeAssignmentStatuses = new Set(['assigned', 'running', 'commit_submitted', 'reveal_open', 'reveal_submitted']);
const finalizedJobStatuses = new Set(['accepted', 'acceptance_processing', 'rejected_by_requester']);
const deploymentSignalingConfig = POOL_CONFIG.deployment?.signaling || {};
const MAX_PEER_ROOM_PAYLOAD_BYTES = Number(process.env.POOL_MAX_PEER_ROOM_PAYLOAD_BYTES || deploymentSignalingConfig.maxPeerRoomPayloadBytes || 64 * 1024);
const MAX_PEER_ROOM_MESSAGES_PER_POLL = Number(process.env.POOL_MAX_PEER_ROOM_MESSAGES_PER_POLL || deploymentSignalingConfig.maxPeerRoomMessagesPerPoll || 100);
const MAX_PEER_ROOM_MESSAGE_TTL_MS = Number(process.env.POOL_PEER_ROOM_MESSAGE_TTL_MS || deploymentSignalingConfig.peerRoomMessageTtlMs || 2 * 60 * 1000);
const PEER_ROOM_MESSAGE_TYPES = new Set([
  'provider-advert-request',
  'provider-advert',
  'peer-run-request',
  'peer-run-accepted',
  'webrtc-signal',
  'relay-ack'
]);

const jsonByteLength = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

export function createPoolRouter({
  store = poolStore,
  verifyAuthToken = null,
  requireAuth = false,
  allowUnauthenticatedLocal = false,
  allowCanaryCreation = false,
  createAdapterDownloadUrl = null,
  turnEnv = process.env,
  releaseEnv = process.env,
  runtimeBundleIdentity = null
} = {}) {
  const router = express.Router();
  const rateLimits = resolvePoolRateLimits(POOL_CONFIG.admission?.rateLimits);
  const authOptions = Object.freeze({ allowUnauthenticatedLocal, verifierConfigured: typeof verifyAuthToken === 'function' });
  const authPolicy = effectivePoolAuthPolicy(authOptions);
  let runtimeBundlePromise = null;
  const resolveRuntimeBundleIdentity = () => {
    if (runtimeBundleIdentity) return Promise.resolve(runtimeBundleIdentity);
    if (!runtimeBundlePromise) runtimeBundlePromise = buildCoordinatorRuntimeBundle();
    return runtimeBundlePromise;
  };
  registerPoolAdmission(router, { store, rateLimits, authOptions, verifyAuthToken });

  registerPoolMetadataRoutes(router, { turnEnv, store, authOptions, allowCanaryCreation });

  registerResearchRoutes(router, { store, asyncRoute, requireBoundRole });

  registerAdapterRoutes(router, {
    store,
    asyncRoute,
    requireBoundRole,
    canReadAdapterPublication,
    hasCoordinatorClaim,
    authMatchesRoleId,
    createAdapterDownloadUrl
  });

  registerPeerRoomRoutes(router, {
    store,
    asyncRoute,
    peerRoomMessageTypes: PEER_ROOM_MESSAGE_TYPES,
    maxPeerRoomPayloadBytes: MAX_PEER_ROOM_PAYLOAD_BYTES,
    maxPeerRoomMessagesPerPoll: MAX_PEER_ROOM_MESSAGES_PER_POLL,
    maxPeerRoomMessageTtlMs: MAX_PEER_ROOM_MESSAGE_TTL_MS,
    jsonByteLength,
    hashJson,
    relayPageResponse
  });

  registerPoolDeploymentRoutes(router, { store, resolveRuntimeBundleIdentity, verifyAuthToken, authPolicy, createAdapterDownloadUrl, releaseEnv, turnEnv, rateLimits, authOptions, requireAuth, allowCanaryCreation });

  registerProviderRoutes(router, {
    store,
    asyncRoute,
    requireBoundRole,
    roleIdForUid,
    recoverHostedAssignments
  });
  registerJobRoutes(router, {
    store,
    asyncRoute,
    requireBoundAnyRole,
    recoverHostedAssignments
  });

  registerCommitRevealRoutes(router, {
    store,
    asyncRoute,
    requireBoundRole,
    assignmentMatchesCurrentJobAttempt,
    phaseProtocolForAssignment,
    currentRevealsForJob,
    commitmentBarrierReached,
    validateCommitmentInput,
    validateRevealInput,
    revealMatchesCommitment,
    buildCommitmentHash,
    recordRejectedReceipt,
    penalizeProvider,
    getPolicy,
    evaluateAgreement,
    statusForPendingAgreement,
    statusForRejectedAgreement,
    recoverHostedAssignments,
    poolConfigVersion: POOL_CONFIG_VERSION,
    poolConfigHash: POOL_CONFIG_HASH
  });

  registerReceiptRoutes(router, {
    store,
    asyncRoute,
    requireBoundRole,
    requireBoundAnyRole,
    getPolicy,
    activeAssignmentStatuses,
    finalizedJobStatuses,
    assignmentMatchesCurrentJobAttempt,
    phaseProtocolForAssignment,
    verifyReceipt,
    updateJobAfterVerifiedReceipt,
    recordRejectedReceipt,
    penalizeProvider,
    evaluateAgreement,
    statusForPendingAgreement,
    statusForRejectedAgreement,
    assignQueuedJobs,
    recoverHostedAssignments,
    hasCoordinatorClaim,
    authMatchesRoleId,
    authMatchesAnyRoleId,
    poolConfigVersion: POOL_CONFIG_VERSION,
    poolConfigHash: POOL_CONFIG_HASH
  });

  registerAuditRoutes(router, {
    store,
    asyncRoute,
    allowCanaryCreation,
    hasCoordinatorClaim,
    authMatchesRoleId,
    scheduleAuditExecution
  });

  registerPoolAccountViews(router, { store });

  return router;
}

export default createPoolRouter;
