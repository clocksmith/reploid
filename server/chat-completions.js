/** Text-only HTTP projection of the existing partition requester. No provider fallback. */
import { randomUUID } from 'node:crypto';
import policy from '../self/config/partition-policy.json' with { type: 'json' };

const fail = (status, message, param = null) => Object.assign(new Error(message), { status, param });
const assert = (ok, message) => { if (!ok) throw fail(502, message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const freeze = value => { if (object(value) || Array.isArray(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const errorBody = error => ({ error: { message: error.message, type: error.status < 500 ? 'invalid_request_error' : 'server_error',
  param: error.param || null, code: error.status === 401 ? 'unauthorized' : error.status === 403 ? 'permission_denied' : null } });

export function parseTextChatCompletion(body) {
  if (!object(body)) throw fail(400, 'A JSON object is required');
  for (const key of Object.keys(body)) if (!['model', 'messages', 'stream'].includes(key)) throw fail(400, `Unsupported parameter: ${key}`, key);
  if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 256) throw fail(400, 'A bounded model id is required', 'model');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw fail(400, 'stream must be boolean', 'stream');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 128) throw fail(400, 'Require 1–128 text messages', 'messages');
  let characters = 0;
  const messages = body.messages.map((message, index) => {
    const param = `messages[${index}]`;
    if (!object(message) || Object.keys(message).some(key => !['role', 'content'].includes(key))
      || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw fail(400, 'Only system/user/assistant string-content messages are supported', param);
    }
    characters += message.content.length;
    if (characters > policy.inputLimits.maxInputCharacters) throw fail(413, 'Input text limit exceeded', 'messages');
    return { role: message.role, content: message.content };
  });
  return freeze({ model: body.model, messages, stream: body.stream === true });
}

async function readBody(req, signal) {
  const chunks = []; let bytes = 0;
  const aborted = () => req.destroy();
  signal.addEventListener('abort', aborted, { once: true });
  try {
    for await (const chunk of req) {
      signal.throwIfAborted(); bytes += chunk.length;
      if (bytes > policy.controlChannel.maxControlBytes) throw fail(413, 'Request body limit exceeded');
      chunks.push(chunk);
    }
    try { return parseTextChatCompletion(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (error) { if (error.status) throw error; throw fail(400, 'Invalid JSON'); }
  } finally { signal.removeEventListener('abort', aborted); }
}

/** Explicit opt-in: the host authenticates callers AND approves each exact disclosure.
 * The participant and its model/cleanup owners are borrowed, never replaced or closed here.
 */
export function createChatCompletions({ participant, authenticate, authorize }) {
  if (!participant || typeof participant.generate !== 'function' || typeof participant.getState !== 'function'
    || typeof authenticate !== 'function' || typeof authorize !== 'function') throw Error('Chat Completions requires an actual requester and explicit authentication/authorization ports');
  const active = new Set(); let closed = false;
  const handle = async (req, res) => {
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; }
    catch { json(res, 400, errorBody(fail(400, 'Invalid API route'))); return; }
    if (pathname !== '/v1/chat/completions') {
      json(res, 404, errorBody(fail(404, 'Unsupported API route'))); return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
    if (closed || active.size >= policy.inputLimits.maxConcurrentAttempts) {
      json(res, closed ? 503 : 429, errorBody(fail(closed ? 503 : 429, 'Requester admission unavailable'))); return;
    }
    const controller = new AbortController(), signal = controller.signal;
    let settle;
    const item = { controller, completion: new Promise(resolve => { settle = resolve; }) }; active.add(item);
    const cancel = () => controller.abort(Error('HTTP requester disconnected'));
    req.once('aborted', cancel); res.once('close', cancel);
    const timer = setTimeout(() => controller.abort(fail(408, 'Request admission deadline exceeded')), policy.controlChannel.timeoutMs);
    let streaming = false, emitted = '', sequence = 0;
    const id = 'chatcmpl-' + randomUUID().replaceAll('-', ''), created = Math.floor(Date.now() / 1000);
    const threadId = randomUUID().replaceAll('-', ''), attemptId = randomUUID().replaceAll('-', '');
    let model;
    const chunk = (delta, finishReason = null) => {
      signal.throwIfAborted();
      if (!streaming) {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }); streaming = true;
      }
      const value = { id, object: 'chat.completion.chunk', created, model: model.id,
        choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }] };
      if (!res.write(`data: ${JSON.stringify(value)}\n\n`) && res.writableLength > policy.controlChannel.maxBufferedBytes) {
        controller.abort(Error('HTTP stream output buffer exceeded')); signal.throwIfAborted();
      }
    };
    try {
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'application/json required');
      const authenticated = await authenticate(req, { signal }); signal.throwIfAborted();
      if (!object(authenticated) || typeof authenticated.subject !== 'string' || !authenticated.subject || authenticated.subject.length > 512) throw fail(401, 'Authentication required');
      const principal = freeze({ subject: authenticated.subject });
      const input = await readBody(req, signal); signal.throwIfAborted();
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
            if (input.stream) chunk({ ...(streaming ? {} : { role: 'assistant' }), content: event.text });
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
      if (input.stream) {
        if (!sequence) chunk({ role: 'assistant', content: result.content });
        chunk({}, finishReason); res.end('data: [DONE]\n\n');
      } else json(res, 200, { id, object: 'chat.completion', created, model: model.id,
        choices: [{ index: 0, message: { role: 'assistant', content: result.content, refusal: null }, logprobs: null, finish_reason: finishReason }] });
    } catch (cause) {
      const error = cause instanceof Error ? cause : fail(502, 'Requester failed');
      controller.abort(error);
      if (!res.destroyed && !res.writableEnded) {
        const body = errorBody(error);
        if (streaming) res.end(`data: ${JSON.stringify(body)}\n\n`);
        else json(res, error.status || 502, body);
      }
    } finally {
      clearTimeout(timer); req.removeListener('aborted', cancel); res.removeListener('close', cancel);
      active.delete(item); settle();
    }
  };
  return Object.freeze({ handle, getState: () => ({ closed, active: active.size, scope: 'http-requests' }),
    async close() {
      closed = true;
      for (const item of active) item.controller.abort(Error('Chat Completions server closing'));
      let timer;
      try { await Promise.race([Promise.all([...active].map(item => item.completion)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('HTTP requester cleanup remains unsettled')), policy.controlChannel.timeoutMs);
      })]); } finally { clearTimeout(timer); }
    } });
}
