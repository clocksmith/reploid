/**
 * @fileoverview Telemetry Timeline
 * Unified append-only event log for audit, performance, and agent state changes.
 */

import { RUN_TRACE_SCHEMA, RUN_TRACE_LIMITS, sanitizeRunTraceValue, validateRunTrace } from '../core/run-replay-bundle.js';

export const SAVED_TRACE_ROOT = '/.logs/recordings';
export const MAX_SAVED_TRACES = 8;
const savedTracePath = path => typeof path === 'string' && /^\/\.logs\/recordings\/[a-z0-9-]+\.json$/.test(path);
export async function listSavedRunTraces(VFS) {
  if (!VFS?.list) return [];
  const paths = await VFS.list(SAVED_TRACE_ROOT);
  return paths.filter(savedTracePath).sort().reverse().slice(0, MAX_SAVED_TRACES);
}
export async function readSavedRunTrace(VFS, path) {
  if (!savedTracePath(path)) throw new Error('Invalid saved recording path.');
  return validateRunTrace(await VFS.read(path));
}

// The minimal shell persists bounded recordings through its existing per-instance VFS.
// Records an ordered prefix; a full recorder never silently evicts earlier evidence.
export function createRunTraceRecorder({ now = Date.now, VFS = null, onPersistenceError = () => {},
  withLock = action => {
    if (!globalThis.navigator?.locks?.request) throw new Error('Safe browser storage locking is unavailable. Export this run before leaving.');
    return globalThis.navigator.locks.request('reploid:recordings:write', action);
  },
  makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` } = {}) {
  let trace;
  let session;
  let bytes = 0;
  let timer = null;
  let saving = Promise.resolve();
  const pending = new Set();
  const savePending = async () => {
    for (const item of [...pending]) {
      pending.delete(item);
      if (!item.trace.events.length || item.blocked) continue;
      try {
        if (!VFS?.write || !VFS?.list || !VFS?.read) throw new Error('Persistent VFS unavailable. Export this in-memory recording before leaving.');
        await withLock(async () => {
          if (!item.path) {
            const paths = await VFS.list(SAVED_TRACE_ROOT);
            if (paths.filter(savedTracePath).length >= MAX_SAVED_TRACES) throw new Error('Saved recording limit reached. Existing recordings are preserved; export this run before leaving.');
            const path = `${SAVED_TRACE_ROOT}/${Math.trunc(item.trace.startedAt)}-${makeId()}.json`;
            if (!savedTracePath(path) || paths.includes(path)) throw new Error('Recording identity collision; existing recording was not overwritten.');
            item.path = path;
          } else if (item.savedText !== null && await VFS.read(item.path) !== item.savedText) {
            throw new Error('Saved recording changed externally; it was not overwritten. Export the current in-memory run.');
          }
          const text = JSON.stringify(validateRunTrace(item.trace));
          await VFS.write(item.path, text);
          item.savedText = text;
          item.error = null;
        });
      } catch (error) {
        item.error = error.message;
        item.blocked = true;
        try { onPersistenceError(error.message); } catch { /* Persistence cannot fail the live run. */ }
      }
    }
  };
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    saving = saving.then(savePending);
    return saving;
  };
  const scheduleSave = () => {
    pending.add(session);
    if (timer === null) timer = setTimeout(() => { void flush(); }, 250);
  };
  const reset = (provenance = {}) => {
    trace = { schema: RUN_TRACE_SCHEMA, startedAt: now(), provenance: sanitizeRunTraceValue(provenance),
      droppedEvents: 0, events: [] };
    session = { trace, path: null, savedText: null, error: null, blocked: false };
    bytes = new TextEncoder().encode(JSON.stringify(trace)).length;
  };
  const record = (type, data) => {
    if (trace.droppedEvents) { trace.droppedEvents++; scheduleSave(); return; }
    try {
      const event = { seq: trace.events.length, ts: Math.max(now(), trace.events.at(-1)?.ts || trace.startedAt),
        type, data: sanitizeRunTraceValue(data) };
      const size = new TextEncoder().encode(JSON.stringify(event)).length;
      if (trace.events.length >= RUN_TRACE_LIMITS.events || size > RUN_TRACE_LIMITS.eventBytes
          || event.ts - trace.startedAt > RUN_TRACE_LIMITS.durationMs
          || bytes + size > RUN_TRACE_LIMITS.bytes - 65536) { trace.droppedEvents++; scheduleSave(); return; }
      trace.events.push(event);
      bytes += size + 1;
    } catch { trace.droppedEvents++; }
    scheduleSave();
  };
  const recordEvent = (type, data = {}) => {
    if (type === 'agent:history' && data.type === 'llm_response') {
      record('model_text', { content: data.content || '', cycle: data.cycle ?? null,
        model: data.model ?? data.modelUsed?.id ?? null, provider: data.provider ?? data.modelUsed?.provider ?? null,
        revision: data.modelUsed?.revision ?? null });
    } else if (type === 'agent:history' && data.type === 'tool_result') {
      // The loop also observes calls rejected before the executor (policy, parsing,
      // cooldown). Keep that evidence distinct from recorded execution attempts.
      record('tool_observation', { tool: data.tool || '', args: data.args || {}, result: data.result,
        cycle: data.cycle ?? null, model: data.model ?? null, provider: data.provider ?? null });
    } else if (type === 'agent:status') {
      record('status', { state: data.state || '', activity: data.activity || '', cycle: data.cycle ?? null });
    } else if (type === 'agent:error' || type === 'agent:warning') {
      record('error', { message: data.error || data.reason || data.message || '', cycle: data.cycle ?? null });
    }
  };
  reset();
  return { reset, record, recordEvent, flush, snapshot: () => validateRunTrace(trace),
    getPersistenceStatus: () => ({ path: session.path, error: session.error,
      saved: session.savedText !== null, pending: pending.has(session) }),
    close: async () => { await flush(); }
  };
}

const TelemetryTimeline = {
  metadata: {
    id: 'TelemetryTimeline',
    version: '1.0.0',
    genesis: { introduced: 'reflection' },
    dependencies: ['Utils', 'VFS', 'EventBus?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger, generateId } = Utils;

    const LOG_DIR = '/.logs/timeline';
    const MAX_RECENT = 500;
    const _recent = [];
    const _pendingEntries = [];
    let _flushScheduled = false;
    let _flushPromise = Promise.resolve();

    const scheduleMicrotask = (callback) => {
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(callback);
        return;
      }
      Promise.resolve().then(callback);
    };

    const _appendEntries = async (entries) => {
      const entriesByPath = new Map();
      entries.forEach((entry) => {
        const date = new Date(entry.ts).toISOString().split('T')[0];
        const path = `${LOG_DIR}/${date}.jsonl`;
        if (!entriesByPath.has(path)) entriesByPath.set(path, []);
        entriesByPath.get(path).push(entry);
      });

      for (const [path, pathEntries] of entriesByPath.entries()) {
        let content = '';

        try {
          if (await VFS.exists(path)) {
            content = await VFS.read(path);
          }
        } catch (err) {
          logger.warn('[Telemetry] Failed to read timeline file', { path, error: err.message });
        }

        try {
          const lines = pathEntries.map((entry) => JSON.stringify(entry)).join('\n');
          const prefix = content && !content.endsWith('\n') ? `${content}\n` : content;
          await VFS.write(path, `${prefix}${lines}\n`);
        } catch (err) {
          logger.error('[Telemetry] Failed to write timeline entry', { error: err.message });
        }
      }
    };

    const _flushPending = async () => {
      _flushScheduled = false;
      const batch = _pendingEntries.splice(0);
      if (batch.length === 0) return;
      await _appendEntries(batch);
      if (_pendingEntries.length > 0) {
        _scheduleFlush();
      }
    };

    const _scheduleFlush = () => {
      if (_flushScheduled) return _flushPromise;
      _flushScheduled = true;
      _flushPromise = _flushPromise
        .catch(() => {})
        .then(() => new Promise((resolve) => scheduleMicrotask(resolve)))
        .then(_flushPending);
      _flushPromise.catch((err) => {
        logger.error('[Telemetry] Failed to flush timeline batch', { error: err?.message || err });
      });
      return _flushPromise;
    };

    const _loadRecent = async () => {
      const today = new Date().toISOString().split('T')[0];
      const path = `${LOG_DIR}/${today}.jsonl`;

      try {
        if (await VFS.exists(path)) {
          const content = await VFS.read(path);
          const lines = content.split('\n').filter(Boolean);
          const start = Math.max(0, lines.length - MAX_RECENT);
          for (let i = start; i < lines.length; i++) {
            try {
              _recent.push(JSON.parse(lines[i]));
            } catch {
              // skip malformed line
            }
          }
        }
      } catch (err) {
        logger.warn('[Telemetry] Failed to load recent timeline entries', err.message);
      }
    };

    const record = async (type, payload = {}, options = {}) => {
      const entry = {
        id: generateId('evt'),
        ts: Date.now(),
        type,
        severity: options.severity || 'info',
        tags: options.tags || [],
        payload
      };
      _recent.push(entry);
      if (_recent.length > MAX_RECENT) _recent.shift();

      _pendingEntries.push(entry);
      _scheduleFlush();
      if (EventBus) {
        EventBus.emit('telemetry:event', entry);
      }
      return entry.id;
    };

    const flush = async () => {
      if (_pendingEntries.length > 0) _scheduleFlush();
      do {
        await _flushPromise;
        if (_pendingEntries.length > 0) _scheduleFlush();
      } while (_flushScheduled || _pendingEntries.length > 0);
    };

    const getRecent = (limit = 100) => {
      if (limit <= 0) return [];
      const start = Math.max(0, _recent.length - limit);
      return _recent.slice(start);
    };

    const getEntries = async (startDate, endDate = startDate) => {
      if (!startDate) throw new Error('startDate required');
      await flush();
      let start = new Date(startDate);
      let end = new Date(endDate || startDate);
      const entries = [];

      // Guard against infinite loop if dates are inverted
      if (start > end) {
        logger.warn('[Telemetry] startDate > endDate, swapping');
        [start, end] = [end, start];
      }

      // Use separate loop variable to avoid mutating comparison target
      const current = new Date(start);
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        const path = `${LOG_DIR}/${dateStr}.jsonl`;
        try {
          if (await VFS.exists(path)) {
            const content = await VFS.read(path);
            for (const line of content.split('\n').filter(Boolean)) {
              try { entries.push(JSON.parse(line)); } catch { /* ignore */ }
            }
          }
        } catch (err) {
          logger.warn('[Telemetry] Failed to read timeline entries', { path, error: err.message });
        }
        current.setDate(current.getDate() + 1);
      }

      return entries;
    };

    const _wireEventBus = () => {
      if (!EventBus) return;
      const safeRecord = (type, payload, options) => {
        record(type, payload, options).catch((err) => {
          logger.warn('[Telemetry] Failed to record event', { type, error: err?.message || err });
        });
      };

      EventBus.on('agent:status', (data = {}) => safeRecord('agent:status', data, { tags: ['agent'] }));
      EventBus.on('agent:warning', (data = {}) => safeRecord('agent:warning', data, { severity: 'warn', tags: ['agent'] }));
      EventBus.on('tool:slow', (data = {}) => safeRecord('tool:slow', data, { severity: 'warn', tags: ['tool'] }));
      EventBus.on('tool:timeout', (data = {}) => safeRecord('tool:timeout', data, { severity: 'error', tags: ['tool'] }));
      EventBus.on('tool:error', (data = {}) => safeRecord('tool:error', data, { severity: 'error', tags: ['tool'] }));
      EventBus.on('tool:circuit_skip', (data = {}) => safeRecord('tool:circuit_skip', data, { severity: 'warn', tags: ['tool'] }));
    };

    return {
      init: async () => {
        await _loadRecent();
        _wireEventBus();
        logger.info('[Telemetry] Timeline initialized');
        return true;
      },
      record,
      flush,
      getRecent,
      getEntries
    };
  }
};

export default TelemetryTimeline;
