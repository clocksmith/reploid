# Blueprint 0x000003: Core Utilities and Error Handling

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/shared/core/utils.js`, `/tests/unit/utils-core.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/utils.js`

**Former Blueprint Paths:** `self/blueprints/0x000003-core-utilities-and-error-handling.md`
**Objective:** Provide the dependency-free base module every other module receives as `Utils`: typed errors, a logger with recent history, ID and string helpers, a tolerant JSON extractor for model output, and the subscription tracker the event bus uses.

**Prerequisites:** None

**Affected Artifacts:** `shared/core/utils.js` (served at `/self/core/utils.js`)

---

### 1. Location

The source file is `shared/core/utils.js`. It moved from `self/core/` to `shared/` (commit `3d8f2a118`) because both the substrate and the product load it; the served tree still exposes it at `/self/core/utils.js`, and the module inventory lists it as `core/utils.js`. Host files import it directly, for example `self/host/start-app.js` imports `../../shared/core/utils.js`.

Module metadata: `id: 'Utils'`, `genesis: { introduced: 'tabula' }`, no dependencies, `type: 'pure'`. The DI container is created with `Utils.factory()` ([0x000042](0x000042-dependency-injection-container.md)).

### 2. Interface

`Utils.factory()` returns:

| Member | Behavior |
| --- | --- |
| `Errors` | `ApplicationError` (sets `name`, `details`, `timestamp`) and its subclasses `ApiError` (adds `status`), `StateError`, `ArtifactError`, `ValidationError`, `AbortError`, `ToolError`, `ConfigError` |
| `logger` | `debug`, `info`, `warn`, `error` write to the matching `console` method with a `[LEVEL]` prefix and keep the last 100 entries `{ ts, level, msg, data }`; `getStats()`, `getHistory()`, `clearHistory()` |
| `generateId(prefix = 'id')` | `<prefix>_<base36 time>_<8 random base36 chars>`; not cryptographically random |
| `trunc(str, len)` | Truncates with `...` inside `len` |
| `kabobToCamel(s)` | `kebab-case` to `camelCase` |
| `escapeHtml(text)` | Escapes `& < > " '` |
| `sanitizeLlmJsonRespPure(text)` | Returns `{ json, method }`, trying in order: direct parse, backtick-string conversion, a fenced code block, the outermost `{...}`, and that span with backtick conversion. On failure `{ json: '{}', method: 'failed' }`. |
| `createSubscriptionTracker()` | `{ track(id, unsubscribe), unsubscribeAll(id) }`, used by [0x00004F](0x00004F-event-bus-infrastructure.md) |
| `parseCatsBundle`, `generateCatsBundle`, `parseDogsBundle`, `generateDogsBundle` | Read and write the older Markdown context-bundle (`vfs-file` blocks) and change-proposal (`paws-change` blocks) formats. No current module calls them. |

Each `factory()` call creates its own logger state, so two `Utils` instances do not share log history.

### 3. Rules

- No I/O other than `console` output.
- Error classes are created per factory call; compare errors by `name`, not with `instanceof` across instances.

### 4. Verification

`tests/unit/utils-core.test.js` covers the errors, logger, helpers, JSON extraction and bundle parsers.
