/**
 * HTTP for the hosted self-serve fleet at one stable prefix, `/v1/fleet`:
 *
 *   POST /v1/fleet                         signed fleet operations (service.js), authenticated by enrolled keys
 *   GET  /v1/fleet/client                  public settings
 *   GET  /v1/fleet/coordinator             the coordinator's public key, for checking settlement statements
 *   POST /v1/fleet/account                 create (or return) the session's account        [session]
 *   GET  /v1/fleet/account                 balance, held, debt limit, computers, open codes [session]
 *   POST /v1/fleet/pairings                a single-use pairing code                        [session]
 *   GET  /v1/fleet/pairings/:id            its state, and the claiming computer's fingerprint [session]
 *   POST /v1/fleet/pairings/:id/confirm    enroll the claiming computer's key               [session]
 *   POST /v1/fleet/pairings/:id/cancel                                                      [session]
 *   POST /v1/fleet/join                    a native host claims a code, signed by its key
 *   POST /v1/fleet/join/status             the host waits for confirmation, signed by its key
 *   GET  /v1/fleet/statement               the account's signed statement for offline checking [session]
 *   POST /v1/fleet/computers/revoke        remove one computer key from the account         [session]
 *
 * A session is the existing sign-in's ID token (`Authorization: Bearer …`), verified by `authenticate`.
 * Bodies are parsed here with a byte bound, so this handler mounts before any general body parser.
 */
import { SelfServeError } from './self-serve.js';
import { answerCoordinatorKey } from './service.js';
import { bearerToken } from '../pool/http-admission.js';

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
};

/** Firebase ID-token claims to a session. Anonymous sign-ins are accounts too, without starter debt. */
export function firebaseSessionAuthenticator(verifyIdToken) {
  return async token => {
    const claims = await verifyIdToken(token);
    const provider = claims?.firebase?.sign_in_provider ?? 'unknown';
    const verified = provider !== 'anonymous' && provider !== 'unknown' && (provider !== 'password' || claims.email_verified === true);
    return { issuer: claims.iss || 'firebase', subject: claims.uid || claims.sub, provider, verified };
  };
}

/**
 * Loopback development and tests only: `test:<subject>:verified|anonymous`. The mount refuses it in production.
 */
export const testSessionAuthenticator = Object.assign(async token => {
  const match = /^test:([a-z0-9-]{1,64}):(verified|anonymous)$/.exec(token);
  if (!match) throw Error('Unrecognized test session');
  return { issuer: 'test', subject: match[1], provider: match[2] === 'verified' ? 'test-verified' : 'anonymous', verified: match[2] === 'verified' };
}, { testOnly: true });

export function createSelfServeHttpHandler({ selfServe, fleet, authenticate, coordinator = null, clientKey = request => request.socket?.remoteAddress || 'unknown',
  maxBodyBytes = 65536, fleetMaxBodyBytes = 1048576, fleetRequestsPerMinute = 600 }) {
  const fleetCounts = new Map();
  const readJson = async (request, limit = maxBodyBytes) => {
    if (request.body !== undefined) throw new SelfServeError('body_parsed', 'Request body was already parsed upstream', 500);
    let length = 0; const chunks = [];
    for await (const chunk of request) {
      length += chunk.length;
      if (length > limit) throw new SelfServeError('body_too_large', 'Request too large', 413);
      chunks.push(chunk);
    }
    if (!length) return {};
    try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new SelfServeError('body_invalid', 'Request body must be JSON'); }
  };
  const session = async request => {
    const token = bearerToken(request);
    if (!token) throw new SelfServeError('sign_in_required', 'Sign in first.', 401);
    try {
      const value = await authenticate(token);
      if (!value?.subject) throw Error('No subject');
      return value;
    } catch { throw new SelfServeError('sign_in_required', 'Your sign-in expired. Sign in again.', 401); }
  };

  return async function handle(request, response) {
    const url = new URL(request.originalUrl || request.url || '/', 'http://local');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;
    try {
      if (route === '/v1/fleet') {
        if (method !== 'POST') throw new SelfServeError('method', 'Use POST for fleet operations', 405);
        // A coarse per-network bound; signed operations are already bounded per account by the ledger.
        const key = clientKey(request), minute = Math.floor(Date.now() / 60000);
        const count = fleetCounts.get(key);
        const next = count?.minute === minute ? count.count + 1 : 1;
        if (fleetCounts.size > 10000) fleetCounts.clear();
        fleetCounts.set(key, { minute, count: next });
        if (next > fleetRequestsPerMinute) throw new SelfServeError('rate_limited', 'Too many fleet requests from this network.', 429);
        return fleet.handle(request, response);
      }
      const client = clientKey(request);
      if (route === '/v1/fleet/client' && method === 'GET') return json(response, 200, selfServe.client());
      if (route === '/v1/fleet/coordinator' && method === 'GET') return answerCoordinatorKey(response, coordinator);
      if (route === '/v1/fleet/join' && method === 'POST') return json(response, 200, await selfServe.claim(await readJson(request), { client }));
      if (route === '/v1/fleet/join/status' && method === 'POST') return json(response, 200, await selfServe.poll(await readJson(request), { client }));
      if (route === '/v1/fleet/account' && method === 'POST') {
        const who = await session(request); await readJson(request);
        return json(response, 200, await selfServe.createAccount(who, { client }));
      }
      if (route === '/v1/fleet/account' && method === 'GET') return json(response, 200, await selfServe.account(await session(request)));
      if (route === '/v1/fleet/statement' && method === 'GET') return json(response, 200, selfServe.statement(await session(request)));
      if (route === '/v1/fleet/pairings' && method === 'POST') {
        const who = await session(request); await readJson(request);
        return json(response, 200, selfServe.createPairing(who));
      }
      if (route === '/v1/fleet/computers/revoke' && method === 'POST') {
        const who = await session(request), body = await readJson(request);
        return json(response, 200, await selfServe.revoke(who, body.participantId));
      }
      const pairing = /^\/v1\/fleet\/pairings\/(pair-[0-9a-f-]{36})(?:\/(confirm|cancel))?$/.exec(route);
      if (pairing) {
        const who = await session(request), [, id, action] = pairing;
        if (!action && method === 'GET') return json(response, 200, selfServe.pairing(who, id));
        if (action === 'confirm' && method === 'POST') return json(response, 200, await selfServe.confirm(who, id, await readJson(request)));
        if (action === 'cancel' && method === 'POST') { await readJson(request); return json(response, 200, selfServe.cancelPairing(who, id)); }
      }
      throw new SelfServeError('not_found', 'Unknown fleet endpoint', 404);
    } catch (error) {
      if (response.headersSent) { response.destroy(error); return; }
      const known = error instanceof SelfServeError;
      json(response, known ? error.status : 400, { error: error.message, code: known ? error.code : 'invalid_request' });
    }
  };
}
