import { createRemoteJWKSet, jwtVerify } from 'jose';
import policy from './policy.json';

// Public signing keys only. No Firebase administrator credential leaves Google.
const firebaseKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export async function verifyFirebase(token, projectId, keys = firebaseKeys) {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'], audience: projectId, issuer: `https://securetoken.google.com/${projectId}`,
    requiredClaims: ['exp', 'iat', 'sub', 'auth_time']
  });
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.sub !== 'string' || !payload.sub.length || payload.sub.length > 128
    || !Number.isFinite(payload.iat) || payload.iat > now
    || !Number.isFinite(payload.auth_time) || payload.auth_time > now) throw new Error('Invalid Firebase identity');
  return payload.sub;
}

async function boundedJson(response) {
  if (!response.body) throw new Error('Missing credential response');
  const reader = response.body.getReader();
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > policy.turnMaxResponseBytes) throw new Error('Oversized credential response');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel(); reader.releaseLock(); }
}

export function normalizeIceServers(value) {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('Invalid ICE servers');
  let relay = false;
  const servers = value.map(server => {
    if (!server || typeof server !== 'object') throw new Error('Invalid ICE server');
    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 16) throw new Error('Invalid ICE URLs');
    const filtered = urls.filter(url => {
      if (typeof url !== 'string' || !/^(stun:stun|turns?:turn)\.cloudflare\.com:(3478|5349|443|80|53)(\?transport=(udp|tcp))?$/.test(url)) throw new Error('Unexpected ICE endpoint');
      return !/:53(?:\?|$)/.test(url);
    });
    const credentials = {};
    if (filtered.some(url => url.startsWith('turn'))) {
      if (typeof server.username !== 'string' || !server.username || server.username.length > 2048
        || typeof server.credential !== 'string' || !server.credential || server.credential.length > 2048) throw new Error('Invalid relay credentials');
      relay = true;
      Object.assign(credentials, { username: server.username, credential: server.credential, credentialType: 'password' });
    }
    return { urls: filtered, ...credentials };
  }).filter(server => server.urls.length);
  if (!relay) throw new Error('Missing relay credentials');
  return servers;
}

export async function handleTurn(request, env, { verify = verifyFirebase, fetcher = fetch } = {}) {
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.length > 8192 || !authorization.startsWith('Bearer ')) return Response.json({ error: 'Firebase auth token required' }, { status: 401 });
  let subject;
  try { subject = await verify(authorization.slice(7), env.FIREBASE_PROJECT_ID); }
  catch { return Response.json({ error: 'Firebase auth token invalid' }, { status: 401 }); }
  if (!await env.ADMISSION.getByName('bounded-admission-v1').allowTurn(subject)) {
    return Response.json({ error: 'TURN credential rate limit exceeded', retryAfter: policy.turnWindowMs / 1000 },
      { status: 429, headers: { 'Retry-After': String(policy.turnWindowMs / 1000) } });
  }
  if (!/^[a-f0-9]{32}$/i.test(env.TURN_KEY_ID || '') || !env.TURN_KEY_SECRET) {
    return Response.json({ error: 'TURN relay is not configured', code: 'turn_not_configured' }, { status: 503 });
  }
  const now = Date.now();
  let stage = 'request', upstreamStatus = null;
  try {
    const response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      // Workers supports manual/follow, not the browser's redirect:error mode.
      // A redirect remains non-OK below and never receives this secret.
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(policy.turnTimeoutMs),
      headers: { Authorization: `Bearer ${env.TURN_KEY_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: policy.turnTtlSeconds })
    });
    upstreamStatus = response.status;
    if (!response.ok) { await response.body?.cancel(); throw new Error('Credential issuer rejected request'); }
    stage = 'parse';
    const data = await boundedJson(response);
    stage = 'validate';
    const iceServers = normalizeIceServers(data.iceServers);
    return Response.json({ schema: 'reploid.pool.turn_credentials/v1',
      issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + policy.turnTtlSeconds * 1000).toISOString(),
      ttlSeconds: policy.turnTtlSeconds, rtcConfig: { iceTransportPolicy: 'all', iceServers }
    });
  } catch (error) {
    const failure = /illegal invocation/i.test(error?.message || '') ? 'illegal_invocation'
      : /timeout|timed out/i.test(error?.message || '') ? 'timeout'
      : /abortsignal|signal/i.test(error?.message || '') ? 'abort_signal'
      : /fetch|network|connection/i.test(error?.message || '') ? 'network'
      : 'invalid_response';
    console.error(JSON.stringify({ event: 'turn-credential-issuer-failed', stage, upstreamStatus, failure }));
    return Response.json({ error: 'TURN credential service unavailable', code: `turn_${stage}_${failure}`,
      retryable: true, retryAfter: policy.turnRetrySeconds },
    { status: 503, headers: { 'Retry-After': String(policy.turnRetrySeconds) } });
  }
}
