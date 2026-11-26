# Blueprint 0x000078: LLM Config Panel

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000078-llm-config-panel.md`

## Retired design

This blueprint described a runtime panel at `/self/ui/panels/llm-config-panel.js` for
switching providers and models after boot. No such file exists. Provider and model selection
happens before the agent starts, in the boot wizard (`self/ui/boot-wizard/state.js`,
`detection.js`, `steps/direct.js`, `steps/proxy.js`, `steps/browser.js`), which is specified
in [`0x000074-model-config-ui.md`](0x000074-model-config-ui.md).
