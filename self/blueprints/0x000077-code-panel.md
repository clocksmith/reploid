# Blueprint 0x000077: Code Panel

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000077-code-panel.md`

## Retired design

This blueprint described a code-editor panel at `/self/ui/panels/code-panel.js` with syntax
highlighting, a file tree and read-only protection for kernel files. No such file exists.
Browsing and editing VFS files is done by the proto VFS browser in `self/ui/proto/vfs.js`
(`createVFSManager`: tree, filter, view, `startEditing`, `saveFile`), and the explorer
design is kept in
[`0x000020-vfs-explorer-interaction.md`](0x000020-vfs-explorer-interaction.md).
