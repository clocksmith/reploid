import { isTransientProviderFailure, providerRetryDelay } from './provider-recovery.js';

/**
 * @fileoverview Lab strategy provider throttling inputs, backoff and parking.
 * Parks an attempt when its provider is unavailable or rejects the request, and
 * schedules the engine-owned resume that restarts it from the parked context.
 */

export const getModelIdentity = (model = {}) => (
  String(model.id || model.model || model.modelId || model.name || '')
);

export function createLabProviderRecovery({ deps, engine, loop, pushActivity: _pushActivity,
  writeCycleArtifact: _writeCycleArtifact, startRun }) {
  const { Utils, EventBus } = deps;
  const { logger } = Utils;
  const {
    MANAGED_SERVER_PROXY_REJECT_STATUSES,
    getProviderErrorStatus,
    isManagedServerProxyModel,
    resolveProviderThrottleConfig
  } = deps.Policies;

  const getProviderThrottleConfig = (model = loop.modelConfig) => resolveProviderThrottleConfig([
    model?.agentThrottle, model?.providerThrottle, model?.throttle?.provider,
    loop.policy.legacyAgent.settings?.providerThrottle
  ]);

  const isTransientProviderError = isTransientProviderFailure;

  const isManagedProviderRequestError = (error) => {
    const status = getProviderErrorStatus(error);
    return MANAGED_SERVER_PROXY_REJECT_STATUSES.has(status)
      && isManagedServerProxyModel(loop.modelConfig || loop.modelConfigs[0]);
  };

  const computeProviderBackoffMs = (attempt, error, model = loop.modelConfig) => {
    const config = getProviderThrottleConfig(model);
    return providerRetryDelay(error, { attempt, baseMs: config.providerBackoffBaseMs,
      maxMs: config.providerBackoffMaxMs, jitterRatio: config.providerBackoffJitterRatio });
  };

  const clearProviderResumeTimer = () => {
    engine.cancelRetry();
    loop.providerResumeState = null;
  };

  const scheduleProviderResume = (resumeState, delayMs) => {
    clearProviderResumeTimer();

    const retryAt = Date.now() + delayMs;
    loop.providerResumeState = {
      ...resumeState,
      delayMs,
      retryAt
    };

    engine.scheduleRetry(delayMs, () => {
      const state = loop.providerResumeState;
      loop.providerResumeState = null;

      if (!state || loop.isRunning) return;
      const resumeKind = state.resumeKind || 'provider';
      const resumeType = resumeKind === 'tool_cooldown' ? 'tool_cooldown_resume' : 'provider_resume';
      EventBus.emit('agent:history', {
        type: resumeType,
        cycle: state.iteration,
        attempt: state.providerRetryAttempt,
        content: state.resumeContent || 'Resuming after provider backoff',
        ts: Date.now()
      });
      EventBus.emit('agent:status', {
        state: 'RESUMING',
        activity: state.resumeActivity || 'Retrying provider request',
        cycle: state.iteration,
        retryAttempt: state.providerRetryAttempt
      });
      _pushActivity({
        kind: resumeType,
        cycle: state.iteration,
        attempt: state.providerRetryAttempt
      });

      loop.providerResumePromise = startRun(state.goal, state).catch((error) => {
        logger.error('[Agent] Provider resume failed:', error);
        EventBus.emit('agent:error', {
          error: error?.message || String(error),
          cycle: state.iteration
        });
      });
    });
  };

  // Transient provider failures park the attempt and, when allowed, schedule a resume.
  const parkTransientProviderFailure = async (attempt, err) => {
    const { goal, context, iteration, providerRetryAttempt, consecutiveReadOnlyBuildBatches } = attempt;
    const status = getProviderErrorStatus(err);
    const throttleConfig = getProviderThrottleConfig(loop.modelConfig);
    const delayMs = computeProviderBackoffMs(providerRetryAttempt, err, loop.modelConfig);
    const nextRetryAttempt = providerRetryAttempt + 1;
    const retryAt = Date.now() + delayMs;
    attempt.providerParked = true;
    attempt.scheduledProviderResume = throttleConfig.providerAutoResume;
    attempt.providerParkReason = `Provider unavailable${status ? ` (${status})` : ''}; ${attempt.scheduledProviderResume ? 'retry scheduled' : 'auto-resume disabled'}`;
    logger.warn(`[Agent] ${attempt.providerParkReason}; parking run.`);
    EventBus.emit('agent:warning', {
      type: 'provider_unavailable',
      cycle: iteration,
      status,
      error: err?.message || String(err),
      retryAttempt: nextRetryAttempt,
      retryDelayMs: delayMs,
      retryAt,
      autoResume: attempt.scheduledProviderResume
    });
    EventBus.emit('agent:history', {
      type: 'provider_unavailable',
      cycle: iteration,
      content: attempt.providerParkReason,
      status,
      error: err?.message || String(err),
      retryAttempt: nextRetryAttempt,
      retryDelayMs: delayMs,
      retryAt,
      autoResume: attempt.scheduledProviderResume,
      ts: Date.now()
    });
    _pushActivity({
      kind: 'provider_unavailable',
      cycle: iteration,
      status,
      error: err?.message || String(err),
      retryAttempt: nextRetryAttempt,
      retryDelayMs: delayMs,
      retryAt,
      autoResume: attempt.scheduledProviderResume
    });
    try {
      await _writeCycleArtifact(iteration || 0, 'provider-recovery.json', {
        event: 'provider:parked',
        cycle: iteration,
        status,
        error: err?.message || String(err),
        retryAttempt: nextRetryAttempt,
        retryDelayMs: delayMs,
        retryAt,
        autoResume: attempt.scheduledProviderResume
      });
    } catch (artifactError) {
      logger.debug('[Agent] Failed to write provider recovery artifact:', artifactError?.message || artifactError);
    }
    if (attempt.scheduledProviderResume) {
      scheduleProviderResume({
        goal,
        context,
        iteration,
        providerRetryAttempt: nextRetryAttempt,
        consecutiveReadOnlyBuildBatches
      }, delayMs);
    }
  };

  // Managed proxy rejections park the attempt without an automatic resume.
  const parkRejectedProviderRequest = async (attempt, err) => {
    const { iteration } = attempt;
    const status = getProviderErrorStatus(err);
    attempt.providerParked = true;
    attempt.scheduledProviderResume = false;
    attempt.providerParkReason = `Provider request rejected${status ? ` (${status})` : ''}: ${err?.responseMessage || err?.details?.responseMessage || err?.message || String(err)}`;
    logger.warn(`[Agent] ${attempt.providerParkReason}; parking run.`);
    EventBus.emit('agent:warning', {
      type: 'provider_request_rejected',
      cycle: iteration,
      status,
      error: err?.message || String(err),
      responseMessage: err?.responseMessage || err?.details?.responseMessage || null,
      autoResume: false
    });
    EventBus.emit('agent:history', {
      type: 'provider_request_rejected',
      cycle: iteration,
      content: attempt.providerParkReason,
      status,
      error: err?.message || String(err),
      responseMessage: err?.responseMessage || err?.details?.responseMessage || null,
      autoResume: false,
      ts: Date.now()
    });
    _pushActivity({
      kind: 'provider_request_rejected',
      cycle: iteration,
      status,
      error: err?.message || String(err),
      responseMessage: err?.responseMessage || err?.details?.responseMessage || null
    });
    try {
      await _writeCycleArtifact(iteration || 0, 'provider-recovery.json', {
        event: 'provider:request-rejected',
        cycle: iteration,
        status,
        error: err?.message || String(err),
        responseMessage: err?.responseMessage || err?.details?.responseMessage || null,
        autoResume: false
      });
    } catch (artifactError) {
      logger.debug('[Agent] Failed to write provider rejection artifact:', artifactError?.message || artifactError);
    }
  };

  return {
    getProviderThrottleConfig,
    isTransientProviderError,
    isManagedProviderRequestError,
    computeProviderBackoffMs,
    clearProviderResumeTimer,
    scheduleProviderResume,
    parkTransientProviderFailure,
    parkRejectedProviderRequest
  };
}
