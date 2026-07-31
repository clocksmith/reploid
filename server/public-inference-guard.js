/**
 * @fileoverview Admission control for the anonymous shared inference gateway.
 *
 * This module is intentionally independent from Express and provider SDKs so
 * policy parsing and quota accounting can be exercised without live keys.
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_INPUT_CHARS = 16_000;
const DEFAULT_REQUESTS_PER_MINUTE = 5;
const DEFAULT_REQUESTS_PER_DAY = 40;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 1;
const CHARS_PER_TOKEN = 4;

const asPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const asNonNegativeNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseJsonObject = (value, label) => {
  if (!value) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
};

const normalizePolicy = (provider, model, value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Public inference policy ${provider}/${model} must be an object`);
  }
  const maxInputTokens = asPositiveInteger(value.maxInputTokens, null);
  const maxOutputTokens = asPositiveInteger(value.maxOutputTokens, null);
  const maxEstimatedCostUsd = asNonNegativeNumber(value.maxEstimatedCostUsd, null);
  const inputUsdPerMillionTokens = asNonNegativeNumber(value.inputUsdPerMillionTokens, null);
  const outputUsdPerMillionTokens = asNonNegativeNumber(value.outputUsdPerMillionTokens, null);
  const maxDailyCostUsd = asNonNegativeNumber(value.maxDailyCostUsd, null);
  if (!maxInputTokens || !maxOutputTokens || maxEstimatedCostUsd === null
    || inputUsdPerMillionTokens === null || outputUsdPerMillionTokens === null
    || maxDailyCostUsd === null) {
    throw new Error(`Public inference policy ${provider}/${model} requires input/output token and USD caps`);
  }
  return Object.freeze({
    provider,
    model,
    maxInputTokens,
    maxOutputTokens,
    maxEstimatedCostUsd,
    inputUsdPerMillionTokens,
    outputUsdPerMillionTokens,
    maxDailyCostUsd
  });
};

export function createPublicInferenceConfig(env = process.env) {
  const enabled = env.REPLOID_PUBLIC_INFERENCE_ENABLED === 'true';
  const rawPolicies = parseJsonObject(
    env.REPLOID_PUBLIC_INFERENCE_MODEL_POLICIES,
    'REPLOID_PUBLIC_INFERENCE_MODEL_POLICIES'
  );
  const policies = new Map();
  for (const [provider, models] of Object.entries(rawPolicies)) {
    if (!models || typeof models !== 'object' || Array.isArray(models)) {
      throw new Error(`Public inference provider ${provider} must map models to policies`);
    }
    for (const [model, policy] of Object.entries(models)) {
      const normalizedProvider = String(provider || '').trim().toLowerCase();
      const normalizedModel = String(model || '').trim();
      if (!normalizedProvider || !normalizedModel) {
        throw new Error('Public inference provider and model identifiers are required');
      }
      policies.set(`${normalizedProvider}\u0000${normalizedModel}`, normalizePolicy(normalizedProvider, normalizedModel, policy));
    }
  }
  if (enabled && policies.size === 0) {
    throw new Error('Anonymous inference requires at least one configured model policy');
  }
  return Object.freeze({
    enabled,
    maxInputChars: asPositiveInteger(env.REPLOID_PUBLIC_INFERENCE_MAX_INPUT_CHARS, DEFAULT_MAX_INPUT_CHARS),
    requestsPerMinute: asPositiveInteger(env.REPLOID_PUBLIC_INFERENCE_REQUESTS_PER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE),
    requestsPerDay: asPositiveInteger(env.REPLOID_PUBLIC_INFERENCE_REQUESTS_PER_DAY, DEFAULT_REQUESTS_PER_DAY),
    maxConcurrentRequests: asPositiveInteger(
      env.REPLOID_PUBLIC_INFERENCE_MAX_CONCURRENT_REQUESTS,
      DEFAULT_MAX_CONCURRENT_REQUESTS
    ),
    policies
  });
}

const messageText = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  if (!['system', 'user', 'assistant'].includes(message.role)) return null;
  return typeof message.content === 'string' ? message.content : null;
};

const requestedOutputTokens = (body, policy) => {
  const requested = body?.max_tokens
    ?? body?.maxTokens
    ?? body?.generationConfig?.maxOutputTokens
    ?? policy.maxOutputTokens;
  const parsed = Number(requested);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
};

const startOfDay = (now) => Math.floor(now / DAY_MS) * DAY_MS;

const estimatedCostUsd = ({ inputTokens, outputTokens, policy }) => (
  (inputTokens * policy.inputUsdPerMillionTokens / 1_000_000)
  + (outputTokens * policy.outputUsdPerMillionTokens / 1_000_000)
);

export function createPublicInferenceGuard({
  config = createPublicInferenceConfig(),
  now = () => Date.now(),
  getClientKey = (request = {}) => String(request.ip || request.socket?.remoteAddress || 'unknown')
} = {}) {
  const clients = new Map();

  const prune = (current) => {
    for (const [key, bucket] of clients.entries()) {
      if (bucket.inFlight === 0 && current - bucket.lastSeenAt > DAY_MS) clients.delete(key);
    }
  };

  const reject = (status, error, details = {}) => ({ ok: false, status, error, ...details });

  const admit = (request = {}) => {
    const current = now();
    prune(current);
    if (!config.enabled) return reject(503, 'Anonymous inference is not enabled');
    const body = request.body || {};
    const provider = String(body.provider || '').trim().toLowerCase();
    const model = String(body.model || '').trim();
    const policy = config.policies.get(`${provider}\u0000${model}`);
    if (!policy) return reject(403, 'Provider or model is not available for anonymous inference');
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reject(400, 'messages must be a non-empty array');
    }
    if (body.messages.length > 32) return reject(413, 'Too many messages');
    const texts = body.messages.map(messageText);
    if (texts.some((text) => text === null)) {
      return reject(400, 'Messages must use supported roles and string content');
    }
    const inputChars = texts.reduce((total, text) => total + text.length, 0);
    if (inputChars > config.maxInputChars) return reject(413, 'Input is too large');
    const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
    if (inputTokens > policy.maxInputTokens) return reject(413, 'Input token budget exceeded');
    const outputTokens = requestedOutputTokens(body, policy);
    if (!outputTokens || outputTokens > policy.maxOutputTokens) {
      return reject(413, 'Output token budget exceeded');
    }
    const estimatedCost = estimatedCostUsd({ inputTokens, outputTokens, policy });
    if (estimatedCost > policy.maxEstimatedCostUsd) {
      return reject(413, 'Request cost budget exceeded');
    }
    const clientKey = String(getClientKey(request) || 'unknown');
    const dayStart = startOfDay(current);
    const bucket = clients.get(clientKey) || {
      minuteRequests: [],
      dayStart,
      dayRequests: 0,
      reservedCostUsd: 0,
      inFlight: 0,
      lastSeenAt: current
    };
    if (bucket.dayStart !== dayStart) {
      bucket.dayStart = dayStart;
      bucket.dayRequests = 0;
      bucket.reservedCostUsd = 0;
    }
    bucket.minuteRequests = bucket.minuteRequests.filter((timestamp) => current - timestamp < MINUTE_MS);
    bucket.lastSeenAt = current;
    if (bucket.minuteRequests.length >= config.requestsPerMinute) {
      clients.set(clientKey, bucket);
      return reject(429, 'Per-client request rate exceeded', { retryAfter: 60 });
    }
    if (bucket.dayRequests >= config.requestsPerDay) {
      clients.set(clientKey, bucket);
      return reject(429, 'Per-client daily request quota exceeded', { retryAfter: 24 * 60 * 60 });
    }
    if (bucket.inFlight >= config.maxConcurrentRequests) {
      clients.set(clientKey, bucket);
      return reject(429, 'Per-client concurrent request quota exceeded', { retryAfter: 1 });
    }
    if (bucket.reservedCostUsd + estimatedCost > policy.maxDailyCostUsd) {
      clients.set(clientKey, bucket);
      return reject(429, 'Per-client daily cost cap exceeded', { retryAfter: 24 * 60 * 60 });
    }
    bucket.minuteRequests.push(current);
    bucket.dayRequests += 1;
    bucket.reservedCostUsd += estimatedCost;
    bucket.inFlight += 1;
    clients.set(clientKey, bucket);
    let released = false;
    return {
      ok: true,
      clientKey,
      policy,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimatedCost,
      release() {
        if (released) return;
        released = true;
        bucket.inFlight = Math.max(0, bucket.inFlight - 1);
        bucket.lastSeenAt = now();
      }
    };
  };

  return Object.freeze({ admit, config });
}

export function createPublicInferenceMiddleware({
  guard = null,
  configurationError = null
} = {}) {
  return (req, res, next) => {
    if (!guard) {
      return res.status(503).json({
        error: 'Anonymous inference is unavailable',
        details: configurationError || 'Anonymous inference is not configured'
      });
    }
    const admission = guard.admit(req);
    if (!admission.ok) {
      if (admission.retryAfter) res.setHeader('Retry-After', String(admission.retryAfter));
      return res.status(admission.status).json({
        error: admission.error,
        ...(admission.retryAfter ? { retryAfter: admission.retryAfter } : {})
      });
    }
    req.publicInferenceAdmission = admission;
    res.once('finish', admission.release);
    res.once('close', admission.release);
    return next();
  };
}

export default {
  createPublicInferenceConfig,
  createPublicInferenceGuard,
  createPublicInferenceMiddleware
};
