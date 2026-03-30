# Blueprint 0x000088-SLDR: Substrate Loader

**Objective:** Dynamically load ES modules and widgets from VFS at runtime using blob URLs for RSI substrate execution.

**Target Module:** `SubstrateLoader`

**Implementation:** `/capabilities/system/substrate-loader.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000011` (VFS/IndexedDB Storage)

**Category:** System

**Genesis:** Full

---

## 1. The Strategic Imperative

For recursive self-improvement (RSI) to function, the agent must be able to execute code it has written and stored in the VFS. The browser's ES module system requires valid URLs for `import()`, but VFS content exists only in IndexedDB. The Substrate Loader bridges this gap by converting VFS content to blob URLs that the browser can import as native ES modules.

This capability is foundational for:
- **Dynamic Tool Loading**: Loading agent-created tools from VFS
- **Widget Rendering**: Dynamically loading and mounting UI widgets
- **Hot Code Execution**: Running newly written code without page reload
- **Modular Substrate Evolution**: The agent can modify and reload its own components

## 2. The Architectural Solution

The `/capabilities/system/substrate-loader.js` exports a `SubstrateLoader` service with two primary methods for dynamic code execution.

### Module Structure

```javascript
const SubstrateLoader = {
  metadata: {
    id: 'SubstrateLoader',
    version: '1.0.0',
    dependencies: ['Storage', 'Utils'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Storage, Utils } = deps;
    const { logger } = Utils;

    /**
     * Load an ES module from VFS path
     * @param {string} path - VFS path to module (e.g., '/tools/MyTool.js')
     * @returns {Promise<Object>} - The imported module exports
     */
    const loadModule = async (path) => {
      // 1. Read module content from VFS
      const content = await Storage.getArtifactContent(path);
      if (!content) {
        throw new Error(`Module not found in VFS: ${path}`);
      }

      // 2. Create blob with JavaScript MIME type
      const blob = new Blob([content], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);

      try {
        // 3. Dynamic import using blob URL
        logger.info(`[SubstrateLoader] Loading module: ${path}`);
        const module = await import(blobUrl);
        return module;
      } finally {
        // 4. Always revoke blob URL to prevent memory leaks
        URL.revokeObjectURL(blobUrl);
      }
    };

    /**
     * Load and render a widget to a DOM container
     * @param {string} path - VFS path to widget module
     * @param {string} containerId - DOM element ID to mount widget
     * @returns {Promise<HTMLElement>} - The mounted widget element
     */
    const loadWidget = async (path, containerId) => {
      // 1. Load the widget module
      const widgetModule = await loadModule(path);

      // 2. Find container element
      const container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`Container not found: ${containerId}`);
      }

      // 3. Instantiate and mount widget
      if (widgetModule.default?.render) {
        // Function-based widget
        const element = widgetModule.default.render();
        container.appendChild(element);
        return element;
      } else if (widgetModule.default?.prototype instanceof HTMLElement) {
        // Web Component widget
        const element = new widgetModule.default();
        container.appendChild(element);
        return element;
      } else if (typeof widgetModule.mount === 'function') {
        // Mount function pattern
        return widgetModule.mount(container);
      }

      throw new Error(`Invalid widget format: ${path}`);
    };

    /**
     * Check if a module exists in VFS
     * @param {string} path - VFS path to check
     * @returns {Promise<boolean>}
     */
    const exists = async (path) => {
      const content = await Storage.getArtifactContent(path);
      return content !== null && content !== undefined;
    };

    return {
      loadModule,
      loadWidget,
      exists
    };
  }
};
```

## 3. The Implementation Pathway

### Step 1: Read Content from VFS

```javascript
const content = await Storage.getArtifactContent(path);
if (!content) {
  throw new Error(`Module not found in VFS: ${path}`);
}
```

The VFS (backed by IndexedDB) stores all agent-written code. The Storage service provides access to this content.

### Step 2: Create Blob URL

```javascript
const blob = new Blob([content], { type: 'application/javascript' });
const blobUrl = URL.createObjectURL(blob);
```

`URL.createObjectURL()` creates a temporary URL that points to the in-memory blob. This URL is valid for the lifetime of the document or until revoked.

### Step 3: Dynamic Import

```javascript
const module = await import(blobUrl);
```

The browser's native ES module system handles the import, including:
- Parsing the JavaScript
- Resolving any relative imports (within the blob)
- Executing the module code
- Returning the exports

### Step 4: Cleanup

```javascript
URL.revokeObjectURL(blobUrl);
```

**Critical:** Always revoke blob URLs after import to prevent memory leaks. Using `finally` ensures cleanup even if import fails.

## 4. Data Flow Diagram

```
VFS (IndexedDB)
      |
      v
  [Read Content]
      |
      v
  [Create Blob]
      |
      v
 [Blob URL]  --->  [Dynamic Import]
      |                   |
      v                   v
 [Revoke URL]        [Module Exports]
```

## 5. Widget Loading Patterns

The `loadWidget` method supports multiple widget formats:

### Pattern A: Render Function

```javascript
// /widgets/my-widget.js
export default {
  render() {
    const div = document.createElement('div');
    div.innerHTML = '<h1>My Widget</h1>';
    return div;
  }
};
```

### Pattern B: Web Component

```javascript
// /widgets/my-component.js
export default class MyComponent extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<h1>My Component</h1>';
  }
}
customElements.define('my-component', MyComponent);
```

### Pattern C: Mount Function

```javascript
// /widgets/my-app.js
export function mount(container) {
  container.innerHTML = '<div id="app">Mounted!</div>';
  return container.firstChild;
}
```

## 6. Operational Safeguards & Quality Gates

### Security Considerations

| Concern | Mitigation |
|---------|------------|
| Arbitrary code execution | Only loads from VFS (sandboxed by browser) |
| Host filesystem access | Blob URLs are ephemeral, no file:// access |
| Memory leaks | Blob URLs revoked immediately after import |
| Malicious imports | VFS content is agent-controlled, not external |
| Cross-origin issues | Blob URLs are same-origin by default |

### Error Handling

```javascript
try {
  const module = await SubstrateLoader.loadModule(path);
} catch (error) {
  if (error.message.includes('not found')) {
    // Module doesn't exist in VFS
  } else if (error instanceof SyntaxError) {
    // Invalid JavaScript in module
  } else {
    // Import failed for other reason
  }
}
```

### Validation Before Load

```javascript
// Check existence before loading
if (await SubstrateLoader.exists(path)) {
  const module = await SubstrateLoader.loadModule(path);
}
```

## 7. Integration Examples

### Loading a Dynamic Tool

```javascript
// Agent creates and stores a tool
await Storage.setArtifactContent('/tools/CustomTool.js', `
  export default {
    name: 'CustomTool',
    execute: async (args) => {
      return { result: 'Custom tool executed!' };
    }
  };
`);

// Later, load and use the tool
const { default: CustomTool } = await SubstrateLoader.loadModule('/tools/CustomTool.js');
const result = await CustomTool.execute({ input: 'test' });
```

### Dynamic Widget Mounting

```javascript
// Load and mount a widget to the UI
await SubstrateLoader.loadWidget('/widgets/status-display.js', 'widget-container');
```

## 8. Extension Points

- **Module Caching**: Cache loaded modules to avoid repeated blob creation
- **Dependency Resolution**: Resolve VFS imports within modules
- **Hot Reload**: Detect VFS changes and reload modules automatically
- **Module Registry**: Track all loaded modules for cleanup on unload
- **Import Maps**: Support import maps for VFS module resolution

---

**Status:** Implemented
