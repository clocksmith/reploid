# Blueprint 0x00004A: Hot Module Reload System

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00004A-hot-module-reload.md`

## Retired design

This design proposed `/infrastructure/hot-reload.js`, which replaced running modules in place while keeping their state. That module does not exist; the state manager the old metadata cited does not implement it. What exists is narrower and lives in the boot host ([0x000002](0x000002-application-orchestration.md)): when a VFS file changes, `self/host/start-app.js` asks the service worker to invalidate the cached module, remounts the UI for UI paths, and reloads the whole page for substrate paths; `self/host/reploid-launch.js` remounts the capsule UI when its files change. Module state is not preserved across a substrate reload.
