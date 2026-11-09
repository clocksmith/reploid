import { createHttpRequestOwner } from './http-request-owner.js';
/** Authenticated recovery of an existing accepted request; this never generates. */
import { readBody, fail, object } from './text-requester.js';
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };

export const TEXT_RECOVERY_PATH = '/v1/reploid/recover';
export function createTextRecovery({ participant, accounting, authenticate, authorize }) {
  const requests = createHttpRequestOwner({ timeoutMs: policy.controlChannel.timeoutMs });
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  return {
    async handle(req, res) {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
      if (requests.closed || typeof accounting?.recover !== 'function' || typeof participant.recoverGeneration !== 'function') {
        return json(res, 503, { error: { message: 'Request recovery unavailable' } });
      }
      if (requests.size >= policy.inputLimits.maxConcurrentAttempts) return json(res, 429, { error: { message: 'Recovery admission unavailable' } });
      const scope = requests.begin(req, res, {
        disconnectError: () => Error('Recovery disconnected'), deadlineError: () => Error('Recovery deadline exceeded')
      });
      const { signal } = scope;
      try {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'application/json required');
        const principal = await authenticate(req, { signal }); signal.throwIfAborted();
        if (!object(principal) || typeof principal.subject !== 'string' || !principal.subject || principal.subject.length > 512) throw fail(401, 'Authentication required');
        const input = await readBody(req, signal, body => {
          if (!object(body) || Object.keys(body).some(key => !['reservationId', 'messages', 'providerId'].includes(key))
            || typeof body.reservationId !== 'string' || !body.reservationId || body.reservationId.length > 512
            || !Array.isArray(body.messages) || !body.messages.length) throw fail(400, 'Expected accepted reservationId and original messages');
          return body;
        });
        if (await authorize({ action: 'chat.recover', principal: Object.freeze({ subject: principal.subject }),
          reservationId: input.reservationId, signal }) !== true) throw fail(403, 'Request recovery denied');
        signal.throwIfAborted();
        const result = await accounting.recover(input, { principal: { subject: principal.subject }, signal },
          (request, reference, controls) => participant.recoverGeneration(request, reference, controls));
        signal.throwIfAborted(); json(res, 200, result);
      } catch (error) {
        if (!res.destroyed && !res.writableEnded) json(res, error.status || 502, { error: { message: error.message } });
      } finally {
        scope.finish();
      }
    },
    close: () => requests.close(() => Error('Recovery closed'), () => Error('Recovery cleanup remains unsettled'))
  };
}
