import { DETERMINISTIC_GENERATION_CONFIG } from '../pool/policy-router.js';
import { getPeerRelayMode } from './product-context.js';

export const getPeerDiscoveryWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_DISCOVERY_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (getPeerRelayMode() === 'server') return 8000;
  return 1200;
};

export const getPeerReceiptWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_RECEIPT_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return 60000;
};

export const getPeerQueueWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_QUEUE_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return getPeerReceiptWindowMs();
};

export const getPeerSessionAcceptWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_SESSION_ACCEPT_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (getPeerRelayMode() === 'server') return 15000;
  return 5000;
};

export const getPeerTransportConnectWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_TRANSPORT_CONNECT_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (getPeerRelayMode() === 'server') return 20000;
  return 5000;
};

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
