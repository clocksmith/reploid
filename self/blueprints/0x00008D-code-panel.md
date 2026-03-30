# Blueprint 0x00008D: Code Panel

**Objective:** UI panel for viewing and editing VFS files with syntax highlighting.

**Target Module:** CodePanel (`ui/panels/code-panel.js`)

**Prerequisites:** Utils, CodeViewer (optional)

**Affected Artifacts:** `/ui/panels/code-panel.js`

---

### 1. The Strategic Imperative

Users need to:
- View agent-generated code
- Edit files in the VFS
- See syntax-highlighted source
- Navigate file contents

### 2. The Architectural Solution

A panel wrapper that hosts the CodeViewer component:

**Module Structure:**
```javascript
const CodePanel = {
  metadata: {
    id: 'CodePanel',
    version: '1.0.0',
    dependencies: ['Utils', 'CodeViewer?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, CodeViewer } = deps;

    const init = (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (CodeViewer?.init) {
        CodeViewer.init(containerId);
      }
    };

    return { init };
  }
};
```

### 3. Panel Features

- File path display
- Line numbers
- Syntax highlighting (JS, CSS, HTML, MD)
- Read-only and edit modes
- Save button (writes to VFS)

### 4. Syntax Highlighting

Uses browser-native or lightweight highlighting:
- Keywords
- Strings
- Comments
- Numbers
- Functions

### 5. API Surface

| Method | Description |
|--------|-------------|
| `init(containerId)` | Mount panel to container |
| `loadFile(path)` | Load file from VFS |
| `setContent(code, language)` | Set content directly |
| `getContent()` | Get current content |
| `setReadOnly(bool)` | Toggle edit mode |

### 6. Integration

CodePanel is mounted in the Proto UI layout:
```javascript
CodePanel.init('code-container');
```

---

### 7. VFS Integration

On save:
1. Get content from editor
2. Write to VFS via `VFS.write(path, content)`
3. Emit `code:saved` event
4. Show success toast
