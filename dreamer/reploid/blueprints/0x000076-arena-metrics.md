# Arena Metrics

**Module:** `ArenaMetrics`
**File:** `./testing/arena/arena-metrics.js`
**Purpose:** Scores and compares arena competitor performance

## Overview

Defines scoring rubrics for arena challenges. Metrics include: time to completion, code quality, resource efficiency, correctness, creativity.

## Implementation

```javascript
const ArenaMetrics = {
  metadata: {
    id: 'ArenaMetrics',
    dependencies: ['Utils'],
    type: 'testing'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;

    const scoreCompetitor = (competitor, challenge) => {
      const scores = {
        speed: 0,
        correctness: 0,
        efficiency: 0,
        codeQuality: 0,
        creativity: 0
      };

      // Speed score (0-100)
      const duration = competitor.metrics.endTime - competitor.metrics.startTime;
      scores.speed = Math.max(0, 100 - (duration / 1000)); // 1pt per second penalty

      // Correctness score (0-100)
      const passed = challenge.verifyResult(competitor);
      scores.correctness = passed ? 100 : 0;

      // Efficiency score (0-100)
      const targetIterations = challenge.expectedIterations || 10;
      scores.efficiency = Math.max(0, 100 - Math.abs(competitor.metrics.iterations - targetIterations) * 5);

      // Code quality (0-100) - based on error count
      scores.codeQuality = Math.max(0, 100 - competitor.metrics.errors.length * 10);

      // Creativity (0-100) - subjective, needs human eval or heuristic
      scores.creativity = 50; // Default neutral

      // Weighted total
      const total = (
        scores.speed * 0.2 +
        scores.correctness * 0.4 +
        scores.efficiency * 0.2 +
        scores.codeQuality * 0.1 +
        scores.creativity * 0.1
      );

      return { scores, total };
    };

    return { scoreCompetitor };
  }
};
```
