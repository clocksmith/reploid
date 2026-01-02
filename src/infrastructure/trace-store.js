/**
 * @fileoverview Trace Store
 * Persistent execution traces for GEPA datasets.
 */

const TraceStore = {
  metadata: {
    id: 'TraceStore',
    version: '1.0.0',
    genesis: { introduced: 'substrate' },
    dependencies: ['Utils', 'VFS', 'EventBus?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger, generateId, trunc } = Utils;

    const TRACE_DIR = '/.memory/traces';
    const INDEX_PATH = `${TRACE_DIR}/index.jsonl`;
    const MAX_STRING = 2000;
    const MAX_ARRAY_ITEMS = 50;
    const MAX_OBJECT_KEYS = 50;
    const MAX_DEPTH = 4;

    const _sessions = new Map();

    const ensureTraceDir = async () => {
      if (!VFS) return;
      if (!await VFS.exists(TRACE_DIR)) {
        await VFS.mkdir(TRACE_DIR);
      }
    };

    const sanitizeValue = (value, depth = 0) => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'string') return trunc(value, MAX_STRING);
      if (typeof value === 'number' || typeof value === 'boolean') return value;
      if (Array.isArray(value)) {
        if (depth >= MAX_DEPTH) return '[Array]';
        return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
      }
      if (typeof value === 'object') {
        if (depth >= MAX_DEPTH) return '[Object]';
        const keys = Object.keys(value);
        const limited = keys.slice(0, MAX_OBJECT_KEYS);
        const out = {};
        for (const key of limited) {
          out[key] = sanitizeValue(value[key], depth + 1);
        }
        if (keys.length > limited.length) {
          out._truncatedKeys = keys.length - limited.length;
        }
        return out;
      }
      return String(value);
    };

    const appendJsonl = async (path, entry) => {
      if (!VFS) return;
      let content = '';
      try {
        if (await VFS.exists(path)) {
          content = await VFS.read(path);
        }
        content += JSON.stringify(entry) + '\n';
        await VFS.write(path, content);
      } catch (err) {
        logger.warn('[TraceStore] Failed to append trace', { path, error: err.message });
      }
    };

    const startSession = async (meta = {}) => {
      await ensureTraceDir();
      const sessionId = generateId('trace');
      const session = {
        sessionId,
        startTime: Date.now(),
        meta: sanitizeValue(meta)
      };
      _sessions.set(sessionId, session);
      await appendJsonl(INDEX_PATH, { type: 'session_start', ...session });
      if (EventBus) {
        EventBus.emit('trace:session_started', session);
      }
      return sessionId;
    };

    const record = async (sessionId, type, payload = {}, options = {}) => {
      if (!sessionId || !_sessions.has(sessionId)) {
        logger.warn('[TraceStore] Unknown sessionId, skipping trace');
        return false;
      }
      const entry = {
        id: generateId('evt'),
        sessionId,
        ts: Date.now(),
        type,
        tags: options.tags || [],
        payload: sanitizeValue(payload)
      };
      const path = `${TRACE_DIR}/${sessionId}.jsonl`;
      await appendJsonl(path, entry);
      if (EventBus) {
        EventBus.emit('trace:event', entry);
      }
      return true;
    };

    const endSession = async (sessionId, summary = {}) => {
      if (!sessionId || !_sessions.has(sessionId)) return false;
      const session = _sessions.get(sessionId);
      const entry = {
        sessionId,
        endTime: Date.now(),
        durationMs: Date.now() - session.startTime,
        summary: sanitizeValue(summary)
      };
      await appendJsonl(INDEX_PATH, { type: 'session_end', ...entry });
      _sessions.delete(sessionId);
      if (EventBus) {
        EventBus.emit('trace:session_ended', entry);
      }
      return true;
    };

    const listSessions = async (limit = 50) => {
      if (!VFS) return [];
      try {
        if (!await VFS.exists(INDEX_PATH)) return [];
        const content = await VFS.read(INDEX_PATH);
        const lines = content.split('\n').filter(Boolean);
        const recent = lines.slice(-limit);
        return recent.map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
      } catch (err) {
        logger.warn('[TraceStore] Failed to read index', err.message);
        return [];
      }
    };

    const getSessionTraces = async (sessionId) => {
      if (!VFS || !sessionId) return [];
      const path = `${TRACE_DIR}/${sessionId}.jsonl`;
      try {
        if (!await VFS.exists(path)) return [];
        const content = await VFS.read(path);
        return content.split('\n').filter(Boolean).map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
      } catch (err) {
        logger.warn('[TraceStore] Failed to read session traces', err.message);
        return [];
      }
    };

    const getSessionSummary = async (sessionId) => {
      if (!sessionId) return null;
      const traces = await getSessionTraces(sessionId);
      if (!traces.length) return null;

      let toolCount = 0;
      let toolErrors = 0;
      let llmCalls = 0;
      let lastTs = 0;
      let firstTs = traces[0]?.ts || 0;

      for (const entry of traces) {
        if (entry?.type === 'tool:execute') {
          toolCount++;
          if (entry.payload?.success === false) toolErrors++;
        }
        if (entry?.type === 'llm:request') llmCalls++;
        if (entry?.ts && entry.ts > lastTs) lastTs = entry.ts;
        if (entry?.ts && entry.ts < firstTs) firstTs = entry.ts;
      }

      return {
        sessionId,
        entryCount: traces.length,
        toolCount,
        toolErrors,
        llmCalls,
        firstTs,
        lastTs,
        durationMs: lastTs && firstTs ? (lastTs - firstTs) : 0
      };
    };

    return {
      init: async () => {
        await ensureTraceDir();
        logger.info('[TraceStore] Initialized');
        return true;
      },
      startSession,
      record,
      endSession,
      listSessions,
      getSessionTraces,
      getSessionSummary
    };
  }
};

export default TraceStore;
