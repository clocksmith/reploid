import { createPoolSdk } from './sdk.js';
import { normalizeRtcConfig } from './p2p-transport.js';
import policy from '../config/swarm-bootstrap.json' with { type: 'json' };

const REFRESH_SKEW_MS = policy.rtcRefreshSkewMs;
if (!Number.isSafeInteger(REFRESH_SKEW_MS) || REFRESH_SKEW_MS <= policy.server.heartbeatInterval) {
  throw new Error('RTC credential renewal must reserve more than one heartbeat interval');
}
let cachedConfiguration = null;
let pendingConfiguration = null;

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
  if (!pendingConfiguration) {
    const pending = Promise.resolve().then(async () => {
      const payload = await sdk.rtcConfig();
      const expiresAtMs = Date.parse(payload?.expiresAt || '');
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Number(now())) {
        throw new Error('Pool TURN configuration is missing a valid future expiry');
      }
      const configuration = { expiresAtMs, rtcConfig: normalizeRtcConfig(payload.rtcConfig) };
      if (pendingConfiguration === pending) cachedConfiguration = configuration;
      return configuration;
    }).finally(() => { if (pendingConfiguration === pending) pendingConfiguration = null; });
    pendingConfiguration = pending;
  }
  const configuration = await pendingConfiguration;
  return forceRelay
    ? normalizeRtcConfig({ ...configuration.rtcConfig, iceTransportPolicy: 'relay' })
    : configuration.rtcConfig;
}

export function clearPoolRtcConfigCache() {
  cachedConfiguration = null;
  pendingConfiguration = null;
}
