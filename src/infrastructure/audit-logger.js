/**
 * @fileoverview Audit Logger
 * Security tracking. Writes to /.logs/audit/YYYY-MM-DD.jsonl
 * Supports structured export (JSON/CSV) for compliance and debugging.
 * Emits events: audit:tool_exec, audit:core_write, audit:warning
 */

const AuditLogger = {
  metadata: {
    id: 'AuditLogger',
    version: '1.1.0',
    genesis: { introduced: 'substrate' },
    dependencies: ['Utils', 'VFS', 'EventBus?', 'TelemetryTimeline?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus, TelemetryTimeline } = deps;
    const { logger, generateId } = Utils;
    const LOG_DIR = '/.logs/audit';

    // Sensitive keys that should be redacted in logs
    const SENSITIVE_KEYS = [
      'apiKey', 'api_key', 'apikey',
      'token', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
      'password', 'passwd', 'secret', 'credential', 'credentials',
      'authorization', 'auth', 'bearer',
      'private_key', 'privateKey', 'key',
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY'
    ];

    // Max length for values before truncation
    const MAX_VALUE_LENGTH = 500;

    /**
     * Sanitize arguments for logging - redact secrets, truncate large values
     * @param {any} value - Value to sanitize
     * @param {string} [key] - Key name (for sensitive detection)
     * @returns {any} Sanitized value
     */
    const sanitizeValue = (value, key = '') => {
      // Check if key is sensitive
      const isSensitiveKey = SENSITIVE_KEYS.some(sk =>
        key.toLowerCase().includes(sk.toLowerCase())
      );

      if (isSensitiveKey && value) {
        return '[REDACTED]';
      }

      if (typeof value === 'string') {
        // Check for patterns that look like secrets
        if (value.match(/^(sk-|pk-|api-|key-|token-|bearer\s)/i)) {
          return '[REDACTED]';
        }
        // Truncate long strings
        if (value.length > MAX_VALUE_LENGTH) {
          return value.substring(0, MAX_VALUE_LENGTH) + `... [truncated ${value.length - MAX_VALUE_LENGTH} chars]`;
        }
        return value;
      }

      if (Array.isArray(value)) {
        return value.map((v, i) => sanitizeValue(v, String(i)));
      }

      if (value && typeof value === 'object') {
        const sanitized = {};
        for (const [k, v] of Object.entries(value)) {
          sanitized[k] = sanitizeValue(v, k);
        }
        return sanitized;
      }

      return value;
    };

    /**
     * Sanitize tool arguments for audit logging
     * @param {Object} args - Tool arguments
     * @returns {Object} Sanitized arguments
     */
    const sanitizeArgs = (args) => {
      if (!args || typeof args !== 'object') return args;
      return sanitizeValue(args);
    };

    const init = async () => {
      // Directory check implied by VFS structure
      return true;
    };

    const logEvent = async (type, data, severity = 'INFO') => {
      const entry = {
        id: generateId('log'),
        ts: new Date().toISOString(),
        type,
        severity,
        data
      };

      // Echo security warnings to console
      if (severity === 'ERROR' || severity === 'WARN') {
        logger.warn(`[Audit] ${type}`, data);
      }

      // Emit EventBus events for real-time monitoring
      if (EventBus) {
        // Map event types to specific audit events
        if (type === 'TOOL_EXEC') {
          EventBus.emit('audit:tool_exec', { ...entry.data, severity });
        } else if (type === 'CORE_WRITE' || type === 'CORE_WRITE_BLOCKED') {
          EventBus.emit('audit:core_write', { ...entry.data, severity });
        }
        // Emit generic warning event for WARN/ERROR severity
        if (severity === 'WARN' || severity === 'ERROR') {
          EventBus.emit('audit:warning', { type, data: entry.data, severity });
        }
      }

      const date = new Date().toISOString().split('T')[0];
      const path = `${LOG_DIR}/${date}.jsonl`;

      // Retry once on failure to ensure audit trail integrity
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          let content = '';
          if (await VFS.exists(path)) {
            content = await VFS.read(path);
          }
          content += JSON.stringify(entry) + '\n';
          await VFS.write(path, content);
          if (TelemetryTimeline) {
            await TelemetryTimeline.record(`audit:${type}`, entry.data, { severity, tags: ['audit'] });
          }
          return; // Success
        } catch (e) {
          if (attempt === 0) {
            logger.warn('[AuditLogger] Write failed, retrying...', e.message);
            await new Promise(r => setTimeout(r, 50));
          } else {
            logger.error('[AuditLogger] Write failed after retry - audit event lost', {
              error: e.message,
              entry: { type, severity, id: entry.id }
            });
          }
        }
      }
    };

    /**
     * Get all log entries for a date range
     * @param {string} [startDate] - YYYY-MM-DD (default: today)
     * @param {string} [endDate] - YYYY-MM-DD (default: startDate)
     * @returns {Promise<Array>} Array of log entries
     */
    const getEntries = async (startDate = null, endDate = null) => {
      const today = new Date().toISOString().split('T')[0];
      const start = startDate || today;
      const end = endDate || start;

      const entries = [];
      const current = new Date(start);
      const endDt = new Date(end);

      while (current <= endDt) {
        const dateStr = current.toISOString().split('T')[0];
        const path = `${LOG_DIR}/${dateStr}.jsonl`;

        try {
          if (await VFS.exists(path)) {
            const content = await VFS.read(path);
            const lines = content.split('\n').filter(l => l.trim());
            for (const line of lines) {
              try {
                entries.push(JSON.parse(line));
              } catch (e) {
                // Skip malformed lines
              }
            }
          }
        } catch (e) {
          logger.warn(`[AuditLogger] Failed to read ${path}:`, e.message);
        }

        current.setDate(current.getDate() + 1);
      }

      return entries;
    };

    /**
     * Export audit log as JSON
     * @param {string} [startDate] - YYYY-MM-DD
     * @param {string} [endDate] - YYYY-MM-DD
     * @returns {Promise<string>} JSON string
     */
    const exportJSON = async (startDate = null, endDate = null) => {
      const entries = await getEntries(startDate, endDate);
      return JSON.stringify({
        exported: new Date().toISOString(),
        startDate: startDate || new Date().toISOString().split('T')[0],
        endDate: endDate || startDate || new Date().toISOString().split('T')[0],
        count: entries.length,
        entries
      }, null, 2);
    };

    /**
     * Export audit log as CSV
     * @param {string} [startDate] - YYYY-MM-DD
     * @param {string} [endDate] - YYYY-MM-DD
     * @returns {Promise<string>} CSV string
     */
    const exportCSV = async (startDate = null, endDate = null) => {
      const entries = await getEntries(startDate, endDate);

      // CSV header
      const headers = ['id', 'timestamp', 'type', 'severity', 'data'];
      const rows = [headers.join(',')];

      for (const entry of entries) {
        const row = [
          entry.id || '',
          entry.ts || '',
          entry.type || '',
          entry.severity || 'INFO',
          JSON.stringify(entry.data || {}).replace(/"/g, '""')
        ];
        rows.push(row.map(v => `"${v}"`).join(','));
      }

      return rows.join('\n');
    };

    /**
     * Download audit log (browser only)
     * @param {string} format - 'json' or 'csv'
     * @param {string} [startDate] - YYYY-MM-DD
     * @param {string} [endDate] - YYYY-MM-DD
     */
    const download = async (format = 'json', startDate = null, endDate = null) => {
      const content = format === 'csv'
        ? await exportCSV(startDate, endDate)
        : await exportJSON(startDate, endDate);

      const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
      const ext = format === 'csv' ? 'csv' : 'json';
      const filename = `audit-${startDate || 'today'}-${endDate || startDate || 'today'}.${ext}`;

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logger.info(`[AuditLogger] Downloaded ${filename}`);
    };

    /**
     * Get summary statistics for a date range
     * @param {string} [startDate] - YYYY-MM-DD
     * @param {string} [endDate] - YYYY-MM-DD
     * @returns {Promise<Object>} Statistics
     */
    const getStats = async (startDate = null, endDate = null) => {
      const entries = await getEntries(startDate, endDate);

      const stats = {
        total: entries.length,
        byType: {},
        bySeverity: { INFO: 0, WARN: 0, ERROR: 0 },
        timeRange: {
          start: entries[0]?.ts || null,
          end: entries[entries.length - 1]?.ts || null
        }
      };

      for (const entry of entries) {
        stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
        stats.bySeverity[entry.severity || 'INFO']++;
      }

      return stats;
    };

    // L3 substrate paths that require WARN severity
    const SUBSTRATE_PREFIXES = ['/core/', '/infrastructure/'];

    /**
     * Check if path is a core/infrastructure (L3 substrate) path
     * @param {string} path - File path
     * @returns {boolean}
     */
    const isSubstratePath = (path) => {
      if (!path) return false;
      return SUBSTRATE_PREFIXES.some(prefix => path.startsWith(prefix));
    };

    /**
     * Log tool execution with full context
     * @param {Object} params - Execution parameters
     * @param {string} params.tool - Tool name
     * @param {Object} params.args - Tool arguments (will be sanitized)
     * @param {number} params.durationMs - Execution duration in ms
     * @param {boolean} params.success - Whether execution succeeded
     * @param {string} [params.error] - Error message if failed
     * @param {string} [params.workerId] - Worker ID if executed by worker
     */
    const logToolExec = async ({ tool, args, durationMs, success, error, workerId }) => {
      const sanitizedArgs = sanitizeArgs(args);
      const data = {
        tool,
        args: sanitizedArgs,
        durationMs,
        success,
        ...(error && { error }),
        ...(workerId && { workerId })
      };
      const severity = success ? 'INFO' : 'ERROR';
      await logEvent('TOOL_EXEC', data, severity);
    };

    /**
     * Log a core file write operation with WARN severity
     * Emits audit:core_write event for L3 substrate changes
     * @param {Object} params - Write parameters
     * @param {string} params.path - File path
     * @param {string} params.operation - Operation type (WriteFile, Edit, CreateTool)
     * @param {boolean} params.existed - Whether file existed before
     * @param {number} [params.bytesWritten] - Bytes written
     * @param {boolean} [params.arenaVerified] - Whether arena verification was performed
     */
    const logCoreWrite = async ({ path, operation, existed, bytesWritten, arenaVerified }) => {
      const data = {
        path,
        operation,
        existed,
        isSubstrate: true,
        ...(bytesWritten !== undefined && { bytesWritten }),
        ...(arenaVerified !== undefined && { arenaVerified })
      };
      await logEvent('CORE_WRITE', data, 'WARN');
    };

    return {
      init,
      logEvent,
      getEntries,
      exportJSON,
      exportCSV,
      download,
      getStats,
      // Sanitization utilities
      sanitizeArgs,
      sanitizeValue,
      isSubstratePath,
      // Tool execution logging
      logToolExec,
      logCoreWrite,
      // Convenience aliases
      logAgentAction: (action, tool, args) => logEvent('AGENT_ACTION', { action, tool, args: sanitizeArgs(args) }),
      logSecurity: (type, details) => logEvent('SECURITY', { type, ...sanitizeValue(details) }, 'ERROR')
    };
  }
};

export default AuditLogger;
