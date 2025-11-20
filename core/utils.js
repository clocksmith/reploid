/**
 * @fileoverview Core Utilities Module
 * The foundational pure functions and error classes used across the system.
 *
 * Phase 1 Updates:
 * - Consolidated Error classes (replaces utils/error-handler.js).
 * - Added performance metrics to Logger.
 * - Added 'widget' stub for backward compatibility.
 */

const Utils = {
  metadata: {
    id: 'Utils',
    version: '2.0.0',
    dependencies: [],
    type: 'pure'
  },

  factory: () => {
    // --- Internal State ---
    const _logStats = { debug: 0, info: 0, warn: 0, error: 0 };
    const _recentLogs = [];
    const MAX_LOG_HISTORY = 100;

    // --- Error Handling System ---
    class ApplicationError extends Error {
      constructor(message, details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.details = details;
        this.timestamp = Date.now();
      }
    }

    class ApiError extends ApplicationError {
      constructor(message, status, details) {
        super(message, details);
        this.status = status;
      }
    }

    class StateError extends ApplicationError {}
    class ArtifactError extends ApplicationError {}
    class ValidationError extends ApplicationError {}
    class AbortError extends ApplicationError {}
    class ToolError extends ApplicationError {}
    class ConfigError extends ApplicationError {}

    const Errors = {
      ApplicationError,
      ApiError,
      StateError,
      ArtifactError,
      ValidationError,
      AbortError,
      ToolError,
      ConfigError
    };

    // --- Logging System ---
    const logger = {
      _write: (level, message, details) => {
        _logStats[level]++;

        const entry = {
          ts: new Date().toISOString(),
          level: level.toUpperCase(),
          msg: message,
          data: details
        };

        // Console output
        const method = console[level] || console.log;
        const prefix = `[${entry.level}]`;
        details ? method(prefix, message, details) : method(prefix, message);

        // In-memory history
        _recentLogs.push(entry);
        if (_recentLogs.length > MAX_LOG_HISTORY) _recentLogs.shift();
      },

      debug: (msg, data) => logger._write('debug', msg, data),
      info: (msg, data) => logger._write('info', msg, data),
      warn: (msg, data) => logger._write('warn', msg, data),
      error: (msg, data) => logger._write('error', msg, data),

      getStats: () => ({ ..._logStats }),
      getHistory: () => [..._recentLogs],
      clearHistory: () => { _recentLogs.length = 0; }
    };

    // --- Pure Helpers ---

    const generateId = (prefix = 'id') => {
      const random = Math.random().toString(36).substring(2, 10);
      const ts = Date.now().toString(36);
      return `${prefix}_${ts}_${random}`;
    };

    const trunc = (str, len) => {
      if (!str) return '';
      return str.length > len ? str.substring(0, len - 3) + '...' : str;
    };

    const kabobToCamel = (s) => s.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase());

    const escapeHtml = (unsafe) => {
      if (!unsafe) return '';
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    const sanitizeLlmJsonRespPure = (text) => {
      if (!text || typeof text !== 'string') return { json: "{}", method: "empty" };

      try {
        JSON.parse(text);
        return { json: text, method: "direct" };
      } catch (e) { /* continue */ }

      const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlock) {
        try {
          JSON.parse(codeBlock[1]);
          return { json: codeBlock[1], method: "block" };
        } catch (e) { /* continue */ }
      }

      const firstOpen = text.indexOf('{');
      const lastClose = text.lastIndexOf('}');
      if (firstOpen > -1 && lastClose > firstOpen) {
        const candidate = text.substring(firstOpen, lastClose + 1);
        try {
          JSON.parse(candidate);
          return { json: candidate, method: "heuristic" };
        } catch (e) { /* continue */ }
      }

      return { json: "{}", method: "failed" };
    };

    /**
     * Tracker to prevent EventBus memory leaks
     */
    const createSubscriptionTracker = () => {
      const subs = new Map();
      return {
        track: (id, unsubFn) => {
          if (!subs.has(id)) subs.set(id, []);
          subs.get(id).push(unsubFn);
        },
        unsubscribeAll: (id) => {
          const list = subs.get(id);
          if (list) {
            list.forEach(fn => fn());
            subs.delete(id);
          }
        }
      };
    };

    // --- Backward Compatibility Stub ---
    // Prevents crashes if legacy code imports Utils.widget
    const widget = {
      element: 'div',
      displayName: 'Legacy Utils (Deprecated)',
      render: () => console.warn('Utils.widget is deprecated. Update UI to use dedicated widgets.')
    };

    return {
      Errors,
      logger,
      generateId,
      trunc,
      kabobToCamel,
      escapeHtml,
      sanitizeLlmJsonRespPure,
      createSubscriptionTracker,
      widget // Compatibility stub
    };
  }
};

export default Utils;
