# Blueprint 0x00005E: Embedding Store

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/cognition/semantic/embedding-store.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/cognition/semantic/embedding-store.js`

**Former Blueprint Paths:** `self/blueprints/0x00005E-embedding-store.md`
**Module:** `EmbeddingStore` (version 3.0.0, type `service`)
**File:** `self/capabilities/cognition/semantic/embedding-store.js`
**Genesis level:** `cognition` (`self/config/genesis-levels.json`)
**Dependencies:** `Utils`, `VFS`
**Purpose:** VFS-backed storage and vector search for memory records that already carry an embedding.

## Contract

EmbeddingStore stores and searches vectors; it does not compute them. Callers pass `memory.embedding` into `addMemory` and a query vector into the search functions. Query vectors in the current code come from `SemanticMemory.embed` (see [0x00005F](0x00005F-semantic-memory.md)), which returns a 384-slot tag-hash vector, not a learned embedding.

Known gap: the only writer, `MemoryManager.indexForRetrieval` (`core/memory-manager.js:434-452`), calls `addMemory` without an `embedding` field. The vector searches skip records without an embedding, so those records are reachable only through the listing functions (`getRecentMemories`, `searchByTimeRange`, `getSessionMemories`) until a writer supplies vectors.

Callers include `core/memory-manager.js` (`addMemory`, `searchSimilar`, `getAllMemories`, `deleteMemory`, `getStats`), `capabilities/cognition/hybrid-retrieval.js` (`searchWithRetention`, `getRecentMemories`) and `capabilities/cognition/prompt-memory.js` (`getMemory`, `updateMemory`).

The module emits no EventBus events.

## Storage layout

| Path | Content | Source |
| --- | --- | --- |
| `/.memory/embeddings/{id}.json` | One memory record: `id`, `content`, `embedding`, `domain`, `timestamp`, `accessCount`, `source`, `metadata` | `embedding-store.js:27`, `:82-100` |
| `/.memory/vocab.json` | Token map: `token`, `frequency`, `lastSeen`, `domains` | `embedding-store.js:28`, `:179-193` |

Every search reads every record file through `getAllMemories` (`:107`). There is no index; cost grows linearly with the number of records.

## Exports

Returned object at `embedding-store.js:524-549`.

| Export | Line | Behavior |
| --- | --- | --- |
| `init()` | 74 | Creates the memory directory once. |
| `addMemory(memory)` | 82 | Writes a record; ID from `memory.id` or `generateId('mem')`; `accessCount` starts at 0. |
| `addMemoryWithSession(memory, sessionId)` | 333 | `addMemory` with `metadata.sessionId` and `metadata.timestamp`. |
| `getMemory(id)`, `getAllMemories()` | 102, 107 | Read one or all records; read failures return `null` / `[]`. |
| `deleteMemory(id)`, `updateMemory(id, updates)` | 135, 474 | Delete; shallow `Object.assign` update. |
| `searchSimilar(vector, topK = 5, minSimilarity = 0.5)` | 150 | Cosine similarity over all records with a non-empty embedding; returns `{ memory, similarity }` and increments `accessCount` of each hit. |
| `searchWithRetention(vector, { topK = 10, minSimilarity = 0.3, retentionWeight = 0.3 })` | 381 | Score = `similarity × (1 − w) + retention × w`; also increments `accessCount`. |
| `searchWithContiguity(vector, { topK, minSimilarity, contiguityWindowMs = 60000, contiguityBoost = 0.15 })` | 275 | Adds `contiguityBoost` to hits that have another hit within the time window. |
| `searchByTimeRange(start, end, { limit = 100, domain })` | 261 | Time and domain filter, newest first. |
| `getRecentMemories(count = 20, domain)`, `getSessionMemories(sessionId)` | 317, 326 | Recency and session listings. |
| `updateVocabulary(tokens)`, `getVocabulary()` | 179, 195 | Token frequency map. |
| `pruneOldMemories(maxAge = 7 days)` | 203 | Deletes only the excess above `MAX_MEMORIES` (10,000), choosing records older than `maxAge` with the lowest `accessCount`. Below the cap it deletes nothing. |
| `pruneByRetention()` | 430 | Deletes records whose retention has reached `minRetentionScore`. |
| `computeRetentionScore(memory)` | 353 | See below. |
| `updateAccessCount(id)`, `updateImportance(id, importance)` | 126, 456 | Importance is clamped to 0–1 in `metadata.importance`. |
| `getMemoriesByRetention()` | 488 | Buckets: strong ≥ 0.7, moderate ≥ 0.4, weak ≥ 0.2, fading below. |
| `configureForgetting(config)` | 519 | Merges into the forgetting configuration. |
| `getStats()`, `clear()` | 229, 243 | Counts and full wipe of records and vocabulary. |

## Retention score

`embedding-store.js:32-37`, `:353-371`:

- `strength = decayHalfLifeMs × (1 + accessCount × accessBoostFactor + importance × importanceBoostFactor)`
- `retention = max(minRetentionScore, e^(−age / strength))`
- Defaults: `decayHalfLifeMs` 7 days, `accessBoostFactor` 0.15, `importanceBoostFactor` 0.25, `minRetentionScore` 0.1.

Despite its name, `decayHalfLifeMs` is the exponential time constant, not a half-life: an unaccessed record with no importance has retention e^−1 ≈ 0.37 after 7 days. Because the score is clamped to the floor, `pruneByRetention` removes every record whose decay has reached the floor.

## Related blueprints

- [0x00005F Semantic Memory](0x00005F-semantic-memory.md): produces the vectors this store holds.
- [0x000068 Hierarchical Memory Architecture](0x000068-hierarchical-memory-architecture.md): `MemoryManager`, the main caller.
