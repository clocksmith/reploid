# Blueprint 0x000004: Default Storage Backend (localStorage)

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000004-default-storage-backend-localstorage.md`

## Retired design

This design proposed `/core/storage.js`, a synchronous `localStorage` backend for the VFS that stored each file under a prefixed key. That module does not exist. The VFS is stored in IndexedDB by `self/core/vfs.js`, described in [0x000011](0x000011-advanced-storage-backend-indexeddb.md).
