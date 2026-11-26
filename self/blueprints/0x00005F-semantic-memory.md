# Blueprint 0x00005F: Semantic Memory

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/cognition/semantic/semantic-memory-llm.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/cognition/semantic/semantic-memory-llm.js`

**Former Blueprint Paths:** `self/blueprints/0x00005F-semantic-memory.md`
**Module:** `SemanticMemory` (object `SemanticMemoryLLM`, version 2.0.0, type `capability`)
**File:** `self/capabilities/cognition/semantic/semantic-memory-llm.js`
**Genesis level:** `cognition` (`self/config/genesis-levels.json`)
**Dependencies:** `Utils`, `EventBus`, `VFS`, `LLMClient`
**Purpose:** Store short text memories with keyword tags and retrieve them by tag and word overlap.

## Contract

There is no `semantic-memory.js` and no `remember`/`recall` API. The module registered as `SemanticMemory` is `semantic-memory-llm.js`. Despite the file name, it makes no model calls: `extractTags` (`:72-78`) always uses the keyword fallback (`:80-91`), which takes the six most frequent words of 3–15 letters after removing stop words. `LLMClient` is declared but unused.

Retrieval is lexical. `search` (`:175-228`) scores each memory by 2 points per shared tag plus 0.5 per shared word, keeps the top `rerankTopK` (10), rescales to 0–10 against the best candidate, drops scores below `minRelevanceScore` (3), and returns `similarity = score / 10`. A result's similarity is relative to the best candidate in that query, not an absolute measure.

`embed` (`:265-274`) exists for callers that expect vectors: it sets one slot per tag hash in a 384-slot array. It is not a learned embedding.

## Storage

| Path | Content | Source |
| --- | --- | --- |
| `/.memory/semantic-memories.jsonl` | All memories, rewritten in full on each save | `:25`, `:65-68` |
| `/.memory/semantic-index.json` | Tag → memory IDs | `:26` |

Limits (`CONFIG`, `:29-35`): `maxMemories` 1000 (a store that exceeds it drops the oldest memory, `:158`), `topKDefault` 5, `rerankTopK` 10, `minRelevanceScore` 3. `maxTagsPerMemory` (10) is declared but unused; the fallback returns at most six tags. `store` ignores text shorter than 20 characters and keeps the first 2,000 characters. `prune` (`:372-389`) drops memories older than 30 days.

## Exports

Returned object at `semantic-memory-llm.js:413-426`.

| Export | Line | Behavior |
| --- | --- | --- |
| `init()` | 119 | Loads both files and subscribes to `agent:history`. |
| `store(text, metadata)` | 131 | Adds a memory with tags, `domain` (default `general`) and `source` (default `assistant`); returns its ID or `null`. |
| `search(query, { topK })` | 175 | Returns `{ id, content, similarity, domain, timestamp, tags }`. |
| `enrich(query, context)` | 234 | Inserts one `system` message with up to three memories before the first non-system message; returns `context` unchanged on failure. |
| `embed(text)`, `embedBatch(texts)` | 265, 415 | Tag-hash vectors. |
| `cosineSimilarity(a, b)` | 286 | Delegates to `capabilities/cognition/vector-math.js`. |
| `routeToExpert(task, experts)` | 391 | Tag overlap between `task.description` and each expert's `specialization`; returns the top `task.topK` (default 1) experts. Labelled a FunctionGemma compatibility export; no caller in `self/` uses it. |
| `prune()`, `getStats()`, `clear()`, `dispose()` | 372, 341, 351, 363 | Maintenance; `dispose` removes the `agent:history` listener. |

## Events

| Direction | Event | Payload | Line |
| --- | --- | --- | --- |
| Listens | `agent:history` | `llm_response` longer than 100 characters, or `tool_result` longer than 100 characters, is queued and stored in batches of 5 every 5 s | 125, 293-339 |
| Emits | `cognition:semantic:store` | `{ id, tags }` | 169 |
| Emits | `cognition:semantic:search` | `{ query (first 50 chars), candidates, results }` | 218 |

The automatic learning path stores assistant output and tool results without review. Anything a tool returns can therefore enter later prompts through `enrich`.

## Related blueprints

- [0x00005E Embedding Store](0x00005E-embedding-store.md): vector store that receives `embed` output as query vectors.
- [0x000063 Cognition API](0x000063-cognition-api.md): wraps `search`, `store`, `enrich` and `embed` behind circuit breakers.
- [0x00004F Event Bus Infrastructure](0x00004F-event-bus-infrastructure.md).
