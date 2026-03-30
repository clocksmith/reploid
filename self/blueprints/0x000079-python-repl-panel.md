# Blueprint 0x000090-PYREPL: Python REPL Panel

**Objective:** Provide an interactive Python execution environment in the browser using Pyodide (WebAssembly Python) with VFS integration, package management, and proper stdout/stderr separation.

**Target Module:** `PythonReplPanel`

**Implementation:** `/ui/panels/python-repl-panel.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000058` (Event Bus), `0x000030` (Pyodide Runtime Orchestration), `0x000011` (Storage Backend)

**Category:** UI

---

## 1. The Strategic Imperative

Python execution in the browser unlocks powerful capabilities:
- Agents can write and execute Python code without server round-trips
- Data analysis with numpy, pandas available via Pyodide packages
- VFS integration enables script persistence and file I/O
- Isolated WebAssembly sandbox ensures security

**The Python REPL Panel** provides:
- **Interactive REPL**: Execute Python code with immediate feedback
- **Output Separation**: Distinct stdout/stderr display with formatting
- **Package Management**: Install numpy, pandas, scipy from Pyodide repository
- **VFS Integration**: Execute scripts from VFS, save outputs
- **Session Persistence**: Maintain Python state across interactions

This panel is the **Python execution interface** for the agent substrate.

---

## 2. The Architectural Solution

The Python REPL Panel uses a **Web Component architecture** with Shadow DOM and integrates with the Pyodide worker-based runtime.

### Key Components

**1. Pyodide Integration**

Pyodide provides full Python 3.x in WebAssembly:

```javascript
// Initialize Pyodide runtime
await PyodideRuntime.init();

// Execute Python code
const result = await PyodideRuntime.execute(`
import numpy as np
arr = np.array([1, 2, 3, 4, 5])
print(f"Sum: {arr.sum()}")
print(f"Mean: {arr.mean()}")
arr.tolist()
`);

// result = { success: true, stdout: "Sum: 15\nMean: 3.0\n", result: [1, 2, 3, 4, 5] }
```

**2. Output Handling**

Separated stdout/stderr with formatting:

```javascript
const OUTPUT_TYPES = {
  stdout: {
    icon: '[U+261E]',  // Pointing hand
    className: 'output-stdout',
    color: '#e0e0e0'
  },
  stderr: {
    icon: '[U+26A1]',  // Warning
    className: 'output-stderr',
    color: '#ff6b6b'
  },
  result: {
    icon: '[U+2190]',  // Left arrow
    className: 'output-result',
    color: '#8ab4f8'
  },
  error: {
    icon: '[U+2612]',  // Ballot X
    className: 'output-error',
    color: '#ff4444'
  }
};

function formatOutput(output) {
  const lines = [];

  if (output.stdout) {
    lines.push({
      type: 'stdout',
      content: output.stdout
    });
  }

  if (output.stderr) {
    lines.push({
      type: 'stderr',
      content: output.stderr
    });
  }

  if (output.result !== undefined && output.result !== null) {
    lines.push({
      type: 'result',
      content: formatPythonValue(output.result)
    });
  }

  if (output.error) {
    lines.push({
      type: 'error',
      content: output.error
    });
  }

  return lines;
}
```

**3. Package Management**

Install packages from Pyodide repository:

```javascript
const COMMON_PACKAGES = [
  { name: 'numpy', description: 'Numerical computing' },
  { name: 'pandas', description: 'Data analysis' },
  { name: 'scipy', description: 'Scientific computing' },
  { name: 'matplotlib', description: 'Plotting (limited)' },
  { name: 'scikit-learn', description: 'Machine learning' },
  { name: 'networkx', description: 'Graph algorithms' },
  { name: 'sympy', description: 'Symbolic math' },
  { name: 'pillow', description: 'Image processing' }
];

async function installPackage(packageName) {
  EventBus.emit('toast:show', {
    message: `Installing ${packageName}...`,
    type: 'info'
  });

  try {
    await PyodideRuntime.installPackage(packageName);
    _installedPackages.push(packageName);
    EventBus.emit('toast:show', {
      message: `${packageName} installed`,
      type: 'success'
    });
  } catch (error) {
    EventBus.emit('toast:show', {
      message: `Failed to install ${packageName}: ${error.message}`,
      type: 'error'
    });
  }
}
```

**4. VFS Integration**

Execute scripts from VFS and sync files:

```javascript
// Execute script from VFS
async function executeVfsScript(path) {
  const code = await Storage.read(path);
  if (!code) {
    throw new Error(`File not found: ${path}`);
  }

  // Sync workspace to Pyodide filesystem
  if (_autoSync) {
    await PyodideRuntime.syncWorkspace();
  }

  return await PyodideRuntime.execute(code);
}

// Write Python output to VFS
async function saveOutput(path, content) {
  await Storage.write(path, content);
  EventBus.emit('vfs:file-saved', { path });
}

// Sync specific file to Pyodide
async function syncFileToWorker(path) {
  const content = await Storage.read(path);
  await PyodideRuntime.syncFileToWorker(path, content);
}
```

**5. Web Component Widget**

```javascript
class PythonReplPanelWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._history = [];
    this._historyIndex = -1;
    this._outputBuffer = [];
    this._pyodideReady = false;
    this._installedPackages = [];
    this._autoSync = true;
  }

  connectedCallback() {
    this.render();
    this._initPyodide();

    EventBus.on('pyodide:ready', this._onPyodideReady.bind(this));
    EventBus.on('pyodide:stdout', this._onStdout.bind(this));
    EventBus.on('pyodide:stderr', this._onStderr.bind(this));
    EventBus.on('pyodide:error', this._onError.bind(this));
    EventBus.on('python-repl:execute', this._onExternalExecute.bind(this));
  }

  disconnectedCallback() {
    EventBus.off('pyodide:ready', this._onPyodideReady);
    EventBus.off('pyodide:stdout', this._onStdout);
    EventBus.off('pyodide:stderr', this._onStderr);
    EventBus.off('pyodide:error', this._onError);
    EventBus.off('python-repl:execute', this._onExternalExecute);
  }

  async _initPyodide() {
    try {
      await PyodideRuntime.init();
    } catch (error) {
      this._appendOutput({
        type: 'error',
        content: `Failed to initialize Pyodide: ${error.message}`
      });
    }
  }

  getStatus() {
    return {
      state: !this._pyodideReady ? 'warning' :
             this._executionError ? 'error' :
             this._isExecuting ? 'active' : 'idle',
      primaryMetric: this._pyodideReady ? `${this._executionCount} runs` : 'Initializing',
      secondaryMetric: `${this._installedPackages.length} packages`,
      lastActivity: this._lastExecutionTime,
      message: this._pyodideReady ? 'Ready' : 'Loading Pyodide...'
    };
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          height: 100%;
          font-family: monospace;
          color: #e0e0e0;
          background: #1a1a1a;
        }
        .panel-container {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        /* Status Bar */
        .status-bar {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          background: #252525;
          border-bottom: 1px solid #333;
        }
        .status-icon {
          margin-right: 8px;
          font-size: 14px;
        }
        .status-icon.ready { color: #0c0; }
        .status-icon.loading { color: #fa0; }
        .status-icon.error { color: #f00; }
        .status-text {
          flex: 1;
          font-size: 12px;
        }
        .package-count {
          font-size: 11px;
          color: #888;
        }

        /* Output Area */
        .output-area {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          background: #1a1a1a;
        }
        .output-line {
          display: flex;
          margin-bottom: 4px;
          font-size: 13px;
          line-height: 1.4;
        }
        .output-icon {
          width: 20px;
          flex-shrink: 0;
        }
        .output-content {
          flex: 1;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .output-stdout { color: #e0e0e0; }
        .output-stderr { color: #ff6b6b; }
        .output-result { color: #8ab4f8; }
        .output-error { color: #ff4444; }
        .output-input { color: #888; }

        /* Input Area */
        .input-area {
          display: flex;
          flex-direction: column;
          border-top: 1px solid #333;
          background: #252525;
        }
        .input-row {
          display: flex;
          align-items: flex-start;
          padding: 8px 12px;
        }
        .prompt {
          color: #8ab4f8;
          margin-right: 8px;
          padding-top: 8px;
        }
        textarea {
          flex: 1;
          min-height: 60px;
          max-height: 200px;
          padding: 8px;
          background: #1a1a1a;
          border: 1px solid #444;
          border-radius: 3px;
          color: #e0e0e0;
          font-family: monospace;
          font-size: 13px;
          resize: vertical;
        }
        textarea:focus {
          border-color: #8ab4f8;
          outline: none;
        }

        /* Toolbar */
        .toolbar {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          gap: 8px;
          border-top: 1px solid #333;
        }
        button {
          padding: 6px 12px;
          background: #333;
          color: #e0e0e0;
          border: 1px solid #555;
          border-radius: 3px;
          cursor: pointer;
          font-family: monospace;
          font-size: 12px;
        }
        button:hover:not(:disabled) {
          background: #444;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        button.primary {
          background: #1a4d1a;
          border-color: #2a6d2a;
        }
        button.primary:hover:not(:disabled) {
          background: #2a5d2a;
        }
        .checkbox-group {
          display: flex;
          align-items: center;
          margin-left: auto;
        }
        .checkbox-group input {
          margin-right: 6px;
        }
        .checkbox-group label {
          font-size: 11px;
          color: #888;
        }

        /* Package Modal */
        .package-modal {
          display: none;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 6px;
          padding: 16px;
          width: 300px;
          z-index: 100;
        }
        .package-modal.open {
          display: block;
        }
        .package-list {
          max-height: 200px;
          overflow-y: auto;
          margin: 12px 0;
        }
        .package-item {
          display: flex;
          align-items: center;
          padding: 8px;
          cursor: pointer;
        }
        .package-item:hover {
          background: #333;
        }
        .package-item.installed {
          opacity: 0.5;
        }
        .package-name {
          flex: 1;
        }
        .package-desc {
          font-size: 11px;
          color: #888;
        }
      </style>

      <div class="panel-container">
        <!-- Status Bar -->
        <div class="status-bar">
          <span class="status-icon ${this._pyodideReady ? 'ready' : 'loading'}">
            ${this._pyodideReady ? '[U+2605]' : '[U+260D]'}
          </span>
          <span class="status-text">
            ${this._pyodideReady ? 'Python Ready' : 'Loading Pyodide...'}
          </span>
          <span class="package-count">
            ${this._installedPackages.length} packages loaded
          </span>
        </div>

        <!-- Output Area -->
        <div class="output-area" id="output-area">
          ${this._outputBuffer.map(line => `
            <div class="output-line">
              <span class="output-icon">${OUTPUT_TYPES[line.type].icon}</span>
              <span class="output-content ${OUTPUT_TYPES[line.type].className}">${this._escapeHtml(line.content)}</span>
            </div>
          `).join('')}
        </div>

        <!-- Input Area -->
        <div class="input-area">
          <div class="input-row">
            <span class="prompt">>>></span>
            <textarea
              id="code-input"
              placeholder="Enter Python code..."
              ${!this._pyodideReady ? 'disabled' : ''}
            ></textarea>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
          <button id="run-btn" class="primary" ${!this._pyodideReady ? 'disabled' : ''}>
            [U+2607] Run
          </button>
          <button id="clear-btn">[U+2608] Clear</button>
          <button id="packages-btn">[U+26DD] Packages</button>
          <button id="sync-btn" ${!this._pyodideReady ? 'disabled' : ''}>
            [U+260D] Sync VFS
          </button>
          <div class="checkbox-group">
            <input type="checkbox" id="auto-sync" ${this._autoSync ? 'checked' : ''} />
            <label for="auto-sync">Auto-sync workspace</label>
          </div>
        </div>

        <!-- Package Modal -->
        <div class="package-modal" id="package-modal">
          <h3>Install Packages</h3>
          <div class="package-list">
            ${COMMON_PACKAGES.map(pkg => `
              <div class="package-item ${this._installedPackages.includes(pkg.name) ? 'installed' : ''}"
                   data-package="${pkg.name}">
                <span class="package-name">${pkg.name}</span>
                <span class="package-desc">${pkg.description}</span>
              </div>
            `).join('')}
          </div>
          <button id="close-modal-btn">Close</button>
        </div>
      </div>
    `;

    this._attachEventListeners();
    this._scrollToBottom();
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  _scrollToBottom() {
    const outputArea = this.shadowRoot.querySelector('#output-area');
    if (outputArea) {
      outputArea.scrollTop = outputArea.scrollHeight;
    }
  }

  _attachEventListeners() {
    const codeInput = this.shadowRoot.querySelector('#code-input');
    const runBtn = this.shadowRoot.querySelector('#run-btn');
    const clearBtn = this.shadowRoot.querySelector('#clear-btn');
    const packagesBtn = this.shadowRoot.querySelector('#packages-btn');
    const syncBtn = this.shadowRoot.querySelector('#sync-btn');
    const autoSyncCheck = this.shadowRoot.querySelector('#auto-sync');
    const packageModal = this.shadowRoot.querySelector('#package-modal');
    const closeModalBtn = this.shadowRoot.querySelector('#close-modal-btn');

    // Run code on button click
    runBtn?.addEventListener('click', () => this._executeCode());

    // Run code on Shift+Enter
    codeInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        this._executeCode();
      }

      // History navigation with Ctrl+Up/Down
      if (e.ctrlKey && e.key === 'ArrowUp') {
        e.preventDefault();
        this._navigateHistory(-1);
      }
      if (e.ctrlKey && e.key === 'ArrowDown') {
        e.preventDefault();
        this._navigateHistory(1);
      }
    });

    // Clear output
    clearBtn?.addEventListener('click', () => {
      this._outputBuffer = [];
      this.render();
    });

    // Package modal
    packagesBtn?.addEventListener('click', () => {
      packageModal.classList.add('open');
    });

    closeModalBtn?.addEventListener('click', () => {
      packageModal.classList.remove('open');
    });

    // Package installation
    this.shadowRoot.querySelectorAll('.package-item').forEach(item => {
      if (!item.classList.contains('installed')) {
        item.addEventListener('click', () => {
          const packageName = item.dataset.package;
          this._installPackage(packageName);
        });
      }
    });

    // Sync VFS
    syncBtn?.addEventListener('click', () => this._syncWorkspace());

    // Auto-sync toggle
    autoSyncCheck?.addEventListener('change', (e) => {
      this._autoSync = e.target.checked;
    });
  }

  async _executeCode() {
    const codeInput = this.shadowRoot.querySelector('#code-input');
    const code = codeInput?.value?.trim();

    if (!code) return;

    // Add to history
    this._history.push(code);
    this._historyIndex = this._history.length;

    // Show input in output
    this._appendOutput({
      type: 'input',
      content: code
    });

    // Clear input
    codeInput.value = '';

    // Execute
    this._isExecuting = true;

    try {
      // Auto-sync if enabled
      if (this._autoSync) {
        await PyodideRuntime.syncWorkspace();
      }

      const result = await PyodideRuntime.execute(code);
      this._executionCount = (this._executionCount || 0) + 1;
      this._lastExecutionTime = Date.now();

      // Format and display output
      const outputLines = formatOutput(result);
      outputLines.forEach(line => this._appendOutput(line));

    } catch (error) {
      this._appendOutput({
        type: 'error',
        content: error.message
      });
      this._executionError = error;
    }

    this._isExecuting = false;
    this.render();
  }

  _appendOutput(line) {
    this._outputBuffer.push(line);
    // Limit buffer size
    if (this._outputBuffer.length > 1000) {
      this._outputBuffer = this._outputBuffer.slice(-500);
    }
  }

  _navigateHistory(direction) {
    const newIndex = this._historyIndex + direction;
    if (newIndex >= 0 && newIndex < this._history.length) {
      this._historyIndex = newIndex;
      const codeInput = this.shadowRoot.querySelector('#code-input');
      if (codeInput) {
        codeInput.value = this._history[newIndex];
      }
    }
  }

  async _installPackage(packageName) {
    try {
      await PyodideRuntime.installPackage(packageName);
      this._installedPackages.push(packageName);
      this._appendOutput({
        type: 'stdout',
        content: `Package '${packageName}' installed successfully`
      });
      this.render();
    } catch (error) {
      this._appendOutput({
        type: 'error',
        content: `Failed to install '${packageName}': ${error.message}`
      });
      this.render();
    }
  }

  async _syncWorkspace() {
    try {
      await PyodideRuntime.syncWorkspace();
      this._appendOutput({
        type: 'stdout',
        content: 'Workspace synced to Pyodide filesystem'
      });
      this.render();
    } catch (error) {
      this._appendOutput({
        type: 'error',
        content: `Sync failed: ${error.message}`
      });
      this.render();
    }
  }

  _onPyodideReady() {
    this._pyodideReady = true;
    this._appendOutput({
      type: 'stdout',
      content: 'Python 3.x (Pyodide) initialized. Type code and press Shift+Enter to run.'
    });
    this.render();
  }

  _onStdout(data) {
    this._appendOutput({ type: 'stdout', content: data.text });
    this.render();
  }

  _onStderr(data) {
    this._appendOutput({ type: 'stderr', content: data.text });
    this.render();
  }

  _onError(data) {
    this._appendOutput({ type: 'error', content: data.message });
    this.render();
  }

  _onExternalExecute(data) {
    const codeInput = this.shadowRoot.querySelector('#code-input');
    if (codeInput) {
      codeInput.value = data.code;
    }
    if (data.autoRun) {
      this._executeCode();
    }
  }
}

// Register custom element
if (!customElements.get('python-repl-panel-widget')) {
  customElements.define('python-repl-panel-widget', PythonReplPanelWidget);
}

const widget = {
  element: 'python-repl-panel-widget',
  displayName: 'Python REPL',
  icon: '[U+26AF]',  // Pyodide/Python symbol
  category: 'runtime'
};
```

---

## 3. The Implementation Pathway

**Phase 1: Pyodide Integration**
1. [ ] Initialize Pyodide runtime on panel load
2. [ ] Handle initialization errors gracefully
3. [ ] Display loading state during initialization
4. [ ] Subscribe to Pyodide events (ready, stdout, stderr)

**Phase 2: Code Execution**
1. [ ] Create code input textarea
2. [ ] Implement Shift+Enter execution
3. [ ] Display input echo in output area
4. [ ] Format and display execution results

**Phase 3: Output Handling**
1. [ ] Separate stdout/stderr display
2. [ ] Format Python return values
3. [ ] Syntax highlight error tracebacks
4. [ ] Implement output buffer with limit

**Phase 4: Package Management**
1. [ ] Create package installation modal
2. [ ] List common packages with descriptions
3. [ ] Implement package installation via micropip
4. [ ] Track installed packages

**Phase 5: VFS Integration**
1. [ ] Implement workspace sync button
2. [ ] Add auto-sync option
3. [ ] Support executing scripts from VFS
4. [ ] Save output to VFS files

**Phase 6: Web Component Widget**
1. [ ] Define PythonReplPanelWidget class
2. [ ] Add Shadow DOM with encapsulated styles
3. [ ] Implement lifecycle methods with cleanup
4. [ ] Register custom element with duplicate check

---

## 4. UI Elements

| Element ID | Description |
|------------|-------------|
| `code-input` | Python code input textarea |
| `output-area` | Execution output display |
| `run-btn` | Execute code button |
| `clear-btn` | Clear output button |
| `packages-btn` | Open package manager |
| `sync-btn` | Sync VFS to Pyodide FS |
| `auto-sync` | Auto-sync checkbox |
| `package-modal` | Package installation modal |

---

## 5. Status States

| Icon | Status | Description |
|------|--------|-------------|
| [U+2605] (Star) | Ready | Pyodide initialized |
| [U+260D] (Opposition) | Loading | Pyodide initializing |
| [U+2612] (Ballot X) | Error | Initialization or execution failed |

---

## 6. Output Format

```javascript
// Success case
{
  success: true,
  stdout: 'Hello, World!\n',
  stderr: '',
  result: 42  // Return value of last expression
}

// Error case
{
  success: false,
  error: 'NameError: name "foo" is not defined',
  traceback: '...'
}
```

---

## 7. Event System

**Emitted Events:**
```javascript
EventBus.emit('python-repl:executed', { code, result });
EventBus.emit('python-repl:package-installed', { name });
```

**Listened Events:**
```javascript
EventBus.on('pyodide:ready', handleReady);
EventBus.on('pyodide:stdout', handleStdout);
EventBus.on('pyodide:stderr', handleStderr);
EventBus.on('pyodide:error', handleError);
EventBus.on('python-repl:execute', handleExternalExecute);
```

---

## 8. Dependencies

- `Utils` - Core utilities (required)
- `EventBus` - Event communication (required)
- `PyodideRuntime` - Python execution engine (required)
- `Storage` - VFS backend for file sync (required)

---

## 9. Success Criteria

**Execution:**
- [ ] Python code executes correctly
- [ ] Return values displayed properly
- [ ] Stdout/stderr separated correctly
- [ ] Error tracebacks formatted

**Package Management:**
- [ ] Common packages listed
- [ ] Package installation works
- [ ] Installed packages tracked
- [ ] Import after install succeeds

**VFS Integration:**
- [ ] Manual sync works
- [ ] Auto-sync option functional
- [ ] VFS files accessible in Python
- [ ] Output can be saved to VFS

**User Experience:**
- [ ] Shift+Enter executes code
- [ ] Command history navigation
- [ ] Clear output functional
- [ ] Loading state displayed

---

## 10. Known Limitations

1. **Initial load time** - Pyodide download is ~15MB
2. **Memory usage** - WebAssembly has limited heap
3. **No threads** - Python threading not supported
4. **Some packages unavailable** - Not all PyPI packages ported
5. **No GPU** - NumPy runs on CPU only

---

## 11. Future Enhancements

1. **Jupyter-style cells** - Multi-cell notebook interface
2. **Matplotlib rendering** - Display plots inline
3. **Variable inspector** - Show current namespace
4. **Code completion** - Python autocomplete
5. **Persistent sessions** - Save/restore Python state
6. **Package search** - Search Pyodide package index

---

**Status:** Planned

