/**
 * The hosted self-serve account for service credits (`/v1/fleet/*` on the page's own server).
 *
 * Off unless the server publishes `GET /v1/fleet/client`. Sign-in is the existing Firebase sign-in; an
 * account is created only when the person asks. Pairing shows a single-use code for `npx reploid join`,
 * then the fingerprint the computer printed; the person confirms it here before the key is enrolled.
 * After pairing, "Use for answers" claims the local host's browser-bridge secret once with the same
 * code and connects the existing private-computers port, which spends from the same account.
 * Balances, prices and outcomes all come from the server's ledger; nothing here computes a charge.
 */
import { bootstrapPoolFirebaseAuth } from '../../../shared/pool/firebase-auth.js';

const PAIRING_POLL_MS = 2000;

/** The signed-in Firebase user's ID token, without signing anyone in. */
async function currentToken() {
  const auth = await bootstrapPoolFirebaseAuth().catch(() => null);
  await auth?.authStateReady?.();
  return auth?.currentUser?.getIdToken ? auth.currentUser.getIdToken() : null;
}

/** Explicit sign-in: a verified provider (starter credit) or an anonymous one (earn first). */
async function defaultSignIn(kind) {
  const auth = await bootstrapPoolFirebaseAuth().catch(() => null);
  if (!auth) throw Error('Sign-in is not available on this page.');
  const flow = kind === 'google' ? globalThis.REPLOID_FIREBASE_SIGN_IN_WITH_GOOGLE : globalThis.REPLOID_FIREBASE_SIGN_IN_ANONYMOUSLY;
  if (typeof flow !== 'function') throw Error('That sign-in is not available on this page.');
  await flow(auth);
}

export function createFleetAccount({ fetchImpl = globalThis.fetch?.bind(globalThis), origin = '', getToken = currentToken, signIn = defaultSignIn,
  privateComputers = null, onChange = () => {}, setTimer = globalThis.setTimeout?.bind(globalThis), clearTimer = globalThis.clearTimeout?.bind(globalThis) } = {}) {
  let client = null, signedIn = false, account = null, pairing = null, error = '', busy = false, loaded = false, closed = false, timer = null;
  const changed = () => { if (!closed) onChange(); };
  const call = async (method, route, body, { session = true } = {}) => {
    const token = session ? await getToken() : null;
    if (session && !token) throw Object.assign(Error('Sign in first.'), { code: 'sign_in_required' });
    const response = await fetchImpl(origin + route, { method, credentials: 'omit', cache: 'no-store',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(Error(value.error || 'The account service did not respond.'), { code: value.code, status: response.status });
    return value;
  };
  const act = async operation => {
    busy = true; error = ''; changed();
    try { return await operation(); }
    catch (cause) { error = cause.message; throw cause; }
    finally { busy = false; changed(); }
  };
  const readAccount = async () => {
    try { account = await call('GET', '/v1/fleet/account'); signedIn = true; }
    catch (cause) {
      if (cause.code === 'account_required') { account = null; signedIn = true; return; }
      if (cause.code === 'sign_in_required') { account = null; signedIn = false; return; }
      throw cause;
    }
  };
  const stopPolling = () => { if (timer !== null) clearTimer?.(timer); timer = null; };
  const poll = () => {
    stopPolling();
    if (closed || !pairing || !['open', 'claimed'].includes(pairing.state)) return;
    timer = setTimer?.(async () => {
      timer = null;
      try { await refreshPairing(); } catch { /* The next poll or the person's action retries. */ }
      poll();
    }, PAIRING_POLL_MS);
  };
  const refreshPairing = async () => {
    if (!pairing) return null;
    const next = await call('GET', `/v1/fleet/pairings/${pairing.id}`);
    // The code itself is only in this tab; the server keeps its hash.
    pairing = { ...pairing, ...next };
    if (next.state === 'confirmed') await readAccount();
    changed();
    return pairing;
  };

  return {
    state: () => ({ available: client?.available === true, loaded, signedIn, busy, error, client, account: account ? structuredClone(account) : null,
      pairing: pairing ? structuredClone(pairing) : null }),
    async load() {
      try {
        client = await call('GET', '/v1/fleet/client', undefined, { session: false });
        if (client?.schema !== 'reploid.fleet-self-serve/v1') client = null;
        if (client) await readAccount();
      } catch { client = null; }
      loaded = true; changed();
    },
    signIn: kind => act(async () => { await signIn(kind); await readAccount(); }),
    createAccount: () => act(async () => { account = await call('POST', '/v1/fleet/account', {}); signedIn = true; }),
    refresh: () => act(readAccount),
    /** Re-read the account without marking the view busy: the balance changes as answers settle. */
    async reread() {
      if (!client?.available || !signedIn || busy) return;
      try { await readAccount(); changed(); } catch { /* The next read retries. */ }
    },
    startPairing: () => act(async () => { pairing = await call('POST', '/v1/fleet/pairings', {}); poll(); return pairing; }),
    refreshPairing: () => act(refreshPairing),
    /** Confirm only after comparing the fingerprint with the one the computer printed. */
    confirmPairing: () => act(async () => {
      if (pairing?.state !== 'claimed') throw Error('No computer has claimed this code yet.');
      pairing = { ...pairing, ...await call('POST', `/v1/fleet/pairings/${pairing.id}/confirm`, { fingerprint: pairing.computer.fingerprint }) };
      stopPolling(); await readAccount();
    }),
    cancelPairing: () => act(async () => {
      stopPolling();
      if (pairing && ['open', 'claimed'].includes(pairing.state)) await call('POST', `/v1/fleet/pairings/${pairing.id}/cancel`, {}).catch(() => null);
      pairing = null;
    }),
    closePairing() { stopPolling(); if (pairing?.state !== 'open' && pairing?.state !== 'claimed') pairing = null; changed(); },
    /**
     * Connect this tab to the paired host's local bridge. The host hands its secret once to this origin for the
     * code it joined with; after that the existing private-computers connection is used for answers.
     */
    useThisComputer: () => act(async () => {
      if (!privateComputers) throw Error('Private computers are not available on this page.');
      if (pairing?.state !== 'confirmed' || !pairing.code) throw Error('Pair the computer first.');
      const url = `http://127.0.0.1:${pairing.computer?.bridgePort || 18784}`;
      let response;
      try {
        response = await fetchImpl(`${url}/claim`, { method: 'POST', credentials: 'omit', redirect: 'error', targetAddressSpace: 'loopback',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pairing.code }) });
      } catch { throw Error('Start the host on that computer first, then try again.'); }
      const value = await response.json().catch(() => ({}));
      if (!response.ok || typeof value.token !== 'string') throw Error(value.error || 'The host did not accept this browser.');
      await privateComputers.connect(url, value.token);
      pairing = null;
    }),
    statement: () => call('GET', '/v1/fleet/statement'),
    revoke: participantId => act(async () => { account = await call('POST', '/v1/fleet/computers/revoke', { participantId }); }),
    close() { closed = true; stopPolling(); }
  };
}
