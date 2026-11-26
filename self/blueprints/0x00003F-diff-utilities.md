# Blueprint 0x00003F: Diff Utilities

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** `/core/diff-utils.js`

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00003F-diff-utilities.md`
**Objective:** Give the agent and the operator one browser-native way to compare two versions of a file and to describe a change, so that a proposed change can be reviewed before it is adopted.

**Prerequisites:** None (pure utility)

This blueprint is the one place for change representation. It holds the ideas of the retired [0x00003B](0x00003B-dogs-cats-browser-parser.md) (DOGS/CATS bundles), [0x000048](0x000048-diff-viewer-ui.md) (diff viewer) and [0x000057](0x000057-internal-patch-format.md) (JSON patch format).

---

### 1. What exists

There is no diff module. The tool runner does not provide a `diff_artifacts` tool, and nothing in `self/`, `shared/` or `packages/reploid/src` computes a line diff. Changes are written by tools: `self/tools/EditFile.js` applies literal match-and-replace operations (`operations: [{ match, replacement, count }]`, or `patch: [{ find, replace, count }]`) and `WriteFile.js` replaces whole files. Candidates are staged under `/shadow` and compared with the live file only by reading both. The `self/tools/git.js` tool's `diff` command depends on a `gitTools` provider that no module supplies (see the retired [0x00004B](0x00004B-git-vfs-version-control.md)).

### 2. Proposed module

`/core/diff-utils.js`, a pure module with no dependencies:

- `diffLines(before, after)` returns `{ hunks, stats: { added, removed, unchanged } }`, computed with a longest-common-subsequence line diff. Each hunk carries old and new line numbers.
- `formatUnified(diff, { context = 3 })` returns unified-diff text for the operator and for logs.
- `toEditOperations(diff)` returns operations in the `EditFile` format, so a reviewed diff can be applied with the existing tool.

A change set is a list of `{ path, kind: 'create' | 'modify' | 'delete', before, after }` entries. Text bundle formats such as DOGS/CATS are not planned; the unused DOGS/CATS helpers in `shared/core/utils.js` ([0x000003](0x000003-core-utilities-and-error-handling.md)) are not part of this design.

### 3. Use

- A candidate in `/shadow` is shown to the operator as a diff against the live path before adoption.
- Improvement episodes ([docs/rsi-improvement-episodes.md](../../docs/rsi-improvement-episodes.md)) can record the diff of the candidate patch as evidence.
- A diff describes a change; it grants nothing. Adoption remains the operator's.

### 4. Verification conditions

- Identical inputs produce no hunks; empty-to-text and text-to-empty produce one hunk each.
- `toEditOperations(diffLines(a, b))` applied to `a` with `EditFile` yields `b`.
- Line numbers in every hunk match the input files.
