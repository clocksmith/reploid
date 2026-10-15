/** Sign-in for local development against a service running the local test flow (flow `local_test_subject`).
 * The person types a short name; the service issues a test assertion for it. Any name signs in as that
 * name, so hosts offer this only on a loopback page and the service only outside production. It has the
 * same state, subscribe, start, signIn and signOut shape as the Supabase sign-in (../supabase-sign-in.js). */

const SUBJECT = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEY = 'reploid.earning-local-subject:v1';

/**
 * @param {object} options
 * @param {string} options.baseUrl the earning service base (…/v1)
 * @param {string} options.providerId the service's local test provider id
 * @param {Function} [options.fetch]
 * @param {object} [options.storage] Web Storage area remembering the typed name on this device
 */
export function createLocalTestSignIn({ baseUrl, providerId, fetch = globalThis.fetch, storage = globalThis.localStorage } = {}) {
  if (typeof baseUrl !== 'string' || typeof providerId !== 'string' || !providerId) throw new TypeError('Local sign-in needs the service base and provider id');
  const base = baseUrl.replace(/\/$/, '');
  const listeners = new Set();
  const stored = () => { try { return storage?.getItem(KEY) || null; } catch { return null; } };
  let status = { phase: 'idle', subject: null, message: '' };
  const snapshot = () => ({ ...status });
  const set = next => { status = { ...status, ...next }; for (const listener of listeners) listener(snapshot()); };

  return Object.freeze({
    providerId,
    flow: 'local_test_subject',
    state: snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    async start() {
      const subject = stored();
      set(subject ? { phase: 'signed_in', subject, message: '' } : { phase: 'signed_out', subject: null });
      return snapshot();
    },
    /** Remember the typed name on this device; the next signIn() asks the service for its assertion. */
    async useSubject(value) {
      const subject = String(value ?? '').trim().toLowerCase();
      if (!SUBJECT.test(subject)) throw new Error('Use a short name of lowercase letters, digits, dots, dashes or underscores.');
      storage?.setItem(KEY, subject);
      set({ phase: 'signed_in', subject, message: '' });
    },
    /** The earning client's port: a fresh test assertion for the remembered name. */
    async signIn({ providerId: requested = providerId } = {}) {
      if (requested !== providerId) throw new Error(`This sign-in serves ${providerId}, not ${requested}`);
      const subject = stored();
      if (!subject) throw Object.assign(new Error('Sign in on this device first.'), { code: 'sign_in_required' });
      const response = await fetch(`${base}/sign-in/${encodeURIComponent(providerId)}/assertions`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ subject })
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok || typeof body?.assertion !== 'string') {
        throw Object.assign(new Error(body?.message || `The sign-in service answered ${response.status}`), { code: body?.error || `http_${response.status}` });
      }
      return body.assertion;
    },
    async signOut() {
      storage?.removeItem(KEY);
      set({ phase: 'signed_out', subject: null, message: '' });
    }
  });
}

export default createLocalTestSignIn;
