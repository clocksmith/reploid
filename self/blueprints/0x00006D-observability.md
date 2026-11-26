# Blueprint 0x00006D: Observability

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/observability.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/observability.js`

**Former Blueprint Paths:** `self/blueprints/0x00006D-observability.md`
**Objective:** In-memory token, mutation, decision, Arena and substrate-change records for real-time visibility into agent behavior.

**Target Module:** `Observability`

**Implementation:** `/infrastructure/observability.js`

**Genesis Level:** substrate (`self/config/genesis-levels.json`; module metadata `observability.js:10`)

**Prerequisites:** `0x000003` (Core Utilities), `0x00004F` (Event Bus), `0x000011` (VFS); optional `0x00006C` (Error Store), `0x000032` (Reflection Store)

**Category:** Infrastructure

---

## Overview

Observability keeps bounded in-memory streams of token usage, VFS mutations, agent decisions, Arena results and core-file changes, and assembles them into one dashboard object. Some streams also append JSON Lines files under `/.logs/` in the VFS. Dependencies are `Utils`, `EventBus`, `VFS`, and optional `ErrorStore`, `PerformanceMonitor`, `ReflectionStore`, `PromptScoreMap` (`observability.js:11`).

Cost figures come from a fixed per-1K-token table with a default row (`observability.js:75-85`). They are rough estimates, not billing data.

## Exports

Returned by the factory (`observability.js:416-437`). There is no `getSessionStats` or `getUsageByModel`; session and per-model totals come from `getTokenUsage()`.

| Function | Behavior | Source |
| --- | --- | --- |
| `init()` | Loads errors from ErrorStore (newest 200), wires EventBus once | `:407-414` |
| `recordTokens(usage)` | Adds `inputTokens`/`outputTokens` (or a word-count estimate from `inputText`/`outputText`) to session and per-model totals; keeps the last 100 requests; emits `observability:tokens` | `:92-129` |
| `getTokenUsage()` | `{ session: { input, output, total, estimatedCost }, byModel, history }` | `:131-141` |
| `estimateCost(model, inputTokens, outputTokens)` | Table lookup, `default` row for unknown models | `:87-90` |
| `recordMutation(pathOrEntry, op, beforeBytes, afterBytes, meta)` | Keeps the last 1,000 in memory; the overflowed entry is appended to `/.logs/mutations/<date>.jsonl`; ignores paths under `/.logs/`; emits `observability:mutation` | `:144-172` |
| `getMutations(limit = 100)` | Most recent mutations | `:174-177` |
| `recordDecision(decisionOrGoal, ...)` | Keeps the last 200; always appends to `/.logs/decisions/<date>.jsonl`; context and reasoning truncated to 2,000 characters; emits `observability:decision` | `:180-203` |
| `getDecisions(limit = 50)` | Most recent decisions | `:205-208` |
| `recordArenaResult(result)` | Keeps the last 100; emits `observability:arena_result` | `:233-249` |
| `getArenaResults(limit = 20)` | Most recent Arena results | `:270-273` |
| `getSuccessRate(windowSize = 10)` | Pass rate over the window, with counts and timestamps | `:251-268` |
| `isSubstrateChange(path)` | True for paths under `/core/` or `/infrastructure/` | `:276-281` |
| `recordSubstrateChange(change)` | Always appends to `/.logs/substrate/<date>.jsonl`; emits `observability:substrate_change` | `:283-303` |
| `getDashboard()` | Tokens, recent mutations/decisions/Arena results, success rate, optional PerformanceMonitor metrics, errors | `:306-334` |

## Event subscriptions

Wired by `init()` (`observability.js:337-405`).

| Event | Action |
| --- | --- |
| `vfs:file_changed` | `recordMutation` with `source: 'vfs'` |
| `agent:decision` | `recordDecision` |
| `llm:complete` | `recordTokens` |
| `error:added` / `error:cleared` | Mirror the ErrorStore list (bounded to 200) |
| `arena:complete` | `recordArenaResult` with `passed = summary.passRate >= 80`; also writes a ReflectionStore entry and a PromptScoreMap score when those modules are present |

## Events emitted

`observability:tokens`, `observability:mutation`, `observability:decision`, `observability:arena_result`, `observability:substrate_change`.

## Boundaries

- Observability records; it never approves, rejects or rolls back a change. The 80% Arena threshold only labels a result.
- Token counts without provider usage are estimates (`words / 0.75`, `:41-45`).

---
