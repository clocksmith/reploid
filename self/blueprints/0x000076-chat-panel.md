# Blueprint 0x000076: Chat Panel

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000076-chat-panel.md`

## Retired design

This blueprint described a full conversation panel at `/self/ui/panels/chat-panel.js` with
streaming, tool-call display, export and search. No such file was ever written, and nothing
in `self/` imports or mounts it. The chat surface that exists in `self/` is the inline chat
component, specified in [`0x000075-inline-chat.md`](0x000075-inline-chat.md) and implemented
in `self/ui/components/inline-chat.js`.
