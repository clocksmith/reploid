import http from 'node:http';
import { createCircleHttpGrants } from './http-grants.js';
import { formatHostDisclosure } from './admission.js';
import { handleCircleInviteOwnerCommand } from './owner-invites.js';

const MAX_BODY_BYTES = 16_384;

function sendJson(res, statusCode, payload) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJson(req, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    function cleanup() {
      req.off('data',data); req.off('end',end); req.off('aborted',aborted); req.off('error',fail);
      signal?.removeEventListener('abort', aborted);
    }
    function fail(error) { cleanup(); req.resume(); reject(error); }
    function aborted() { fail(signal?.reason ?? Error('Client disconnected')); }
    function data(chunk) {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) return fail(Object.assign(Error('Request body exceeds limit'), {statusCode:413,code:'BODY_TOO_LARGE'}));
      chunks.push(chunk);
    }
    function end() {
      cleanup();
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(Error('Invalid JSON body'),{statusCode:400,code:'INVALID_JSON'})); }
    }
    signal?.addEventListener('abort',aborted,{once:true});
    req.on('data',data); req.once('end',end); req.once('aborted',aborted); req.once('error',fail);
  });
}

function errorStatus(code, fallback = 400) {
  switch (code) {
    case 'CIRCLE_INVITE':
    case 'CIRCLE_OWNER':
    case 'CIRCLE_REVOKED':
    case 'CIRCLE_EXPIRED':
    case 'CHALLENGE_CHAT_FORBIDDEN':
      return 403;
    case 'CIRCLE_WAIT_EXCEEDED':
    case 'CHALLENGE_WAIT_EXCEEDED':
    case 'CHALLENGE_CAPACITY_FULL':
    case 'CHALLENGE_HOST_RATE_CAP':
    case 'CHALLENGE_VISITOR_CAP':
      return 429;
    case 'CIRCLE_OFFLINE':
    case 'CIRCLE_CLOSED':
    case 'CHALLENGE_REPLAY_ONLY':
      return 503;
    case 'CIRCLE_DUPLICATE':
      return 409;
    default:
      return fallback;
  }
}

/**
 * Request-path HTTP gateway for Wave 1 invite-gated circle chat, zero-load public recorded demo,
 * authenticated owner invite controls, and toggleable Wave 2 public Daily Challenge lane.
 */
export function createCirclePublicGateway({
  invites,
  admission,
  ownerPairing,
  authenticatePeer,
  publicChallengeGate = null,
  recordedDemo,
  executeInference,
  executeChallenge = null,
  revocationPolicy = 'finish',
  grantTtlMs = 10_000,
  now = Date.now
}) {
  if (!invites || !admission || !ownerPairing || typeof authenticatePeer !== 'function'
    || typeof executeInference !== 'function' || !recordedDemo) {
    throw new Error('Circle gateway requires invites, admission, ownerPairing, authenticatePeer, recordedDemo, and executeInference');
  }

  const grants = createCircleHttpGrants({invites,admission,ownerPairing,grantTtlMs,now});
  const shutdown = new AbortController();
  let inferenceCalls = 0;
  let challengeCalls = 0;
  let activeExecutions = 0;
  let peakExecutions = 0;
  let demoViews = 0;

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      return sendJson(res, 400, { error: 'Invalid request URL' });
    }

    const { pathname } = url;

    if (req.method === 'GET' && (pathname === '/circle/demo' || pathname === '/circle/status')) {
      demoViews += 1;
      const availability = admission.getAvailability();
      return sendJson(res, 200, {
        surface: 'wave1-circle',
        demo: recordedDemo,
        host: availability,
        disclosure: availability.disclosure,
        challenge: publicChallengeGate ? publicChallengeGate.status() : { mode: 'replay-only', enabled: false, openChatAllowed: false }
      });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (['/circle/admit','/circle/chat','/circle/cancel'].includes(pathname)) {
      return handleChat(req,res,pathname);
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message, code: error.code || 'BAD_REQUEST' });
    }

    if (pathname === '/circle/redeem') {
      const peerId = await authenticatePeer(req);
      if (!peerId) return sendJson(res, 401, { error: 'Authenticated peer required', fallback: ['replay', 'host-your-own'] });
      if (body.hostPeerId && body.hostPeerId !== invites.hostPeerId) {
        return sendJson(res, 403, { error: 'Invite is scoped to a different computer', code: 'CIRCLE_WRONG_HOST', fallback: ['replay', 'host-your-own'] });
      }
      const grant = invites.redeem({ token: body.token, guestPeerId: peerId });
      if (!grant) {
        return sendJson(res, 403, { error: 'Invite is invalid, expired, revoked, or already claimed', code: 'CIRCLE_INVITE', fallback: ['replay', 'host-your-own'] });
      }
      const availability = admission.getAvailability();
      return sendJson(res, 200, {
        grant,
        host: availability,
        disclosure: formatHostDisclosure({ hostPeerId: grant.hostPeerId, hostLabel: grant.hostLabel })
      });
    }

    if (pathname === '/circle/owner') {
      const peerId = await authenticatePeer(req);
      if (!peerId) return sendJson(res, 401, { error: 'Authenticated owner required' });
      try {
        const result = await handleCircleInviteOwnerCommand({
          invites,
          ownerPairing,
          authenticatePeer: async id => id,
          getQueuedCount: inviteId => admission.getQueuedCount(inviteId),
          getActiveCount: inviteId => admission.getActiveCount(inviteId),
          revocationPolicy,
          peerId,
          command: body
        });
        return sendJson(res, 200, { ok: true, result });
      } catch (error) {
        const statusCode = /Only a paired owner/.test(error.message) ? 403 : 400;
        return sendJson(res, statusCode, { error: error.message });
      }
    }

    if (pathname === '/circle/challenge') {
      if (!publicChallengeGate) {
        return sendJson(res, 503, {
          error: 'Public challenge lane is disabled; replay-only mode active',
          code: 'CHALLENGE_REPLAY_ONLY',
          mode: 'replay-only',
          fallback: ['replay', 'host-your-own']
        });
      }
      let reservation;
      try {
        reservation = publicChallengeGate.admit({
          kind: body.kind,
          visitorId: body.visitorId,
          modelIdentity: body.modelIdentity,
          maxOutputTokens: body.maxOutputTokens,
          challengeDay: body.challengeDay
        });
      } catch (error) {
        return sendJson(res, error.statusCode || errorStatus(error.code, 400), {
          error: error.message,
          code: error.code || 'CHALLENGE_REJECTED',
          fallback: error.fallback || ['replay', 'host-your-own']
        });
      }
      if (!reservation.admitted) {
        return sendJson(res, errorStatus(reservation.code, 429), {
          admitted: false,
          code: reservation.code,
          mode: reservation.mode,
          disclosure: reservation.disclosure,
          expectedWaitMs: reservation.expectedWaitMs ?? null,
          fallback: reservation.fallback
        });
      }

      activeExecutions += 1;
      if (activeExecutions > peakExecutions) peakExecutions = activeExecutions;
      challengeCalls += 1;
      try {
        const runner = executeChallenge || executeInference;
        const result = await runner({
          prompt: body.prompt,
          maxOutputTokens: reservation.maxOutputTokens,
          reservation
        });
        return sendJson(res, 200, {
          admitted: true,
          output: result?.output ?? '',
          disclosure: reservation.disclosure,
          receipt: {
            schema: 'reploid.circle-challenge-receipt/v1',
            hostPeerId: reservation.hostPeerId,
            hostLabel: reservation.hostLabel,
            modelIdentity: reservation.modelIdentity,
            outputTokens: result?.outputTokens ?? 0,
            maxOutputTokens: reservation.maxOutputTokens,
            modelWeightBytes: result?.modelWeightBytes ?? 0
          },
          remainingVisitorTurns: reservation.remainingVisitorTurns
        });
      } finally {
        activeExecutions = Math.max(0, activeExecutions - 1);
        reservation.release();
      }
    }

    return sendJson(res, 404, { error: 'Not found' });
  }

  async function handleChat(req,res,pathname) {
    const peerId = await authenticatePeer(req);
    if (!peerId) return sendJson(res,401,{error:'Authenticated peer required',code:'CIRCLE_UNAUTHENTICATED',fallback:['replay','host-your-own']});
    const disconnected = new AbortController();
    const abort = () => { if (!res.writableEnded) disconnected.abort(Error('Client disconnected')); };
    res.once('close',abort);
    const signal = AbortSignal.any([disconnected.signal,shutdown.signal]);
    let entry, ownsEntry = false, dispatched = false;
    try {
      if (res.destroyed) throw Error('Client disconnected');
      if (pathname === '/circle/admit') {
        const body = await readJson(req,signal);
        if (body?.hostPeerId !== invites.hostPeerId) return sendJson(res,403,{error:'Admission requires the exact expected host',code:'CIRCLE_WRONG_HOST'});
        const {hostPeerId,...metadata} = body;
        // acquire rejects every unknown property (including a prompt). Only these
        // metadata bytes travel to the host while the normal caller waits in queue.
        const lease = await admission.acquire(metadata,{authenticatedPeerId:peerId,signal});
        entry = grants.issue(lease,peerId,metadata);
        ownsEntry = true;
        signal.throwIfAborted();
        const undelivered = () => { if (!res.writableFinished) grants.abandon(entry); };
        res.once('close',undelivered);
        res.once('finish',() => res.off('close',undelivered));
        return sendJson(res,200,{admitted:true,grant:entry.token,expiresAt:entry.expiresAt,hostPeerId,
          requesterPeerId:peerId,requestId:metadata.requestId,modelIdentity:metadata.modelIdentity,maxOutputTokens:metadata.maxOutputTokens,
          disclosure:lease.disclosure});
      }
      // Authenticate and validate headers before attaching a body reader. Recheck
      // the invitation or owner immediately before dispatch, including slow uploads.
      entry = grants.lookup(req.headers['x-circle-grant'],peerId,req.headers['x-circle-host']);
      if (pathname === '/circle/cancel') { grants.abandon(entry); return sendJson(res,200,{cancelled:true}); }
      grants.claim(entry);
      ownsEntry = true;
      const body = await readJson(req,AbortSignal.any([signal,entry.abort.signal]));
      if (typeof body?.prompt !== 'string' || !body.prompt.trim() || Object.keys(body).length !== 1) {
        throw Object.assign(Error('A single non-empty prompt is required'),{code:'CIRCLE_REQUEST'});
      }
      signal.throwIfAborted();
      grants.dispatch(entry);
      dispatched = true;
      const {lease,metadata} = entry;
      activeExecutions++; peakExecutions = Math.max(peakExecutions,activeExecutions); inferenceCalls++;
      const result = await executeInference({prompt:body.prompt,maxOutputTokens:metadata.maxOutputTokens,requestId:metadata.requestId,
        authenticatedPeerId:peerId,lease,signal:AbortSignal.any([signal,lease.streamSignal])});
      const outcome = lease.streamSignal.aborted || signal.aborted ? 'stopped' : result?.outcome || 'completed';
      const settled = lease.settle({outcome,outputTokens:result?.outputTokens ?? 0,modelWeightBytes:result?.modelWeightBytes ?? 0});
      return sendJson(res,200,{output:result?.output ?? '',disclosure:lease.disclosure,receipt:settled.receipt,alreadySettled:settled.alreadySettled});
    } catch (error) {
      if (dispatched) {
        const stopped = entry.lease.streamSignal.aborted || signal.aborted;
        const settled = entry.lease.settle({outcome:stopped ? 'stopped':'failed',outputTokens:0,modelWeightBytes:0});
        return sendJson(res,stopped ? 409:500,{error:error.message,code:stopped?'CIRCLE_REVOKED':'CIRCLE_EXECUTION_FAILED',receipt:settled.receipt});
      }
      if (ownsEntry) grants.abandon(entry);
      const full = /queue is full/.test(error.message);
      return sendJson(res,full ? 429 : errorStatus(error.code,error.statusCode || 400),{error:error.message,
        code:error.code ?? (full?'CIRCLE_FULL':'CIRCLE_REJECTED'),state:error.state ?? admission.getAvailability().status,
        expectedWaitMs:error.expectedWaitMs ?? null,fallback:error.fallback ?? ['replay','host-your-own']});
    } finally {
      res.off('close',abort);
      if (dispatched) { activeExecutions--; entry.lease.release(); }
    }
  }

  function stats() {
    return Object.freeze({
      demoViews,
      inferenceCalls,
      challengeCalls,
      activeExecutions,
      peakExecutions
    });
  }

  async function listen({ host = '127.0.0.1', port = 0 } = {}) {
    const inFlight = new Set();
    const server = http.createServer((req, res) => {
      const task = handle(req, res).catch(error => {
        if (!res.headersSent) sendJson(res, 500, { error: error?.message || 'Internal error' });
      });
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    const address = server.address();
    const origin = `http://${host}:${address.port}`;
    return Object.freeze({
      server,
      origin,
      stats,
      async close() {
        shutdown.abort();
        grants.close();
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
        await Promise.allSettled(inFlight);
      }
    });
  }

  return Object.freeze({ handle, listen, stats });
}
