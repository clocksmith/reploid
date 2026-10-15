// The browser half of Supabase magic-link sign-in: the link request, the PKCE return, the
// state-bound assertion the earning client's signIn port receives, and the Account section.
// supabase-js and the earning service are fakes; addresses and tokens are test-only.
import { describe, expect, it, vi } from 'vitest';

import { SUPABASE_AUTH_STORAGE_KEY, createSupabaseSignIn } from '../../self/host/supabase-sign-in.js';
import { bindAccountSignIn, renderAccountSignIn } from '../../self/ui/pool-home/account-sign-in.js';

const BASE = 'https://reploid.test/v1';
const SETTINGS = { providerId: 'supabase', flow: 'supabase_magic_link', url: 'https://projectreftest.supabase.co', publishableKey: 'sb_publishable_test_only', metadataKey: 'reploid_sign_in_state' };

/** supabase-js stand-in: one session, user metadata, and a refresh that re-mints the token from it. */
function fakeSupabase({ session = null } = {}) {
  const calls = [];
  const listeners = [];
  const state = { session, metadata: {} };
  const auth = {
    getSession: async () => ({ data: { session: state.session }, error: null }),
    onAuthStateChange: (listener) => { listeners.push(listener); listener('INITIAL_SESSION', state.session); return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithOtp: async (args) => { calls.push(['signInWithOtp', args]); return { data: {}, error: null }; },
    updateUser: async (args) => { calls.push(['updateUser', args]); Object.assign(state.metadata, args.data); return { data: { user: state.session.user }, error: null }; },
    refreshSession: async () => {
      calls.push(['refreshSession']);
      state.session = { ...state.session, access_token: `token-carrying:${state.metadata.reploid_sign_in_state}` };
      return { data: { session: state.session }, error: null };
    },
    signOut: async (args) => { calls.push(['signOut', args]); state.session = null; listeners.forEach((listener) => listener('SIGNED_OUT', null)); return { error: null }; }
  };
  return { calls, state, load: async () => ({ createClient: (...args) => { calls.push(['createClient', ...args]); return { auth }; } }) };
}

/** The earning service: settings and single-use states. */
function fakeService() {
  const requests = [];
  let issued = 0;
  const fetch = async (url, init = {}) => {
    requests.push([init.method ?? 'GET', url]);
    if (url === `${BASE}/sign-in/supabase`) return Response.json(SETTINGS);
    if (url === `${BASE}/sign-in/supabase/states` && init.method === 'POST') return Response.json({ providerId: 'supabase', state: `rss1.state-${++issued}.mac`, metadataKey: 'reploid_sign_in_state' }, { status: 201 });
    return Response.json({ error: 'route_not_found', message: 'no earning route matches this method and path' }, { status: 404 });
  };
  return { fetch, requests };
}

const page = (href) => {
  const url = new URL(href);
  return { location: { href, origin: url.origin, pathname: url.pathname }, history: { state: null, replaceState: vi.fn() } };
};

describe('Supabase magic-link sign-in in the browser', () => {
  it('asks Supabase to email a link back to this page and sends the address nowhere else', async () => {
    const supabase = fakeSupabase();
    const service = fakeService();
    const signIn = createSupabaseSignIn({ baseUrl: BASE, fetch: service.fetch, storage: null, loadSupabase: supabase.load, ...page('https://reploid.test/app?thread=1') });
    await expect(signIn.requestLink('not-an-address')).rejects.toThrow('Enter an email address.');
    await signIn.requestLink(' person@example.test ');
    expect(supabase.calls[0]).toEqual(['createClient', SETTINGS.url, SETTINGS.publishableKey, { auth: {
      flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: SUPABASE_AUTH_STORAGE_KEY, storage: null
    } }]);
    expect(supabase.calls[1]).toEqual(['signInWithOtp', { email: 'person@example.test', options: { emailRedirectTo: 'https://reploid.test/app', shouldCreateUser: true } }]);
    expect(signIn.state()).toMatchObject({ phase: 'link_sent', message: 'Check your email for a sign-in link. Open it on this device.' });
    expect(service.requests).toEqual([['GET', `${BASE}/sign-in/supabase`]]);
    // Without a completed link there is no assertion, and no state is requested.
    await expect(signIn.signIn({ providerId: 'supabase' })).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(service.requests).toHaveLength(1);
  });

  it('after the link returns, gives the earning client a fresh state-bound assertion each time', async () => {
    const supabase = fakeSupabase({ session: { access_token: 'original', user: { id: 'user-1', email: 'person@example.test' } } });
    const service = fakeService();
    const returning = page('https://reploid.test/app?code=pkce-code-1&thread=1');
    const signIn = createSupabaseSignIn({ baseUrl: BASE, fetch: service.fetch, loadSupabase: supabase.load, ...returning });
    expect(await signIn.start()).toMatchObject({ phase: 'signed_in', email: 'person@example.test' });
    expect(returning.history.replaceState).toHaveBeenCalledWith(null, '', '/app?thread=1');
    const first = await signIn.signIn({ providerId: 'supabase' });
    expect(first).toEqual({ accessToken: 'token-carrying:rss1.state-1.mac', state: 'rss1.state-1.mac' });
    expect(supabase.calls.slice(1)).toEqual([['updateUser', { data: { reploid_sign_in_state: 'rss1.state-1.mac' } }], ['refreshSession']]);
    expect((await signIn.signIn()).state).toBe('rss1.state-2.mac');
    await expect(signIn.signIn({ providerId: 'other' })).rejects.toThrow(/serves supabase/);
    await signIn.signOut();
    expect(supabase.calls.at(-1)).toEqual(['signOut', { scope: 'local' }]);
    expect(signIn.state().phase).toBe('signed_out');
  });

  it('reports a failed link and an unavailable service', async () => {
    const failed = page('https://reploid.test/app?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    const signIn = createSupabaseSignIn({ baseUrl: BASE, fetch: fakeService().fetch, loadSupabase: fakeSupabase().load, ...failed });
    expect(await signIn.start()).toMatchObject({ phase: 'signed_out', message: 'The sign-in link expired or was already used. Request a new one.' });
    expect(failed.history.replaceState).toHaveBeenCalledWith(null, '', '/app');
    const unconfigured = createSupabaseSignIn({ baseUrl: 'https://elsewhere.test/v1', fetch: fakeService().fetch, loadSupabase: fakeSupabase().load, ...page('https://reploid.test/app') });
    await expect(unconfigured.start()).rejects.toThrow('no earning route matches this method and path');
    expect(unconfigured.state()).toMatchObject({ phase: 'unavailable' });
  });

  it('renders the Account section from the sign-in state', async () => {
    const supabase = fakeSupabase();
    const signIn = createSupabaseSignIn({ baseUrl: BASE, fetch: fakeService().fetch, loadSupabase: supabase.load, ...page('https://reploid.test/app') });
    document.body.innerHTML = renderAccountSignIn();
    const dispose = bindAccountSignIn(document.body, signIn);
    const find = (selector) => document.querySelector(selector);
    await vi.waitFor(() => expect(signIn.state().phase).toBe('signed_out'));
    expect(find('[data-account-sign-in-summary]').textContent).toBe('Sign in with a one-time link sent to your email. Supabase receives your address to send it.');
    expect(find('[data-account-sign-in-send]').disabled).toBe(false);
    find('[data-account-sign-in-email]').value = 'person@example.test';
    find('[data-account-sign-in-form]').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(find('[data-account-sign-in-status]').textContent).toBe('Check your email for a sign-in link. Open it on this device.'));
    expect(find('[data-account-signed-in]').hidden).toBe(true);
    dispose();
  });
});
