/**
 * @fileoverview Error Store
 * Persists errors to VFS for display in Status tab.
 * Replaces in-memory Toast error handling.
 */

const ErrorStore = {
  metadata: {
    id: 'ErrorStore',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'VFS', 'EventBus?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger, generateId } = Utils;

    const ERRORS_PATH = '/.system/errors.json';
    const MAX_ERRORS = 100;
    let _errors = [];
    let _loaded = false;

    /**
     * Load errors from VFS
     */
    const _load = async () => {
      if (_loaded) return;
      try {
        if (await VFS.exists(ERRORS_PATH)) {
          const content = await VFS.read(ERRORS_PATH);
          _errors = JSON.parse(content);
          if (!Array.isArray(_errors)) _errors = [];
        }
      } catch (err) {
        logger.warn('[ErrorStore] Failed to load errors', err.message);
        _errors = [];
      }
      _loaded = true;
    };

    /**
     * Save errors to VFS
     */
    const _save = async () => {
      try {
        await VFS.write(ERRORS_PATH, JSON.stringify(_errors, null, 2));
      } catch (err) {
        logger.error('[ErrorStore] Failed to save errors', err.message);
      }
    };

    /**
     * Add an error
     * @param {string} type - Error type (tool:error, agent:error, etc.)
     * @param {string} message - Error message
     * @param {Object} [details] - Additional details
     */
    const addError = async (type, message, details = {}) => {
      await _load();

      const error = {
        id: generateId('err'),
        ts: Date.now(),
        type,
        message,
        details,
        severity: details.severity || 'error'
      };

      _errors.unshift(error);

      // Prune oldest if over limit
      if (_errors.length > MAX_ERRORS) {
        _errors = _errors.slice(0, MAX_ERRORS);
      }

      await _save();

      if (EventBus) {
        EventBus.emit('error:added', error);
      }

      logger.debug(`[ErrorStore] Added error: ${type} - ${message}`);
      return error;
    };

    /**
     * Add a warning (lower severity)
     */
    const addWarning = async (type, message, details = {}) => {
      return addError(type, message, { ...details, severity: 'warning' });
    };

    /**
     * Get all errors
     */
    const getErrors = async () => {
      await _load();
      return [..._errors];
    };

    /**
     * Clear all errors
     */
    const clearErrors = async () => {
      _errors = [];
      await _save();
      if (EventBus) {
        EventBus.emit('error:cleared');
      }
      logger.info('[ErrorStore] Errors cleared');
    };

    /**
     * Get error count
     */
    const getCount = async () => {
      await _load();
      return _errors.length;
    };

    /**
     * Wire up EventBus subscriptions
     */
    const _wireEventBus = () => {
      if (!EventBus) return;

      // Listen for tool errors
      EventBus.on('tool:error', ({ tool, error, context }) => {
        addError('tool:error', `${tool}: ${error}`, { tool, context });
      });

      // Listen for persistence errors
      EventBus.on('error:persistence', ({ message, details }) => {
        addError('persistence', message, { details });
      });

      // Listen for circuit breaker events
      EventBus.on('tool:circuit_open', ({ tool, reason }) => {
        addWarning('circuit:open', `Circuit open for ${tool}: ${reason}`, { tool });
      });

      // Listen for agent errors
      EventBus.on('agent:error', ({ message, error }) => {
        addError('agent:error', message, { error: error?.message || error });
      });

      logger.info('[ErrorStore] EventBus wired');
    };

    // Wire up on init
    _wireEventBus();

    return {
      addError,
      addWarning,
      getErrors,
      clearErrors,
      getCount
    };
  }
};

export default ErrorStore;
