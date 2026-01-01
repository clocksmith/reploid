/**
 * @fileoverview Verification Manager v3.0
 * Pre-flight safety checks via Web Worker with event emissions.
 *
 * @version 3.0.0
 * Features:
 * - Delegates to verification-worker.js for analysis
 * - Emits events for violations (verification:pattern_detected, verification:complexity_warning)
 * - Supports quick verification mode for single files
 * - Returns detailed results with warnings array
 */

const VerificationManager = {
  metadata: {
    id: 'VerificationManager',
    version: '3.0.0',
    genesis: { introduced: 'reflection' },
    dependencies: ['Utils', 'VFS', 'EventBus'],
    optionalDependencies: ['EventBus'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { VFS } = deps;
    const EventBus = deps.EventBus || null;

    const WORKER_PATH = '/core/verification-worker.js';
    const DEFAULT_TIMEOUT = 10000; // 10 seconds

    /**
     * Emit an event if EventBus is available
     */
    const emitEvent = (eventType, data) => {
      if (EventBus) {
        EventBus.emit(eventType, data);
      }
    };

    /**
     * Create a snapshot of all JS/JSON files in VFS
     */
    const createSnapshot = async (basePath = '/') => {
      const files = await VFS.list(basePath);
      const snapshot = {};

      for (const path of files) {
        if (path.endsWith('.js') || path.endsWith('.json')) {
          try {
            snapshot[path] = await VFS.read(path);
          } catch (e) {
            logger.warn(`[Verifier] Could not read ${path}: ${e.message}`);
          }
        }
      }

      return snapshot;
    };

    /**
     * Normalize changes to standard format
     */
    const normalizeChanges = (changes) => {
      if (Array.isArray(changes)) return changes;
      if (changes && typeof changes === 'object') {
        return Object.entries(changes).map(([path, content]) => ({
          operation: content === null ? 'DELETE' : 'WRITE',
          file_path: path,
          new_content: content
        }));
      }
      return [];
    };

    /**
     * Process verification result and emit events
     */
    const processResult = (result) => {
      // Emit events from worker results
      if (result.events && Array.isArray(result.events)) {
        for (const event of result.events) {
          emitEvent(event.type, event);
        }
      }

      // Log summary
      if (result.passed) {
        logger.info(`[Verifier] Passed with ${result.warnings?.length || 0} warnings`);
      } else {
        logger.warn(`[Verifier] Failed: ${result.errors?.length || 0} errors, ${result.warnings?.length || 0} warnings`);
      }

      return result;
    };

    /**
     * Verify a proposal with changes
     * @param {Array|Object} changes - Changes to verify
     * @param {Object} options - Verification options
     * @param {number} options.timeout - Timeout in ms (default 10000)
     * @param {boolean} options.quickMode - Skip full snapshot, only verify changes
     * @returns {Promise<Object>} Verification result
     */
    const verifyProposal = async (changes, options = {}) => {
      const { timeout = DEFAULT_TIMEOUT, quickMode = false } = options;

      logger.info('[Verifier] Starting verification...');

      let snapshot;

      if (quickMode) {
        // Quick mode: only include the changed files
        snapshot = {};
        const normalized = normalizeChanges(changes);
        for (const c of normalized) {
          if (c.operation !== 'DELETE' && c.new_content) {
            snapshot[c.file_path] = c.new_content;
          }
        }
      } else {
        // Full mode: snapshot everything and overlay changes
        logger.info('[Verifier] Creating snapshot...');
        snapshot = await createSnapshot();

        const normalized = normalizeChanges(changes);
        for (const c of normalized) {
          if (c.operation === 'DELETE') {
            delete snapshot[c.file_path];
          } else {
            snapshot[c.file_path] = c.new_content;
          }
        }
      }

      const fileCount = Object.keys(snapshot).length;
      logger.info(`[Verifier] Analyzing ${fileCount} files...`);

      return new Promise((resolve) => {
        const worker = new Worker(WORKER_PATH);

        const timeoutId = setTimeout(() => {
          worker.terminate();
          const result = {
            passed: false,
            reason: 'Timeout',
            errors: ['Verification timed out'],
            warnings: [],
            events: [{ type: 'verification:timeout', timestamp: Date.now() }]
          };
          resolve(processResult(result));
        }, timeout);

        worker.onmessage = (e) => {
          clearTimeout(timeoutId);
          worker.terminate();
          resolve(processResult(e.data));
        };

        worker.onerror = (e) => {
          clearTimeout(timeoutId);
          worker.terminate();
          logger.error('[Verifier] Worker crash', e);
          const result = {
            passed: false,
            reason: 'Worker Error',
            errors: [`Worker crashed: ${e.message}`],
            warnings: [],
            events: [{ type: 'verification:worker_crash', timestamp: Date.now(), error: e.message }]
          };
          resolve(processResult(result));
        };

        worker.postMessage({ type: 'VERIFY', snapshot, options });
      });
    };

    /**
     * Quick verification of a single file
     * @param {string} path - File path
     * @param {string} content - File content
     * @returns {Promise<Object>} Verification result
     */
    const verifyFile = async (path, content) => {
      return verifyProposal(
        [{ operation: 'WRITE', file_path: path, new_content: content }],
        { quickMode: true }
      );
    };

    /**
     * Verify multiple files at once
     * @param {Object} files - Map of path to content
     * @returns {Promise<Object>} Verification result
     */
    const verifyFiles = async (files) => {
      const changes = Object.entries(files).map(([path, content]) => ({
        operation: 'WRITE',
        file_path: path,
        new_content: content
      }));
      return verifyProposal(changes, { quickMode: true });
    };

    /**
     * Get capability rules for a path (mirrors worker logic)
     */
    const getCapabilitiesForPath = (path) => {
      const rules = {
        '/tools/': { canWrite: ['/tools/', '/apps/', '/.logs/'], canNetwork: false, canEval: false },
        '/apps/': { canWrite: ['/apps/', '/.logs/'], canNetwork: false, canEval: false },
        '/core/': { canWrite: ['*'], canNetwork: true, canEval: true },
        '/infrastructure/': { canWrite: ['*'], canNetwork: true, canEval: true },
        '/.logs/': { canWrite: ['/.logs/'], canNetwork: false, canEval: false }
      };

      for (const [prefix, caps] of Object.entries(rules)) {
        if (path.startsWith(prefix)) return caps;
      }

      return rules['/tools/']; // Default to restricted
    };

    return {
      verifyProposal,
      verifyFile,
      verifyFiles,
      getCapabilitiesForPath
    };
  }
};

export default VerificationManager;
