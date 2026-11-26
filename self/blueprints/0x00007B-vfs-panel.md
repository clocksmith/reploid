# Blueprint 0x00007B: VFS Panel

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00007B-vfs-panel.md`

## Retired design

This blueprint described a container panel at `/self/ui/panels/vfs-panel.js` that would
wrap the VFS explorer. No such module exists. The VFS browser is the proto module
`self/ui/proto/vfs.js` (`createVFSManager`), rendered into the `vfs-panel` element of
`self/ui/proto/template.js` and styled by `self/styles/proto/vfs.css`. The explorer design is
kept in [`0x000020-vfs-explorer-interaction.md`](0x000020-vfs-explorer-interaction.md).
