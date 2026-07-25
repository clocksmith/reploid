import { afterEach, describe, expect, it, vi } from 'vitest';

const loadBootstrap = async () => {
  vi.resetModules();
  return (await import('../../self/pool/firebase-auth.js')).bootstrapPoolFirebaseAuth;
};

describe('Pool Firebase Auth bootstrap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.REPLOID_FIREBASE_CONFIG;
    delete globalThis.REPLOID_POOL_FIREBASE_CONFIG;
    delete globalThis.REPLOID_FIREBASE_APP_MODULE_URL;
    delete globalThis.REPLOID_FIREBASE_AUTH_MODULE_URL;
  });

  it('does not probe the Firebase Hosting config endpoint on loopback', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('location', { hostname: 'localhost' });
    vi.stubGlobal('fetch', fetchMock);

    const bootstrap = await loadBootstrap();

    await expect(bootstrap()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still accepts explicit Firebase config on loopback', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('location', { hostname: '127.0.0.1' });
    vi.stubGlobal('fetch', fetchMock);
    globalThis.REPLOID_FIREBASE_CONFIG = {
      apiKey: 'test',
      projectId: 'test'
    };
    globalThis.REPLOID_FIREBASE_APP_MODULE_URL = 'data:text/javascript,export const getApps=()=>[];export const initializeApp=(config)=>({config});';
    globalThis.REPLOID_FIREBASE_AUTH_MODULE_URL = 'data:text/javascript,export const browserLocalPersistence={};export const getAuth=(app)=>({app});export const setPersistence=async()=>{};export const signInAnonymously=async()=>({});';

    const bootstrap = await loadBootstrap();
    const auth = await bootstrap();

    expect(auth.app.config).toEqual(globalThis.REPLOID_FIREBASE_CONFIG);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
