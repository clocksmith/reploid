/**
 * @fileoverview State Manager
 * Manages high-level agent state and persistence.
 */

const StateManager = {
  metadata: {
    id: 'StateManager',
    version: '2.1.0',
    dependencies: ['Utils', 'VFS', 'StateHelpersPure', 'EventBus', 'AuditLogger?'], // Optional AuditLogger
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, StateHelpersPure, EventBus, AuditLogger } = deps;
    const { logger, Errors, generateId } = Utils;

    const STATE_PATH = '/.system/state.json';
    let _state = null;

    const load = async () => {
      try {
        const content = await VFS.read(STATE_PATH);
        const rawState = JSON.parse(content);

        const errors = StateHelpersPure.validateState(rawState);
        if (errors) {
          logger.warn('[StateManager] Validation failed, resetting', errors);
          _state = StateHelpersPure.createInitialState();
        } else {
          _state = StateHelpersPure.createInitialState(rawState); // Merge safely
          logger.info(`[StateManager] Loaded state (Cycle: ${_state.totalCycles})`);
        }
      } catch (err) {
        // If file missing, init fresh
        logger.info('[StateManager] Initializing fresh state.');
        _state = StateHelpersPure.createInitialState();
        await save();
      }
      return _state;
    };

    const save = async (retries = 2) => {
      if (!_state) return;
      try {
        const content = JSON.stringify(_state, null, 2);
        await VFS.write(STATE_PATH, content);
      } catch (err) {
        if (retries > 0) {
          logger.warn(`[StateManager] Save failed, retrying (${retries} left)`, err.message);
          await new Promise(r => setTimeout(r, 100));
          return save(retries - 1);
        }
        logger.error('[StateManager] Save failed after retries', err);
        // Notify UI so user knows state may not be persisted
        if (EventBus) {
          EventBus.emit('error:persistence', {
            message: 'Failed to save agent state',
            details: err.message
          });
        }
      }
    };

    // --- Public API ---

    const getState = () => {
      if (!_state) throw new Errors.StateError('StateManager not initialized');
      return JSON.parse(JSON.stringify(_state));
    };

    const updateState = async (updates) => {
      if (!_state) await load();
      Object.assign(_state, updates);
      await save();
      return getState();
    };

    const setGoal = async (goalText) => {
      if (!_state) await load();

      // Use pure helper to maintain goal history
      _state = StateHelpersPure.pushGoal(_state, goalText);

      await save();

      if (AuditLogger && AuditLogger.logAgentAction) {
        AuditLogger.logAgentAction('SET_GOAL', 'StateManager', { goal: goalText });
      }

      logger.info(`[StateManager] Goal set: "${goalText.substring(0, 50)}..."`);
    };

    const incrementCycle = async () => {
      if (!_state) await load();
      _state.totalCycles++;
      await save();
    };

    return {
      init: load,
      getState,
      updateState,
      setGoal,
      incrementCycle
    };
  }
};

export default StateManager;
