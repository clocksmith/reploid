# Blueprint 0x00004B: git-based Virtual File System

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00004B-git-vfs-version-control.md`

## Retired design

This design proposed `/core/git-vfs.js`, commit history and rollback for the VFS built on isomorphic-git. That module does not exist. The `self/tools/git.js` tool expects an optional `gitTools` dependency, and no module provides it, so the tool reports that git is not available. Rollback is provided by genesis snapshots ([0x00003C](0x00003C-genesis-snapshot-system.md)); VFS storage is [0x000011](0x000011-advanced-storage-backend-indexeddb.md).
