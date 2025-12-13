# Blueprint 0x000077: Arena Harness

**Module:** `ArenaHarness`
**File:** `./testing/arena/arena-harness.js`
**Purpose:** Orchestrates arena battles and manages competitors

## Overview

Arena harness runs challenges, spawns competitors, collects metrics, and determines winners. Provides framework for RSI benchmarking.

## Implementation

```javascript
const ArenaHarness = {
  metadata: {
    id: 'ArenaHarness',
    dependencies: ['Utils', 'ArenaCompetitor', 'ArenaMetrics'],
    type: 'testing'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { ArenaCompetitor, ArenaMetrics } = deps;

    const runBattle = async (challenge, competitors) => {
      logger.info(`Starting arena battle: ${challenge.name}`);

      const results = [];

      for (const config of competitors) {
        const competitor = await ArenaCompetitor.createCompetitor(config.id, config.genesisLevel);

        try {
          await competitor.run(challenge);
          const score = ArenaMetrics.scoreCompetitor(competitor, challenge);
          results.push({ competitor: config.id, score, metrics: competitor.metrics });
        } catch (error) {
          logger.error(`Competitor ${config.id} failed`, error);
          results.push({ competitor: config.id, error: error.message, score: { total: 0 } });
        } finally {
          await competitor.cleanup();
        }
      }

      results.sort((a, b) => b.score.total - a.score.total);

      return {
        challenge: challenge.name,
        winner: results[0].competitor,
        results
      };
    };

    return { runBattle };
  }
};
```

## Example Challenge

```javascript
const challenge = {
  name: 'Build Reflection Layer',
  goal: 'Starting from Tabula Rasa, implement ReflectionStore and ReflectionAnalyzer modules',
  expectedIterations: 15,
  verifyResult: (competitor) => {
    // Check if modules exist and work
    return competitor.sandbox.vfs.exists('/capabilities/reflection/reflection-store.js');
  }
};
```
