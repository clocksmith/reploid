/**
 * @fileoverview Audit Logger
 * Security tracking. Writes to /.logs/audit/YYYY-MM-DD.jsonl
 * Supports structured export (JSON/CSV) for compliance and debugging.
 */

const AuditLogger = {
  metadata: {
    id: 'AuditLogger',
    version: '2.1.0',
    dependencies: ['Utils', 'VFS'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, VFS } = deps;
    const { logger, generateId } = Utils;
    const LOG_DIR = '/.logs/audit';

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

    return {
      init,
      logEvent,
      getEntries,
      exportJSON,
      exportCSV,
      download,
      getStats,
      // Convenience aliases
      logAgentAction: (action, tool, args) => logEvent('AGENT_ACTION', { action, tool, args }),
      logSecurity: (type, details) => logEvent('SECURITY', { type, ...details }, 'ERROR')
    };
  }
};

export default AuditLogger;
