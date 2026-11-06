/** Authenticated recovery of an existing accepted request; this never generates. */
import { readBody, fail, object } from './text-requester.js';
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };

export const TEXT_RECOVERY_PATH = '/v1/reploid/recover';
export function createTextRecovery({ participant, accounting, authenticate, authorize }) {
  const active = new Set(); let closed = false;
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  return {
    async handle(req, res) {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
      if (closed || typeof accounting?.recover !== 'function' || typeof participant.recoverGeneration !== 'function') {
        return json(res, 503, { error: { message: 'Request recovery unavailable' } });
      }
      if (active.size >= policy.inputLimits.maxConcurrentAttempts) return json(res, 429, { error: { message: 'Recovery admission unavailable' } });
      const controller = new AbortController(), { signal } = controller;
      const done = Promise.withResolvers(), item = { controller, done: done.promise }; active.add(item);
      const cancel = () => controller.abort(Error('Recovery disconnected'));
      const timer = setTimeout(() => controller.abort(Error('Recovery deadline exceeded')), policy.controlChannel.timeoutMs);
      req.once('aborted', cancel); res.once('close', cancel);
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
        clearTimeout(timer); req.removeListener('aborted', cancel); res.removeListener('close', cancel); active.delete(item); done.resolve();
      }
    },
    async close() {
      closed = true;
      for (const item of active) item.controller.abort(Error('Recovery closed'));
      let timer;
      try { await Promise.race([Promise.all([...active].map(item => item.done)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Recovery cleanup remains unsettled')), policy.controlChannel.timeoutMs);
      })]); } finally { clearTimeout(timer); }
    }
  };
}
