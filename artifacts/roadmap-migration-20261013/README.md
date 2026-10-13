# Applied Desktop roadmap migration

Applied the 19 replacement files from `Desktop/reploid-roadmap-migration` to Reploid after `92642382`. The supplied migration was based on `229a6e60`. Seventeen files match the supplied replacements exactly; ROADMAP and the canonical requirements additionally retain the newer storage-participation evidence. Desktop originals are unchanged.

Component: documentation navigation and acceptance tracking. Intent: planning navigation deliberately changes from TODO to ROADMAP; product intent, runtime ownership and acceptance gates are preserved. Boundary effects: AGENTS, GOALS, documentation and blueprint navigation now point to the roadmap and its detailed register. No runtime or cross-repository edits.

- [ROADMAP](../../ROADMAP.md) selects work and presents the product outcomes.
- [Canonical requirements](../../docs/roadmap/requirements.md) retain the task entries and checkboxes.
- [RD-CANON/1](../../docs/roadmap/rd-canon-1.md) retains the normative architecture and inherited fixtures.
- [History](../../docs/roadmap/history.md) preserves chronology.
- At migration, [TODO](https://github.com/clocksmith/reploid/blob/8853b90a4d7e59a021016b6cb056e7fe274e814a/TODO.md) preserved old links through compatibility anchors; that compatibility file has since been removed.

[Validation](validation.json) records input/output hashes and the actual checks: 47 stable IDs, all 87 checkbox states (31 checked), all 74 legacy anchors, and 301 unique local paths/fragments or locally available Git-pinned objects. RD-CANON is byte-identical after the four navigation-only substitutions. Other external links were not requalified.

`npm run verify:journeys`, `node scripts/verify-catscan.js`, and `git diff --check` pass. The newer storage controls remain scoped to their recorded source/browser tests and real bounded origin download; the migration does not mark installed conversations or live-mesh acceptance complete. No runtime tests, GPU runs, package changes or deployment occurred.
