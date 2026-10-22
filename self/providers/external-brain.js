/** Loopback-only request/reply adapter. The controller supplies reasoning, never execution authority. */
import { getCurrentReploidInstanceId } from '../instance.js';

const ROOT = '/api/external-brain';
const HEADERS = { 'Content-Type': 'application/json', 'X-Reploid-External-Brain': '1' };
const isLoopbackHost = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);

export function createExternalBrainProvider({
  fetch: fetchRequest = (...args) => globalThis.fetch(...args),
  getLocation = () => globalThis.location,
  getSessionId = () => `x:${getCurrentReploidInstanceId() || 'default'}`
} = {}) {
  const active = new Map();
  const chat = async (messages, modelConfig, requestId, { signal } = {}) => {
    const location = getLocation();
    if (!location || !isLoopbackHost(location.hostname) || !['http:', 'https:'].includes(location.protocol)) {
      throw new Error('External reasoning is available only on a loopback X server');
    }
    signal?.throwIfAborted();
    const sessionId = getSessionId();
    const controller = new AbortController();
    let cancellation = null;
    const cancel = () => {
      controller.abort(signal?.reason);
      // The held response's disconnect also cancels server work. This explicit
      // request records the same outcome when a browser reuses its connection.
      cancellation ??= fetchRequest(`${ROOT}/requests/${encodeURIComponent(requestId)}`, {
        method: 'DELETE', headers: HEADERS, credentials: 'omit', redirect: 'error', cache: 'no-store', body: JSON.stringify({ sessionId }),
        signal: AbortSignal.timeout(2000)
      }).catch(() => null);
    };
    active.set(requestId, cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      signal?.throwIfAborted();
      // Do not serialize modelConfig: other providers may put credentials in it.
      const response = await fetchRequest(`${ROOT}/generate`, {
        method: 'POST', headers: HEADERS, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({
          schema: 'reploid.external-brain.request/v1', requestId, sessionId,
          modelId: modelConfig.id, messages, tools: modelConfig.tools || []
        })
      });
      let body;
      try {
        body = await response.json();
      } catch {
        if (response.ok) throw new Error('Invalid JSON from external reasoning mailbox');
      }
      if (!response.ok) {
        const error = new Error(body?.error || `External reasoning mailbox unavailable (${response.status})`);
        error.status = response.status;
        error.code = body?.code;
        throw error;
      }
      signal?.throwIfAborted();
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!body || body.requestId !== requestId || body.sessionId !== sessionId
        || body.provider !== 'external' || body.model !== modelConfig.id
        || typeof body.content !== 'string' || !Array.isArray(body.toolCalls || [])) {
        throw new Error('Invalid external reasoning response');
      }
      return body;
    } finally {
      signal?.removeEventListener('abort', cancel);
      active.delete(requestId);
      await cancellation;
    }
  };
  return {
    chat,
    abort(requestId) {
      const cancel = active.get(requestId);
      if (!cancel) return false;
      cancel();
      return true;
    },
    status: () => ({ available: true, mode: 'external', transport: 'loopback-mailbox' })
  };
}
