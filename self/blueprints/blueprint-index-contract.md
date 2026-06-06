# Blueprint Index Contract

The blueprint index is the runtime's navigation layer.

## Entry Fields

| Field | Meaning |
|-------|---------|
| `id` | Stable blueprint identifier. |
| `path` | VFS path to read with `ReadFile`. |
| `status` | `active`, `lazy`, or `archived`. |
| `tags` | Objective matching hints. |
| `summary` | Short description for context selection. |

## Status Rules

| Status | Runtime behavior |
|--------|------------------|
| `active` | Include in first context. |
| `lazy` | Read only when needed for the objective. |
| `archived` | Keep for research; do not use as live guidance unless explicitly requested. |

## Selection Rule

Before changing runtime, tools, boot, prompts, or promotion behavior, read the index and choose the smallest matching blueprint set.

*Last updated: June 2026*
