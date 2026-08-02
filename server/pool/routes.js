/**
 * @fileoverview Pool coordinator routes for receipt-backed browser inference.
 */

import express from 'express';
import poolStore from './store.js';
import { DETERMINISTIC_GENERATION_CONFIG, getPolicy, listPolicies } from './policy-router.js';
import { LAUNCH_MODEL } from './model-contract.js';
import { verifyReceipt, verifyRequesterAcceptance } from './verifier.js';
import { awardAcceptedReceipt, chargeRequester, penalizeProvider } from './points.js';
import { recordAcceptedReceipt, recordRejectedReceipt } from './reputation.js';
import { hashJson } from './hash.js';
import { POOL_CONFIG, POOL_CONFIG_HASH, POOL_CONFIG_VERSION, validatePoolConfig } from './config.js';
import { buildCommitmentHash, revealMatchesCommitment, validateCommitmentInput, validateRevealInput } from './commit-reveal.js';
import {
  assignQueuedJobs,
  scheduleAuditExecution
} from './services/job-assignment.js';
import {
  acceptedLedgerReasonForJob,
  assignmentMatchesCurrentJobAttempt,
  commitmentBarrierReached,
  currentRevealsForJob,
  ensureAgreementCommitRevealReady,
  evaluateAgreement,
  phaseProtocolForAssignment,
  statusForPendingAgreement,
  statusForRejectedAgreement,
  spendLedgerReasonForJob,
  updateJobAfterVerifiedReceipt
} from './services/agreement-lifecycle.js';
import { buildAcceptanceSummary } from './services/acceptance.js';
import {
  createTurnRtcConfiguration,
  getPublicTurnServiceStatus
} from './turn-credentials.js';
import { cursorForRelayRecord } from './relay-cursor.js';
import { registerAdapterRoutes } from './routes/adapters.js';
import { registerAuditRoutes } from './routes/audits.js';
import { registerCommitRevealRoutes } from './routes/commit-reveal.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerPeerRoomRoutes } from './routes/peer-rooms.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerReceiptRoutes } from './routes/receipts.js';
import { registerResearchRoutes } from './routes/research.js';
import { registerSignalingRoutes } from './routes/signaling.js';

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const relayPageResponse = (messages, idField) => {
  const nextCursor = messages?.nextCursor || (messages?.length
    ? cursorForRelayRecord(messages.at(-1), idField)
    : null);
  return nextCursor ? { messages, nextCursor } : { messages };
};

const POOL_RATE_LIMIT_MAX_REQUESTS = 30;
const POOL_RATE_LIMIT_BUCKET_MS = 10000;
const POOL_REALTIME_RATE_LIMIT_MAX_REQUESTS = 240;

const isRealtimeRelayRequest = (req) => (
  /\/(?:signal\/sessions|peer\/rooms)\/[^/]+\/messages(?:\/|$)/.test(String(req.path || req.url || ''))
);

const createPoolRateLimiter = ({
  store,
  maxRequests = POOL_RATE_LIMIT_MAX_REQUESTS,
  bucketMs = POOL_RATE_LIMIT_BUCKET_MS,
  realtimeMaxRequests = POOL_REALTIME_RATE_LIMIT_MAX_REQUESTS
} = {}) => {
  const buckets = new Map();
  const rejectRateLimitedRequest = (res, resetAt) => {
    const retryAfter = Math.max(1, Math.ceil((Number(resetAt) - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'pool rate limit exceeded', retryable: true, retryAfter });
  };
  return async (req, res, next) => {
    const realtime = isRealtimeRelayRequest(req);
    const requestLimit = realtime ? realtimeMaxRequests : maxRequests;
    const rateClass = realtime ? 'realtime-relay' : 'control';
    const identity = String(req.headers['x-reploid-client-id'] || req.body?.requesterId || req.body?.providerId || req.ip || 'unknown');
    const key = `${identity}:${rateClass}`;
    if (typeof store?.consumeRateLimit === 'function') {
      const result = await store.consumeRateLimit({ key, maxRequests: requestLimit, bucketMs });
      res.setHeader('X-RateLimit-Limit', String(result.limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
      res.setHeader('X-RateLimit-Reset', String(result.resetAt));
      if (!result.allowed) {
        return rejectRateLimitedRequest(res, result.resetAt);
      }
      return next();
    }
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + bucketMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + bucketMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > requestLimit) {
      return rejectRateLimitedRequest(res, bucket.resetAt);
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

const isLoopbackRequest = (req) => {
  const address = String(req.ip || req.socket?.remoteAddress || '').trim().toLowerCase();
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
};

const isPublicDiscoveryRoute = (req) => (
  req.path === '/peer/rooms'
  || req.path.startsWith('/peer/rooms/')
  || (req.method === 'GET'
    && (req.path === '/deployment/check'
      || req.path === '/status'
      || req.path === '/policies'
      || req.path === '/config'
      || req.path.startsWith('/research/')
      || req.path === '/adapter-canaries'
      || req.path.startsWith('/adapter-canaries/')))
);

const normalizeUid = (uid) => String(uid || '').replace(/[^a-z0-9_-]/gi, '_');
const roleIdForUid = (role, uid) => `${role}_${normalizeUid(uid)}`;

const authMatchesRoleId = (auth, role, roleId) => {
  if (hasCoordinatorClaim(auth)) return true;
  if (auth?.localDevelopment === true) return true;
  if (!auth?.verified || !auth.uid) return false;
  return roleId === roleIdForUid(role, auth.uid);
};

const authMatchesAnyRoleId = (auth, roles, roleId) => {
  if (auth?.localDevelopment === true) return true;
  if (!auth?.verified || !auth.uid) return false;
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

const canReadAdapterPublication = (req, publication = {}) => (
  publication.visibility === 'public'
  || hasCoordinatorClaim(req.poolAuth)
  || authMatchesRoleId(req.poolAuth, 'publisher', publication.publisher?.publisherId)
);

const hasCoordinatorClaim = (auth) => auth?.decoded?.admin === true
  || auth?.decoded?.poolCoordinator === true
  || auth?.decoded?.coordinator === true;

const signalingRoles = Object.freeze(['requester', 'agent', 'provider']);

const signalingParticipantAllowed = (auth, participantIds = []) => {
  if (auth?.localDevelopment === true) return true;
  if (!auth?.verified || !auth.uid) return false;
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
  if (req.poolAuth?.localDevelopment === true || hasCoordinatorClaim(req.poolAuth)) return true;
  if (!req.poolAuth?.verified || !req.poolAuth.uid) {
    res.status(403).json({ error: 'authenticated identity is required to publish signaling messages' });
    return false;
  }
  if (authMatchesAnyRoleId(req.poolAuth, signalingRoles, fromPeerId)) return true;
  res.status(403).json({ error: 'authenticated identity does not match signal fromPeerId' });
  return false;
};

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
  'webrtc-signal',
  'relay-ack'
]);

const jsonByteLength = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

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

export function createPoolRouter({
  store = poolStore,
  verifyAuthToken = null,
  requireAuth = false,
  allowUnauthenticatedLocal = false,
  allowCanaryCreation = false,
  createAdapterDownloadUrl = null,
  turnEnv = process.env
} = {}) {
  const router = express.Router();
  router.use(asyncRoute(createPoolRateLimiter({ store })));
  router.use(asyncRoute(async (req, res, next) => {
    const authOptional = isPublicDiscoveryRoute(req);
    const localDevelopment = !authOptional && allowUnauthenticatedLocal && isLoopbackRequest(req);
    const routeRequiresAuth = !authOptional && !localDevelopment;
    const token = extractBearerToken(req);
    if (!token) {
      if (routeRequiresAuth && !authOptional) return res.status(401).json({ error: 'Firebase auth token required' });
      req.poolAuth = {
        verified: false,
        tokenPresent: false,
        localDevelopment
      };
      return next();
    }
    if (typeof verifyAuthToken !== 'function') {
      if (routeRequiresAuth) return res.status(503).json({ error: 'Firebase auth verifier unavailable' });
      req.poolAuth = {
        verified: false,
        tokenPresent: true,
        localDevelopment
      };
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

  router.get('/rtc-config', asyncRoute(async (req, res) => {
    if (!req.poolAuth?.verified || !req.poolAuth.uid) {
      return res.status(401).json({ error: 'Firebase auth token required for TURN credentials' });
    }
    try {
      return res.json(createTurnRtcConfiguration({
        subject: req.poolAuth.uid,
        env: turnEnv
      }));
    } catch (error) {
      if (error?.code === 'turn_not_configured') {
        return res.status(503).json({
          error: error.message,
          code: error.code,
          retryable: true
        });
      }
      throw error;
    }
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
        adapterRegistry: 'signed_metadata_only',
        adapterCanaryRegistry: 'signed_non_routable_evidence',
        adapterArtifactTransport: 'cache_peer_origin',
        modelArtifactBaseConfigured: Boolean(process.env.REPLOID_POOL_MODEL_BASE_URL || process.env.POOL_MODEL_BASE_URL),
        turn: getPublicTurnServiceStatus(turnEnv)
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

  registerSignalingRoutes(router, {
    store,
    asyncRoute,
    signalTypes: SIGNAL_TYPES,
    maxSignalPayloadBytes: MAX_SIGNAL_PAYLOAD_BYTES,
    maxMessagesPerPoll: MAX_SIGNAL_MESSAGES_PER_POLL,
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
    const privateAdapterDeliveryConfigured = typeof createAdapterDownloadUrl === 'function';
    const turn = getPublicTurnServiceStatus(turnEnv);
    const configValidation = validatePoolConfig();
    const readinessConfig = POOL_CONFIG.deployment || {};
    const commitRevealSupported = typeof store.saveAssignmentCommitment === 'function'
      && typeof store.getAssignmentCommitment === 'function'
      && typeof store.saveAssignmentReveal === 'function'
      && typeof store.getAssignmentReveal === 'function';
    const poolEventsSupported = typeof store.appendPoolEvent === 'function'
      && typeof store.listPoolEventsForJob === 'function';
    const distributedRateLimitSupported = typeof store.consumeRateLimit === 'function';
    const productionReady = configValidation.ok
      && (!readinessConfig.requiresFirestore || storageMode === 'firestore')
      && (!readinessConfig.requiresFirebaseAuthVerifier || authVerifierConfigured)
      && (!readinessConfig.requiresAuthForNonDiscoveryRoutes || authRequired)
      && (!readinessConfig.requiresOffloadedModelArtifactBase || modelArtifactBaseConfigured)
      && (!readinessConfig.requiresDopplerModuleConfiguration || dopplerModuleConfigured)
      && (!readinessConfig.requiresDopplerKernelBaseConfiguration || dopplerKernelBaseConfigured)
      && (!readinessConfig.requiresPrivateAdapterDeliverySigner || privateAdapterDeliveryConfigured)
      && (!readinessConfig.requiresCommitRevealStore || commitRevealSupported)
      && turn.configured
      && (storageMode !== 'firestore' || distributedRateLimitSupported);
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
        adapterDelivery: {
          configured: privateAdapterDeliveryConfigured,
          provider: privateAdapterDeliveryConfigured ? 'gcs-v4-generation-pinned' : null
        },
        hybridP2PAnchor: true,
        signaling: {
          supported: typeof store.createSignalingSession === 'function'
            && typeof store.appendSignalMessage === 'function'
            && typeof store.listSignalMessages === 'function',
          maxPayloadBytes: MAX_SIGNAL_PAYLOAD_BYTES,
          maxMessagesPerPoll: MAX_SIGNAL_MESSAGES_PER_POLL,
          sessionTtlMs: MAX_SIGNAL_SESSION_TTL_MS
        },
        turn,
        commitReveal: {
          supported: commitRevealSupported,
          activeProtocolId: POOL_CONFIG.ringPhaseProtocols?.activeProtocolId || null
        },
        eventSourcing: {
          supported: poolEventsSupported,
          activeStateModeId: POOL_CONFIG.stateModes?.activeModeId || null,
          appendOnlyEventSourcedModeEnabled: POOL_CONFIG.stateModes?.modes?.append_only_event_sourced_v1?.enabled === true
        },
        rateLimit: {
          supported: distributedRateLimitSupported,
          distributed: storageMode === 'firestore' && distributedRateLimitSupported,
          maxRequests: POOL_RATE_LIMIT_MAX_REQUESTS,
          bucketMs: POOL_RATE_LIMIT_BUCKET_MS
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
        browserRequirement: 'A signed participation profile and device-root role delegation are required for hosted requests and providers.',
        signingKeys: 'A browser device root delegates scoped requester and provider signing roles; an optional passkey can bind the root.'
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

  registerProviderRoutes(router, {
    store,
    asyncRoute,
    requireBoundRole,
    roleIdForUid,
    assignQueuedJobs
  });
  registerJobRoutes(router, {
    store,
    asyncRoute,
    requireBoundAnyRole
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
    buildAcceptanceSummary,
    ensureAgreementCommitRevealReady,
    verifyRequesterAcceptance,
    awardAcceptedReceipt,
    recordAcceptedReceipt,
    chargeRequester,
    acceptedLedgerReasonForJob,
    spendLedgerReasonForJob,
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
