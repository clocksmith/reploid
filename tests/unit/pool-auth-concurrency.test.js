import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function load(auth) {
  vi.resetModules();
  vi.stubGlobal('REPLOID_FIREBASE_AUTH', auth);
  return (await import('../../self/pool/identity.js')).getPoolAuthToken;
}

it('shares one anonymous sign-in across concurrent RTC and identity callers', async () => {
  let release;
  const user = { uid: 'test', getIdToken: async () => 'token' };
  const auth = { currentUser: null, signInAnonymously: vi.fn(() => new Promise(resolve => { release = () => { auth.currentUser = user; resolve({user}); }; })) };
  const token = await load(auth);
  const pending = Promise.all([token(), token(), token()]);
  await vi.waitFor(() => expect(auth.signInAnonymously).toHaveBeenCalledTimes(1));
  release();
  expect(await pending).toEqual(['token','token','token']);
  expect(await token()).toBe('token');
  expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
});

it('waits for persisted authentication before considering a new anonymous account', async () => {
  const user = { uid: 'restored', getIdToken: async () => 'restored-token' };
  const auth = { currentUser: null, signInAnonymously: vi.fn(), authStateReady: vi.fn(async () => { auth.currentUser = user; }) };
  const token = await load(auth);
  expect(await token()).toBe('restored-token');
  expect(auth.signInAnonymously).not.toHaveBeenCalled();
});

it('bounds failed sign-in retries without granting an unauthenticated token', async () => {
  vi.useFakeTimers();
  const auth = { currentUser: null, signInAnonymously: vi.fn().mockRejectedValue(new Error('TOO_MANY_ATTEMPTS_TRY_LATER')) };
  const token = await load(auth);
  expect(await Promise.all([token(), token(), token()])).toEqual([null,null,null]);
  expect(await token()).toBeNull();
  expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(await token()).toBeNull();
  expect(auth.signInAnonymously).toHaveBeenCalledTimes(2);
});
