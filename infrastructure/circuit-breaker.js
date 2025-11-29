/**
 * @fileoverview Circuit Breaker - Failure tracking utility
 * Prevents repeated calls to failing services/tools.
 * Implements three states: CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery).
 */

const CircuitBreaker = {
  metadata: {
    id: 'CircuitBreaker',
    version: '2.0.0',
    dependencies: ['Utils', 'EventBus?'],
    async: false,
    type: 'utility'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    /** Circuit states */
    const State = {
      CLOSED: 'closed',     // Normal operation
      OPEN: 'open',         // Failing, reject calls
      HALF_OPEN: 'half_open' // Testing recovery
    };

    /**
     * Create a circuit breaker instance
     * @param {Object} options
     * @param {number} options.threshold - Failures before circuit opens (default: 3)
     * @param {number} options.resetMs - Cooldown before testing recovery (default: 60000)
     * @param {number} options.successThreshold - Successes needed to close (default: 2)
     * @param {string} options.name - Name for logging (default: 'CircuitBreaker')
     * @param {boolean} options.emitEvents - Emit EventBus events (default: true)
     */
    const create = (options = {}) => {
      const {
        threshold = 3,
        resetMs = 60000,
        successThreshold = 2,
        name = 'CircuitBreaker',
        emitEvents = true
      } = options;

      const circuits = new Map();

      const emit = (event, data) => {
        if (emitEvents && EventBus) {
          EventBus.emit(event, { breaker: name, ...data });
        }
      };

      /**
       * Check if circuit is open for a key
       * @param {string} key - Identifier (tool name, service name, etc.)
       * @returns {boolean} True if circuit is open (should skip execution)
       */
      const isOpen = (key) => {
        const record = circuits.get(key);
        if (!record) return false;

        const now = Date.now();

        // OPEN state: check if cooldown has passed
        if (record.state === State.OPEN) {
          const elapsed = now - record.tripTime;
          if (elapsed >= resetMs) {
            // Transition to HALF_OPEN (test recovery)
            record.state = State.HALF_OPEN;
            record.testSuccesses = 0;
            logger.info(`[${name}] Circuit half-open for: ${key} (testing recovery)`);
            emit('circuit:half_open', { key });
            return false; // Allow test call
          }
          return true; // Still in cooldown
        }

        // HALF_OPEN state: allow calls (testing recovery)
        if (record.state === State.HALF_OPEN) {
          return false;
        }

        // CLOSED state or counting failures
        if (record.failures >= threshold) {
          // Should have transitioned to OPEN, but just in case
          record.state = State.OPEN;
          record.tripTime = now;
          return true;
        }

        return false;
      };

      /**
       * Record a failure for a key
       * @param {string} key - Identifier
       * @param {Error} error - The error that occurred
       */
      const recordFailure = (key, error) => {
        const now = Date.now();
        let record = circuits.get(key);

        if (!record) {
          record = {
            state: State.CLOSED,
            failures: 0,
            lastError: null,
            tripTime: 0,
            testSuccesses: 0
          };
        }

        record.lastError = error;

        if (record.state === State.HALF_OPEN) {
          // Recovery test failed - back to OPEN
          record.state = State.OPEN;
          record.tripTime = now;
          record.testSuccesses = 0;
          logger.warn(`[${name}] Recovery failed for: ${key}, circuit re-opened`);
          emit('circuit:reopen', { key, error: error?.message });
        } else {
          // Normal failure counting
          record.failures++;

          if (record.failures >= threshold && record.state !== State.OPEN) {
            record.state = State.OPEN;
            record.tripTime = now;
            logger.warn(`[${name}] Circuit TRIPPED for: ${key} after ${record.failures} failures`);
            emit('circuit:open', { key, failures: record.failures, error: error?.message });
          }
        }

        circuits.set(key, record);
      };

      /**
       * Record a success for a key
       * @param {string} key - Identifier
       */
      const recordSuccess = (key) => {
        const record = circuits.get(key);
        if (!record) return;

        if (record.state === State.HALF_OPEN) {
          // Count successful test calls
          record.testSuccesses++;

          if (record.testSuccesses >= successThreshold) {
            // Fully recovered - close circuit
            circuits.delete(key);
            logger.info(`[${name}] Circuit CLOSED for: ${key} (recovered after ${successThreshold} successes)`);
            emit('circuit:closed', { key });
          }
        } else {
          // Normal success - clear failure record
          circuits.delete(key);
        }
      };

      /**
       * Get current state for a key
       * @param {string} key - Identifier
       * @returns {Object|null} Circuit state or null if no record
       */
      const getState = (key) => {
        const record = circuits.get(key);
        if (!record) return { state: State.CLOSED, failures: 0, isOpen: false };

        const now = Date.now();
        const isCurrentlyOpen = record.state === State.OPEN &&
          (now - record.tripTime) < resetMs;

        return {
          state: record.state,
          failures: record.failures,
          lastError: record.lastError?.message,
          isOpen: isCurrentlyOpen,
          tripTime: record.tripTime,
          testSuccesses: record.testSuccesses || 0
        };
      };

      /**
       * Reset all circuits
       */
      const reset = () => {
        circuits.clear();
        logger.info(`[${name}] All circuits reset`);
      };

      /**
       * Get all tracked keys
       * @returns {string[]} List of keys with records
       */
      const getTrackedKeys = () => [...circuits.keys()];

      return {
        isOpen,
        recordFailure,
        recordSuccess,
        getState,
        reset,
        getTrackedKeys,
        State,
        get size() { return circuits.size; }
      };
    };

    return { create, State };
  }
};

export default CircuitBreaker;
