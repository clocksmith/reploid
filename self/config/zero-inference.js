/**
 * @fileoverview Managed Zero inference proxy contract.
 */

export const ZERO_GEMINI_FUNCTION_PATH = '/zero/gemini';
export const ZERO_GEMINI_PROVIDER = 'gemini';
export const ZERO_GEMINI_MODEL = 'gemini-3.8-flash';
export const LEGACY_ZERO_GEMINI_MODEL = 'gemini-3.5-flash';
const LEGACY_ZERO_GEMINI_MODELS = Object.freeze([LEGACY_ZERO_GEMINI_MODEL, 'gemini-3.1-flash-lite']);
export const ZERO_GEMINI_SERVER_TYPE = 'firebase-function';
export const ZERO_MANAGED_MAX_ITERATIONS = 99;
export const ZERO_GEMINI_AGENT_THROTTLE = Object.freeze({
  minProviderRequestIntervalMs: 6000,
  providerBackoffBaseMs: 15000,
  providerBackoffMaxMs: 300000,
  providerBackoffJitterRatio: 0.2,
  providerAutoResume: true
});

const DEFAULT_FIREBASE_APP_MODULE_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
const DEFAULT_FIREBASE_AUTH_MODULE_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
const DEFAULT_FIREBASE_APP_CHECK_MODULE_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js';

let zeroAccessPromise = null;

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
  if (current.serverType === ZERO_GEMINI_SERVER_TYPE && LEGACY_ZERO_GEMINI_MODELS.includes(model)) {
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

const isLoopbackHost = () => {
  const hostname = String(globalThis.location?.hostname || '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

const getZeroFirebaseConfig = async () => {
  if (globalThis.REPLOID_ZERO_FIREBASE_CONFIG) return globalThis.REPLOID_ZERO_FIREBASE_CONFIG;
  if (globalThis.REPLOID_FIREBASE_CONFIG) return globalThis.REPLOID_FIREBASE_CONFIG;
  if (isLoopbackHost() || typeof fetch !== 'function') return null;
  const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
  return response.ok ? response.json() : null;
};

const requireZeroAppCheckSiteKey = () => {
  const siteKey = String(globalThis.REPLOID_ZERO_APP_CHECK_SITE_KEY || '').trim();
  if (!siteKey) throw new Error('Zero App Check is not configured. Set REPLOID_ZERO_APP_CHECK_SITE_KEY.');
  return siteKey;
};

const getZeroFirebaseModuleUrls = () => ({
  app: globalThis.REPLOID_FIREBASE_APP_MODULE_URL || DEFAULT_FIREBASE_APP_MODULE_URL,
  auth: globalThis.REPLOID_FIREBASE_AUTH_MODULE_URL || DEFAULT_FIREBASE_AUTH_MODULE_URL,
  appCheck: globalThis.REPLOID_FIREBASE_APP_CHECK_MODULE_URL || DEFAULT_FIREBASE_APP_CHECK_MODULE_URL
});

const bootstrapZeroAccess = async () => {
  const config = await getZeroFirebaseConfig();
  if (!config) throw new Error('Zero Firebase configuration is unavailable.');
  const urls = getZeroFirebaseModuleUrls();
  const [appModule, authModule, appCheckModule] = await Promise.all([
    import(urls.app),
    import(urls.auth),
    import(urls.appCheck)
  ]);
  const app = appModule.getApps().at(0) || appModule.initializeApp(config);
  const auth = authModule.getAuth(app);
  if (authModule.setPersistence && authModule.browserLocalPersistence) {
    await authModule.setPersistence(auth, authModule.browserLocalPersistence).catch(() => null);
  }
  const appCheck = appCheckModule.initializeAppCheck(app, {
    provider: new appCheckModule.ReCaptchaV3Provider(requireZeroAppCheckSiteKey()),
    isTokenAutoRefreshEnabled: true
  });
  return { auth, authModule, appCheck, appCheckModule };
};

export async function getZeroAccessHeaders() {
  if (!zeroAccessPromise) zeroAccessPromise = bootstrapZeroAccess();
  const { auth, authModule, appCheck, appCheckModule } = await zeroAccessPromise;
  const user = auth.currentUser || (await authModule.signInAnonymously(auth)).user;
  const [idToken, appCheckToken] = await Promise.all([
    user.getIdToken(),
    appCheckModule.getToken(appCheck)
  ]);
  if (!idToken || !appCheckToken?.token) throw new Error('Zero Firebase credentials are unavailable.');
  return Object.freeze({
    Authorization: `Bearer ${idToken}`,
    'X-Firebase-AppCheck': appCheckToken.token
  });
}
