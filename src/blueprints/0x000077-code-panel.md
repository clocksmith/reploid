# Blueprint 0x00008E-CDPNL: Code Panel

**Objective:** Provide a full-featured code editor panel for viewing and editing VFS files with syntax highlighting, file navigation, and VFS integration.

**Target Module:** `CodePanel`

**Implementation:** `/ui/panels/code-panel.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000058` (Event Bus), `0x000011` (Storage Backend)

**Category:** UI

---

## 1. The Strategic Imperative

A proper code editing experience is essential for self-modifying agents:
- Agents need to view and edit their own source code in the VFS
- Syntax highlighting improves code comprehension and error detection
- File tree navigation enables exploring the codebase structure
- Read-only mode protects system-critical files from accidental modification

**The Code Panel** provides:
- **Syntax Highlighting**: Language-aware code display using CodeMirror or Monaco
- **File Tree Navigation**: Hierarchical view of VFS directories
- **VFS Integration**: Seamless save/load from IndexedDB-backed storage
- **Read-Only Mode**: Protection for system files and Genesis Kernel modules

This panel is the **primary code editing interface** for the agent substrate.

---

## 2. The Architectural Solution

The Code Panel uses a **Web Component architecture** with Shadow DOM for encapsulated rendering and event-driven updates.

### Key Components

**1. Editor Engine (CodeMirror/Monaco)**

The panel integrates a syntax highlighting library:

```javascript
// Editor initialization with language detection
const editor = CodeMirror(container, {
  value: fileContent,
  mode: detectLanguage(filename),
  lineNumbers: true,
  theme: 'reploid-dark',
  readOnly: isSystemFile(path)
});
```

Supported language modes:
- `javascript` - JS/ES6+
- `css` - Stylesheets
- `htmlmixed` - HTML with embedded JS/CSS
- `markdown` - Documentation files
- `json` - Configuration and data files
- `python` - Python scripts

**2. File Tree Navigation**

Hierarchical file browser with VFS integration:

```javascript
{
  type: 'directory',
  name: 'core',
  path: '/vfs/core/',
  children: [
    { type: 'file', name: 'agent-loop.js', path: '/vfs/core/agent-loop.js' },
    { type: 'file', name: 'utils.js', path: '/vfs/core/utils.js' }
  ],
  expanded: true
}
```

Visual indicators:
- `[U+2617]` icon = Folder (collapsed)
- `[U+2617]` icon = Folder (expanded)
- `[U+0192]` icon = Code file
- `[U+2610]` icon = Document
- `[U+26BF]` icon = Locked system file

**3. VFS Integration**

```javascript
// Load file from VFS
async function loadFile(path) {
  const content = await Storage.read(path);
  editor.setValue(content);
  currentPath = path;
  updateTitle(path);
}

// Save file to VFS
async function saveFile() {
  if (isReadOnly) {
    showToast('Cannot save read-only file', 'warning');
    return;
  }
  const content = editor.getValue();
  await Storage.write(currentPath, content);
  EventBus.emit('vfs:file-saved', { path: currentPath });
  showToast('File saved', 'success');
}
```

**4. Read-Only Mode Detection**

System files are protected from modification:

```javascript
const SYSTEM_PATHS = [
  '/vfs/genesis/',           // Genesis Kernel (immutable)
  '/vfs/core/agent-loop.js', // Core agent loop (L3 changes only)
  '/vfs/config/system.json'  // System configuration
];

function isSystemFile(path) {
  return SYSTEM_PATHS.some(sysPath => path.startsWith(sysPath));
}
```

**5. Web Component Widget**

```javascript
class CodePanelWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._editor = null;
    this._currentPath = null;
    this._isReadOnly = false;
    this._fileTree = [];
  }

  connectedCallback() {
    this.render();
    this._setupEventListeners();

    EventBus.on('vfs:file-changed', this._onFileChanged.bind(this));
    EventBus.on('code-panel:open-file', this._onOpenFile.bind(this));
  }

  disconnectedCallback() {
    EventBus.off('vfs:file-changed', this._onFileChanged);
    EventBus.off('code-panel:open-file', this._onOpenFile);
    if (this._editor) {
      this._editor.destroy();
    }
  }

  getStatus() {
    return {
      state: this._editor ? 'active' : 'idle',
      primaryMetric: this._currentPath ? Utils.basename(this._currentPath) : 'No file',
      secondaryMetric: this._isReadOnly ? 'Read-only' : 'Editable',
      lastActivity: this._lastEditTime,
      message: this._currentPath || 'Open a file to edit'
    };
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          height: 100%;
          font-family: monospace;
          color: #e0e0e0;
        }
        .panel-container {
          display: flex;
          width: 100%;
          height: 100%;
        }
        .file-tree {
          width: 200px;
          min-width: 150px;
          max-width: 300px;
          background: #1a1a1a;
          border-right: 1px solid #333;
          overflow-y: auto;
        }
        .tree-item {
          padding: 4px 8px;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tree-item:hover {
          background: #2a2a2a;
        }
        .tree-item.active {
          background: #333;
        }
        .tree-item.directory {
          color: #8ab4f8;
        }
        .tree-item.readonly {
          color: #888;
        }
        .editor-container {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .editor-toolbar {
          display: flex;
          align-items: center;
          padding: 8px;
          background: #1a1a1a;
          border-bottom: 1px solid #333;
        }
        .file-path {
          flex: 1;
          font-size: 12px;
          color: #888;
        }
        .readonly-badge {
          background: #444;
          color: #aaa;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 11px;
          margin-left: 8px;
        }
        .editor-area {
          flex: 1;
          overflow: auto;
        }
        button {
          padding: 6px 12px;
          background: #333;
          color: #e0e0e0;
          border: 1px solid #555;
          border-radius: 3px;
          cursor: pointer;
          margin-left: 8px;
        }
        button:hover:not(:disabled) {
          background: #444;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      </style>

      <div class="panel-container">
        <div class="file-tree" id="file-tree">
          <!-- File tree rendered here -->
        </div>
        <div class="editor-container">
          <div class="editor-toolbar">
            <span class="file-path" id="file-path">No file open</span>
            <span class="readonly-badge" id="readonly-badge" style="display: none;">Read-only</span>
            <button id="save-btn" disabled>Save</button>
            <button id="reload-btn" disabled>Reload</button>
          </div>
          <div class="editor-area" id="editor-area">
            <!-- CodeMirror/Monaco editor -->
          </div>
        </div>
      </div>
    `;

    this._initFileTree();
    this._initEditor();
    this._attachEventListeners();
  }

  _initFileTree() {
    // Load VFS directory structure
  }

  _initEditor() {
    // Initialize CodeMirror or Monaco editor
  }

  _attachEventListeners() {
    this.shadowRoot.querySelector('#save-btn').addEventListener('click', () => {
      this._saveFile();
    });

    this.shadowRoot.querySelector('#reload-btn').addEventListener('click', () => {
      this._reloadFile();
    });
  }

  async _openFile(path) {
    const content = await Storage.read(path);
    this._currentPath = path;
    this._isReadOnly = isSystemFile(path);
    this._editor.setValue(content);
    this._updateUI();
  }

  async _saveFile() {
    if (this._isReadOnly) return;
    const content = this._editor.getValue();
    await Storage.write(this._currentPath, content);
    EventBus.emit('vfs:file-saved', { path: this._currentPath });
  }

  _updateUI() {
    const pathEl = this.shadowRoot.querySelector('#file-path');
    const badgeEl = this.shadowRoot.querySelector('#readonly-badge');
    const saveBtn = this.shadowRoot.querySelector('#save-btn');
    const reloadBtn = this.shadowRoot.querySelector('#reload-btn');

    pathEl.textContent = this._currentPath || 'No file open';
    badgeEl.style.display = this._isReadOnly ? 'inline' : 'none';
    saveBtn.disabled = !this._currentPath || this._isReadOnly;
    reloadBtn.disabled = !this._currentPath;
  }
}

// Register custom element
if (!customElements.get('code-panel-widget')) {
  customElements.define('code-panel-widget', CodePanelWidget);
}

const widget = {
  element: 'code-panel-widget',
  displayName: 'Code Panel',
  icon: '[U+0192]',  // Code file symbol
  category: 'ui'
};
```

---

## 3. The Implementation Pathway

**Phase 1: Core Editor Integration**
1. [ ] Select editor library (CodeMirror 6 recommended for size/performance)
2. [ ] Create editor wrapper with language detection
3. [ ] Implement theme matching REPLOID dark aesthetic
4. [ ] Add line numbers and basic editing features

**Phase 2: File Tree Navigation**
1. [ ] Build VFS directory scanner
2. [ ] Create collapsible tree UI component
3. [ ] Implement file selection with active state
4. [ ] Add context menu for file operations

**Phase 3: VFS Integration**
1. [ ] Implement file loading from Storage backend
2. [ ] Implement file saving with dirty tracking
3. [ ] Add unsaved changes warning on navigation
4. [ ] Subscribe to VFS change events for external updates

**Phase 4: Read-Only Mode**
1. [ ] Define system file path patterns
2. [ ] Implement read-only detection logic
3. [ ] Disable editing for protected files
4. [ ] Display read-only badge in toolbar

**Phase 5: Web Component Widget**
1. [ ] Define CodePanelWidget class extending HTMLElement
2. [ ] Add Shadow DOM with encapsulated styles
3. [ ] Implement lifecycle methods with proper cleanup
4. [ ] Register custom element with duplicate check

---

## 4. UI Elements

| Element ID | Description |
|------------|-------------|
| `file-tree` | Hierarchical file browser |
| `file-path` | Current file path display |
| `readonly-badge` | Read-only status indicator |
| `editor-area` | CodeMirror/Monaco container |
| `save-btn` | Save current file button |
| `reload-btn` | Reload file from VFS button |

---

## 5. Event System

**Emitted Events:**
```javascript
EventBus.emit('vfs:file-saved', { path });      // File saved to VFS
EventBus.emit('code-panel:file-opened', { path }); // File opened in editor
EventBus.emit('code-panel:dirty', { path, isDirty }); // Unsaved changes state
```

**Listened Events:**
```javascript
EventBus.on('vfs:file-changed', handleExternalChange);  // External VFS update
EventBus.on('code-panel:open-file', openFileHandler);   // Request to open file
```

---

## 6. Dependencies

- `Utils` - Core utilities (required)
- `Storage` - VFS backend (required)
- `EventBus` - Event communication (required)
- `CodeMirror` or `Monaco` - Editor library (external, loaded dynamically)

---

## 7. Success Criteria

**Editor Functionality:**
- [ ] Syntax highlighting for JS, CSS, HTML, JSON, Python, Markdown
- [ ] Line numbers displayed correctly
- [ ] Proper indentation and tab handling
- [ ] Search and replace within file

**File Navigation:**
- [ ] Tree displays VFS directory structure
- [ ] Folders expand/collapse on click
- [ ] Files open in editor on click
- [ ] Active file highlighted in tree

**VFS Integration:**
- [ ] Files load correctly from Storage
- [ ] Save updates file in IndexedDB
- [ ] External changes trigger reload prompt
- [ ] Dirty indicator shows unsaved changes

**Read-Only Protection:**
- [ ] System files cannot be edited
- [ ] Read-only badge displays correctly
- [ ] Save button disabled for protected files
- [ ] Genesis Kernel files always protected

---

## 8. Known Limitations

1. **Large file performance** - Very large files may cause editor lag
2. **Binary files** - Cannot display binary content (images, etc.)
3. **Concurrent editing** - No multi-user conflict resolution
4. **Undo history** - Lost on file switch (no persistent undo)

---

## 9. Future Enhancements

1. **Multi-tab editing** - Open multiple files simultaneously
2. **Git integration** - Show diff markers for changed lines
3. **Intelligent autocomplete** - Context-aware code suggestions
4. **Keyboard shortcuts** - Vim/Emacs keybindings option
5. **Split view** - Side-by-side file comparison
6. **Minimap** - Code overview for large files

---

**Status:** Planned

