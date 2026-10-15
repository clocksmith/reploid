/**
 * Browser composition of the earning loop: the service's published settings
 * (GET <origin>/v1/client) choose the sign-in provider, which feeds the
 * earning client, whose attempts run each charged partition attempt and whose
 * account model drives the settings panel (balance, recent journal entries,
 * top-ups, the standing spending limit and the last quote).
 *
 * Off unless the page's own server publishes the earning service: no
 * settings, no recognised sign-in flow, or a failure loading them leaves the
 * product without earning, exactly as before. Supabase sign-in is used when
 * the service offers it; the local test flow only when the page itself is on
 * a loopback address. Nothing here authors prices, outcomes or rewards; the
 * spending limit is the person's own standing decision on this device, and a
 * quote above it (or with no limit set) is declined before anything is sent.
 * When the service offers Community Access and the account's available
 * credits cannot cover a quote, the answer asks for Community Access instead.
 */
import { createSigningIdentity } from '../../vendor/reploid/artifacts/identity.js';
import { createEarningAttempts } from '../earning/attempts.js';
import { EARNING_CLIENT_SCHEMA, createEarningClient, createWebStorageEarningStorage } from '../earning/client.js';
import { createSupabaseSignIn } from '../supabase-sign-in.js';
import { createLocalTestSignIn } from './local-sign-in.js';

export const EARNING_SERVICE_SCHEMA = 'reploid.earning-service/v1';
export const EARNING_PREFIX = '/v1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const IDENTITY_KEY = 'reploid.earning-identity:v1';
const LIMIT_KEY = 'reploid.earning-spending-limit:v1';
const CHECKOUT_KEY = 'reploid.earning-last-checkout:v1';
const JOURNAL_ROWS = 12;

const safeStorage = storage => ({
  get(key) { try { return storage?.getItem(key) ?? null; } catch { return null; } },
  set(key, value) { try { storage?.setItem(key, value); } catch { /* reported by the caller's state */ } },
  remove(key) { try { storage?.removeItem(key); } catch { /* nothing stored */ } }
});

/** The service's public settings, or null when this origin publishes none. */
export async function loadEarningService({ origin, fetch = (...input) => globalThis.fetch(...input) } = {}) {
  let response;
  try { response = await fetch(`${origin}${EARNING_PREFIX}/client`, { headers: { accept: 'application/json' }, credentials: 'same-origin' }); }
  catch { return null; }
  if (!response.ok) return null;
  let body = null;
  try { body = await response.json(); } catch { return null; }
  if (body?.schema !== EARNING_SERVICE_SCHEMA || !Array.isArray(body.signIn) || !Array.isArray(body.topUps)) return null;
  return body;
}

/** Supabase when offered; the local test flow only for a page served from loopback. */
export function chooseSignInFlow(service, location) {
  const supabase = service?.signIn?.find(entry => entry.flow === 'supabase_magic_link' && entry.testOnly !== true);
  if (supabase) return supabase;
  const local = service?.signIn?.find(entry => entry.flow === 'local_test_subject');
  return local && LOOPBACK.has(location.hostname) ? local : null;
}

/** This browser profile's participant identity for the earning loop, created once and kept with its other earning state. */
export async function loadEarningIdentity({ storage, create = () => createSigningIdentity({ algorithm: 'Ed25519' }).catch(() => createSigningIdentity({ algorithm: 'ECDSA' })) }) {
  const store = safeStorage(storage);
  try {
    const stored = JSON.parse(store.get(IDENTITY_KEY) ?? 'null');
    if (stored?.peerId && stored.privateJwk && stored.publicJwk) return stored;
  } catch { /* replaced below */ }
  const identity = await create();
  store.set(IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}

const quoteRequest = request => ({ modelId: request.model.id, modelIdentity: request.model.identity, operation: 'chat.completion' });
const quoteRecord = (quote, { accepted, funding }) => ({ quoteId: quote?.quoteId ?? null, modelId: quote?.service?.model?.modelId ?? null,
  maxCharge: quote?.pricing?.maxCharge ?? null, deadline: quote?.service?.deadline ?? null, accepted, funding, at: new Date().toISOString() });

/**
 * The account model the settings panel renders. Reads need a signed-in device session; until the
 * provider is signed in it stays signed_out and sends nothing.
 */
export function createEarningAccount({ client, signIn, service, storage, origin, fetch = (...input) => globalThis.fetch(...input),
  navigate = url => globalThis.location.assign(url) }) {
  const store = safeStorage(storage);
  const listeners = new Set();
  const readLimit = () => {
    const value = Number(store.get(LIMIT_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  let state = { phase: 'signed_out', providerId: signIn.providerId, flow: signIn.flow ?? 'supabase_magic_link', accountId: null, deviceId: null,
    balance: null, journal: [], topUps: structuredClone(service.topUps), checkout: null, spendingLimit: readLimit(), lastQuote: null, message: '' };
  let refreshing = null, again = false;
  const snapshot = () => structuredClone(state);
  const set = next => { state = { ...state, ...next }; for (const listener of listeners) listener(snapshot()); };
  const failure = error => error?.message || String(error);

  async function readCheckout() {
    const checkoutId = store.get(CHECKOUT_KEY);
    if (!checkoutId) return null;
    try { return await client.get(`/payments/checkouts/${encodeURIComponent(checkoutId)}`); }
    catch (error) { if (error.code === 'checkout_not_found') store.remove(CHECKOUT_KEY); return null; }
  }

  /** After the provider signs out, this device's service session ends too; an unreachable service lets it expire. */
  async function endStoredSession() {
    const session = await client.storage.get('session');
    if (!session) return;
    await client.storage.delete('session');
    store.remove(CHECKOUT_KEY);
    try { await fetch(`${client.config.baseUrl}/sessions/end`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` } }); }
    catch { /* the session ends on expiry */ }
  }

  /** Sign in (when the provider has a session), then read the balance, journal and last checkout. */
  function refresh() {
    if (refreshing) { again = true; return refreshing; }
    refreshing = (async () => {
      const provider = signIn.state().phase;
      if (provider !== 'signed_in') {
        // Only a provider that has signed out ends this device's session; one still loading or sending a link keeps it.
        if (provider === 'signed_out') await endStoredSession();
        set({ phase: 'signed_out', accountId: null, deviceId: null, balance: null, journal: [], checkout: null, lastQuote: null });
        return snapshot();
      }
      if (state.phase !== 'ready') set({ phase: 'signing_in', message: '' });
      try {
        const session = await client.ensureSession();
        const [balance, journal, checkout] = await Promise.all([client.get('/balances'), client.get('/journal'), readCheckout()]);
        set({ phase: 'ready', accountId: session.accountId, deviceId: session.deviceId, balance,
          journal: journal.entries.slice(-JOURNAL_ROWS).reverse(), checkout, message: '' });
      } catch (error) {
        set({ phase: error.code === 'sign_in_required' ? 'signed_out' : 'error', message: error.code === 'sign_in_required' ? '' : failure(error) });
      }
      return snapshot();
    })().finally(() => {
      refreshing = null;
      // A sign-in change during this read is read again.
      if (again) { again = false; void refresh(); }
    });
    return refreshing;
  }

  return Object.freeze({
    state: snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    refresh,
    /** Start a one-time top-up and hand off to its checkout page (Stripe, or the local test processor's). */
    async topUp(topUpId) {
      try {
        const started = await client.send({ opId: `checkout:${topUpId}:${crypto.randomUUID()}`, path: '/payments/checkouts', body: { topUpId }, durable: false });
        store.set(CHECKOUT_KEY, started.checkoutId);
        set({ checkout: started, message: '' });
        const url = started.checkout?.url ? new URL(started.checkout.url, origin) : null;
        if (url && (url.protocol === 'https:' || url.origin === origin)) navigate(url.href);
        else set({ message: 'Checkout started, but it has no page to open.' });
        return started;
      } catch (error) {
        set({ message: failure(error) });
        return null;
      }
    },
    /** The person's standing per-answer limit on this device; empty clears it. */
    setSpendingLimit(value) {
      const text = String(value ?? '').trim();
      if (!text) { store.remove(LIMIT_KEY); set({ spendingLimit: null, message: '' }); return null; }
      const limit = Number(text);
      if (!Number.isSafeInteger(limit) || limit <= 0) { set({ message: 'Enter a whole number of credits.' }); return state.spendingLimit; }
      store.set(LIMIT_KEY, String(limit));
      set({ spendingLimit: limit, message: '' });
      return limit;
    },
    /** The spending port: accept a quote whose maximum charge is within the standing limit; record it either way. */
    async authorizeSpending({ quote }) {
      const limit = readLimit();
      const accepted = limit !== null && quote?.pricing?.maxCharge <= limit;
      set({ spendingLimit: limit, lastQuote: quoteRecord(quote, { accepted, funding: 'account' }) });
      return accepted;
    },
    /**
     * Community Access when the service offers it and this account's available credits cannot cover the
     * quoted maximum; the pool, not the person, is charged, so no spending limit applies.
     */
    async useCommunityAccess({ quote }) {
      if (service.communityAccess !== true) return false;
      let available = 0;
      try { available = (await client.get('/balances')).available; } catch { return false; }
      if (!(available < quote?.pricing?.maxCharge)) return false;
      set({ lastQuote: quoteRecord(quote, { accepted: true, funding: 'community_access' }) });
      return true;
    },
    /** Sign out of the provider on this device; refresh() then ends the service session. */
    async signOut() {
      await signIn.signOut();
      return refresh();
    }
  });
}

/** Spending around each charged attempt, then the account's balance read again. */
function attemptsWithRefresh(attempts, account) {
  return Object.freeze({
    ...attempts,
    async run(request, controls, execute) {
      try { return await attempts.run(request, controls, execute); }
      finally { void account.refresh(); }
    }
  });
}

/**
 * Compose the earning loop for this page, or resolve null when its server publishes no earning service.
 * Resolves { config, service, signIn, client, identity, account, earning }; `earning` is the product
 * session's attempts port.
 */
export async function openBrowserEarning({ location = globalThis.location, storage = globalThis.localStorage,
  fetch = (...input) => globalThis.fetch(...input), navigate, loadIdentity = loadEarningIdentity } = {}) {
  const origin = location.origin;
  const service = await loadEarningService({ origin, fetch });
  const flow = service && chooseSignInFlow(service, location);
  if (!flow) return null;
  const baseUrl = `${origin}${EARNING_PREFIX}`;
  const config = { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl, providerId: flow.providerId };
  const signIn = flow.flow === 'supabase_magic_link'
    ? createSupabaseSignIn({ baseUrl, providerId: flow.providerId, fetch, storage, location })
    : createLocalTestSignIn({ baseUrl, providerId: flow.providerId, fetch, storage });
  const identity = await loadIdentity({ storage });
  const client = createEarningClient({ config, identity, host: 'browser', signIn: signIn.signIn, storage: createWebStorageEarningStorage(storage), fetch });
  const account = createEarningAccount({ client, signIn, service, storage, origin, fetch, ...(navigate ? { navigate } : {}) });
  const attempts = createEarningAttempts({ client, quoteRequest, authorizeSpending: account.authorizeSpending,
    ...(service.communityAccess === true ? { communityAccess: { decide: account.useCommunityAccess } } : {}) });
  // Pending reports and claims from an earlier visit resend once this device is signed in again.
  let reconciled = false;
  account.subscribe(state => {
    if (state.phase !== 'ready' || reconciled) return;
    reconciled = true;
    attempts.reconcile().catch(error => console.warn('[Reploid earning] Stored reports remain pending', error?.code || error?.message));
  });
  signIn.subscribe(() => { void account.refresh(); });
  signIn.start().catch(() => {});
  return Object.freeze({ config, service, flow, signIn, client, identity, account, attempts, earning: attemptsWithRefresh(attempts, account) });
}

/**
 * The product session's earning port while the composition opens: once open, charged attempts run
 * through it; when the page has no earning service, attempts run exactly as without one.
 */
export function deferredEarning(opening) {
  return Object.freeze({
    async run(request, controls, execute) {
      const opened = await opening.catch(() => null);
      return opened ? opened.earning.run(request, controls, execute) : execute(request, controls);
    }
  });
}

export default openBrowserEarning;
