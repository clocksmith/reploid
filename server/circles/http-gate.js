import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { formatHostDisclosure } from './admission.js';
import { handleCircleInviteOwnerCommand } from './owner-invites.js';

const MAX_BODY_BYTES = 16_384;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body exceeds limit'), { statusCode: 413, code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400, code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
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
  revocationPolicy = 'finish'
}) {
  if (!invites || !admission || !ownerPairing || typeof authenticatePeer !== 'function'
    || typeof executeInference !== 'function' || !recordedDemo) {
    throw new Error('Circle gateway requires invites, admission, ownerPairing, authenticatePeer, recordedDemo, and executeInference');
  }

  const releases = new Map();
  const releaseTtlMs = 5_000;
  function retireRelease(token, releaseSlot = true) {
    const entry = releases.get(token);
    if (!entry) return null;
    releases.delete(token);
    clearTimeout(entry.timer);
    entry.lease.streamSignal.removeEventListener('abort', entry.cancel);
    if (releaseSlot) entry.lease.release();
    return entry;
  }
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

    if (pathname === '/circle/admit' || pathname === '/circle/chat') {
      const peerId = await authenticatePeer(req);
      if (!peerId) return sendJson(res, 401, { error: 'Authenticated peer required', code: 'CIRCLE_UNAUTHENTICATED' });
      if (body.hostPeerId !== invites.hostPeerId) {
        return sendJson(res, 403, { error: 'Invite cannot route work to another computer', code: 'CIRCLE_WRONG_HOST', fallback: ['replay', 'host-your-own'] });
      }
      if (pathname === '/circle/admit') {
        const { hostPeerId, ...metadata } = body;
        const waiting = new AbortController();
        const disconnect = () => { if (!res.writableEnded) waiting.abort(Error('Requester disconnected')); };
        res.once('close', disconnect);
        let lease;
        try {
          lease = await admission.acquire(metadata, { authenticatedPeerId: peerId, signal: waiting.signal, deferDisclosure: true });
          waiting.signal.throwIfAborted();
          if (res.destroyed) throw Error('Requester disconnected');
          const token = randomUUID();
          const issuedAt = Date.now();
          const expiresAt = Math.min(issuedAt + releaseTtlMs, lease.expiresAt ?? Infinity);
          if (expiresAt <= issuedAt || lease.streamSignal.aborted) throw Error('Disclosure release has expired');
          const timer = setTimeout(() => retireRelease(token), expiresAt - issuedAt);
          timer.unref?.();
          const cancel = () => retireRelease(token);
          releases.set(token, { peerId, hostPeerId, metadata, lease, expiresAt, timer, cancel });
          lease.streamSignal.addEventListener('abort', cancel, { once: true });
          sendJson(res, 200, { release: token, expiresAt, hostPeerId, requestId: metadata.requestId, disclosure: lease.disclosure });
        } catch (error) {
          lease?.release();
          if (!res.destroyed) return sendJson(res, /queue is full/.test(error.message) ? 429 : errorStatus(error.code, 400), {
            error: error.message, code: error.code || 'CIRCLE_REJECTED', fallback: ['replay', 'host-your-own']
          });
        } finally {
          res.off('close', disconnect);
        }
        return;
      }
      const entry = typeof body.release === 'string' ? releases.get(body.release) : null;
      if (!entry || entry.peerId !== peerId || entry.hostPeerId !== body.hostPeerId || entry.metadata.requestId !== body.requestId
        || entry.expiresAt <= Date.now() || typeof body.prompt !== 'string' || !body.prompt.trim()
        || !Object.keys(body).every(key => ['release', 'hostPeerId', 'requestId', 'prompt'].includes(key))) {
        return sendJson(res, 403, { error: 'A fresh admission release for this computer is required', code: 'CIRCLE_RELEASE' });
      }
      retireRelease(body.release, false);
      const { lease, metadata } = entry;
      try {
        lease.beginDisclosure();
      } catch (error) {
        lease.release();
        return sendJson(res, errorStatus(error.code, 403), { error: error.message, code: error.code || 'CIRCLE_RELEASE' });
      }

      activeExecutions += 1;
      if (activeExecutions > peakExecutions) peakExecutions = activeExecutions;
      inferenceCalls += 1;
      try {
        const result = await executeInference({
          prompt: body.prompt,
          maxOutputTokens: metadata.maxOutputTokens,
          lease,
          signal: lease.streamSignal
        });
        const outcome = lease.streamSignal.aborted ? 'stopped' : (result?.outcome || 'completed');
        const settled = lease.settle({
          outcome,
          outputTokens: result?.outputTokens ?? 0,
          modelWeightBytes: result?.modelWeightBytes ?? 0
        });
        return sendJson(res, 200, {
          output: result?.output ?? '',
          disclosure: lease.disclosure,
          receipt: settled.receipt,
          alreadySettled: settled.alreadySettled
        });
      } catch (error) {
        const outcome = lease.streamSignal.aborted ? 'stopped' : 'failed';
        const settled = lease.settle({ outcome, outputTokens: 0, modelWeightBytes: 0 });
        return sendJson(res, lease.streamSignal.aborted ? 409 : 500, {
          error: error.message,
          code: lease.streamSignal.aborted ? 'CIRCLE_REVOKED' : 'CIRCLE_EXECUTION_FAILED',
          receipt: settled.receipt
        });
      } finally {
        activeExecutions = Math.max(0, activeExecutions - 1);
        lease.release();
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
    const server = http.createServer((req, res) => {
      void handle(req, res).catch(error => {
        if (!res.headersSent) sendJson(res, 500, { error: error?.message || 'Internal error' });
      });
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
        for (const token of releases.keys()) retireRelease(token);
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
      }
    });
  }

  return Object.freeze({ handle, listen, stats });
}
