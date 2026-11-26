# Blueprint 0x00000F: UI Body Template (HTML)

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00000F-ui-body-template-html.md`

## Retired design

This design proposed `/ui/ui-body-template.html`, an HTML skeleton that the UI manager of [0x00000D](0x00000D-ui-manager.md) injected into the page. That file does not exist. Boot pages are plain HTML files in the served tree (for example `self/kernel/index.html`), and the boot UI is mounted from JavaScript by `self/host/start-app.js`, described in [0x000002](0x000002-application-orchestration.md).
