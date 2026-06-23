import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_REFERER = 'https://replo.id';
const PROVIDER = 'gemini';
const ALLOWED_METHODS = 'GET,POST,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, X-Reploid-Client-Id';

const setHeaders = (res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.set('Cache-Control', 'no-store');
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

export const zeroGemini = onRequest({
  region: 'us-central1',
  cors: true,
  secrets: [geminiApiKey]
}, async (req, res) => {
  setHeaders(res);

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
      hasApiKey: !!key
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

  const provider = String(req.body?.provider || PROVIDER).toLowerCase();
  if (provider !== PROVIDER) {
    res.status(400).json({ error: 'Zero Cloud Function only serves Gemini.' });
    return;
  }

  const model = String(req.body?.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const maxOutputTokens = Number(req.body?.max_tokens || req.body?.maxOutputTokens || 8192);
  const payload = toGeminiPayload(req.body?.messages || [], {
    maxOutputTokens: Math.max(1, Math.min(8192, Number.isFinite(maxOutputTokens) ? maxOutputTokens : 8192))
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
