import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import express from 'express';

const REQUEST_SCHEMA = 'reploid.external-brain.request/v1';
const RESPONSE_SCHEMA = 'reploid.external-brain.response/v1';
const MAX_BODY_BYTES = 256 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const MESSAGE_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool', 'function']);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => typeof value === 'string' && ID_PATTERN.test(value);

function hasBoundedDepth(value) {
  const remaining = [{ value, depth: 0 }];
  while (remaining.length) {
    const entry = remaining.pop();
    if (entry.depth > 64) return false;
    if (entry.value !== null && typeof entry.value === 'object') {
      for (const child of Object.values(entry.value)) {
        remaining.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
  return true;
}

function boundedOption(value, fallback, maximum, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function isLoopbackSocket(address) {
  if (address === '::1') return true;
  const ipv4 = address?.startsWith('::ffff:') ? address.slice(7) : address;
  return isIP(ipv4 || '') === 4 && ipv4.startsWith('127.');
}

function localOrigin(req) {
  const host = req.headers.host;
  if (typeof host !== 'string') return null;
  // Do not let URL parsing normalize unusual IPv4 spellings or user information
  // into a trusted Host. Forwarded headers never establish local ownership.
  const match = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::([1-9]\d{0,4}))?$/.exec(host);
  if (!match || (match[2] && Number(match[2]) > 65535)) return null;
  if (match[1].startsWith('127') && isIP(match[1]) !== 4) return null;
  const protocol = req.socket.encrypted ? 'https' : 'http';
  return new URL(`${protocol}://${host}`).origin;
}

function hasRepeatedBoundaryHeader(req) {
  const names = new Set(['host', 'origin', 'x-reploid-external-brain']);
  const seen = new Set();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const header = req.rawHeaders[i].toLowerCase();
    if (!names.has(header)) continue;
    if (seen.has(header)) return true;
    seen.add(header);
  }
  return false;
}

function fail(res, status, code, error, identity = {}) {
  return res.status(status).json({ error, code, ...identity });
}

function validateRequest(body) {
  if (!isRecord(body) || body.schema !== REQUEST_SCHEMA) return 'Invalid request schema';
  if (!hasBoundedDepth(body)) return 'Request nesting exceeds 64 levels';
  if (!isId(body.requestId) || !isId(body.sessionId)) return 'Invalid request or session identity';
  if (typeof body.modelId !== 'string' || !/^[^\s\x00-\x1f\x7f]{1,128}$/.test(body.modelId)) {
    return 'Invalid model identity';
  }
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 256) {
    return 'Messages must contain between 1 and 256 entries';
  }
  for (const message of body.messages) {
    if (!isRecord(message) || !MESSAGE_ROLES.has(message.role)) return 'Invalid message';
    const hasContent = typeof message.content === 'string'
      || message.content === null
      || (Array.isArray(message.content) && message.content.every(isRecord));
    const hasToolCalls = message.role === 'assistant' && Array.isArray(message.tool_calls);
    if (!hasContent && !hasToolCalls) return 'Invalid message content';
  }
  if (!Array.isArray(body.tools) || body.tools.length > 128) return 'Tools must contain at most 128 entries';
  const names = new Set();
  for (const tool of body.tools) {
    const fn = tool?.function;
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(fn)
      || typeof fn.name !== 'string' || !TOOL_NAME_PATTERN.test(fn.name)
      || (fn.parameters !== undefined && !isRecord(fn.parameters))
      || (fn.description !== undefined && typeof fn.description !== 'string')) {
      return 'Invalid OpenAI function tool schema';
    }
    if (names.has(fn.name)) return 'Duplicate tool name';
    names.add(fn.name);
  }
  return null;
}

function validateResponse(body) {
  if (!isRecord(body) || body.schema !== RESPONSE_SCHEMA) return 'Invalid response schema';
  if (!hasBoundedDepth(body)) return 'Response nesting exceeds 64 levels';
  if (!isId(body.requestId) || !isId(body.sessionId)) return 'Invalid request or session identity';
  if (typeof body.content !== 'string') return 'Response content must be a string';
  if (body.toolCalls === undefined) return null;
  if (!Array.isArray(body.toolCalls) || body.toolCalls.length > 128) return 'Invalid tool calls';
  const ids = new Set();
  for (const call of body.toolCalls) {
    if (!isRecord(call) || typeof call.name !== 'string' || !TOOL_NAME_PATTERN.test(call.name)
      || !isRecord(call.args) || (call.id !== undefined && !isId(call.id))) {
      return 'Invalid tool call';
    }
    if (call.id !== undefined && ids.has(call.id)) return 'Duplicate tool call identity';
    if (call.id !== undefined) ids.add(call.id);
  }
  return null;
}

/**
 * An opt-in, same-machine reasoning mailbox. The caller owns mounting and HTTP
 * server lifetime. Mount before general JSON/CORS middleware; close() settles
 * every waiter. Tool calls are proposals for the existing browser executor.
 * Callers must never reuse IDs: duplicate rejection covers only pending entries
 * and the last maxSettled settlements, and this process-local state is volatile.
 */
export function createExternalBrainRouter(options = {}) {
  const timeoutMs = boundedOption(options.timeoutMs, 300_000, 900_000, 'timeoutMs');
  const maxPending = boundedOption(options.maxPending, 16, 16, 'maxPending');
  const maxSettled = boundedOption(options.maxSettled, 64, 64, 'maxSettled');
  const router = express.Router();
  const pending = new Map();
  const settled = new Map();
  let closed = false;

  function settle(entry, status, httpStatus, result) {
    if (pending.get(entry.request.requestId) !== entry) return false;
    const { request, res, onDisconnect, timer } = entry;
    pending.delete(request.requestId);
    clearTimeout(timer);
    res.off('close', onDisconnect);
    settled.set(request.requestId, {
      requestId: request.requestId,
      sessionId: request.sessionId,
      modelId: request.modelId,
      status,
      createdAt: entry.createdAt,
      settledAt: Date.now()
    });
    while (settled.size > maxSettled) settled.delete(settled.keys().next().value);
    // The retained summary must not retain messages, schemas, content or calls.
    entry.request = null;
    entry.res = null;
    entry.onDisconnect = null;
    entry.timer = null;
    if (result && !res.destroyed && !res.writableEnded) res.status(httpStatus).json(result);
    return true;
  }

  function failWaiter(entry, status, httpStatus, code, error) {
    const { requestId, sessionId } = entry.request;
    settle(entry, status, httpStatus, { error, code, requestId, sessionId });
  }

  function expirePending() {
    const now = Date.now();
    for (const entry of pending.values()) {
      if (now >= entry.deadlineAt) {
        failWaiter(entry, 'timed_out', 504, 'external_brain_timeout', 'External reasoning request timed out');
      }
    }
  }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = localOrigin(req);
    if (!isLoopbackSocket(req.socket.remoteAddress) || !origin || hasRepeatedBoundaryHeader(req)) {
      return fail(res, 403, 'local_only', 'External reasoning requires a loopback socket and Host');
    }
    if (req.headers.origin !== undefined && req.headers.origin !== origin) {
      return fail(res, 403, 'origin_denied', 'External reasoning requires an exact same-origin request');
    }
    if (req.headers['x-reploid-external-brain'] !== '1') {
      return fail(res, 403, 'bridge_header_required', 'X-Reploid-External-Brain: 1 is required');
    }
    if (closed) return fail(res, 503, 'external_brain_closed', 'External reasoning mailbox is closed');
    expirePending();
    next();
  });

  router.use((req, res, next) => {
    if (['POST', 'DELETE'].includes(req.method) && !req.is('application/json')) {
      return fail(res, 415, 'json_required', 'An application/json body is required');
    }
    next();
  });
  router.use(express.json({ limit: MAX_BODY_BYTES, strict: true, inflate: false }));
  router.use((req, res, next) => {
    // Body ingress is asynchronous: close/deadline can change while it arrives.
    if (closed) return fail(res, 503, 'external_brain_closed', 'External reasoning mailbox is closed');
    expirePending();
    next();
  });

  router.get('/status', (req, res) => {
    res.json({ enabled: true, provider: 'external', pending: pending.size, maxPending, timeoutMs });
  });

  router.get('/requests', (req, res) => {
    res.json({
      pending: [...pending.values()].map(({ request, createdAt, deadlineAt }) => ({
        ...request, createdAt, deadlineAt
      })),
      settled: [...settled.values()]
    });
  });

  router.post('/generate', (req, res) => {
    const error = validateRequest(req.body);
    if (error) return fail(res, 400, 'invalid_request', error);
    const { requestId, sessionId, modelId, messages, tools } = req.body;
    if (pending.has(requestId) || settled.has(requestId)) {
      return fail(res, 409, 'request_id_reused', 'Request identity has already been used', { requestId });
    }
    if (pending.size >= maxPending) return fail(res, 429, 'mailbox_full', 'External reasoning mailbox is full');
    if (req.aborted || res.destroyed) return;
    const createdAt = Date.now();
    const entry = {
      request: { schema: REQUEST_SCHEMA, requestId, sessionId, modelId, messages, tools },
      createdAt,
      deadlineAt: createdAt + timeoutMs,
      res,
      timer: null,
      onDisconnect: null
    };
    entry.onDisconnect = () => settle(entry, 'disconnected');
    entry.timer = setTimeout(() => {
      failWaiter(entry, 'timed_out', 504, 'external_brain_timeout', 'External reasoning request timed out');
    }, timeoutMs);
    entry.timer.unref?.();
    pending.set(requestId, entry);
    res.once('close', entry.onDisconnect);
  });

  function correlatedRequest(req, res, sessionId) {
    const requestId = req.params.requestId;
    if (!isId(requestId)) {
      fail(res, 400, 'invalid_request', 'Invalid request identity');
      return null;
    }
    const entry = pending.get(requestId);
    const known = entry?.request || settled.get(requestId);
    if (!known) {
      fail(res, 404, 'request_not_found', 'Unknown external reasoning request', { requestId });
      return null;
    }
    if (known.sessionId !== sessionId) {
      fail(res, 409, 'session_mismatch', 'Session identity does not match this request', { requestId });
      return null;
    }
    if (!entry) {
      fail(res, 409, 'request_settled', 'External reasoning request is already settled', { requestId, status: known.status });
      return null;
    }
    return entry;
  }

  router.post('/requests/:requestId/respond', (req, res) => {
    const error = validateResponse(req.body);
    if (error) return fail(res, 400, 'invalid_response', error);
    const { requestId, sessionId, content } = req.body;
    if (requestId !== req.params.requestId) {
      return fail(res, 400, 'request_mismatch', 'Response and route request identities do not match');
    }
    const entry = correlatedRequest(req, res, sessionId);
    if (!entry) return;
    const toolNames = new Set(entry.request.tools.map((tool) => tool.function.name));
    if (req.body.toolCalls?.some((call) => !toolNames.has(call.name))) {
      return fail(res, 400, 'unknown_tool', 'Tool call names must match this request\'s advertised tools');
    }
    const toolCalls = req.body.toolCalls?.length
      ? req.body.toolCalls.map((call) => ({ id: call.id || `external_${randomUUID()}`, name: call.name, args: call.args }))
      : null;
    const result = {
      requestId,
      sessionId,
      provider: 'external',
      model: entry.request.modelId,
      content,
      raw: content,
      toolCalls
    };
    settle(entry, 'completed', 200, result);
    res.json({ requestId, sessionId, status: 'completed' });
  });

  router.delete('/requests/:requestId', (req, res) => {
    if (!isRecord(req.body) || !isId(req.body.sessionId)) {
      return fail(res, 400, 'invalid_request', 'A valid session identity is required');
    }
    const entry = correlatedRequest(req, res, req.body.sessionId);
    if (!entry) return;
    failWaiter(entry, 'cancelled', 409, 'external_brain_cancelled', 'External reasoning request was cancelled');
    res.json({ requestId: req.params.requestId, sessionId: req.body.sessionId, status: 'cancelled' });
  });

  router.use((req, res) => fail(res, 404, 'route_not_found', 'Unknown external reasoning route'));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') return fail(res, 413, 'body_too_large', 'Request body exceeds 256 KiB');
    if (error.status === 415) return fail(res, 415, 'unsupported_encoding', 'Unsupported JSON body encoding');
    if (error.status === 400) return fail(res, 400, 'invalid_json', 'Invalid JSON request body');
    return fail(res, 500, 'external_brain_error', 'External reasoning mailbox failed');
  });

  function close() {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) {
      failWaiter(entry, 'closed', 503, 'external_brain_closed', 'External reasoning mailbox is closed');
    }
  }

  return { router, close };
}
