/**
 * @fileoverview Pure State Helpers
 * Logic-only functions for state validation and default values.
 */

const StateHelpersPure = {
  metadata: {
    id: 'StateHelpersPure',
    version: '2.0.0',
    dependencies: [],
    type: 'pure'
  },

  factory: () => {

    const DEFAULT_STATE = {
      version: '2.0.0',
      totalCycles: 0,
      currentGoal: null,
      session: {
        id: null,
        startTime: null,
        status: 'idle'
      },
      artifactMetadata: {}, // Tracks file modification times/cycles
      stats: {
        apiCalls: 0,
        errors: 0
      }
    };

    const createInitialState = (overrides = {}) => {
      return {
        ...DEFAULT_STATE,
        ...overrides,
        session: { ...DEFAULT_STATE.session, ...(overrides.session || {}) }
      };
    };

    const validateState = (state) => {
      const errors = [];
      if (!state || typeof state !== 'object') return ['State is not an object'];
      if (typeof state.totalCycles !== 'number') errors.push('Invalid totalCycles');
      return errors.length > 0 ? errors : null;
    };

    /**
     * Push a new goal onto the goal stack
     */
    const pushGoal = (state, newGoalText) => {
      const newState = JSON.parse(JSON.stringify(state));

      if (!newState.currentGoal) {
        newState.currentGoal = {
          id: Date.now().toString(),
          text: newGoalText,
          created: Date.now(),
          subgoals: []
        };
      } else {
        // Add as subgoal to current
        newState.currentGoal.subgoals.push({
          id: Date.now().toString(),
          text: newGoalText,
          created: Date.now(),
          status: 'pending'
        });
      }

      return newState;
    };

    return {
      createInitialState,
      validateState,
      pushGoal,
      DEFAULT_STATE
    };
  }
};

export default StateHelpersPure;
