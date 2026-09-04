---
name: reploid-registry-audit
description: Validate Reploid's generated registry graph, or regenerate it from canonical sources when the user requests regeneration or a registry-owning source changed.
---

# Reploid Registry Audit

## Prerequisites

- Run from the Reploid repository root.
- Identify whether the request is validation-only or regeneration.
- Before regeneration, inspect `git status --short` and preserve unrelated changes.

## Procedure

For validation-only work, run:

```bash
node scripts/validate-registry.js
```

For an authorized regeneration, run the generators in dependency order:

```bash
node scripts/build-genesis-manifest.js
node scripts/build-blueprint-registry.js
node scripts/build-module-registry.js
node scripts/build-vfs-manifest.js
node scripts/validate-registry.js
```

Inspect changes under `self/config/`. Classify every reported circular dependency,
missing dependency, orphan module/file, stale blueprint, missing blueprint, and
missing metadata item. The validator's process exit code alone is not acceptance;
its reported issue count is part of the result.

## Validation

Validation passes only when all generators exit successfully, generated JSON parses,
the second generator run is idempotent, and `validate-registry.js` reports zero
unresolved issues. Report unresolved findings even when the validator exits zero.

## Stop Conditions

Stop before regeneration unless it was requested or a canonical registry source was
changed in the current task. Stop if generated output would overwrite unrelated user
changes, or if an issue requires an architectural ownership decision.

## Outputs

- Validation-only: categorized issue report with exact paths and counts.
- Regeneration: updated deterministic registry files plus the validation report.

## Side Effects

Validation-only is read-only. Regeneration rewrites generated JSON files under
`self/config/`; it does not commit, push, deploy, or alter runtime state.
