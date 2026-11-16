import timing from '../config/peer-timing.json' with { type: 'json' };
import { DETERMINISTIC_GENERATION_CONFIG } from '../pool/policy-router.js';
import { getPeerRelayMode } from './product-context.js';

// Generic SDK budgets and product relay profiles are deliberately distinct. Resolve
// a profile once at dispatch; neither URL selection nor longer waits grant authority.
const timingValue = (key, globalKey) => {
  const explicit = Number(window[globalKey] || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return timing.relayOverrides[getPeerRelayMode()]?.[key] ?? timing.generic[key];
};
export const getPeerDiscoveryWindowMs = () => timingValue('discoveryWindowMs', 'REPLOID_POOL_DISCOVERY_WINDOW_MS');
export const getPeerReceiptWindowMs = () => timingValue('receiptWindowMs', 'REPLOID_POOL_RECEIPT_WINDOW_MS');
export const getPeerQueueWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_QUEUE_WINDOW_MS || 0);
  return Number.isFinite(explicit) && explicit > 0 ? explicit : getPeerReceiptWindowMs();
};
export const getPeerSessionAcceptWindowMs = () => timingValue('sessionAcceptWindowMs', 'REPLOID_POOL_SESSION_ACCEPT_WINDOW_MS');
export const getPeerTransportConnectWindowMs = () => timingValue('transportConnectWindowMs', 'REPLOID_POOL_TRANSPORT_CONNECT_WINDOW_MS');

export const getPeerGenerationConfig = () => {
  const override = window.REPLOID_POOL_GENERATION_CONFIG && typeof window.REPLOID_POOL_GENERATION_CONFIG === 'object'
    ? window.REPLOID_POOL_GENERATION_CONFIG
    : {};
  const maxOutputTokens = Number(
    window.REPLOID_POOL_MAX_OUTPUT_TOKENS
    || override.maxOutputTokens
    || DETERMINISTIC_GENERATION_CONFIG.maxOutputTokens
  );
  return {
    ...DETERMINISTIC_GENERATION_CONFIG,
    ...override,
    maxOutputTokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? Math.floor(maxOutputTokens)
      : DETERMINISTIC_GENERATION_CONFIG.maxOutputTokens
  };
};

/** Freeze one dispatch's settings before any asynchronous authorization or discovery. */
export const getPeerExecutionConfig = () => Object.freeze({
  discoveryWindowMs: getPeerDiscoveryWindowMs(), receiptWindowMs: getPeerReceiptWindowMs(),
  queueWindowMs: getPeerQueueWindowMs(), sessionAcceptWindowMs: getPeerSessionAcceptWindowMs(),
  transportConnectWindowMs: getPeerTransportConnectWindowMs(), generation: structuredClone(getPeerGenerationConfig())
});
