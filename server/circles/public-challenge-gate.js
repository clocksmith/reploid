import { formatHostDisclosure } from './admission.js';

export const PUBLIC_CHALLENGE_MAX_OUTPUT_TOKENS = 16;
export const PUBLIC_CHALLENGE_DEFAULT_MAX_EXPECTED_WAIT_MS = 20_000;
const MINUTE_MS = 60_000;
const MAX_VISITOR_BUCKETS = 20_000;
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/**
 * Derive per-minute and per-visitor caps from measured throughput on the pinned model.
 * Keeps Wave 2 public challenge admission strictly within observed single-host capacity.
 */
export function derivePublicChallengeCaps({
  measuredAttemptsPerMinute,
  hostCount = 1,
  safetyFactor = 0.8,
  maxTurnsPerVisitor = 3,
  visitorWindowMinutes = 60
}) {
  if (!Number.isFinite(measuredAttemptsPerMinute) || measuredAttemptsPerMinute <= 0) {
    throw fail('CHALLENGE_CONFIG', 'Measured attempts per minute must be positive');
  }
  if (!positive(hostCount) || !Number.isFinite(safetyFactor) || safetyFactor <= 0 || safetyFactor > 1) {
    throw fail('CHALLENGE_CONFIG', 'Host count and safety factor (0..1] are required');
  }
  if (!positive(maxTurnsPerVisitor) || !positive(visitorWindowMinutes)) {
    throw fail('CHALLENGE_CONFIG', 'Positive per-visitor turn cap and window are required');
  }
  const perHostAttemptsPerMinute = Math.max(1, Math.floor(measuredAttemptsPerMinute * safetyFactor));
  const totalAttemptsPerMinute = perHostAttemptsPerMinute * hostCount;
  const estimatedTurnMs = Math.ceil(MINUTE_MS / measuredAttemptsPerMinute);
  return Object.freeze({
    measuredAttemptsPerMinute,
    hostCount,
    safetyFactor,
    perHostAttemptsPerMinute,
    totalAttemptsPerMinute,
    maxTurnsPerVisitor,
    visitorWindowMs: visitorWindowMinutes * MINUTE_MS,
    maxOutputTokens: PUBLIC_CHALLENGE_MAX_OUTPUT_TOKENS,
    estimatedTurnMs
  });
}

function validateHost(host, approvedCommunityHostRule, allowRentedGpu) {
  if (!host || !nonEmpty(host.hostPeerId) || !nonEmpty(host.hostLabel)
    || !/^sha256:[a-f0-9]{64}$/.test(host.modelIdentity) || !positive(host.maxConcurrent ?? 1)) {
    throw fail('CHALLENGE_CONFIG', 'Public challenge host requires peer ID, label, exact model identity, and positive concurrency');
  }
  const tier = host.tier ?? 'project';
  if (tier === 'rented' && allowRentedGpu !== true) {
    throw fail('CHALLENGE_SPEND_FORBIDDEN', 'Rented GPU hosts are disabled without an owner-approved spending cap');
  }
  if (tier === 'community' && approvedCommunityHostRule?.(host) !== true) {
    throw fail('CHALLENGE_COMMUNITY_UNAPPROVED', 'Community hosts require explicit approved-host rules before backing the public lane');
  }
  if (!['project', 'community', 'rented'].includes(tier)) {
    throw fail('CHALLENGE_CONFIG', `Unsupported public challenge host tier: ${tier}`);
  }
  return Object.freeze({
    hostPeerId: host.hostPeerId,
    hostLabel: host.hostLabel.trim(),
    modelIdentity: host.modelIdentity,
    tier,
    maxConcurrent: host.maxConcurrent ?? 1,
    disclosure: formatHostDisclosure({ hostPeerId: host.hostPeerId, hostLabel: host.hostLabel })
  });
}

/**
 * Separately toggleable, hard-rate-capped Wave 2 public Daily Challenge gate (#185 / #188).
 * Never enables open-ended public chat; off by default; kill switch immediately returns to replay-only.
 */
export function createPublicChallengeGate({
  enabled = false,
  killSwitch = false,
  host,
  caps,
  maxExpectedWaitMs = PUBLIC_CHALLENGE_DEFAULT_MAX_EXPECTED_WAIT_MS,
  approvedCommunityHostRule = null,
  allowRentedGpu = false,
  now = Date.now
}) {
  if (!caps || !positive(caps.perHostAttemptsPerMinute) || !positive(caps.maxTurnsPerVisitor)
    || !positive(caps.visitorWindowMs) || !positive(caps.estimatedTurnMs)) {
    throw fail('CHALLENGE_CONFIG', 'Measured public challenge caps are required');
  }
  if (!positive(maxExpectedWaitMs)) {
    throw fail('CHALLENGE_CONFIG', 'Positive expected wait threshold required');
  }
  const validatedHost = validateHost(host, approvedCommunityHostRule, allowRentedGpu);

  let laneEnabled = enabled === true;
  let killed = killSwitch === true;
  let active = 0;
  let minuteWindowStart = now();
  let minuteUsed = 0;
  const visitors = new Map();
  let peakActive = 0;
  let admittedTotal = 0;

  function refreshMinuteWindow(at) {
    if (at - minuteWindowStart >= MINUTE_MS) {
      minuteWindowStart = at;
      minuteUsed = 0;
    }
  }

  function pruneVisitors(at) {
    if (visitors.size <= MAX_VISITOR_BUCKETS) return;
    for (const [key, entry] of visitors.entries()) {
      if (at - entry.windowStart >= caps.visitorWindowMs) visitors.delete(key);
      if (visitors.size <= MAX_VISITOR_BUCKETS * 0.75) break;
    }
    if (visitors.size > MAX_VISITOR_BUCKETS) {
      const oldestKey = visitors.keys().next().value;
      if (oldestKey !== undefined) visitors.delete(oldestKey);
    }
  }

  function status() {
    const at = now();
    refreshMinuteWindow(at);
    const live = laneEnabled && !killed;
    const expectedWaitMs = active * caps.estimatedTurnMs;
    const rateExhausted = minuteUsed >= caps.perHostAttemptsPerMinute;
    const overCapacity = active >= validatedHost.maxConcurrent || expectedWaitMs > maxExpectedWaitMs || rateExhausted;
    return Object.freeze({
      mode: live ? 'public-challenge' : 'replay-only',
      enabled: laneEnabled,
      killSwitch: killed,
      openChatAllowed: false,
      maxOutputTokens: PUBLIC_CHALLENGE_MAX_OUTPUT_TOKENS,
      host: validatedHost,
      disclosure: validatedHost.disclosure,
      active,
      peakActive,
      admittedTotal,
      maxConcurrent: validatedHost.maxConcurrent,
      minuteUsed,
      perHostAttemptsPerMinute: caps.perHostAttemptsPerMinute,
      maxTurnsPerVisitor: caps.maxTurnsPerVisitor,
      expectedWaitMs,
      maxExpectedWaitMs,
      overCapacity,
      fallback: !live || overCapacity ? ['replay', 'host-your-own'] : []
    });
  }

  function admit({ kind, visitorId, modelIdentity, maxOutputTokens, challengeDay = null }) {
    if (kind !== 'daily-challenge') {
      throw fail('CHALLENGE_CHAT_FORBIDDEN', 'Open public chat is disabled; only invite-scoped chat or capped Daily Challenge turns are allowed', {
        statusCode: 403,
        fallback: ['replay', 'host-your-own']
      });
    }
    if (!laneEnabled || killed) {
      return Object.freeze({
        admitted: false,
        code: 'CHALLENGE_REPLAY_ONLY',
        mode: 'replay-only',
        disclosure: validatedHost.disclosure,
        fallback: ['replay', 'host-your-own']
      });
    }
    if (!nonEmpty(visitorId)) {
      throw fail('CHALLENGE_VISITOR_REQUIRED', 'Visitor identity is required for bounded challenge turns', { statusCode: 400 });
    }
    if (modelIdentity !== validatedHost.modelIdentity) {
      throw fail('CHALLENGE_MODEL_MISMATCH', 'Challenge request must match the pinned model identity', { statusCode: 400 });
    }
    if (!positive(maxOutputTokens) || maxOutputTokens > PUBLIC_CHALLENGE_MAX_OUTPUT_TOKENS) {
      throw fail('CHALLENGE_TOKEN_CAP', `Public challenge turns are hard-capped at ${PUBLIC_CHALLENGE_MAX_OUTPUT_TOKENS} output tokens`, {
        statusCode: 400
      });
    }

    const at = now();
    refreshMinuteWindow(at);
    const expectedWaitMs = (active + 1) * caps.estimatedTurnMs;
    if (expectedWaitMs > maxExpectedWaitMs) {
      return Object.freeze({
        admitted: false,
        code: 'CHALLENGE_WAIT_EXCEEDED',
        mode: 'public-challenge',
        expectedWaitMs,
        maxExpectedWaitMs,
        disclosure: validatedHost.disclosure,
        fallback: ['replay', 'host-your-own']
      });
    }
    if (active >= validatedHost.maxConcurrent) {
      return Object.freeze({
        admitted: false,
        code: 'CHALLENGE_CAPACITY_FULL',
        mode: 'public-challenge',
        expectedWaitMs,
        disclosure: validatedHost.disclosure,
        fallback: ['replay', 'host-your-own']
      });
    }
    if (minuteUsed >= caps.perHostAttemptsPerMinute) {
      return Object.freeze({
        admitted: false,
        code: 'CHALLENGE_HOST_RATE_CAP',
        mode: 'public-challenge',
        retryAfterMs: Math.max(0, MINUTE_MS - (at - minuteWindowStart)),
        disclosure: validatedHost.disclosure,
        fallback: ['replay', 'host-your-own']
      });
    }

    const bucketKey = challengeDay ? `${challengeDay}:${visitorId}` : visitorId;
    let visitor = visitors.get(bucketKey);
    if (!visitor || at - visitor.windowStart >= caps.visitorWindowMs) {
      visitor = { windowStart: at, used: 0 };
      visitors.set(bucketKey, visitor);
    }
    if (visitor.used >= caps.maxTurnsPerVisitor) {
      return Object.freeze({
        admitted: false,
        code: 'CHALLENGE_VISITOR_CAP',
        mode: 'public-challenge',
        usedTurns: visitor.used,
        maxTurnsPerVisitor: caps.maxTurnsPerVisitor,
        disclosure: validatedHost.disclosure,
        fallback: ['replay', 'host-your-own']
      });
    }

    visitor.used += 1;
    minuteUsed += 1;
    active += 1;
    admittedTotal += 1;
    if (active > peakActive) peakActive = active;
    pruneVisitors(at);

    let released = false;
    return Object.freeze({
      admitted: true,
      mode: 'public-challenge',
      hostPeerId: validatedHost.hostPeerId,
      hostLabel: validatedHost.hostLabel,
      modelIdentity: validatedHost.modelIdentity,
      maxOutputTokens,
      disclosure: validatedHost.disclosure,
      remainingVisitorTurns: caps.maxTurnsPerVisitor - visitor.used,
      release() {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
      }
    });
  }

  return Object.freeze({
    status,
    admit,
    setEnabled(value) { laneEnabled = value === true; return status(); },
    setKillSwitch(value) { killed = value === true; return status(); }
  });
}
