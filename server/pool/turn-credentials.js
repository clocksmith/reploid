import { createHmac } from 'node:crypto';

export const TURN_CREDENTIAL_SCHEMA = 'reploid.pool.turn_credentials/v1';
export const DEFAULT_TURN_CREDENTIAL_TTL_SECONDS = 600;
export const MAX_TURN_CREDENTIAL_TTL_SECONDS = 3600;

const normalizeTurnHost = (value) => {
  const host = String(value || '').trim();
  if (!host) return null;
  if (/[\s/?#]/.test(host)) {
    throw new TypeError('TURN host must be a hostname or IP address without a scheme, port, or path');
  }
  return host;
};

const boundedTtlSeconds = (value) => {
  const ttl = Number(value || DEFAULT_TURN_CREDENTIAL_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > MAX_TURN_CREDENTIAL_TTL_SECONDS) {
    throw new TypeError(`TURN credential TTL must be an integer from 60 to ${MAX_TURN_CREDENTIAL_TTL_SECONDS} seconds`);
  }
  return ttl;
};

const normalizeSubject = (value) => {
  const normalized = String(value || 'browser')
    .trim()
    .replace(/[^a-z0-9_.-]/gi, '_')
    .slice(0, 96);
  return normalized || 'browser';
};

export const getTurnServiceConfiguration = (env = process.env) => {
  const host = normalizeTurnHost(env.REPLOID_TURN_HOST);
  const sharedSecret = String(env.REPLOID_TURN_SHARED_SECRET || '').trim() || null;
  const ttlSeconds = boundedTtlSeconds(env.REPLOID_TURN_CREDENTIAL_TTL_SECONDS);
  return Object.freeze({
    configured: Boolean(host && sharedSecret),
    host,
    sharedSecret,
    ttlSeconds
  });
};

export const getPublicTurnServiceStatus = (env = process.env) => {
  const configuration = getTurnServiceConfiguration(env);
  return Object.freeze({
    configured: configuration.configured,
    credentialMode: configuration.configured ? 'turn_rest_ephemeral' : null,
    ttlSeconds: configuration.configured ? configuration.ttlSeconds : null,
    transports: configuration.configured ? ['udp:3478', 'tcp:3478', 'tcp:443'] : []
  });
};

export const createTurnRtcConfiguration = ({
  subject,
  now = Date.now(),
  env = process.env,
  iceTransportPolicy = 'all'
} = {}) => {
  const configuration = getTurnServiceConfiguration(env);
  if (!configuration.configured) {
    const error = new Error('TURN relay is not configured');
    error.code = 'turn_not_configured';
    throw error;
  }
  if (!['all', 'relay'].includes(iceTransportPolicy)) {
    throw new TypeError('TURN iceTransportPolicy must be all or relay');
  }
  const issuedAtSeconds = Math.floor(Number(now) / 1000);
  const expiresAtSeconds = issuedAtSeconds + configuration.ttlSeconds;
  const username = `${expiresAtSeconds}:${normalizeSubject(subject)}`;
  const credential = createHmac('sha1', configuration.sharedSecret)
    .update(username)
    .digest('base64');
  return Object.freeze({
    schema: TURN_CREDENTIAL_SCHEMA,
    issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    ttlSeconds: configuration.ttlSeconds,
    rtcConfig: Object.freeze({
      iceTransportPolicy,
      iceServers: Object.freeze([
        Object.freeze({
          urls: Object.freeze([
            `turn:${configuration.host}:3478?transport=udp`,
            `turn:${configuration.host}:3478?transport=tcp`,
            `turn:${configuration.host}:443?transport=tcp`
          ]),
          username,
          credential,
          credentialType: 'password'
        })
      ])
    })
  });
};
