# Blueprint 0x000006: Pure State Helpers

**Classification:** Canonical Full Specification

**Implementation Status:** In-Progress

**Verified Artifacts:** `/self/core/state-helpers-pure.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/state-helpers-pure.js`

**Former Blueprint Paths:** `self/blueprints/0x000006-pure-state-helpers.md`
**Objective:** Keep the default state shape, validation and goal-stack update as pure functions with no I/O, so `StateManager` stays a thin persistence layer.

**Prerequisites:** None

**Affected Artifacts:** `self/core/state-helpers-pure.js`; used by `self/core/state-manager.js` ([0x000005](0x000005-state-management-architecture.md))

---

### 1. Module

`StateHelpersPure` (`self/core/state-helpers-pure.js`), `genesis: { introduced: 'tabula' }`, no dependencies, `type: 'pure'`. `factory()` returns:

| Member | Behavior |
| --- | --- |
| `DEFAULT_STATE` | `{ version: '1.0.0', totalCycles: 0, currentGoal: null, session: { id: null, startTime: null, status: 'idle' }, artifactMetadata: {}, stats: { apiCalls: 0, errors: 0 } }` |
| `createInitialState(overrides = {})` | Defaults, then `overrides`, with `session` merged one level deep |
| `validateState(state)` | `null` when valid; otherwise an array of messages. It checks only that `state` is an object and `totalCycles` is a number. |
| `pushGoal(state, text)` | Returns a deep copy. With no `currentGoal`, sets `{ id, text, created, subgoals: [] }`; otherwise appends `{ id, text, created, status: 'pending' }` to `currentGoal.subgoals`. IDs are `Date.now()` strings. |

### 2. Rules

- No function reads or writes storage, the clock aside from `Date.now()` in `pushGoal`, or the DOM.
- Inputs are not mutated: `pushGoal` clones with `JSON.parse(JSON.stringify(state))`.
- Validation is deliberately minimal; a richer schema belongs here, not in `StateManager`.

### 3. Verification

Incomplete: no test imports this module, and `tests/unit/state-manager.test.js` replaces it with an empty mock. A direct unit test of the three functions is the missing evidence.
