# Arena Competitor

**Module:** `ArenaCompetitor`
**File:** `./testing/arena/competitor.js`
**Purpose:** Represents agent competitor in multi-agent arena battles

## Overview

Arena system pits multiple agent instances against each other in challenges. Each competitor has isolated VFS, state, and tracks performance metrics.

## Implementation

```javascript
const ArenaCompetitor = {
  metadata: {
    id: 'ArenaCompetitor',
    dependencies: ['Utils', 'VFSSandbox', 'AgentLoop'],
    type: 'testing'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { VFSSandbox, AgentLoop } = deps;

    const createCompetitor = async (id, genesisLevel) => {
      const sandbox = await VFSSandbox.create(`competitor_${id}`);
      const agent = await AgentLoop.factory({ ...deps, VFS: sandbox.vfs });

      return {
        id,
        genesisLevel,
        sandbox,
        agent,
        metrics: {
          startTime: null,
          endTime: null,
          iterations: 0,
          toolCalls: 0,
          errors: [],
          score: 0
        },

        async run(challenge) {
          this.metrics.startTime = Date.now();

          try {
            const result = await this.agent.run(challenge.goal);
            this.metrics.endTime = Date.now();
            return result;
          } catch (error) {
            this.metrics.errors.push(error.message);
            throw error;
          }
        },

        async cleanup() {
          await sandbox.destroy();
        }
      };
    };

    return { createCompetitor };
  }
};
```
