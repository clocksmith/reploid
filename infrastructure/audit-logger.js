/**
 * @fileoverview Audit Logger
 * Security tracking. Writes to /.logs/audit/YYYY-MM-DD.jsonl
 */

const AuditLogger = {
  metadata: {
    id: 'AuditLogger',
    version: '2.0.0',
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

      try {
        let content = '';
        if (await VFS.exists(path)) {
          content = await VFS.read(path);
        }
        content += JSON.stringify(entry) + '\n';
        await VFS.write(path, content);
      } catch (e) {
        logger.error('[AuditLogger] Write failed', e);
      }
    };

    return {
      init,
      logEvent,
      // Convenience aliases
      logAgentAction: (action, tool, args) => logEvent('AGENT_ACTION', { action, tool, args }),
      logSecurity: (type, details) => logEvent('SECURITY', { type, ...details }, 'ERROR')
    };
  }
};

export default AuditLogger;
