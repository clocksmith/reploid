/**
 * @fileoverview Goal Categories and Filtering
 * Defines goals organized by category with capability requirements.
 */

/**
 * Goal categories with capability requirements.
 * Ordered by RSI level: Exploration (none) -> L1 (Tools) -> L2/L3 (Behavioral) -> Model (Neural)
 */
export const GOAL_CATEGORIES = {
  // No RSI - just reading and understanding
  'Exploration': [
    {
      text: 'Explain how the agent loop works',
      requires: {},
      recommended: true
    },
    {
      text: 'List all available tools and their purposes',
      requires: {}
    },
    {
      text: 'Analyze the VFS structure',
      requires: {}
    },
    {
      text: 'Trace a request through the system',
      requires: { reasoning: 'medium' },
      lockReason: 'May need stronger model'
    }
  ],

  // L1: Tool-level RSI - creating and modifying tools
  'Code Tasks (L1)': [
    {
      text: 'Build a new agent tool',
      requires: {},
      recommended: true
    },
    {
      text: 'Write tests for a module',
      requires: {}
    },
    {
      text: 'Debug an issue in the codebase',
      requires: {}
    },
    {
      text: 'Refactor a component for clarity',
      requires: { reasoning: 'medium' },
      lockReason: 'May need stronger model'
    },
    {
      text: 'Add documentation to existing code',
      requires: {}
    }
  ],

  // L2/L3: Behavioral RSI - modifying agent behavior, meta-tools, substrate
  'Behavioral RSI (L2/L3)': [
    {
      text: 'Create meta-tools that generate tools',
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      text: 'Evolve prompts with GEPA optimization',
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      text: 'Improve context management strategies',
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    },
    {
      text: 'Optimize tool selection heuristics',
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    },
    {
      text: 'Modify agent loop for new capabilities',
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    }
  ],

  // Neural-level RSI - weight access, activations, LoRA (requires Doppler)
  'Model RSI (Neural)': [
    {
      text: 'Inspect attention patterns during inference',
      requires: { model: true },
      lockReason: 'Requires Doppler'
    },
    {
      text: 'Analyze hidden state evolution across layers',
      requires: { model: true },
      lockReason: 'Requires Doppler'
    },
    {
      text: 'Implement activation steering for behavior control',
      requires: { model: true },
      lockReason: 'Requires Doppler'
    },
    {
      text: 'Fine-tune LoRA weights based on task performance',
      requires: { model: true },
      lockReason: 'Requires Doppler'
    },
    {
      text: 'Optimize inference kernels for speed',
      requires: { model: true },
      lockReason: 'Requires Doppler'
    }
  ]
};

/**
 * Filter goals based on current capability level
 * @param {Object} categories - Goal categories
 * @param {Object} capabilities - Current capability level
 * @returns {Object} Filtered categories with locked/recommended flags
 */
export function filterGoalsByCapability(categories, capabilities) {
  const result = {};

  for (const [category, goals] of Object.entries(categories)) {
    result[category] = goals.map(goal => {
      const { requires } = goal;
      let locked = false;
      let lockReason = goal.lockReason || '';

      // Check model access requirement
      if (requires.model && !capabilities.canDoModelRSI) {
        locked = true;
      }

      // Check reasoning requirement
      if (requires.reasoning === 'high' && !capabilities.canDoComplexReasoning) {
        locked = true;
      }
      if (requires.reasoning === 'medium' && !capabilities.canDoBehavioralRSI) {
        locked = true;
      }

      // Determine if recommended for this setup
      let recommended = goal.recommended || false;

      // Recommend model RSI goals if user has model access
      if (requires.model && capabilities.canDoModelRSI) {
        recommended = true;
      }

      // Recommend behavioral RSI if user has high reasoning
      if (category === 'Behavioral RSI (L2/L3)' && capabilities.canDoComplexReasoning) {
        recommended = true;
      }

      return {
        ...goal,
        locked,
        lockReason: locked ? lockReason : '',
        recommended
      };
    });
  }

  return result;
}

/**
 * Get a flat list of all unlocked goals
 */
export function getUnlockedGoals(categories, capabilities) {
  const filtered = filterGoalsByCapability(categories, capabilities);
  const unlocked = [];

  for (const goals of Object.values(filtered)) {
    for (const goal of goals) {
      if (!goal.locked) {
        unlocked.push(goal);
      }
    }
  }

  return unlocked;
}

/**
 * Get recommended goals for current setup
 */
export function getRecommendedGoals(categories, capabilities) {
  const filtered = filterGoalsByCapability(categories, capabilities);
  const recommended = [];

  for (const goals of Object.values(filtered)) {
    for (const goal of goals) {
      if (goal.recommended && !goal.locked) {
        recommended.push(goal);
      }
    }
  }

  return recommended;
}
