/** Supabase email magic-link sign-in, the provider behind the earning client's `signIn` port.
 * The service publishes the project's public settings (GET <baseUrl>/sign-in/supabase). The person
 * asks for a link; Supabase emails it; opening it on this device returns here and supabase-js
 * completes its PKCE exchange. signIn() then asks the service for a single-use state, writes it into
 * the Supabase user's metadata and refreshes the session, so the new access token carries it, and
 * returns { accessToken, state } for POST <baseUrl>/accounts/sign-in. The email address goes only to
 * Supabase; the service learns the Supabase user id from the verified token. */

export const SUPABASE_AUTH_STORAGE_KEY = 'reploid.supabase-auth:v1';
const LINK_PARAMS = ['code', 'error', 'error_code', 'error_description'];
const LINK_FAILED = 'The sign-in link expired or was already used. Request a new one.';
const SIGN_IN_FIRST = 'Sign in with the link sent to your email first.';
const loadPinnedSupabase = () => import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm');

/**
 * @param {object} options
 * @param {string} options.baseUrl the earning service base, the same one the earning client uses (…/v1)
 * @param {string} [options.providerId]
 * @param {Function} [options.fetch]
 * @param {object} [options.storage] Web Storage area holding the Supabase session
 * @param {object} [options.location] the page location the email link returns to
 * @param {object} [options.history]
 * @param {Function} [options.loadSupabase] () => supabase-js module
 */
export function createSupabaseSignIn({ baseUrl, providerId = 'supabase', fetch = globalThis.fetch, storage = globalThis.localStorage,
  location = globalThis.location, history = globalThis.history, loadSupabase = loadPinnedSupabase } = {}) {
  if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) throw new TypeError('Supabase sign-in needs the earning service base URL');
  if (typeof fetch !== 'function') throw new TypeError('Supabase sign-in needs fetch');
  const base = baseUrl.replace(/\/$/, '');
  const listeners = new Set();
  let status = { phase: 'idle', email: null, message: '' };
  let opening = null;
  const snapshot = () => ({ ...status });
  const set = next => { status = { ...status, ...next }; for (const listener of listeners) listener(snapshot()); };
  const signedIn = session => ({ phase: 'signed_in', email: session?.user?.email ?? null, message: '' });

  async function service(method, path) {
    const response = await fetch(base + path, { method, headers: { accept: 'application/json' } });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) throw Object.assign(new Error(body?.message || `The sign-in service answered ${response.status}`), { code: body?.error || `http_${response.status}` });
    return body;
  }

  /** Whether the page was opened from a failed link; then drop the link's parameters from the address. */
  function takeLinkResult() {
    const url = new URL(location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const failed = Boolean(url.searchParams.get('error') || hash.get('error'));
    const present = LINK_PARAMS.some(name => url.searchParams.has(name) || hash.has(name));
    if (present) {
      for (const name of LINK_PARAMS) { url.searchParams.delete(name); hash.delete(name); }
      const rest = hash.toString();
      history?.replaceState?.(history.state, '', `${url.pathname}${url.search}${rest ? `#${rest}` : ''}`);
    }
    return failed;
  }

  function open() {
    if (opening) return opening;
    opening = (async () => {
      const settings = await service('GET', `/sign-in/${encodeURIComponent(providerId)}`);
      if (settings?.flow !== 'supabase_magic_link' || typeof settings.url !== 'string' || typeof settings.publishableKey !== 'string') {
        throw new Error('The service does not offer email-link sign-in');
      }
      const { createClient } = await loadSupabase();
      const client = createClient(settings.url, settings.publishableKey, { auth: {
        flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: SUPABASE_AUTH_STORAGE_KEY, storage
      } });
      // Resolves after supabase-js has exchanged a returning link's code for a session.
      const { data, error } = await client.auth.getSession();
      const failedLink = takeLinkResult();
      client.auth.onAuthStateChange((event, session) => set(session ? signedIn(session)
        : { phase: status.phase === 'link_sent' ? 'link_sent' : 'signed_out', email: null }));
      set(data?.session ? signedIn(data.session) : { phase: 'signed_out', email: null, message: failedLink ? LINK_FAILED : error?.message || '' });
      return { client, settings };
    })();
    // A failed opening is reported and retried by the next call.
    opening.catch(error => { opening = null; set({ phase: 'unavailable', email: null, message: error.message }); });
    return opening;
  }

  return Object.freeze({
    providerId,
    state: snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    /** Load the settings and any session a returning link completed. */
    async start() { await open(); return snapshot(); },

    /** Ask Supabase to email a one-time link that returns to this page. */
    async requestLink(email) {
      const address = String(email ?? '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter an email address.');
      const { client } = await open();
      set({ phase: 'sending', message: 'Sending link…' });
      const { error } = await client.auth.signInWithOtp({ email: address, options: { emailRedirectTo: `${location.origin}${location.pathname}`, shouldCreateUser: true } });
      if (error) { set({ phase: 'signed_out', message: error.message }); throw new Error(error.message); }
      set({ phase: 'link_sent', message: 'Check your email for a sign-in link. Open it on this device.' });
    },

    /** The earning client's port: a fresh assertion bound to a single-use state from the service. */
    async signIn({ providerId: requested = providerId } = {}) {
      if (requested !== providerId) throw new Error(`This sign-in serves ${providerId}, not ${requested}`);
      const { client } = await open();
      const { data } = await client.auth.getSession();
      if (!data?.session) throw Object.assign(new Error(SIGN_IN_FIRST), { code: 'sign_in_required' });
      const issued = await service('POST', `/sign-in/${encodeURIComponent(providerId)}/states`);
      const updated = await client.auth.updateUser({ data: { [issued.metadataKey]: issued.state } });
      if (updated.error) throw new Error(updated.error.message);
      const refreshed = await client.auth.refreshSession();
      const accessToken = refreshed.data?.session?.access_token;
      if (refreshed.error || typeof accessToken !== 'string') throw new Error(refreshed.error?.message || 'Supabase did not refresh the session');
      return { accessToken, state: issued.state };
    },

    /** End the Supabase session on this device; a Reploid session ends through its own route. */
    async signOut() {
      const { client } = await open();
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new Error(error.message);
      set({ phase: 'signed_out', email: null, message: '' });
    }
  });
}
