import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_REFERER = 'https://replo.id';
const PROVIDER = 'gemini';
const ALLOWED_METHODS = 'GET,POST,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, X-Reploid-Client-Id';
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
const DEFAULT_MAX_MESSAGES = 64;
const DEFAULT_MAX_INPUT_CHARS = 120000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_CLIENT_REQUESTS_PER_MINUTE = 12;
const DEFAULT_GLOBAL_REQUESTS_PER_MINUTE = 120;
const rateBuckets = new Map();

const numberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getAllowedOrigins = () => {
  const raw = String(process.env.ZERO_GEMINI_ALLOWED_ORIGINS || '').trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  return getAllowedOrigins().includes(origin);
};

const setHeaders = (req, res) => {
  const origin = req.headers.origin || '';
  const allowedOrigins = getAllowedOrigins();
  const responseOrigin = origin && allowedOrigins.includes(origin)
    ? origin
    : allowedOrigins[0] || DEFAULT_REFERER;
  res.set('Access-Control-Allow-Origin', responseOrigin);
  res.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Origin');
};

const toText = (value) => typeof value === 'string'
  ? value
  : value === null || value === undefined
    ? ''
    : JSON.stringify(value);

const toGeminiPayload = (messages = [], { maxOutputTokens = 8192 } = {}) => {
  const systemText = messages
    .filter((message) => message?.role === 'system')
    .map((message) => toText(message.content).trim())
    .filter(Boolean)
    .join('\n\n');
  const contents = messages
    .filter((message) => message?.role !== 'system')
    .map((message) => ({
      role: message?.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: toText(message?.content).trim() }]
    }))
    .filter((message) => message.parts[0].text);

  const payload = {
    contents: contents.length > 0
      ? contents
      : [{ role: 'user', parts: [{ text: 'Continue.' }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens
    }
  };

  if (systemText) {
    payload.systemInstruction = {
      parts: [{ text: systemText }]
    };
  }

  return payload;
};

const extractGeminiContent = (data = {}) => {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || '')
    .filter(Boolean)
    .join('');
};

const readError = async (response) => {
  const text = await response.text().catch(() => '');
  if (!text) return `Gemini API error (${response.status})`;
  try {
    const data = JSON.parse(text);
    return data?.error?.message || `Gemini API error (${response.status})`;
  } catch {
    return text.slice(0, 240);
  }
};

const getSecretValue = () => {
  const value = geminiApiKey.value();
  return typeof value === 'string' ? value.trim() : '';
};

const getClientKey = (req) => {
  const explicit = String(req.headers['x-reploid-client-id'] || '').trim();
  if (explicit) return `client:${explicit.slice(0, 96)}`;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return `ip:${forwarded}`;
  return `ip:${req.ip || 'unknown'}`;
};

const checkBucket = (key, limit, now) => {
  const windowMs = 60 * 1000;
  const current = rateBuckets.get(key) || [];
  const recent = current.filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return true;
};

const enforceRateLimit = (req) => {
  const now = Date.now();
  const clientLimit = numberEnv('ZERO_GEMINI_CLIENT_RPM', DEFAULT_CLIENT_REQUESTS_PER_MINUTE);
  const globalLimit = numberEnv('ZERO_GEMINI_GLOBAL_RPM', DEFAULT_GLOBAL_REQUESTS_PER_MINUTE);
  const clientKey = getClientKey(req);
  const globalAllowed = checkBucket('global', globalLimit, now);
  const clientAllowed = checkBucket(clientKey, clientLimit, now);
  return {
    allowed: globalAllowed && clientAllowed,
    clientKey,
    clientLimit,
    globalLimit
  };
};

const validateMessages = (messages) => {
  if (!Array.isArray(messages)) {
    throw new Error('messages must be an array');
  }

  const maxMessages = numberEnv('ZERO_GEMINI_MAX_MESSAGES', DEFAULT_MAX_MESSAGES);
  if (messages.length > maxMessages) {
    throw new Error(`messages exceeds limit (${maxMessages})`);
  }

  const maxInputChars = numberEnv('ZERO_GEMINI_MAX_INPUT_CHARS', DEFAULT_MAX_INPUT_CHARS);
  const totalChars = messages.reduce((sum, message) => sum + toText(message?.content).length, 0);
  if (totalChars > maxInputChars) {
    throw new Error(`input exceeds limit (${maxInputChars} chars)`);
  }
};

export const zeroGemini = onRequest({
  region: 'us-central1',
  cors: false,
  secrets: [geminiApiKey],
  maxInstances: 1,
  concurrency: 20,
  memory: '256MiB',
  timeoutSeconds: 60
}, async (req, res) => {
  setHeaders(req, res);

  if (!isAllowedOrigin(req.headers.origin || '')) {
    res.status(403).json({ error: 'Origin not allowed.' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const key = getSecretValue();

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      functionBacked: true,
      zeroOnly: true,
      providers: [PROVIDER],
      configuredProviders: [PROVIDER],
      primaryProvider: PROVIDER,
      primaryModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      hasApiKey: !!key,
      limits: {
        maxMessages: numberEnv('ZERO_GEMINI_MAX_MESSAGES', DEFAULT_MAX_MESSAGES),
        maxInputChars: numberEnv('ZERO_GEMINI_MAX_INPUT_CHARS', DEFAULT_MAX_INPUT_CHARS),
        maxOutputTokens: numberEnv('ZERO_GEMINI_MAX_OUTPUT_TOKENS', DEFAULT_MAX_OUTPUT_TOKENS),
        clientRequestsPerMinute: numberEnv('ZERO_GEMINI_CLIENT_RPM', DEFAULT_CLIENT_REQUESTS_PER_MINUTE),
        globalRequestsPerMinute: numberEnv('ZERO_GEMINI_GLOBAL_RPM', DEFAULT_GLOBAL_REQUESTS_PER_MINUTE)
      }
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use GET for health or POST for chat.' });
    return;
  }

  if (!key) {
    res.status(500).json({ error: 'GEMINI_API_KEY secret is not configured.' });
    return;
  }

  const rateLimit = enforceRateLimit(req);
  if (!rateLimit.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded.',
      clientRequestsPerMinute: rateLimit.clientLimit,
      globalRequestsPerMinute: rateLimit.globalLimit
    });
    return;
  }

  const provider = String(req.body?.provider || PROVIDER).toLowerCase();
  if (provider !== PROVIDER) {
    res.status(400).json({ error: 'Zero Cloud Function only serves Gemini.' });
    return;
  }

  try {
    validateMessages(req.body?.messages || []);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  const model = String(req.body?.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const maxOutputTokens = Number(req.body?.max_tokens || req.body?.maxOutputTokens || 8192);
  const maxAllowedOutputTokens = numberEnv('ZERO_GEMINI_MAX_OUTPUT_TOKENS', DEFAULT_MAX_OUTPUT_TOKENS);
  const payload = toGeminiPayload(req.body?.messages || [], {
    maxOutputTokens: Math.max(1, Math.min(maxAllowedOutputTokens, Number.isFinite(maxOutputTokens) ? maxOutputTokens : maxAllowedOutputTokens))
  });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': process.env.GEMINI_REFERER || DEFAULT_REFERER
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      res.status(response.status).json({ error: await readError(response) });
      return;
    }

    const data = await response.json();
    const content = extractGeminiContent(data);
    res.status(200).json({
      content,
      raw: content,
      provider: PROVIDER,
      model,
      timestamp: Date.now(),
      usage: data.usageMetadata || null
    });
  } catch (error) {
    res.status(502).json({ error: error?.message || 'Gemini request failed.' });
  }
});
