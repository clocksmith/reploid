# Blueprint 0x00002B: Audit Logging Policy

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/audit-logger.js`, `/tests/unit/audit-logger.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/audit-logger.js`

**Former Blueprint Paths:** `self/blueprints/0x00002B-audit-logging-policy.md`

**Module ID:** `AuditLogger` (version 1.1.0, genesis level `substrate`, type `infrastructure`, async; dependencies `Utils`, `VFS`, optional `EventBus`, optional `TelemetryTimeline`)

**Source:** `self/infrastructure/audit-logger.js`

---

## Purpose

`AuditLogger` keeps a durable, append-only record in the VFS of security-relevant agent actions: tool runs, substrate writes, blocked writes, policy decisions, tool creation and worker spawns. The record supports review after the fact; it does not block or approve anything.

An earlier version of this blueprint described `init()` returning `{ init, api, widget }`, a `logModuleLoad` call, a `/.audit/` directory and a status widget. None of those exist. This blueprint describes the current module.

## Storage

- Directory: `/.logs/audit` (`LOG_DIR`, `audit-logger.js:21`).
- One file per UTC day: `/.logs/audit/YYYY-MM-DD.jsonl`, one JSON entry per line.
- Entry shape: `{ id, ts, type, severity, data }`, where `id` comes from `generateId('log')` and `ts` is an ISO time. Severity is `INFO`, `WARN` or `ERROR`.
- Each write reads the day's file, appends the line and writes it back. A failed write is retried once after 50 ms; a second failure is logged to the console as a lost audit event.
- When `TelemetryTimeline` is present, each written entry is also recorded there as `audit:<type>` with tag `audit`.

Ordinary VFS snapshots skip `/.logs/` unless asked to include it ([0x00003C](0x00003C-genesis-snapshot-system.md)).

## Interface

| Export | Behavior |
| --- | --- |
| `init()` | Returns `true`; nothing to set up. |
| `logEvent(type, data, severity = 'INFO')` | Writes one entry. `WARN` and `ERROR` are also echoed to the console. `data` is stored as given. |
| `logToolExec({ tool, args, durationMs, success, error?, workerId? })` | `TOOL_EXEC` with sanitized `args`; severity `INFO` on success, `ERROR` on failure. |
| `logCoreWrite({ path, operation, existed, bytesWritten?, arenaVerified? })` | `CORE_WRITE` at `WARN` with `isSubstrate: true`. |
| `logAgentAction(action, tool, args)` | `AGENT_ACTION` with sanitized `args`. |
| `logSecurity(type, details)` | `SECURITY` at `ERROR` with sanitized details. |
| `getEntries(startDate?, endDate?)` | Reads the daily files in the range (default today) and skips malformed lines. |
| `exportJSON` / `exportCSV` / `download(format, start?, end?)` | Export a range; `download` saves a file in the browser. |
| `getStats(start?, end?)` | `{ total, byType, bySeverity, timeRange }`. |
| `sanitizeArgs` / `sanitizeValue` | Redaction helpers (below). |
| `isSubstratePath(path)` | `true` for paths starting with `/core/` or `/infrastructure/`. |

## Sanitization

`sanitizeValue` replaces with `[REDACTED]` any value whose key contains a listed sensitive name (`apiKey`, `token`, `password`, `secret`, `credential`, `authorization`, `auth`, `bearer`, `privateKey`, `key`, provider key names and their variants) and any string starting with `sk-`, `pk-`, `api-`, `key-`, `token-` or `bearer `. Other strings longer than 500 characters are truncated with a note. It recurses through arrays and objects.

## Events

When `EventBus` is present: `audit:tool_exec` for `TOOL_EXEC`; `audit:core_write` for `CORE_WRITE` and `CORE_WRITE_BLOCKED`; `audit:warning` for any `WARN` or `ERROR` entry.

## Writers

Current callers include `self/core/tool-runner.js` (`TOOL_EXEC`, `TOOL_REJECTED`, `TOOL_PERMISSION_DENIED`, `TOOL_POLICY_BLOCKED`, `TOOL_POLICY_WARNING`, `TOOL_OUTPUT_VALIDATION_FAILED`), `self/tools/WriteFile.js:105` (`CORE_WRITE_BLOCKED` when the sandbox gate does not pass), `self/tools/EditFile.js` (`logCoreWrite`), `self/tools/CopyFile.js` and `DeleteFile.js`, `self/core/create-tool.js` (candidate, quarantine and activation events), `self/core/worker-manager.js` (`WORKER_SPAWN`), `self/core/state-manager.js` (`SET_GOAL`), `self/infrastructure/policy-engine.js` (`POLICY_VIOLATION`), `self/infrastructure/intent-bundle-gate.js`, `self/capabilities/system/doppler-optimizer.js` and `packages/reploid/src/improvement/episodes.js`. `self/infrastructure/replay-engine.js` reads entries back.

The file is on the validator quarantine list in `self/core/promotion-policy.js`, so a candidate change cannot rewrite the logger.

## Boundaries and gaps

- The log is not tamper-evident. Entries are not chained or signed, and any code with VFS write access can change or delete them.
- `logEvent` does not sanitize `data`; only `logToolExec`, `logAgentAction` and `logSecurity` do. Callers of `logEvent` must not pass secrets.
- Appending rewrites the whole day's file, so concurrent writers in different tabs can lose a line.
- An audit entry records that something happened. It is not an approval and grants nothing.

## Related blueprints

- [0x00000A Tool Runner Engine](0x00000A-tool-runner-engine.md): main writer.
- [0x000040 Verification Manager](0x000040-verification-manager.md): the gate whose blocked writes are audited.
- [0x000049 HITL Controller](0x000049-hitl-controller.md): operator approval, which this log records but does not replace.
