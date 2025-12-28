# Blueprint 0x000087: Substrate Loader

**Objective:** Dynamically load and execute JavaScript modules from VFS at runtime.

**Target Module:** SubstrateLoader (`capabilities/system/substrate-loader.js`)

**Prerequisites:** Utils, VFS

**Affected Artifacts:** `/capabilities/system/substrate-loader.js`

---

### 1. The Strategic Imperative

The REPLOID substrate enables runtime self-modification through dynamic module loading. The SubstrateLoader:

- Loads JavaScript from VFS into executable modules
- Creates Blob URLs for dynamic imports
- Renders widgets to DOM containers
- Enables hot-swapping of components

### 2. The Architectural Solution

Uses browser-native dynamic imports with Blob URLs:

**Module Structure:**
```javascript
const SubstrateLoader = {
  metadata: {
    id: 'SubstrateLoader',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'VFS'],
    type: 'capability'
  },

  factory: (deps) => {
    const loadModule = async (path) => {
      const code = await VFS.read(path);
      const blob = new Blob([code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);

      try {
        const module = await import(url);
        return module;
      } finally {
        URL.revokeObjectURL(url); // Cleanup
      }
    };

    const loadWidget = async (path, containerId) => {
      const module = await loadModule(path);
      const container = document.getElementById(containerId);
      container.innerHTML = '';
      container.appendChild(module.default.render());
    };

    return { loadModule, loadWidget };
  }
};
```

### 3. Module Loading Flow

1. Read JavaScript source from VFS
2. Create Blob with MIME type `text/javascript`
3. Generate temporary Blob URL
4. Dynamic import via browser's module system
5. Revoke Blob URL (cleanup)
6. Return loaded module exports

### 4. Widget Convention

Widgets must export a `default` object with a `render()` method:
```javascript
export default {
  render() {
    const el = document.createElement('div');
    el.textContent = 'Hello from widget!';
    return el;
  }
};
```

### 5. API Surface

| Method | Description |
|--------|-------------|
| `loadModule(path)` | Load and execute JS module from VFS, return exports |
| `loadWidget(path, containerId)` | Load module and render to DOM container |

### 6. Genesis Level

**FULL** - Required for runtime self-modification (RSI Level 1+).

---

### 7. Security Considerations

- Loaded code executes in the main context (no sandbox)
- VerificationManager should pre-check code before loading
- Only load from trusted VFS paths (`/tools/`, `/apps/`)
- Blob URLs are immediately revoked to prevent reuse

### 8. Use Cases

1. **Dynamic Tools:** Load agent-created tools at runtime
2. **Hot Reload:** Replace modules without page refresh
3. **Plugin System:** Load optional capabilities on demand
4. **Widget Rendering:** Display VFS-stored UI components
