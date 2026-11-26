# Blueprint 0x000063: Cognition API

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/cognition/cognition-api.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/cognition/cognition-api.js`

**Former Blueprint Paths:** `self/blueprints/0x000063-cognition-api.md`
**Module:** `CognitionAPI` (version 1.0.0, type `capability`)
**File:** `self/capabilities/cognition/cognition-api.js`
**Genesis level:** `cognition` (`self/config/genesis-levels.json`)
**Dependencies:** `Utils`, `EventBus`, `SemanticMemory`, `KnowledgeGraph`, `RuleEngine`, `SymbolGrounder`
**Purpose:** One facade over semantic memory and symbolic reasoning, with a circuit breaker per subsystem.

## Contract

There is no `think(query, mode)` function and no synthesis step. The facade exposes three namespaces (`semantic`, `symbolic`, `learning`) and a `query` function that chains them. Model inference is not part of it; the agent loop calls the model itself.

### Circuit breakers

Each namespace has a breaker (`:49-56`, `:92-131`). Three failures open it; it closes again 60 s after the last failure. A success lowers the failure count by one. While a breaker is open, or a subsystem is disabled in config, calls return a neutral value instead of throwing: `enrich` returns the input context, `search` returns `[]`, `store` returns `null`, `validate` returns `{ valid: true, skipped: true, violations: [] }`, `infer` returns `[]`, `extract` returns `{ learned: false, deferred: true }`. `embed` returns `null` when skipped but rethrows errors.

### Configuration

`_config` (`:41-46`): `semantic.enabled` and `symbolic.enabled` come from `window.getCognitionConfig()` (defined in `self/kernel/boot.js:228`) and default to true; `learning` is `{ enabled: true, autoLearn: true, minConfidence: 0.8 }`. `configure(newConfig)` merges per namespace.

## Exports

Returned object at `cognition-api.js:452-463`.

| Export | Line | Behavior |
| --- | --- | --- |
| `init()` | 60 | `KnowledgeGraph.init()` and `RuleEngine.init()` in parallel, then `SemanticMemory.init()`. |
| `semantic.enrich(query, context)` | 136 | `SemanticMemory.enrich`. |
| `semantic.search`, `semantic.store`, `semantic.embed`, `semantic.getStats` | 152, 168, 184, 199 | Pass-through to `SemanticMemory`. |
| `symbolic.validate(response, context)` | 205 | `SymbolGrounder.ground(response)` then `RuleEngine.validate()`; returns `{ valid, violations, suggestions, grounding }`. |
| `symbolic.infer()` | 232 | `RuleEngine.infer()`. |
| `symbolic.addEntity`, `getEntity`, `addTriple`, `query`, `addRule`, `addConstraint`, `getStats` | 248-258 | Pass-through to `KnowledgeGraph` and `RuleEngine`. |
| `learning.extract(response, context)` | 264 | Grounds the response, keeps new entities and relations at or above `minConfidence`, and when `autoLearn` is on calls `SymbolGrounder.integrateGrounding` and stores responses longer than 50 characters in semantic memory. |
| `learning.feedback(responseId, quality, corrections)` | 319 | Emits an event only; no learning happens. |
| `query(input, options)` | 332 | Enrichment, then validation and learning when `input.response` is present; each phase can be turned off with `useSemanticEnrichment`, `useSymbolicValidation`, `enableLearning` set to false. |
| `configure`, `getConfig`, `getStatus`, `healthCheck`, `dispose` | 397, 408, 412, 422, 446 | Configuration, breaker state, liveness probe, shutdown. |

## Known gaps

- `symbolic.validate` grounds the response but calls `RuleEngine.validate()` with no facts, so constraints are checked against the whole knowledge graph, not against the grounded response. Grounding still adds new entities to the graph as a side effect ([0x000062](0x000062-symbol-grounder.md)).
- `learning.extract` filters entities and relations by confidence, but `integrateGrounding` writes relations and all two-argument facts; the entity filter has no effect on what is written, and the facts are not filtered.

## Callers

| Caller | Use | Source |
| --- | --- | --- |
| Lab strategy cycle | `semantic.enrich` on the last user message before each model call | `packages/reploid/src/agent/lab-strategy-cycle.js:275-287` |
| Lab strategy generation | `symbolic.validate` and `learning.extract` after each model response; a failed validation is logged at debug level and does not block the cycle | `packages/reploid/src/agent/lab-strategy-generation.js:350-365` |
| Cognition panel | `symbolic.infer`, `getStatus` | `self/ui/panels/cognition-panel.js:157-161`, `:266` ([0x00007A](0x00007A-cognition-panel.md)) |

Because `learning.extract` runs on every response with `autoLearn` on, model output enters the knowledge graph and semantic memory without review.

## Events

| Event | Payload | Line |
| --- | --- | --- |
| `cognition:status` | `{ subsystem: 'all', state: 'ready' }` | 78 |
| `cognition:degraded` | `{ subsystem, reason }` when a breaker opens | 117 |
| `cognition:learning:extract` | `{ entities, relations }` | 301 |
| `cognition:learning:feedback` | `{ responseId, quality, corrections }` | 321 |
| `cognition:query:start`, `cognition:query:complete`, `cognition:query:error` | `{ queryId, ... }` | 336, 380, 387 |

## Related blueprints

- [0x00005F Semantic Memory](0x00005F-semantic-memory.md), [0x000060 Knowledge Graph](0x000060-knowledge-graph.md), [0x000061 Rule Engine](0x000061-rule-engine.md), [0x000062 Symbol Grounder](0x000062-symbol-grounder.md).
- [0x00004F Event Bus Infrastructure](0x00004F-event-bus-infrastructure.md).
