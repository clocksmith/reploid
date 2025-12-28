# Blueprint 0x000094: Diff Viewer UI

**Objective:** Interactive code diff visualization with approval controls and rollback capability.

**Target Module:** `DiffViewerUI`

**Implementation:** `/ui/components/diff-viewer-ui.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000010` (State Manager), `0x000058` (Event Bus)

**Category:** UI

---

## Overview

The Diff Viewer UI provides rich visualization of code changes proposed by the agent. It displays side-by-side diffs with syntax highlighting (Prism.js), per-file approval controls, and emergency rollback capability.

## Key Features

1. **Side-by-Side Diff** - Visual comparison of old/new content
2. **Syntax Highlighting** - Prism.js for 10+ languages
3. **Per-File Approval** - Checkbox to approve/reject each change
4. **Diff Statistics** - Added/removed/modified line counts
5. **Export Options** - Markdown export and clipboard copy
6. **Rollback** - Emergency revert to pre-proposal state

## Interface

```javascript
const DiffViewerUI = {
  init(containerId),          // Initialize in DOM container
  showDiff(data),             // Display diff for dogs bundle
  clearDiff()                 // Clear and hide viewer
};
```

## Event Integration

| Event | Direction | Description |
|-------|-----------|-------------|
| `diff:show` | In | Show diff for dogs bundle |
| `diff:clear` | In | Clear the diff viewer |
| `proposal:approved` | Out | User approved changes |
| `proposal:cancelled` | Out | User cancelled |
| `proposal:rollback` | Out | Emergency rollback triggered |
| `proposal:edit` | Out | User wants to edit proposal |

## Diff Operations

| Operation | Icon | Description |
|-----------|------|-------------|
| CREATE | ☩ | New file to be created |
| MODIFY | ✎ | Existing file to be changed |
| DELETE | ✄ | File to be removed |

## Statistics Display

```
+42 new    ~15 modified    -3 deleted
+156 lines  -89 lines      ~23 changed
```

## Language Detection

Supported extensions: `.js`, `.ts`, `.json`, `.css`, `.html`, `.py`, `.md`

---

**Status:** Implemented

