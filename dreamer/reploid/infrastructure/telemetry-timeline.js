/**
 * @fileoverview Telemetry Timeline
 * Unified append-only event log for audit, performance, and agent state changes.
 */

const TelemetryTimeline = {
  metadata: {
    id: 'TelemetryTimeline',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
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

    const _appendEntry = async (entry) => {
      const date = new Date(entry.ts).toISOString().split('T')[0];
      const path = `${LOG_DIR}/${date}.jsonl`;
      let content = '';

      try {
        if (await VFS.exists(path)) {
          content = await VFS.read(path);
        }
      } catch (err) {
        logger.warn('[Telemetry] Failed to read timeline file', { path, error: err.message });
      }

      try {
        await VFS.write(path, content + JSON.stringify(entry) + '\n');
      } catch (err) {
        logger.error('[Telemetry] Failed to write timeline entry', { error: err.message });
      }
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

      await _appendEntry(entry);
      if (EventBus) {
        EventBus.emit('telemetry:event', entry);
      }
      return entry.id;
    };

    const getRecent = (limit = 100) => {
      if (limit <= 0) return [];
      const start = Math.max(0, _recent.length - limit);
      return _recent.slice(start);
    };

    const getEntries = async (startDate, endDate = startDate) => {
      if (!startDate) throw new Error('startDate required');
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
      getRecent,
      getEntries
    };
  }
};

export default TelemetryTimeline;
