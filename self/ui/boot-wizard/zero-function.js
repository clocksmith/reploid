export const ZERO_GEMINI_FUNCTION_PATH = '/zero/gemini';
export const ZERO_GEMINI_PROVIDER = 'gemini';
export const ZERO_GEMINI_MODEL = 'gemini-3.5-flash';
export const ZERO_GEMINI_SERVER_TYPE = 'firebase-function';
export const ZERO_MANAGED_MAX_ITERATIONS = 99;

const trimTrailingSlash = (value) => String(value || '').replace(/\/$/, '');

export const getZeroGeminiFunctionUrl = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${trimTrailingSlash(window.location.origin)}${ZERO_GEMINI_FUNCTION_PATH}`;
  }
  return ZERO_GEMINI_FUNCTION_PATH;
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
  model: current.model || ZERO_GEMINI_MODEL,
  maxIterations: ZERO_MANAGED_MAX_ITERATIONS
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
