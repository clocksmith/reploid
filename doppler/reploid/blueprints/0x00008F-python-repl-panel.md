# Blueprint 0x00008F: Python REPL Panel

**Objective:** Interactive Python execution environment using Pyodide (WebAssembly Python).

**Target Module:** PythonReplPanel (`ui/panels/python-repl-panel.js`)

**Prerequisites:** Utils, EventBus, PyodideRuntime (optional), ToastNotifications (optional)

**Affected Artifacts:** `/ui/panels/python-repl-panel.js`

---

### 1. The Strategic Imperative

Python execution in the browser enables:
- Data analysis without server roundtrips
- Agent-generated Python code execution
- Scientific computing (NumPy, Pandas)
- VFS file processing with Python tools

### 2. The Architectural Solution

A REPL panel that interfaces with PyodideRuntime:

**Module Structure:**
```javascript
const PythonReplPanel = {
  metadata: {
    id: 'PythonReplPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'PyodideRuntime?', 'ToastNotifications?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    let container, outputContainer, codeInput;

    const init = (containerId) => { ... };
    const setupButtons = () => { ... };
    const appendOutput = (result) => { ... };
    const updateStatus = () => { ... };

    return { init };
  }
};
```

### 3. UI Elements

| Element | Purpose |
|---------|---------|
| Code Input | Textarea for Python code |
| Execute Button | Run code |
| Clear Button | Clear output |
| Packages Button | Install pip packages |
| Sync Button | Sync VFS workspace |
| Output Container | Display execution results |
| Status Icon/Text | Pyodide ready state |

### 4. Status States

| State | Icon | Text |
|-------|------|------|
| Initializing | ☍ | "Initializing..." |
| Ready | ★ | "Ready" |
| Error | ☒ | Error message |

### 5. Execution Flow

1. User enters Python code
2. Clicks Execute (or Shift+Enter)
3. Optionally sync VFS workspace
4. PyodideRuntime.execute(code)
5. Display output (stdout, return value, or error)

### 6. Workspace Sync

When "Sync Workspace" is checked:
- VFS files are copied to Pyodide filesystem
- Python can read/write VFS files
- Changes sync back to VFS

### 7. Package Installation

```javascript
await PyodideRuntime.installPackage('numpy');
await PyodideRuntime.installPackage('pandas');
```

### 8. API Surface

| Method | Description |
|--------|-------------|
| `init(containerId)` | Mount panel to container |
| `execute(code)` | Run Python code |
| `clear()` | Clear output |

### 9. Events

Listens to:
- `pyodide:ready` - Runtime initialized
- `pyodide:error` - Initialization error
- `pyodide:output` - Execution output

---

### 10. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Shift+Enter | Execute code |
| Ctrl+L | Clear output |
