/** Text-only HTTP projection of the existing partition requester. No provider fallback. */
import { randomUUID } from 'node:crypto';
import policy from '../self/config/partition-policy.json' with { type: 'json' };

export const fail = (status, message, param = null) => Object.assign(new Error(message), { status, param });
export const assert = (ok, message) => { if (!ok) throw fail(502, message); };
export const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const freeze = value => { if (object(value) || Array.isArray(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const errorBody = error => ({ error: { message: error.message, type: error.status < 500 ? 'invalid_request_error' : 'server_error',
  param: error.param || null, code: error.status === 401 ? 'unauthorized' : error.status === 403 ? 'permission_denied' : null } });
// Protocol adapters borrowing the same requester share its HTTP admission budget.
// Each adapter still owns only its own request cancellation/settlement.
const requesterAdmission = new WeakMap();

async function readBody(req, signal, parse) {
  const chunks = []; let bytes = 0;
  const aborted = () => req.destroy();
  signal.addEventListener('abort', aborted, { once: true });
  try {
    for await (const chunk of req) {
      signal.throwIfAborted(); bytes += chunk.length;
      if (bytes > policy.controlChannel.maxControlBytes) throw fail(413, 'Request body limit exceeded');
      chunks.push(chunk);
    }
    try { return parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (error) { if (error.status) throw error; throw fail(400, 'Invalid JSON'); }
  } finally { signal.removeEventListener('abort', aborted); }
}

/** Explicit opt-in: the host authenticates callers AND approves each exact disclosure.
 * The participant and its model/cleanup owners are borrowed, never replaced or closed here.
 */
export function createTextRequester({ participant, authenticate, authorize }, protocol) {
  if (!participant || typeof participant.generate !== 'function' || typeof participant.getState !== 'function'
    || typeof authenticate !== 'function' || typeof authorize !== 'function') throw Error('Text requester requires an actual requester and explicit authentication/authorization ports');
  const active = new Set(); let closed = false;
  if (!requesterAdmission.has(participant)) requesterAdmission.set(participant, new Set());
  const admitted = requesterAdmission.get(participant);
  const handle = async (req, res) => {
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; }
    catch { json(res, 400, errorBody(fail(400, 'Invalid API route'))); return; }
    if (pathname !== protocol.path) {
      json(res, 404, errorBody(fail(404, 'Unsupported API route'))); return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
    if (closed || admitted.size >= policy.inputLimits.maxConcurrentAttempts) {
      json(res, closed ? 503 : 429, errorBody(fail(closed ? 503 : 429, 'Requester admission unavailable'))); return;
    }
    const controller = new AbortController(), signal = controller.signal;
    let settle;
    const item = { controller, completion: new Promise(resolve => { settle = resolve; }) }; active.add(item); admitted.add(item);
    const cancel = () => controller.abort(Error('HTTP requester disconnected'));
    req.once('aborted', cancel); res.once('close', cancel);
    const timer = setTimeout(() => controller.abort(fail(408, 'Request admission deadline exceeded')), policy.controlChannel.timeoutMs);
    let streaming = false, emitted = '', sequence = 0;
    const id = protocol.idPrefix + randomUUID().replaceAll('-', ''), created = Math.floor(Date.now() / 1000);
    const threadId = randomUUID().replaceAll('-', ''), attemptId = randomUUID().replaceAll('-', '');
    let model, output;
    const write = data => {
      signal.throwIfAborted();
      if (!streaming) {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }); streaming = true;
      }
      if (!res.write(data) && res.writableLength > policy.controlChannel.maxBufferedBytes) {
        controller.abort(Error('HTTP stream output buffer exceeded')); signal.throwIfAborted();
      }
    };
    try {
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'application/json required');
      const authenticated = await authenticate(req, { signal }); signal.throwIfAborted();
      if (!object(authenticated) || typeof authenticated.subject !== 'string' || !authenticated.subject || authenticated.subject.length > 512) throw fail(401, 'Authentication required');
      const principal = freeze({ subject: authenticated.subject });
      const input = await readBody(req, signal, protocol.parse); signal.throwIfAborted();
      const models = participant.getState().models || [];
      const eligible = models.filter(value => value.id === input.model && value.partition && !value.canonical);
      if (!eligible.length) throw fail(503, 'No ready ordinary partition route for this model', 'model');
      if (new Set(eligible.map(value => value.identity)).size !== 1) throw fail(409, 'Model id has ambiguous execution identity', 'model');
      model = freeze(structuredClone(eligible[0]));
      assert(typeof model.identity === 'string' && model.identity.length > 0, 'Requester model identity missing');
      const request = freeze({ threadId, attemptId, model, messages: input.messages });
      if (await authorize({ action: 'chat.execute', principal, request, signal }) !== true) throw fail(403, 'Request execution denied');
      signal.throwIfAborted(); clearTimeout(timer);
      res.setHeader('x-request-id', id); res.setHeader('x-reploid-attempt-id', attemptId);
      res.setHeader('x-reploid-model-identity', model.identity);
      output = protocol.output({ id, created, model: model.id, input, write, end: value => res.end(value), json: value => json(res, 200, value) });
      const result = await participant.generate(request, {
        signal, onState() {},
        async requestApproval(preview) {
          signal.throwIfAborted();
          const approved = await authorize({ action: 'chat.disclose', principal, request,
            preview: freeze(structuredClone(preview)), signal });
          signal.throwIfAborted();
          if (approved !== true) throw fail(403, 'Recipient disclosure denied');
          return true;
        },
        onDelta(event) {
          try {
            signal.throwIfAborted();
            assert(event?.threadId === threadId && event.attemptId === attemptId && event.sequence === sequence++
              && typeof event.text === 'string', 'Requester delta identity or sequence mismatch');
            emitted += event.text;
            assert(emitted.length <= policy.inputLimits.maxOutputCharacters, 'Output text limit exceeded');
            if (input.stream) output.delta(event.text);
          } catch (error) { controller.abort(error); throw error; }
        }
      });
      signal.throwIfAborted();
      assert(result?.threadId === threadId && result.attemptId === attemptId && result.modelId === model.id
        && result.modelIdentity === model.identity, 'Requester result identity mismatch');
      assert(typeof result.content === 'string' && result.content.length <= policy.inputLimits.maxOutputCharacters, 'Invalid requester text result');
      assert(!sequence || emitted === result.content, 'Requester final text differs from streamed text');
      const reason = result.execution?.stopReason;
      assert(['length', 'max-tokens', 'stop', 'eos', 'eos-token', 'stop-token', 'stop-sequence', 'context-limit'].includes(reason), 'Requester termination reason unavailable');
      const finishReason = ['length', 'max-tokens', 'context-limit'].includes(reason) ? 'length' : 'stop';
      if (input.stream && !sequence) output.delta(result.content);
      output.complete(result.content, finishReason, reason);
    } catch (cause) {
      const error = cause instanceof Error ? cause : fail(502, 'Requester failed');
      controller.abort(error);
      if (!res.destroyed && !res.writableEnded) {
        const body = errorBody(error);
        if (streaming) output.error(body.error);
        else json(res, error.status || 502, body);
      }
    } finally {
      clearTimeout(timer); req.removeListener('aborted', cancel); res.removeListener('close', cancel);
      active.delete(item); admitted.delete(item); settle();
    }
  };
  return Object.freeze({ handle, getState: () => ({ closed, active: active.size, scope: 'http-requests' }),
    async close() {
      closed = true;
      for (const item of active) item.controller.abort(Error('Text requester server closing'));
      let timer;
      try { await Promise.race([Promise.all([...active].map(item => item.completion)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('HTTP requester cleanup remains unsettled')), policy.controlChannel.timeoutMs);
      })]); } finally { clearTimeout(timer); }
    } });
}
