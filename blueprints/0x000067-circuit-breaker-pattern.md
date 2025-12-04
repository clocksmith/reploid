# Circuit Breaker Pattern

**Module:** `CircuitBreaker`
**File:** `./infrastructure/circuit-breaker.js`
**Purpose:** Failure isolation - prevents cascading failures when services degrade

## Overview

The Circuit Breaker pattern monitors failures and "opens" the circuit after threshold is exceeded, preventing further calls to failing service. After timeout, circuit enters "half-open" state to test if service recovered.

## States

1. **CLOSED** - Normal operation, requests pass through
2. **OPEN** - Failure threshold exceeded, requests fail fast
3. **HALF_OPEN** - Testing recovery, limited requests allowed

## Implementation

```javascript
const CircuitBreaker = {
  metadata: {
    id: 'CircuitBreaker',
    dependencies: ['Utils'],
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;

    const createBreaker = (threshold = 5, timeout = 60000) => {
      let failures = 0;
      let state = 'CLOSED';
      let nextRetry = 0;

      const execute = async (fn) => {
        if (state === 'OPEN') {
          if (Date.now() < nextRetry) {
            throw new Error('Circuit breaker OPEN');
          }
          state = 'HALF_OPEN';
        }

        try {
          const result = await fn();
          if (state === 'HALF_OPEN') {
            state = 'CLOSED';
            failures = 0;
          }
          return result;
        } catch (error) {
          failures++;
          if (failures >= threshold) {
            state = 'OPEN';
            nextRetry = Date.now() + timeout;
            logger.warn(`Circuit breaker opened after ${failures} failures`);
          }
          throw error;
        }
      };

      return { execute, getState: () => state };
    };

    return { createBreaker };
  }
};
```

## Usage

```javascript
const breaker = CircuitBreaker.createBreaker(5, 60000);

await breaker.execute(async () => {
  return await fetch('/api/endpoint');
});
```
