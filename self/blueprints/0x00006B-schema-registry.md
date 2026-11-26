# Blueprint 0x00006B: Schema Registry

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/schema-registry.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/schema-registry.js`

**Former Blueprint Paths:** `self/blueprints/0x00006B-schema-registry.md`
**Module:** `SchemaRegistry`
**File:** `core/schema-registry.js`
**Purpose:** Registry for tool input schemas, tool output schemas and worker type definitions.

**Genesis Level:** capsule (`self/config/genesis-levels.json`; the module metadata declares `genesis: { introduced: 'capsule' }`)

---

## Purpose

The Schema Registry holds the input schema and `readOnly` flag for each tool the current boot mode exposes, plus any runtime-registered tool and worker schemas. Built-in entries are registered at `init` and are never persisted; non-built-in entries are persisted to the VFS. Callers use `isToolReadOnly` to decide which calls may run in parallel (for example `packages/reploid/src/agent/lab-strategy.js:86`).

Dependencies declared in metadata (`self/core/schema-registry.js:16`): `Utils`, `VFS`, optional `SchemaValidator`.

---

## Exports

Returned by the factory at `self/core/schema-registry.js:523`.

| Export | Source | Behavior |
| --- | --- | --- |
| `init()` | `:508` | Registers built-in schemas for the tools named by `getToolNamesForMode(mode)` (`shared/config/tool-surfaces.js`), then loads persisted non-built-in schemas. |
| `registerToolSchema(name, schema, { builtin })` | `:199` | Synchronous. Stores the schema; persists when not built-in. |
| `unregisterToolSchema(name)` | `:208` | Refuses built-in entries (returns `false`); otherwise deletes and persists. |
| `getToolSchema(name)` | `:216` | Schema or `null`. |
| `isToolReadOnly(name)` | `:222` | The schema's `readOnly` flag when set; otherwise `true` only for the fallback names `Grep`, `Find`, `FileOutline`, `Head`, `Tail`. |
| `getReadOnlyTools()` | `:235` | Registered read-only names plus the same fallback names. |
| `listToolSchemas()` | `:252` | Array of `{ name, schema, builtin }`. |
| `registerWorkerTypes(map, { builtin })`, `getWorkerType(name)`, `listWorkerTypes()` | `:260`-`:272` | Worker type definitions, persisted when not built-in. |
| `validateSchema(value, schema)` | `:290` | Simplified JSON-schema check returning `{ valid, errors }`. |
| `validateCombinedOutput(outputs, taskSchema)` | `:339` | Validates each expert output for FunctionGemma orchestration ([0x00007D](0x00007D-capabilities-intelligence-functiongemma-orchestrator.md)). |
| `mergeOutputs(outputs, strategy)` | `:377` | `voting`, `weighted` (default) or `concatenate`. |
| `registerOutputSchema`, `getOutputSchema`, `validateToolOutput`, `setOutputValidationEnabled`, `isOutputValidationEnabled` | `:455`-`:501` | Output-schema checks delegated to `SchemaValidator` when present. |

## Built-in tool schemas

`DEFAULT_TOOL_SCHEMAS` (`:35`) defines `ReadFile`, `WriteFile`, `Promote`, `EditFile`, `ListFiles`, `DeleteFile`, `CreateTool`, `ListTools` and `LoadModule`. `ReadFile`, `ListFiles` and `ListTools` are `readOnly: true`; the rest are mutating. `WriteFile` and `EditFile` parameters come from `self/config/file-tool-schemas.json`. Only the names in the boot mode's tool surface are registered, so a Zero boot does not expose every entry.

## Persistence

Non-built-in tool and worker schemas are written to `/.system/schemas.json` as `{ tools, workers }` (`:24`, `:143`). On load, persisted entries never replace an entry already registered under the same name. A missing file is not an error.

---

## Dependencies

| Blueprint | Module | Purpose |
|-----------|--------|---------|
| [0x000003](0x000003-core-utilities-and-error-handling.md) | Utils | Logger |
| [0x000011](0x000011-advanced-storage-backend-indexeddb.md) | VFS | Persistence of non-built-in schemas |

---
