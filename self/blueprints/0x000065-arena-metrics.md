# Blueprint 0x000065: Arena Metrics

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/testing/arena/arena-metrics.js`, `/tests/integration/arena-harness.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `testing/arena/arena-metrics.js`

**Former Blueprint Paths:** `self/blueprints/0x000065-arena-metrics.md`
**Module:** `ArenaMetrics` (version 1.0.0, type `utility`)
**File:** `self/testing/arena/arena-metrics.js`
**Genesis level:** `full` (`self/config/genesis-levels.json`)
**Dependencies:** `Utils` (declared, unused)
**Purpose:** Result records, ranking and summary statistics for Arena runs.

## Contract

Metrics are pass/fail first, then speed or token count. There is no weighted rubric, no `scoreCompetitor`, and no speed, efficiency, code-quality or creativity score. A result passes only when the harness's verification passes.

`Status` (`:19-23`) is `PASS`, `FAIL` or `ERROR`.

`createResult(competitorName, status, details)` (`:32-44`) returns `{ competitorName, status, verificationPassed, executionMs, tokenCount, model, provider, errors, warnings, solution, timestamp }`, with zero, `null` or empty-list defaults.

`rankResults(results, sortBy = 'speed')` (`:52-64`) puts `PASS` before everything else, then sorts by `executionMs` (or `tokenCount` when `sortBy` is `'tokens'`). `FAIL` and `ERROR` are not ordered relative to each other.

`summarize(results)` (`:71-110`) returns:

| Field | Meaning |
| --- | --- |
| `total`, `passed`, `failed`, `errors` | Counts by status |
| `passRate` | Rounded percentage of `PASS` |
| `fastestPassing` | Name of the passing result with the lowest `executionMs`, or `null`; the harness reports this as the winner |
| `mostEfficient` | Name of the passing result with the lowest `tokenCount` |
| `avgExecutionMs`, `avgTokens` | Rounded means over passing results only |
| `rankings` | `{ name, status, ms, tokens }` in `rankResults` order |

`compare(summary1, summary2)` (`:118-124`) returns `passRateDiff`, `speedDiff` and `tokenDiff` (second minus first) and `improved`, which is true when the pass rate rose, or stayed equal while mean time fell.

## Authority

A summary, a winner or `improved: true` is evaluation evidence only. It does not grant activation: durable changes still need operator adoption through `Promote` under [promotion-contract.md](promotion-contract.md).

## Exports

Returned object at `arena-metrics.js:126-132`: `Status`, `createResult`, `rankResults`, `summarize`, `compare`. The module emits no events.

## Related blueprints

- [0x000066 Arena Harness](0x000066-arena-harness.md): the producer of results.
- [0x000064 Arena Competitor](0x000064-arena-competitor.md): the source of `executionMs` and `tokenCount`.
