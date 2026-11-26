# Blueprint 0x00005C: Circuit Breaker Pattern

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/circuit-breaker.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/circuit-breaker.js`

**Former Blueprint Paths:** `self/blueprints/0x00005C-circuit-breaker-pattern.md`

**Module ID:** `CircuitBreaker` (version 2.0.0, genesis level `spark`, type `utility`; dependencies `Utils`, optional `EventBus`)

**Source:** `self/infrastructure/circuit-breaker.js`

---

## Purpose

A circuit breaker stops the agent from calling something that keeps failing. Each breaker tracks any number of keys (for example tool names). After enough failures for a key it rejects that key for a cooldown, then lets a limited number of probe calls through to test recovery.

The breaker does not wrap or run the call. The caller asks `isOpen(key)` before calling and reports the outcome with `recordSuccess(key)` or `recordFailure(key, error)`.

The agent's tool path creates one breaker named `AgentToolCircuit` with `threshold: 3` and `resetMs: 60000`, keyed by tool name (`packages/reploid/src/agent/lab-strategy-tools.js:34-39`).

## Exports

The factory returns `{ create, State, DEFAULTS }`.

- `State`: `{ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' }`.
- `DEFAULTS`: `{ threshold: 3, resetMs: 60000, successThreshold: 2, halfOpenMaxConcurrent: 1, useExponentialBackoff: true, maxResetMs: 300000, backoffMultiplier: 2 }`.
- `create(options)`: returns a breaker. Options are the `DEFAULTS` keys plus `name` (default `'CircuitBreaker'`, used in logs and event payloads) and `emitEvents` (default `true`).

A breaker exposes `isOpen`, `recordFailure`, `recordSuccess`, `getState`, `reset`, `getTrackedKeys`, `acquireProbe`, `releaseProbe`, `forceState`, `State`, and the getters `size` and `config`.

## State machine

Per key:

1. **Closed.** Not tracked, or tracked with fewer than `threshold` consecutive failures. `recordSuccess` deletes the record.
2. **Open.** Entered when failures reach `threshold`. `isOpen` returns `true` until the cooldown has passed. The cooldown is `resetMs` on the first trip and, with exponential backoff, `resetMs * backoffMultiplier^(trips - 1)` capped at `maxResetMs`.
3. **Half-open.** The first `isOpen` after the cooldown moves the key here and admits one probe. Further calls are admitted only while fewer than `halfOpenMaxConcurrent` probes are in flight. A failure re-opens the key and counts another trip; `successThreshold` successes close it and delete the record.

`acquireProbe` and `releaseProbe` let a caller manage half-open slots explicitly. `forceState(key, state)` sets a state by hand and throws on an unknown state. `getState(key)` returns `{ state, failures, lastError, isOpen, tripTime, testSuccesses, consecutiveTrips, currentBackoffMs, remainingMs, halfOpenConcurrent, totalFailures }`, or a closed default for an untracked key. `reset()` clears every key.

## Events

Emitted on `EventBus` when present and `emitEvents` is true; every payload includes `breaker: name` and `key`:

`circuit:open`, `circuit:half_open`, `circuit:half_open_progress`, `circuit:reopen`, `circuit:closed`, `circuit:force_closed`, `circuit:force_open`, `circuit:force_half_open`.

## Boundaries

- State is in memory and per breaker instance; it does not survive a reload and is not shared between tabs or peers.
- An open circuit means "stop calling for now". It says nothing about why the target failed.
- Agent-loop behavior with the breaker is exercised in `tests/integration/agent-loop.test.js`; there is no dedicated unit test for this module.

## Related blueprints

- [0x00000A Tool Runner Engine](0x00000A-tool-runner-engine.md): runs the tools the agent breaker guards.
- [0x000029 Rate Limiting Strategies](0x000029-rate-limiting-strategies.md): limits call rate rather than reacting to failures.
