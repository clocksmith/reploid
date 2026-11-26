# Blueprint 0x000060: Knowledge Graph

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/cognition/symbolic/knowledge-graph.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/cognition/symbolic/knowledge-graph.js`

**Former Blueprint Paths:** `self/blueprints/0x000060-knowledge-graph.md`
**Module:** `KnowledgeGraph` (version 1.0.0, type `service`)
**File:** `self/capabilities/cognition/symbolic/knowledge-graph.js`
**Genesis level:** `cognition` (`self/config/genesis-levels.json`)
**Dependencies:** `Utils`, `VFS`, `EventBus`
**Purpose:** Entities plus subject–predicate–object triples with confidence, persisted in the VFS.

## Contract

The graph is a set of entities and a list of triples, not nodes and edges. There is no `addNode`, `addEdge` or `getNeighbors`; the old `{ from, to, relation }` pattern does not exist. A triple is `{ id, subject, predicate, object, metadata: { confidence, source, timestamp, provenance } }`. The object may be an entity ID or a literal.

- `addTriple` (`:170-223`) auto-creates an entity for an unknown string subject. A duplicate `(subject, predicate, object)` is not added again; its confidence is raised if the new one is higher, and the existing ID is returned.
- Default triple confidence is 0.8 with source `llm`; default entity confidence is 1.0 with source `system`.
- Every mutation rewrites both files (`save`, `:65-73`).
- `MAX_ENTITIES` (10,000) and `MAX_TRIPLES` (50,000) are reported by `getStats` but not enforced.

## Storage

| Path | Content | Source |
| --- | --- | --- |
| `/.memory/knowledge-graph-entities.json` | `{ entities: [[id, entity], ...], version: 1 }` | `:22`, `:70` |
| `/.memory/knowledge-graph-triples.jsonl` | One triple per line | `:23`, `:72` |

In memory, subject, predicate and object indexes map a key to triple positions (`:31-33`); they are rebuilt after any deletion.

## Exports

Returned object at `knowledge-graph.js:404-423`.

| Export | Line | Behavior |
| --- | --- | --- |
| `init()` | 38 | Loads both files; corrupt files are logged and skipped. |
| `addEntity({ id, types, labels, properties, confidence, source, metadata })` | 109 | Defaults: `types: ['Entity']`, `labels: { en: id }`; ID from `generateId('ent')` when absent. |
| `getEntity(id)`, `getAllEntities()` | 134, 164 | Reads. |
| `updateEntity(id, updates)` | 138 | Shallow merge; refreshes `metadata.timestamp`. |
| `deleteEntity(id)` | 150 | Also removes every triple whose subject or object is the entity. |
| `addTriple(subject, predicate, object, metadata)` | 170 | See Contract. |
| `getTriple(id)`, `deleteTriple(id)` | 225, 229 | Read and delete by triple ID. |
| `query({ subject, predicate, object, minConfidence })` | 242 | Conjunctive filter; `query({})` returns every triple. |
| `queryEntities({ type, hasProperty, label })` | 270 | Label match is a case-insensitive substring match. |
| `getRelatedEntities(entityId, predicate)` | 291 | Entities linked by outgoing or incoming triples. |
| `decayConfidence()` | 314 | For `source: 'llm'` triples, multiplies confidence by 0.999 per hour since `timestamp`; removes triples that fall below 0.3. |
| `prune()` | 351 | Removes entities that appear in no triple, except `source: 'system'`. |
| `getStats()`, `clear()`, `exportGraph()`, `importGraph(data)` | 377, 385, 395, 397 | Maintenance and serialization. |

Two cautions on `decayConfidence`: it does not reset `timestamp`, so repeated calls compound the decay; and nothing in `self/` calls it today, so LLM-sourced triples do not decay in practice.

## Events

| Event | Payload | Line |
| --- | --- | --- |
| `cognition:symbolic:add` | `{ type: 'entity', id }` | 128 |
| `cognition:symbolic:add` | `{ type: 'triple', id }` (new triples only, not duplicates) | 219 |

`RuleEngine` subscribes to `cognition:symbolic:add` ([0x000061](0x000061-rule-engine.md)).

## Writers

- `RuleEngine.infer` writes derived two-argument facts with source `inferred` ([0x000061](0x000061-rule-engine.md)).
- `SymbolGrounder` creates entities while linking mentions and writes relations and facts in `integrateGrounding` ([0x000062](0x000062-symbol-grounder.md)).
- `CognitionAPI.symbolic` exposes `addEntity`, `getEntity`, `addTriple` and `query` ([0x000063](0x000063-cognition-api.md)).
- The cognition panel reads the graph ([0x00007A](0x00007A-cognition-panel.md)).
