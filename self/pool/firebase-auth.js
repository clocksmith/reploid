/**
 * @fileoverview Optional Firebase Auth bootstrap for hosted pool pages.
 */

const DEFAULT_FIREBASE_APP_MODULE_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
const DEFAULT_FIREBASE_AUTH_MODULE_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

let bootstrapPromise = null;

const getConfig = async () => {
  if (globalThis.REPLOID_FIREBASE_CONFIG) return globalThis.REPLOID_FIREBASE_CONFIG;
  if (globalThis.REPLOID_POOL_FIREBASE_CONFIG) return globalThis.REPLOID_POOL_FIREBASE_CONFIG;
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
};

const getModuleUrls = () => ({
  app: globalThis.REPLOID_FIREBASE_APP_MODULE_URL || DEFAULT_FIREBASE_APP_MODULE_URL,
  auth: globalThis.REPLOID_FIREBASE_AUTH_MODULE_URL || DEFAULT_FIREBASE_AUTH_MODULE_URL
});

const getExistingApp = (appModule) => {
  if (typeof appModule.getApps === 'function' && appModule.getApps().length > 0) {
    return appModule.getApps()[0];
  }
  return null;
};

export async function bootstrapPoolFirebaseAuth() {
  if (globalThis.REPLOID_POOL_FIREBASE_AUTH || globalThis.REPLOID_FIREBASE_AUTH) {
    return globalThis.REPLOID_POOL_FIREBASE_AUTH || globalThis.REPLOID_FIREBASE_AUTH;
  }
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const config = await getConfig();
      if (!config) return null;
      const urls = getModuleUrls();
      const [appModule, authModule] = await Promise.all([
        import(urls.app),
        import(urls.auth)
      ]);
      const app = getExistingApp(appModule) || appModule.initializeApp(config);
      const auth = authModule.getAuth(app);
      if (authModule.setPersistence && authModule.browserLocalPersistence) {
        await authModule.setPersistence(auth, authModule.browserLocalPersistence).catch(() => null);
      }
      globalThis.REPLOID_POOL_FIREBASE_APP = app;
      globalThis.REPLOID_POOL_FIREBASE_AUTH = auth;
      globalThis.REPLOID_FIREBASE_SIGN_IN_ANONYMOUSLY = async (nextAuth = auth) => authModule.signInAnonymously(nextAuth);
      return auth;
    })().catch((error) => {
      globalThis.REPLOID_POOL_FIREBASE_BOOT_ERROR = error;
      return null;
    });
  }
  return bootstrapPromise;
}

export default {
  bootstrapPoolFirebaseAuth
};
