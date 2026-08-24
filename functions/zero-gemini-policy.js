export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_REFERER = 'https://replo.id';
export const DEFAULT_MAX_MESSAGES = 64;
export const DEFAULT_MAX_INPUT_CHARS = 120000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_CLIENT_REQUESTS_PER_MINUTE = 12;
export const DEFAULT_GLOBAL_REQUESTS_PER_MINUTE = 120;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_RATE_BUCKETS = 2048;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'https://replo.id',
  'https://www.replo.id',
  'https://reploid.web.app',
  'https://reploid.firebaseapp.com',
  'http://localhost:8000',
  'http://localhost:5173',
  'http://127.0.0.1:8000',
  'http://127.0.0.1:5173'
]);

const rateBuckets = new Map();

export const numberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const getAllowedOrigins = () => {
  const raw = String(process.env.ZERO_GEMINI_ALLOWED_ORIGINS || '').trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const isAllowedOrigin = (origin) => {
  return !origin || getAllowedOrigins().includes(origin);
};

export const pruneRateBuckets = (now) => {
  for (const [key, timestamps] of rateBuckets) {
    const recent = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) rateBuckets.delete(key);
    else rateBuckets.set(key, recent);
  }
  const maximumBuckets = Math.floor(numberEnv('ZERO_GEMINI_MAX_RATE_BUCKETS', DEFAULT_MAX_RATE_BUCKETS));
  if (rateBuckets.size <= maximumBuckets) return;
  const oldestFirst = [...rateBuckets.entries()]
    .sort(([, left], [, right]) => (left.at(-1) || 0) - (right.at(-1) || 0));
  for (const [key] of oldestFirst.slice(0, rateBuckets.size - maximumBuckets)) {
    rateBuckets.delete(key);
  }
};

const checkBucket = (key, limit, now) => {
  const current = rateBuckets.get(key) || [];
  const recent = current.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= limit) {
    rateBuckets.set(key, recent);
    const oldest = Math.min(...recent);
    return {
      allowed: false,
      retryAfterMs: Math.max(1000, RATE_LIMIT_WINDOW_MS - (now - oldest))
    };
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return {
    allowed: true,
    retryAfterMs: 0
  };
};

export const enforceRateLimit = (req) => {
  const now = Date.now();
  pruneRateBuckets(now);
  const clientLimit = numberEnv('ZERO_GEMINI_CLIENT_RPM', DEFAULT_CLIENT_REQUESTS_PER_MINUTE);
  const globalLimit = numberEnv('ZERO_GEMINI_GLOBAL_RPM', DEFAULT_GLOBAL_REQUESTS_PER_MINUTE);
  const clientKey = `uid:${String(req.zeroIdentity?.uid || '').trim()}`;
  const globalBucket = checkBucket('global', globalLimit, now);
  const clientBucket = checkBucket(clientKey, clientLimit, now);
  const retryAfterMs = Math.max(globalBucket.retryAfterMs, clientBucket.retryAfterMs);
  return {
    allowed: globalBucket.allowed && clientBucket.allowed,
    clientKey,
    clientLimit,
    globalLimit,
    retryAfterMs,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
  };
};

export const getAllowedModels = () => {
  const configured = String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const configuredList = String(process.env.ZERO_GEMINI_ALLOWED_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return new Set(configuredList.length > 0 ? configuredList : [configured]);
};

export const validateMessages = (messages) => {
  if (!Array.isArray(messages)) {
    throw new Error('messages must be an array');
  }
  const maxMessages = numberEnv('ZERO_GEMINI_MAX_MESSAGES', DEFAULT_MAX_MESSAGES);
  if (messages.length > maxMessages) {
    throw new Error(`messages exceeds limit (${maxMessages})`);
  }
  const maxInputChars = numberEnv('ZERO_GEMINI_MAX_INPUT_CHARS', DEFAULT_MAX_INPUT_CHARS);
  const totalChars = messages.reduce((sum, message) => {
    const content = message?.content;
    const text = typeof content === 'string'
      ? content
      : content === null || content === undefined
        ? ''
        : JSON.stringify(content);
    return sum + text.length;
  }, 0);
  if (totalChars > maxInputChars) {
    throw new Error(`input exceeds limit (${maxInputChars} chars)`);
  }
};

export const zeroGeminiPolicy = Object.freeze({
  getAllowedModels,
  isAllowedOrigin,
  pruneRateBuckets,
  rateBuckets
});
