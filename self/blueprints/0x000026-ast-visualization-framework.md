# Blueprint 0x000026: AST Visualization Framework

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000026-ast-visualization-framework.md`

## Retired design

This design proposed `/ui/panels/ast-visualizer.js`, which rendered JavaScript syntax trees for inspection. That module does not exist; the page and stylesheet the old metadata cited do not implement it. The repository vendors acorn (`shared/core/vendor/acorn.js`) for the Verification Worker ([0x00002A](0x00002A-module-integrity-verification.md)), not for display. No current blueprint covers AST display.
