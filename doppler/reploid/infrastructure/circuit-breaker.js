/**
 * @fileoverview Circuit Breaker - Failure tracking utility
 * Prevents repeated calls to failing services/tools.
 * Implements three states: CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery).
 *
 * Features:
 * - Half-open state testing with configurable probe count
 * - Gradual recovery with exponential backoff
 * - Configurable success threshold for full recovery
 * - Event emission for state transitions
 */

const CircuitBreaker = {
  metadata: {
    id: 'CircuitBreaker',
    version: '2.0.0',
    genesis: { introduced: 'tabula' },
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

    /** Default configuration */
    const DEFAULTS = {
      threshold: 3,           // Failures before circuit opens
      resetMs: 60000,         // Initial cooldown before testing recovery (60s)
      successThreshold: 2,    // Successes needed in half-open to close
      halfOpenMaxConcurrent: 1, // Max concurrent requests in half-open state
      useExponentialBackoff: true, // Use exponential backoff on repeated failures
      maxResetMs: 300000,     // Maximum backoff time (5 minutes)
      backoffMultiplier: 2    // Backoff multiplier
    };

    /**
     * Create a circuit breaker instance
     * @param {Object} options
     * @param {number} options.threshold - Failures before circuit opens (default: 3)
     * @param {number} options.resetMs - Initial cooldown before testing recovery (default: 60000)
     * @param {number} options.successThreshold - Successes needed to close (default: 2)
     * @param {string} options.name - Name for logging (default: 'CircuitBreaker')
     * @param {boolean} options.emitEvents - Emit EventBus events (default: true)
     * @param {number} options.halfOpenMaxConcurrent - Max concurrent requests in half-open (default: 1)
     * @param {boolean} options.useExponentialBackoff - Use exponential backoff (default: true)
     * @param {number} options.maxResetMs - Maximum backoff time (default: 300000)
     * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
     */
    const create = (options = {}) => {
      const {
        threshold = DEFAULTS.threshold,
        resetMs = DEFAULTS.resetMs,
        successThreshold = DEFAULTS.successThreshold,
        name = 'CircuitBreaker',
        emitEvents = true,
        halfOpenMaxConcurrent = DEFAULTS.halfOpenMaxConcurrent,
        useExponentialBackoff = DEFAULTS.useExponentialBackoff,
        maxResetMs = DEFAULTS.maxResetMs,
        backoffMultiplier = DEFAULTS.backoffMultiplier
      } = options;

      const circuits = new Map();

      const emit = (event, data) => {
        if (emitEvents && EventBus) {
          EventBus.emit(event, { breaker: name, ...data });
        }
      };

      /**
       * Calculate backoff time based on consecutive failures
       * @param {number} consecutiveFailures - Number of consecutive failures
       * @param {number} baseMs - Base timeout in ms
       * @returns {number} Backoff time in ms
       */
      const calculateBackoff = (consecutiveFailures, baseMs) => {
        if (!useExponentialBackoff || consecutiveFailures <= 1) {
          return baseMs;
        }
        // Exponential backoff: base * multiplier^(failures-1), capped at maxResetMs
        const backoff = baseMs * Math.pow(backoffMultiplier, consecutiveFailures - 1);
        return Math.min(backoff, maxResetMs);
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

        // OPEN state: check if cooldown has passed (with exponential backoff)
        if (record.state === State.OPEN) {
          const currentResetMs = calculateBackoff(record.consecutiveTrips || 1, resetMs);
          const elapsed = now - record.tripTime;
          if (elapsed >= currentResetMs) {
            // Transition to HALF_OPEN (test recovery)
            record.state = State.HALF_OPEN;
            record.testSuccesses = 0;
            record.halfOpenConcurrent = 1; // First probe is being allowed now
            record.halfOpenStartTime = now;
            logger.info(`[${name}] Circuit half-open for: ${key} (testing recovery after ${currentResetMs}ms)`);
            emit('circuit:half_open', { key, backoffMs: currentResetMs, consecutiveTrips: record.consecutiveTrips || 1 });
            return false; // Allow test call (first probe)
          }
          return true; // Still in cooldown
        }

        // HALF_OPEN state: limit concurrent test requests
        if (record.state === State.HALF_OPEN) {
          if (record.halfOpenConcurrent >= halfOpenMaxConcurrent) {
            // Too many concurrent requests in half-open state
            logger.debug(`[${name}] Half-open concurrent limit reached for: ${key}`);
            return true;
          }
          // Allow this request as a probe and increment counter
          record.halfOpenConcurrent = (record.halfOpenConcurrent || 0) + 1;
          return false;
        }

        // CLOSED state or counting failures
        if (record.failures >= threshold) {
          // Should have transitioned to OPEN, but just in case
          record.state = State.OPEN;
          record.tripTime = now;
          record.consecutiveTrips = (record.consecutiveTrips || 0) + 1;
          return true;
        }

        return false;
      };

      /**
       * Attempt to acquire a half-open probe slot
       * Use this for async operations where you need to track in-flight requests
       * @param {string} key - Identifier
       * @returns {boolean} True if probe slot acquired
       */
      const acquireProbe = (key) => {
        const record = circuits.get(key);
        if (!record || record.state !== State.HALF_OPEN) return true; // Not in half-open, allow

        if (record.halfOpenConcurrent >= halfOpenMaxConcurrent) {
          return false;
        }
        record.halfOpenConcurrent = (record.halfOpenConcurrent || 0) + 1;
        return true;
      };

      /**
       * Release a half-open probe slot
       * @param {string} key - Identifier
       */
      const releaseProbe = (key) => {
        const record = circuits.get(key);
        if (record && record.state === State.HALF_OPEN) {
          record.halfOpenConcurrent = Math.max(0, (record.halfOpenConcurrent || 1) - 1);
        }
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
            testSuccesses: 0,
            consecutiveTrips: 0,
            halfOpenConcurrent: 0,
            totalFailures: 0
          };
        }

        record.lastError = error;
        record.totalFailures = (record.totalFailures || 0) + 1;

        if (record.state === State.HALF_OPEN) {
          // Recovery test failed - back to OPEN with increased backoff
          record.state = State.OPEN;
          record.tripTime = now;
          record.testSuccesses = 0;
          record.halfOpenConcurrent = 0;
          record.consecutiveTrips = (record.consecutiveTrips || 0) + 1;
          const nextBackoff = calculateBackoff(record.consecutiveTrips, resetMs);
          logger.warn(`[${name}] Recovery failed for: ${key}, circuit re-opened (next retry in ${nextBackoff}ms)`);
          emit('circuit:reopen', { key, error: error?.message, consecutiveTrips: record.consecutiveTrips, nextBackoffMs: nextBackoff });
        } else {
          // Normal failure counting
          record.failures++;

          if (record.failures >= threshold && record.state !== State.OPEN) {
            record.state = State.OPEN;
            record.tripTime = now;
            record.consecutiveTrips = (record.consecutiveTrips || 0) + 1;
            const backoffMs = calculateBackoff(record.consecutiveTrips, resetMs);
            logger.warn(`[${name}] Circuit TRIPPED for: ${key} after ${record.failures} failures (backoff: ${backoffMs}ms)`);
            emit('circuit:open', { key, failures: record.failures, error: error?.message, backoffMs });
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

        // Release probe slot in half-open state
        if (record.state === State.HALF_OPEN) {
          record.halfOpenConcurrent = Math.max(0, (record.halfOpenConcurrent || 1) - 1);
          // Count successful test calls
          record.testSuccesses++;

          if (record.testSuccesses >= successThreshold) {
            // Fully recovered - close circuit and reset backoff
            const recoveryDuration = record.halfOpenStartTime ? Date.now() - record.halfOpenStartTime : 0;
            circuits.delete(key);
            logger.info(`[${name}] Circuit CLOSED for: ${key} (recovered after ${successThreshold} successes in ${recoveryDuration}ms)`);
            emit('circuit:closed', { key, recoveryDurationMs: recoveryDuration });
          } else {
            logger.debug(`[${name}] Half-open progress for ${key}: ${record.testSuccesses}/${successThreshold}`);
            emit('circuit:half_open_progress', { key, successes: record.testSuccesses, required: successThreshold });
          }
        } else {
          // Normal success - clear failure record
          circuits.delete(key);
        }
      };

      /**
       * Force transition to a specific state (for testing/admin)
       * @param {string} key - Identifier
       * @param {string} state - Target state (closed, open, half_open)
       */
      const forceState = (key, state) => {
        if (!Object.values(State).includes(state)) {
          throw new Error(`Invalid state: ${state}`);
        }

        if (state === State.CLOSED) {
          circuits.delete(key);
          logger.info(`[${name}] Circuit force-closed for: ${key}`);
          emit('circuit:force_closed', { key });
          return;
        }

        let record = circuits.get(key);
        if (!record) {
          record = {
            state: State.CLOSED,
            failures: 0,
            lastError: null,
            tripTime: 0,
            testSuccesses: 0,
            consecutiveTrips: 0,
            halfOpenConcurrent: 0,
            totalFailures: 0
          };
        }

        const now = Date.now();
        record.state = state;
        if (state === State.OPEN) {
          record.tripTime = now;
        } else if (state === State.HALF_OPEN) {
          record.testSuccesses = 0;
          record.halfOpenConcurrent = 0; // No probes in flight initially when forced
          record.halfOpenStartTime = now;
        }

        circuits.set(key, record);
        logger.info(`[${name}] Circuit force-${state} for: ${key}`);
        emit(`circuit:force_${state}`, { key });
      };

      /**
       * Get current state for a key
       * @param {string} key - Identifier
       * @returns {Object|null} Circuit state or null if no record
       */
      const getState = (key) => {
        const record = circuits.get(key);
        if (!record) return { state: State.CLOSED, failures: 0, isOpen: false, consecutiveTrips: 0 };

        const now = Date.now();
        const currentBackoffMs = calculateBackoff(record.consecutiveTrips || 1, resetMs);
        const isCurrentlyOpen = record.state === State.OPEN &&
          (now - record.tripTime) < currentBackoffMs;

        const remainingMs = isCurrentlyOpen
          ? Math.max(0, currentBackoffMs - (now - record.tripTime))
          : 0;

        return {
          state: record.state,
          failures: record.failures,
          lastError: record.lastError?.message,
          isOpen: isCurrentlyOpen || (record.state === State.HALF_OPEN && record.halfOpenConcurrent >= halfOpenMaxConcurrent),
          tripTime: record.tripTime,
          testSuccesses: record.testSuccesses || 0,
          consecutiveTrips: record.consecutiveTrips || 0,
          currentBackoffMs,
          remainingMs,
          halfOpenConcurrent: record.halfOpenConcurrent || 0,
          totalFailures: record.totalFailures || 0
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
        acquireProbe,
        releaseProbe,
        forceState,
        State,
        get size() { return circuits.size; },
        // Expose config for testing
        get config() {
          return {
            threshold,
            resetMs,
            successThreshold,
            halfOpenMaxConcurrent,
            useExponentialBackoff,
            maxResetMs,
            backoffMultiplier
          };
        }
      };
    };

    return { create, State, DEFAULTS };
  }
};

export default CircuitBreaker;
