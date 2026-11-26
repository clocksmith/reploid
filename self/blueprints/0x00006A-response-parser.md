# Blueprint 0x00006A: Response Parser

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/response-parser.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/response-parser.js`

**Former Blueprint Paths:** `self/blueprints/0x00006A-response-parser.md`
**Module:** `ResponseParser`
**File:** `core/response-parser.js` (a one-line re-export of `shared/vendor/reploid/agent/response-parser.js`, which is the vendored copy of `packages/reploid/src/agent/response-parser.js`)
**Purpose:** Extract tool calls and completion signals from model text.

**Genesis Level:** capsule (`self/config/genesis-levels.json`; the module metadata declares `genesis: { introduced: 'capsule' }`)

---

## Purpose

The Response Parser turns free-form model text into a list of tool calls and decides whether a turn signals completion. The primary format is the `REPLOID/0` line protocol taught in `self/prompts/kernel.md`. The older `TOOL_CALL:` / `ARGS:` JSON format is still parsed as a legacy fallback during migration.

---

## Exports

The factory (`packages/reploid/src/agent/response-parser.js:16`) depends on `Utils` (`logger`, `sanitizeLlmJsonRespPure`) and returns exactly two functions (`:680`). There is no `validateToolCall`; argument validation belongs to the tool runner and schema registry ([0x00006B](0x00006B-schema-registry.md)).

| Export | Source | Behavior |
| --- | --- | --- |
| `parseToolCalls(text)` | `:647` | Returns `[{ name, args }]`, or `{ name, args, error }` for a call that could not be parsed. Tries `REPLOID/0` directives first (`:305`); if none are found, legacy `TOOL_CALL:` + `ARGS:` blocks (`:607`); if none, inline legacy `TOOL_CALL: Name {...}` (`:625`). Empty input returns `[]`. |
| `isDone(text)` | `:663` | Returns `true` when any line starts with `DONE:`, `IDLE:` or `PARK:` (case-insensitive), or when the text contains the bare word `DONE`, `GOAL_ACHIEVED` or `GOAL_COMPLETE`. Otherwise `false`. It never forces continuation. |

## REPLOID/0 protocol

```
REPLOID/0

TOOL: WriteFile
path: /artifacts/notes/example.json
content <<JSON
{ "status": "checked" }
JSON
```

| Directive | Meaning |
| --- | --- |
| `REPLOID/<n>` | Protocol header line; skipped by the parser. |
| `TOOL: Name` | Starts one call. Arguments follow as `key: value` lines, inline `key: value` pairs or a JSON object on the same line. |
| `key <<MARKER` … `MARKER` | Literal multiline block argument. A missing end marker yields `Unterminated block for <key>`. |
| `key: \|` | Pipe block argument that runs until the next directive boundary. |
| `---` | Separates calls in one batch. |
| `PLAN:` | JSON array (or `{ steps: [...] }`) of `{ id, after, tool, args }` steps, expanded into calls by `parsePlanCalls` (`:255`). |
| `EVIDENCE:`, `MILESTONE:`, `DONE:`, `IDLE:`, `PARK:` | Directive boundaries; `DONE:`, `IDLE:` and `PARK:` also end the turn through `isDone`. |

## Legacy JSON arguments

Legacy blocks use a brace-counting reader (`readJsonObjectAt`, `:520`) that treats `"` and backtick as string delimiters and honors backslash escapes inside strings. The extracted text passes through `sanitizeLlmJsonRespPure` before `JSON.parse`. A parse failure returns the call with empty `args` and an `error`, adding a hint when the content contains literal newlines.

---

## Dependencies

| Blueprint | Module | Purpose |
|-----------|--------|---------|
| [0x000003](0x000003-core-utilities-and-error-handling.md) | Utils | Logger and JSON sanitizer |

---
