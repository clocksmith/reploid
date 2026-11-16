/** Public configuration, RTC issuance and coordinator readiness projections. */
import { DETERMINISTIC_GENERATION_CONFIG, listPolicies } from '../policy-router.js';
import { LAUNCH_MODEL } from '../model-contract.js';
import { POOL_CONFIG, POOL_CONFIG_HASH, POOL_CONFIG_VERSION, validatePoolConfig } from '../config.js';
import { createTurnRtcConfiguration, getPublicTurnServiceStatus } from '../turn-credentials.js';
import { asyncRoute, effectivePoolAuthPolicy, hasCoordinatorClaim } from '../http-admission.js';

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

export function registerPoolMetadataRoutes(router, { turnEnv, store, authOptions, allowCanaryCreation }) {
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
}

export function registerPoolDeploymentRoutes(router, { store, resolveRuntimeBundleIdentity, verifyAuthToken, authPolicy, createAdapterDownloadUrl, releaseEnv, turnEnv, rateLimits, authOptions, requireAuth, allowCanaryCreation }) {
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
}
