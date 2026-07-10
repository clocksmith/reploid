/**
 * @fileoverview Managed Zero inference proxy contract.
 */

export const ZERO_GEMINI_FUNCTION_PATH = '/zero/gemini';
export const ZERO_GEMINI_PROVIDER = 'gemini';
export const ZERO_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const LEGACY_ZERO_GEMINI_MODEL = 'gemini-3.5-flash';
export const ZERO_GEMINI_SERVER_TYPE = 'firebase-function';
export const ZERO_MANAGED_MAX_ITERATIONS = 99;
export const ZERO_GEMINI_AGENT_THROTTLE = Object.freeze({
  minProviderRequestIntervalMs: 6000,
  providerBackoffBaseMs: 15000,
  providerBackoffMaxMs: 300000,
  providerBackoffJitterRatio: 0.2,
  providerAutoResume: true
});

const trimTrailingSlash = (value) => String(value || '').replace(/\/$/, '');

export const getZeroGeminiFunctionUrl = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${trimTrailingSlash(window.location.origin)}${ZERO_GEMINI_FUNCTION_PATH}`;
  }
  return ZERO_GEMINI_FUNCTION_PATH;
};

export const resolveZeroGeminiModel = (current = {}) => {
  const model = String(current.model || '').trim();
  if (!model) return ZERO_GEMINI_MODEL;
  if (current.serverType === ZERO_GEMINI_SERVER_TYPE && model === LEGACY_ZERO_GEMINI_MODEL) {
    return ZERO_GEMINI_MODEL;
  }
  return model;
};

export const buildZeroGeminiProxyConfig = (current = {}) => ({
  url: current.url && current.serverType === ZERO_GEMINI_SERVER_TYPE
    ? current.url
    : getZeroGeminiFunctionUrl(),
  endpoint: current.endpoint && current.serverType === ZERO_GEMINI_SERVER_TYPE
    ? current.endpoint
    : getZeroGeminiFunctionUrl(),
  serverType: ZERO_GEMINI_SERVER_TYPE,
  provider: ZERO_GEMINI_PROVIDER,
  model: resolveZeroGeminiModel(current),
  maxIterations: ZERO_MANAGED_MAX_ITERATIONS,
  agentThrottle: current.agentThrottle || ZERO_GEMINI_AGENT_THROTTLE
});

export const isZeroGeminiFunctionServer = (serverType) =>
  serverType === ZERO_GEMINI_SERVER_TYPE;

export const getProxyHealthEndpoint = (url, serverType) => {
  const base = trimTrailingSlash(url);
  return isZeroGeminiFunctionServer(serverType) ? base : `${base}/api/health`;
};

export const getProxyChatEndpoint = (url, serverType) => {
  const base = trimTrailingSlash(url);
  return isZeroGeminiFunctionServer(serverType) ? base : `${base}/api/chat`;
};
