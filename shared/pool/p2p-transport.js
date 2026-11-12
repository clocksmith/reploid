import { createP2PTransport as createLibraryTransport, descriptionToPayload, candidateToPayload, defaultSerialize, defaultDeserialize } from '../vendor/reploid/transport/index.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';

export { P2P_TRANSPORT_STATES } from '../vendor/reploid/transport/index.js';
export const DEFAULT_RTC_CONFIG = Object.freeze({
  iceServers: Object.freeze([
    Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
    Object.freeze({ urls: 'stun:stun1.l.google.com:19302' })
  ])
});

const normalizeIceServer = (server = {}) => {
  const urls = Array.isArray(server.urls)
    ? server.urls.map((url) => String(url || '').trim()).filter(Boolean)
    : String(server.urls || '').trim();
  if ((Array.isArray(urls) && urls.length === 0) || !urls) {
    throw new TypeError('RTC iceServers entries require at least one URL');
  }
  const normalized = { urls };
  if (server.username !== undefined) normalized.username = String(server.username);
  if (server.credential !== undefined) normalized.credential = String(server.credential);
  if (server.credentialType !== undefined) normalized.credentialType = String(server.credentialType);
  return Object.freeze(normalized);
};

export const normalizeRtcConfig = (config = DEFAULT_RTC_CONFIG) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('RTC config must be an object');
  }
  const iceServers = Array.isArray(config.iceServers)
    ? config.iceServers.map(normalizeIceServer)
    : DEFAULT_RTC_CONFIG.iceServers;
  const normalized = {
    ...config,
    iceServers: Object.freeze(iceServers)
  };
  if (normalized.iceTransportPolicy && !['all', 'relay'].includes(normalized.iceTransportPolicy)) {
    throw new TypeError('RTC iceTransportPolicy must be all or relay');
  }
  return Object.freeze(normalized);
};

export const resolveRtcConfig = ({
  configured = globalThis.REPLOID_POOL_RTC_CONFIG,
  fallback = DEFAULT_RTC_CONFIG
} = {}) => normalizeRtcConfig(configured || fallback);

export function createP2PRequesterTransport(options = {}) {
  return createP2PTransport({
    ...options,
    initiator: true,
  });
}

export function createP2PProviderTransport(options = {}) {
  return createP2PTransport({
    ...options,
    initiator: false,
  });
}

const assignmentConfig = resolveConfig();
export { descriptionToPayload, candidateToPayload, defaultSerialize, defaultDeserialize };
export function createP2PTransport(options = {}) {
  return createLibraryTransport({
    ...options,
    config: assignmentConfig,
    rtcConfig: options.rtcConfig || resolveRtcConfig()
  });
}
