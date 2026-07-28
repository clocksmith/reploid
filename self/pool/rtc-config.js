import { createPoolSdk } from './sdk.js';
import { normalizeRtcConfig } from './p2p-transport.js';

const REFRESH_SKEW_MS = 30000;
let cachedConfiguration = null;

const cachedConfigurationIsFresh = (now) => (
  cachedConfiguration?.expiresAtMs
  && cachedConfiguration.expiresAtMs - REFRESH_SKEW_MS > now
);

export async function getPoolRtcConfig({
  sdk = createPoolSdk(),
  forceRefresh = false,
  forceRelay = globalThis.REPLOID_POOL_FORCE_RELAY === true,
  now = () => Date.now()
} = {}) {
  const currentTime = Number(now());
  if (!forceRefresh && cachedConfigurationIsFresh(currentTime)) {
    return forceRelay
      ? normalizeRtcConfig({ ...cachedConfiguration.rtcConfig, iceTransportPolicy: 'relay' })
      : cachedConfiguration.rtcConfig;
  }
  if (!sdk || typeof sdk.rtcConfig !== 'function') {
    throw new TypeError('Pool SDK with rtcConfig() is required');
  }
  const payload = await sdk.rtcConfig();
  const expiresAtMs = Date.parse(payload?.expiresAt || '');
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= currentTime) {
    throw new Error('Pool TURN configuration is missing a valid future expiry');
  }
  cachedConfiguration = {
    expiresAtMs,
    rtcConfig: normalizeRtcConfig(payload.rtcConfig)
  };
  return forceRelay
    ? normalizeRtcConfig({ ...cachedConfiguration.rtcConfig, iceTransportPolicy: 'relay' })
    : cachedConfiguration.rtcConfig;
}

export function clearPoolRtcConfigCache() {
  cachedConfiguration = null;
}
