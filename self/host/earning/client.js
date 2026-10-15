/**
 * Host client for the earning routes, shared by the browser and native hosts.
 *
 * Off unless configured: createEarningClient returns null without an explicit
 * { schema, enabled: true, baseUrl, providerId } configuration. It signs in
 * through the injected provider port, registers this host's participant
 * identity as a device and binds its own session to it, then carries quote,
 * acceptance, attempt, report, attempt evidence, delivery and claim requests. Every mutation has
 * a stable Idempotency-Key and waits in a durable outbox until the service
 * answers definitely; a restarted host resends the same request and the
 * service reconciles it to its one effect. Nothing here decides prices,
 * outcomes or rewards, and conversation text never travels.
 */
import { createDeviceRegistrationProof, createSessionBinding } from '../../vendor/reploid/artifacts/participant-proofs.js';
import { createAttemptEvidenceSigner } from '../../vendor/reploid/mesh/partitions/partition-attempt-evidence.js';

export const EARNING_CLIENT_SCHEMA = 'reploid.earning-client/v1';
const OUTBOX = 'outbox';
const SESSION = 'session';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
// Answers after which the same request may still have an effect, or may yet succeed.
const AMBIGUOUS = new Set(['idempotency_in_progress', 'rate_limited', 'internal_error', 'storage_conflict', 'attempt_active']);
const SESSION_LOST = new Set(['session_invalid', 'session_ended', 'session_expired', 'session_revoked']);

export class EarningRequestError extends Error {
  constructor({ status = 0, code, message = code, pending = false, body = null }) {
    super(message);
    this.name = 'EarningRequestError';
    Object.assign(this, { status, code, pending, body });
  }
}

/** Validate the explicit configuration; nothing has a default. */
export function readEarningClientConfig(config) {
  if (config == null || config.enabled !== true) return null;
  const keys = ['schema', 'enabled', 'baseUrl', 'providerId'];
  const unknown = Object.keys(config).filter(key => !keys.includes(key));
  if (unknown.length || config.schema !== EARNING_CLIENT_SCHEMA) throw new TypeError(`Earning client configuration must be ${EARNING_CLIENT_SCHEMA} with ${keys.join(', ')}`);
  let url;
  try { url = new URL(config.baseUrl); } catch { throw new TypeError('Earning client baseUrl must be an absolute URL'); }
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && LOOPBACK.has(url.hostname)) || url.search || url.hash) {
    throw new TypeError('Earning client baseUrl must be https, or http on loopback, without query or fragment');
  }
  if (typeof config.providerId !== 'string' || !config.providerId) throw new TypeError('Earning client providerId is required');
  return Object.freeze({ schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: url.href.replace(/\/$/, ''), providerId: config.providerId });
}

/**
 * @param {object} options
 * @param {object|null} options.config explicit configuration; null or disabled returns null
 * @param {object} options.identity this host's persistent participant signing identity
 * @param {'browser'|'native'} options.host
 * @param {Function} options.signIn ({ providerId }) -> provider assertion, from the provider interface
 * @param {object} options.storage durable { get(key), set(key, value), delete(key) }, kept across restarts
 * @param {Function} [options.fetch]
 */
export function createEarningClient({ config = null, identity, host, signIn, storage, fetch = globalThis.fetch } = {}) {
  const settings = readEarningClientConfig(config);
  if (!settings) return null;
  if (!identity?.peerId || !identity.privateJwk) throw new TypeError('Earning client requires this host\'s participant identity');
  if (!['browser', 'native'].includes(host)) throw new TypeError('Earning client host must be browser or native');
  if (typeof signIn !== 'function' || typeof fetch !== 'function') throw new TypeError('Earning client requires sign-in and fetch ports');
  if (!['get', 'set', 'delete'].every(method => typeof storage?.[method] === 'function')) throw new TypeError('Earning client requires durable storage');
  let signingIn = null, queue = Promise.resolve();
  // Outbox changes run one at a time so concurrent senders never drop each other's entries.
  const serial = task => { const run = queue.then(task); queue = run.catch(() => {}); return run; };

  async function call(method, path, { token = null, key = null, body } = {}) {
    let response;
    try {
      response = await fetch(settings.baseUrl + path, { method, headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (cause) {
      throw new EarningRequestError({ code: 'network_unavailable', message: String(cause?.message || cause), pending: true });
    }
    let json = null;
    try { json = await response.json(); } catch { json = null; }
    if (response.ok) return json;
    const code = typeof json?.error === 'string' ? json.error : `http_${response.status}`;
    throw new EarningRequestError({ status: response.status, code, message: json?.message || code,
      pending: response.status >= 500 || AMBIGUOUS.has(code) || SESSION_LOST.has(code), body: json });
  }

  /**
   * A stored session acting as this device, or a new sign-in whose session
   * this device binds: by registering, or, once registered, by binding the
   * new session to its registration.
   */
  async function ensureSession() {
    const stored = await storage.get(SESSION);
    if (stored?.participantId === identity.peerId && stored.token) return stored;
    signingIn ??= (async () => {
      const assertion = await signIn({ providerId: settings.providerId });
      const signed = await call('POST', '/accounts/sign-in', { body: { providerId: settings.providerId, assertion } });
      const token = signed.session.token, sessionId = signed.session.sessionId;
      const challenge = await call('POST', '/devices/challenges', { token });
      const sessionBinding = await createSessionBinding({ identity, challenge });
      let device;
      try {
        const proof = await createDeviceRegistrationProof({ identity, challenge, host });
        device = await call('POST', '/devices', { token, key: `register:${identity.peerId}:${sessionId}`, body: { proof, bindSession: true, sessionBinding } });
      } catch (error) {
        if (error.code !== 'device_already_registered') throw error;
        const registered = (await call('GET', '/devices', { token })).devices
          .find(row => row.participantId === identity.peerId && row.status === 'active');
        if (!registered) throw error;
        device = await call('POST', `/devices/${encodeURIComponent(registered.deviceId)}/sessions`, { token, key: `bind:${identity.peerId}:${sessionId}`,
          body: { sessionBinding } });
      }
      const session = { token, sessionId, accountId: signed.account.accountId, deviceId: device.deviceId, participantId: identity.peerId };
      await storage.set(SESSION, session);
      return session;
    })().finally(() => { signingIn = null; });
    return signingIn;
  }

  /** A read or an unkeyed request under the device session. */
  async function request(method, path, body) {
    const session = await ensureSession();
    try { return await call(method, path, { token: session.token, body }); }
    catch (error) { if (SESSION_LOST.has(error.code)) await storage.delete(SESSION); throw error; }
  }

  const readOutbox = async () => (await storage.get(OUTBOX)) ?? [];
  const removeOp = opId => serial(async () => storage.set(OUTBOX, (await readOutbox()).filter(op => op.opId !== opId)));

  /** Deliver one stored mutation; a definite answer removes it, an ambiguous one keeps it for reconcile(). */
  async function deliver(op) {
    const session = await ensureSession();
    try {
      const body = await call(op.method, op.path, { token: session.token, key: op.key, body: op.body });
      await removeOp(op.opId);
      return body;
    } catch (error) {
      if (SESSION_LOST.has(error.code)) await storage.delete(SESSION);
      if (!error.pending) await removeOp(op.opId);
      throw error;
    }
  }

  /**
   * Store, then send, one keyed mutation. `opId` names it in the outbox; a
   * repeated send of a stored op resends the stored body, never a new one.
   * `durable: false` sends under the key without storing: a request whose
   * effect, if any, the service releases on its own (a quote, an acceptance
   * that expires unused, a binding before dispatch).
   */
  async function send({ opId, method = 'POST', path, body, key = opId, durable = true }) {
    if (!durable) {
      const session = await ensureSession();
      try { return await call(method, path, { token: session.token, key, body }); }
      catch (error) { if (SESSION_LOST.has(error.code)) await storage.delete(SESSION); throw error; }
    }
    const op = await serial(async () => {
      const outbox = await readOutbox();
      const existing = outbox.find(entry => entry.opId === opId);
      if (existing) return existing;
      const entry = structuredClone({ opId, method, path, key, body });
      await storage.set(OUTBOX, [...outbox, entry]);
      return entry;
    });
    return deliver(op);
  }

  return Object.freeze({
    config: settings,
    participantId: identity.peerId,
    // Signs this device's attempt charge bindings and output acknowledgments with its registered identity.
    evidenceSigner: createAttemptEvidenceSigner({ identity }),
    ensureSession,
    send,
    get: path => request('GET', path),
    post: (path, body) => request('POST', path, body),
    pending: async () => structuredClone(await readOutbox()),
    /** Resend every stored mutation in order; each settles or stays pending. */
    async reconcile() {
      const results = [];
      for (const op of await readOutbox()) {
        try { results.push({ opId: op.opId, ok: true, body: await deliver(op) }); }
        catch (error) { results.push({ opId: op.opId, ok: false, code: error.code, pending: error.pending === true }); }
      }
      return results;
    },
    storage
  });
}

/** Durable storage over a Web Storage area (browser hosts), one JSON value per key under `prefix`. */
export function createWebStorageEarningStorage(area, prefix = 'reploid.earning:v1') {
  return Object.freeze({
    async get(key) { const raw = area.getItem(`${prefix}:${key}`); return raw === null ? null : JSON.parse(raw); },
    async set(key, value) { area.setItem(`${prefix}:${key}`, JSON.stringify(value)); },
    async delete(key) { area.removeItem(`${prefix}:${key}`); }
  });
}

export default createEarningClient;
