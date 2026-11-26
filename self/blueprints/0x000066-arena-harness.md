# Blueprint 0x000066: Arena Harness

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/testing/arena/arena-harness.js`, `/tests/integration/arena-harness.test.js`, `/tests/e2e/x-one-safe-candidate.spec.js`

**Planned Artifacts:** None

**Owned Source Files:** `testing/arena/arena-harness.js`

**Former Blueprint Paths:** `self/blueprints/0x000066-arena-harness.md`
**Module:** `ArenaHarness` (version 1.0.0, type `testing`)
**File:** `self/testing/arena/arena-harness.js` (uses `validateAgainstSchema` from `self/core/tool-argument-validation.js`)
**Genesis level:** `full` (`self/config/genesis-levels.json`)
**Dependencies:** `VFSSandbox`, `ArenaCompetitor`, `ArenaMetrics`, `VerificationManager`, `EventBus`, `Utils`; optional `SchemaRegistry`
**Purpose:** Generate competing proposals, verify each one against a restored VFS snapshot, and rank the results.

## Contract

The harness compares proposals inside one VFS by snapshot and restore. There is no `runBattle`, no per-competitor agent and no challenge object with `verifyResult`. Correctness is decided by `VerificationManager.verifyProposal` ([0x000040](0x000040-verification-manager.md)).

### `runCompetition(config)` (`:36-171`)

Input: `{ task, context, competitors, parseChanges, options: { timeout = 60000, continueOnError = true } }`. `parseChanges(solution)` must return a `{ path: content }` map.

1. `VFSSandbox.createSnapshot()`.
2. All competitors call `propose(task, context)` in parallel, each bounded by `timeout`. A rejected or timed-out proposal becomes an `ERROR` result.
3. For each proposal, in order: restore the snapshot, parse changes (none parsed is `FAIL`), `VFSSandbox.applyChanges`, then `VerificationManager.verifyProposal(changes)`. A pass is `PASS`; otherwise `FAIL` with the verifier's errors. A thrown error is `ERROR` and, when `continueOnError` is false, aborts the loop.
4. Restore the snapshot in a `finally` block, so the VFS is returned to its starting state even on failure.
5. Return `{ results (ranked), summary, winner: summary.fastestPassing, winnerSolution }` from [ArenaMetrics](0x000065-arena-metrics.md).

The timeout stops waiting for a proposal; it does not cancel the underlying model call.

### `verifySolution({ solution, parseChanges })` (`:180-213`)

Single-candidate version: snapshot, apply, verify, restore. Returns `{ passed, errors, warnings, changes }` or `{ passed: false, error }`.

### `runExpertPool(task, experts, doppler, options)` (`:253-291`)

Runs every expert through `options.run`, `doppler.executeExpert` or `doppler.inference` in parallel with the task prompt and sampling settings, scores each output with `scoreOutput`, and returns `{ winner, results }` sorted by score. `scoreOutput` (`:216-251`) gives 0.7 for output that parses and validates against `task.schema` (or the `SchemaRegistry` tool schema named by `task.schemaName`), 0 for invalid output, 0.4 when there is no schema, plus any number returned by `options.scoreOutput`. No VFS change or verification happens on this path.

### `rerunLast()` (`:293-299`)

Repeats the last `runCompetition` with the same config.

## Callers

| Caller | Path used | Source |
| --- | --- | --- |
| GEPA optimizer | `verifySolution` when `options.arenaValidate` is set | `self/capabilities/cognition/gepa-optimizer.js:353-354` |
| FunctionGemma orchestrator | `runExpertPool` | `self/core/functiongemma-orchestrator.js:355-360` |
| Tool runner | Offers `ArenaHarness` to tools through the filtered tool dependencies (`filterToolDepsForTool`) | `self/core/tool-runner.js:404-425` |
| Observability | Listens to `arena:complete` and counts a pass rate of 80 % or more as passed | `self/infrastructure/observability.js:367-380` |
| `/x` end-to-end test | `verifySolution` evidence, then `Promote` | `tests/e2e/x-one-safe-candidate.spec.js` |

No code in `self/` calls `runCompetition` or `rerunLast` today; the integration test exercises them.

## Authority

Arena output is evaluation evidence. A `PASS`, a winner or a pool score never activates a change. Durable `/self` changes still require operator adoption through `Promote` under [promotion-contract.md](promotion-contract.md); the end-to-end test above follows that order.

## Events

| Event | Payload | Line |
| --- | --- | --- |
| `arena:start` | `{ runId, competitorCount, task (first 100 chars) }` | 44 |
| `arena:proposals:start` | `{ count }` | 59 |
| `arena:verifying` | `{ competitor }` | 86 |
| `arena:complete` | `{ runId, ...summary, summary, results, winner }` | 152 |

`verifySolution` and `runExpertPool` emit no events.

## Related blueprints

- [0x000064 Arena Competitor](0x000064-arena-competitor.md), [0x000065 Arena Metrics](0x000065-arena-metrics.md).
- [0x000040 Verification Manager](0x000040-verification-manager.md): owns `VFSSandbox` and the verifier.
- [0x000058 Browser-Native Multi-Model Arena](0x000058-browser-native-paxos.md): the broader Arena design.
- [0x00006B Schema Registry](0x00006B-schema-registry.md): schemas for `scoreOutput`.
