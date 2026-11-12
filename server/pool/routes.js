/**
 * @fileoverview Pool coordinator routes for receipt-backed browser inference.
 */

import express from 'express';
import poolStore from './store.js';
import { resolvePoolRateLimits } from '../../shared/pool/config-contract.js';
import { DETERMINISTIC_GENERATION_CONFIG, getPolicy, listPolicies } from './policy-router.js';
import { LAUNCH_MODEL } from './model-contract.js';
import { verifyReceipt } from './verifier.js';
import { penalizeProvider } from './points.js';
import { recordRejectedReceipt } from './reputation.js';
import { hashJson } from './hash.js';
import { POOL_CONFIG, POOL_CONFIG_HASH, POOL_CONFIG_VERSION, validatePoolConfig } from './config.js';
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
import {
  createTurnRtcConfiguration,
  getPublicTurnServiceStatus
} from './turn-credentials.js';
import { cursorForRelayRecord } from './relay.js';
import { registerAdapterRoutes } from './routes/adapters.js';
import { registerAuditRoutes } from './routes/audits.js';
import { registerCommitRevealRoutes } from './routes/commit-reveal.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerPeerRoomRoutes } from './routes/peer-rooms.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerReceiptRoutes } from './routes/receipts.js';
import { registerResearchRoutes } from './routes/research.js';

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const relayPageResponse = (messages, idField) => {
  const nextCursor = messages?.nextCursor || (messages?.length
    ? cursorForRelayRecord(messages.at(-1), idField)
    : null);
  return nextCursor ? { messages, nextCursor } : { messages };
};


const isRealtimeRelayRequest = (req) => (
  /\/peer\/rooms\/[^/]+\/messages(?:\/|$)/.test(String(req.path || req.url || ''))
);

const createPoolRateLimiter = ({
  store,
  scope,
  limits
} = {}) => {
  if (typeof store?.consumeRateLimit !== 'function') {
    throw new TypeError('Pool admission requires the store rate-limit contract');
  }
  return async (req, res, next) => {
    // Express resolves req.ip using the host's explicit trust-proxy policy.
    // Neither forwarded headers nor caller-supplied role labels establish a quota principal here.
    const identity = scope === 'principal'
      ? (req.poolAuth?.verified ? req.poolAuth.uid : null)
      : req.ip || req.socket?.remoteAddress || 'unknown';
    if (identity === null) return next();
    const realtime = isRealtimeRelayRequest(req);
    const { maxRequests, windowMs } = limits[realtime ? 'realtime' : 'control'];
    const rateClass = realtime ? 'realtime-relay' : 'control';
    const key = JSON.stringify([scope, identity, rateClass]);
    const result = await store.consumeRateLimit({ key, maxRequests, bucketMs: windowMs });
    res.setHeader('X-RateLimit-Scope', scope);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
    res.setHeader('X-RateLimit-Reset', String(result.resetAt));
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((Number(result.resetAt) - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'pool rate limit exceeded', retryable: true, retryAfter });
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

const PUBLIC_AUTH_EXCEPTIONS = Object.freeze([
  { method: '*', path: '/peer/rooms', authorization: 'signed-peer-protocol' },
  { method: '*', prefix: '/peer/rooms/', authorization: 'signed-peer-protocol' },
  ...['/deployment/check', '/status', '/policies', '/config', '/adapter-canaries']
    .map(path => ({ method: 'GET', path, authorization: 'public-read' })),
  ...['/research/', '/adapter-canaries/']
    .map(prefix => ({ method: 'GET', prefix, authorization: 'public-read' }))
].map(Object.freeze));

// Reporting and enforcement use the same exceptions. The legacy requireAuth
// option records host intent; false never makes protected routes anonymous.
const effectivePoolAuthPolicy = ({ allowUnauthenticatedLocal, verifierConfigured }, req = null) => {
  const publicException = req === null ? null : PUBLIC_AUTH_EXCEPTIONS.find(rule => (
    (rule.method === '*' || rule.method === req.method)
    && (rule.path ? req.path === rule.path : req.path.startsWith(rule.prefix))
  )) || null;
  const localAddress = req !== null && isLoopbackRequest(req);
  const localDevelopment = !publicException && localAddress && allowUnauthenticatedLocal === true;
  return {
    schema: 'poolday.http-auth-policy/v1',
    // Compatibility: this describes the protected-route default, not every route.
    required: true,
    protectedDefault: 'authentication-required',
    publicExceptions: PUBLIC_AUTH_EXCEPTIONS,
    localDevelopmentAllowed: allowUnauthenticatedLocal === true,
    localDevelopment: {
      configured: allowUnauthenticatedLocal === true,
      allowedAtRequestAddress: allowUnauthenticatedLocal === true && localAddress,
      eligibleForRequest: localDevelopment,
      appliedToRequest: req?.poolAuth?.localDevelopment === true
    },
    verifierConfigured: verifierConfigured === true,
    roleBinding: true,
    roleBindingExceptions: ['verified-coordinator-claim', 'explicit-loopback-development'],
    request: {
      publicException,
      authenticationRequired: !publicException && !localDevelopment,
      roleAuthorization: req?.poolAuth?.localDevelopment === true ? 'local-development-bypass' : publicException ? publicException.authorization : 'route-specific-role-binding'
    }
  };
};

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

const configuredEnvValue = (...names) => names
  .map((name) => process.env[name])
  .find((value) => {
    const normalized = String(value || '').trim();
    return normalized && !normalized.startsWith('<required-');
  }) || null;

const configuredReleaseValue = (releaseEnv, name) => {
  const normalized = String(releaseEnv?.[name] || '').trim();
  return normalized && !normalized.startsWith('<required-') ? normalized : null;
};

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
  router.use(asyncRoute(createPoolRateLimiter({ store, scope: 'address', limits: rateLimits.address })));
  router.use(asyncRoute(async (req, res, next) => {
    const requestPolicy = effectivePoolAuthPolicy(authOptions, req);
    const routeRequiresAuth = requestPolicy.request.authenticationRequired;
    const localDevelopment = requestPolicy.localDevelopment.eligibleForRequest;
    const token = extractBearerToken(req);
    if (!token) {
      if (routeRequiresAuth) return res.status(401).json({ error: 'Firebase auth token required' });
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
      if (typeof decoded?.uid !== 'string' || !decoded.uid.trim() || decoded.uid.length > 512) {
        return res.status(401).json({ error: 'Firebase auth token has no valid subject' });
      }
      req.poolAuth = { verified: true, tokenPresent: true, uid: decoded.uid, decoded };
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Firebase auth token invalid', reason: error.message });
    }
  }));

  router.use(asyncRoute(createPoolRateLimiter({ store, scope: 'principal', limits: rateLimits.principal })));

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
    return res.json({
      product: 'reploid_browser_inference_pool',
      claim: 'receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference',
      configVersion: POOL_CONFIG_VERSION,
      configHash: POOL_CONFIG_HASH,
      storageMode,
      transport: {
        controlPlane: 'cloud_run_firestore',
        payloadMode: 'hybrid_p2p_anchor',
        signaling: 'peer_room_relay',
        offloadedModelArtifacts: true,
        adapterRegistry: 'signed_metadata_only',
        adapterCanaryRegistry: 'signed_non_routable_evidence',
        adapterArtifactTransport: 'cache_peer_origin',
        modelArtifactBaseConfigured: Boolean(process.env.REPLOID_POOL_MODEL_BASE_URL || process.env.POOL_MODEL_BASE_URL),
        turn: getPublicTurnServiceStatus(turnEnv)
      },
      auth: effectivePoolAuthPolicy(authOptions, req),
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
    const runtimeBundle = await resolveRuntimeBundleIdentity();
    const metrics = await store.getMetrics();
    const storageMode = store.kind || 'unknown';
    const authVerifierConfigured = typeof verifyAuthToken === 'function';
    const authRequired = authPolicy.required;
    const modelArtifactBaseConfigured = Boolean(configuredEnvValue('REPLOID_POOL_MODEL_BASE_URL', 'POOL_MODEL_BASE_URL'));
    const dopplerModuleConfigured = Boolean(configuredEnvValue('REPLOID_DOPPLER_MODULE_URL', 'POOL_DOPPLER_MODULE_URL'));
    const dopplerStorageModuleConfigured = Boolean(configuredEnvValue(
      'REPLOID_DOPPLER_STORAGE_MODULE_URL',
      'POOL_DOPPLER_STORAGE_MODULE_URL'
    ));
    const dopplerKernelBaseConfigured = Boolean(configuredEnvValue('REPLOID_DOPPLER_KERNEL_BASE_URL', 'POOL_DOPPLER_KERNEL_BASE_URL'));
    const privateAdapterDeliveryConfigured = typeof createAdapterDownloadUrl === 'function';
    const releaseSourceRevision = configuredReleaseValue(releaseEnv, 'REPLOID_RELEASE_SOURCE_REVISION');
    const releaseSourceRevisionValid = /^[a-f0-9]{40}$/.test(releaseSourceRevision || '');
    const releaseImage = configuredReleaseValue(releaseEnv, 'REPLOID_RELEASE_IMAGE');
    const releaseImageBound = releaseSourceRevisionValid
      && typeof releaseImage === 'string'
      && releaseImage.endsWith(`:${releaseSourceRevision}`);
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
      && (!readinessConfig.requiresDopplerStorageModuleConfiguration || dopplerStorageModuleConfigured)
      && (!readinessConfig.requiresDopplerKernelBaseConfiguration || dopplerKernelBaseConfigured)
      && (!readinessConfig.requiresPrivateAdapterDeliverySigner || privateAdapterDeliveryConfigured)
      && (!readinessConfig.requiresCommitRevealStore || commitRevealSupported)
      && turn.configured
      && (storageMode !== 'firestore' || (releaseSourceRevisionValid && releaseImageBound))
      && (storageMode !== 'firestore' || /^sha256:[a-f0-9]{64}$/.test(runtimeBundle.runtimeBundleHash || ''))
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
      release: {
        sourceRevision: releaseSourceRevision,
        sourceRevisionValid: releaseSourceRevisionValid,
        image: releaseImage,
        imageBoundToSourceRevision: releaseImageBound,
        runtimeBundleHash: runtimeBundle.runtimeBundleHash,
        runtimeFileCount: runtimeBundle.files?.length || 0,
        platformRevision: configuredReleaseValue(releaseEnv, 'K_REVISION'),
        platformConfiguration: configuredReleaseValue(releaseEnv, 'K_CONFIGURATION'),
        platformService: configuredReleaseValue(releaseEnv, 'K_SERVICE')
      },
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
        dopplerStorageModuleConfigured,
        dopplerStorageModuleEnv: dopplerStorageModuleConfigured ? 'configured' : 'missing',
        dopplerKernelBaseConfigured,
        dopplerKernelBaseEnv: dopplerKernelBaseConfigured ? 'configured' : 'missing',
        adapterDelivery: {
          configured: privateAdapterDeliveryConfigured,
          provider: privateAdapterDeliveryConfigured ? 'gcs-v4-generation-pinned' : null
        },
        hybridP2PAnchor: true,
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
          address: rateLimits.address,
          principal: rateLimits.principal,
          qualification: rateLimits.qualification,
          rationale: rateLimits.rationale,
          // Compatibility fields identify the individual control budget.
          maxRequests: rateLimits.principal.control.maxRequests,
          bucketMs: rateLimits.principal.control.windowMs
        },
        metricsAvailable: !!metrics
      },
      identity: {
        serverAuth: {
          ...effectivePoolAuthPolicy(authOptions, req),
          explicitRequired: requireAuth,
          requiredByPersistentStore: storageMode === 'firestore'
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
