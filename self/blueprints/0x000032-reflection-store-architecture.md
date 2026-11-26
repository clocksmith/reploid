# Blueprint 0x000032: Reflection Store Architecture

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/reflection/reflection-store.js`, `/self/capabilities/reflection/reflection-analyzer.js`, `/tests/integration/reflection-system.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/reflection/reflection-analyzer.js`, `capabilities/reflection/reflection-store.js`

**Former Blueprint Paths:** `self/blueprints/0x000032-reflection-store-architecture.md`

**Modules:** `ReflectionStore` (version 1.0.0, genesis level `reflection`, type `capability`, async; dependencies `Utils`, `VFS`, `EventBus`) and `ReflectionAnalyzer` (version 1.0.0, genesis level `reflection`, type `intelligence`, async; dependencies `ReflectionStore`, `Utils`)

**Sources:** `self/capabilities/reflection/reflection-store.js`, `self/capabilities/reflection/reflection-analyzer.js`

---

## Purpose

The reflection store keeps a durable record of what the agent observed after its actions (tool successes and failures, insights, hypotheses), so later cycles and later sessions can use it. It also keeps two small learning tables for the FunctionGemma path: winning network configurations ("genomes") and per-adapter success counts.

A reflection is an observation. It is not evidence of improvement and grants no permission; recursive-improvement claims need a signed improvement episode ([RSI improvement episodes](../../docs/rsi-improvement-episodes.md)).

## Storage

All in the VFS under `/.memory/` (`reflection-store.js:22-24`):

| Path | Format | Content |
| --- | --- | --- |
| `/.memory/reflections.jsonl` | one JSON object per line | Reflections |
| `/.memory/genomes.json` | JSON | `{ taskType: { generations: [{ genome, fitness, timestamp }] } }` |
| `/.memory/adapter-stats.json` | JSON | `{ 'taskType:adapterId': { successes, attempts } }` |

`init()` loads all three into memory; a corrupt file is logged and reset to empty in memory. Every write rewrites the whole file, creating `/.memory` if needed. The in-memory copy is the source for queries.

## Reflection records

`add(entry)` stores `{ id: generateId('ref'), ts, type, content, context, tags, description }` (`type` defaults to `'insight'`, `description` to `content`), emits `reflection:added` and returns the ID.

`addHypothesis(entry)` validates the entry with `validateHypothesisReflection` from `self/core/improvement-episode.js`, then stores a `hypothesis` reflection whose `context` carries `episodeId`, `candidateId`, `outcome` and the validated hypothesis, tagged `hypothesis-driven` and `improvement-episode`.

`query(filterFn)` filters the cache synchronously. `getReflections({ outcome?, limit? })` filters on `context.outcome`, sorts newest first and truncates.

Writers include the agent tool path, which records each tool result with `context.outcome` of `'failed'` or `'successful'` (`packages/reploid/src/agent/lab-strategy-tools.js:242`), `self/core/functiongemma-orchestrator.js`, `self/infrastructure/observability.js`, `self/capabilities/system/doppler-optimizer.js` (hypotheses) and `self/capabilities/communication/swarm-sync.js:240`, which stores reflections received from peers tagged `shared_from_<peerId>` with `context.sharedFrom`. Peer reflections are untrusted data from that peer.

## Genomes and adapter statistics

- `storeNetworkGenome(taskType, genome, fitness)` keeps the 10 highest-fitness entries per task type and emits `reflection:genome:stored`. `getBestGenome`, `getGenomes`, `getAllWinnerConfigs`, `getGenomeTaskTypes`, `clearGenomes` read or clear them. `pruneOldGenomes({ maxAge = 30 days, keepTop = 3 })` drops old entries outside the top ones.
- `exportWinnerConfigs()` and `importWinnerConfigs(data, { merge = true, overwrite = false })` move genomes and adapter stats between instances.
- `updateAdapterStats(taskType, adapterId, success)` counts attempts and successes and emits `reflection:adapter:updated`; `getAdapterStats` reads them. `selectAdapterUCB1(taskType, adapterIds, explorationWeight = 2)` returns an untried adapter first, a random one when none has been tried, and otherwise the highest `mean + sqrt(weight * ln(total) / attempts)`.

The FunctionGemma orchestrator uses these at `functiongemma-orchestrator.js:429-447`. A UCB1 choice or a fitness ranking selects among already permitted options; it does not adopt a change.

## Reflection analyzer

`ReflectionAnalyzer` returns `{ init, api: { detectFailurePatterns } }`. `detectFailurePatterns()` reads the 50 newest reflections with `outcome: 'failed'`, groups them by the text before the first `:` in `content`, keeps groups with at least 2 entries and returns `[{ indicator, count, example }]`, most frequent first. For tool failures recorded by the agent, `content` is `Tool <name>`, so groups are per tool. The agent cycle reads it at `packages/reploid/src/agent/lab-strategy-cycle.js:193-194`.

## Boundaries and gaps

- There is no semantic or embedding search over reflections; earlier drafts planned a `ReflectionSearch` module that does not exist. Semantic memory is a separate module ([0x00005F](0x00005F-semantic-memory.md)).
- The store has no size limit or retention policy for reflections; the file grows until cleared.
- Rewriting the whole file on each write means concurrent tabs can lose entries.
- No widget exists; earlier drafts described one.

## Verification

`tests/integration/reflection-system.test.js` covers metadata, `init`, `add`, `query`, `getReflections` and `detectFailurePatterns`.

## Related blueprints

- [0x000008 Agent Cognitive Cycle](0x000008-agent-cognitive-cycle.md): writes tool reflections and reads failure patterns.
- [0x00002B Audit Logging Policy](0x00002B-audit-logging-policy.md): the security record, separate from this learning record.
- [0x00007D FunctionGemma Orchestrator](0x00007D-capabilities-intelligence-functiongemma-orchestrator.md): uses genomes and adapter statistics.
