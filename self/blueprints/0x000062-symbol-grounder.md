# Blueprint 0x000062: Symbol Grounder

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/cognition/symbolic/symbol-grounder.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/cognition/symbolic/symbol-grounder.js`

**Former Blueprint Paths:** `self/blueprints/0x000062-symbol-grounder.md`
**Module:** `SymbolGrounder` (version 1.0.0, type `service`)
**File:** `self/capabilities/cognition/symbolic/symbol-grounder.js`
**Genesis level:** `cognition` (`self/config/genesis-levels.json`)
**Dependencies:** `Utils`, `EventBus` (declared, unused), `KnowledgeGraph`, `SemanticMemory`
**Purpose:** Turn model output text into knowledge-graph entities, relations and facts using regular expressions.

## Contract

The grounder does not map symbols to tools or callbacks; there is no `ground(symbol, grounding)`, `resolve` or `execute`, and it does not depend on `ToolRunner`. It reads text and proposes graph content.

`ground(text, context)` (`:42-77`) returns `{ entities, newEntities, relations, facts }` in four steps:

1. **Mentions** (`extractMentions`, `:81-124`). Regular expressions in `PATTERNS` (`:22-29`) find tool names after `TOOL_CALL:` or `TOOL:`, file paths, backtick code references, `Error:`/`Exception:`/`Failed:` messages, URLs and numbers; each gets confidence 0.9. Capitalized phrases longer than three characters, except common sentence starters, get confidence 0.6 (`:126-145`).
2. **Linking** (`linkMention`, `:149-231`). A mention links to an existing entity when its label match score exceeds 0.8 (`computeMatchScore`, `:233`). If the best score is below 0.6, it tries `SemanticMemory.search(mention, { topK: 1 })` and links when similarity exceeds 0.7 and an entity has that label. Otherwise a mention with confidence above 0.7 becomes a new entity with source `grounding`.
3. **Relations** (`extractRelations`, `:276-328`). Patterns for `isA`, `uses`, `dependsOn`, `produces` and `failedWith` connect two linked mentions with confidence 0.7 and source `pattern-extraction`.
4. **Facts** (`extractFacts`, `:332-375`). `toolExecuted(tool, cycle)`, `failedExecution(tool, cycle)` when the text contains `Error:` or `Failed`, and `fileModified(path, cycle)` after "wrote", "created" or "modified".

`integrateGrounding(grounding)` (`:390-420`) writes relations and two-argument facts to the knowledge graph as triples.

## Side effects and limits

- Grounding is not read-only. Step 2 calls `KnowledgeGraph.addEntity` for every new high-confidence mention, before the caller decides whether to integrate. Because every pattern match has confidence 0.9, each new number, path, URL or backtick span in the text becomes an entity.
- Tool detection recognizes only the legacy `TOOL_CALL:` / `TOOL:` markers. The primary `REPLOID/0` response format (see [0x00006A](0x00006A-response-parser.md)) produces no `toolExecuted` or `failedExecution` facts.
- Linking scans every entity for every mention; cost grows with graph size.

## Exports

Returned object at `symbol-grounder.js:422-429`.

| Export | Line | Behavior |
| --- | --- | --- |
| `ground(text, context)` | 42 | Full pipeline; empty or non-string text returns empty lists. |
| `groundBatch(texts, context)` | 379 | Sequential `ground` over a list. |
| `extractMentions(text)` | 81 | Step 1 only. |
| `extractRelations(text, groundedEntities)` | 276 | Step 3 only. |
| `extractFacts(text, context)` | 332 | Step 4 only. |
| `integrateGrounding(grounding)` | 390 | Writes relations and facts to the graph. |

The module emits no events itself; `KnowledgeGraph` emits `cognition:symbolic:add` for each entity and triple it creates.

## Related blueprints

- [0x000060 Knowledge Graph](0x000060-knowledge-graph.md): entity and triple store.
- [0x00005F Semantic Memory](0x00005F-semantic-memory.md): fallback linking.
- [0x000063 Cognition API](0x000063-cognition-api.md): the only caller, through `symbolic.validate` and `learning.extract`.
