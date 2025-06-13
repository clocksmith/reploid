# Blueprint 06: Conceptual IndexedDB Storage Upgrade

**Objective:** To guide the agent in replacing its default synchronous `localStorage` backend with a more robust, asynchronous `IndexedDB` backend, enabling larger storage capacity and non-blocking I/O.

---

### **1. The Strategic Imperative: Overcoming `localStorage` Limitations**

The default `storage.js` module provides a simple, synchronous persistence layer using the browser's `localStorage` API. While sufficient for initial operations, it presents two critical limitations to long-term, sophisticated evolution:

*   **Size Constraint:** `localStorage` is typically limited to 5-10 MB of storage per origin. This is insufficient for storing a long history of artifacts, large datasets, or potentially caching machine learning models.
*   **Synchronous API:** Every read and write operation to `localStorage` is synchronous, blocking the browser's main thread. As the agent's state and artifacts grow in size and complexity, these synchronous operations will become a significant performance bottleneck, leading to a sluggish and unresponsive UI.

To achieve true, long-term autonomy and handle more complex tasks, the agent must upgrade its persistence layer. IndexedDB is the standard browser technology for this purpose, offering a much larger storage quota and a fully asynchronous, transactional API.

### **2. The Architectural Challenge: The Asynchronous Cascade**

This upgrade is more than a simple module swap; it represents a fundamental architectural shift. The core challenge lies in transitioning from a synchronous to an asynchronous storage API.

The current `storage.js` has functions like `getArtifactContent(path)` which immediately return a value (or `null`). An IndexedDB-based implementation must, by its nature, return a `Promise`.

```javascript
// Current (synchronous)
function getArtifactContent(path) {
  return localStorage.getItem(path);
}

// Proposed (asynchronous)
async function getArtifactContent(path) {
  // ... IndexedDB logic ...
  return new Promise((resolve, reject) => {
    // ... transaction logic ...
    request.onsuccess = () => resolve(request.result.content);
    request.onerror = () => reject(request.error);
  });
}
```

This change creates a "refactoring cascade." Any function that directly or indirectly depends on reading from storage must now become `async` and use `await` to get the result.

**Example Cascade:**

1.  `ToolRunner.runTool('read_artifact', ...)` calls `Storage.getArtifactContent(...)`.
2.  Therefore, `runTool` must become `async` and `await` the result.
3.  `AgentCycle.executeCycle()` calls `runTool(...)`.
4.  Therefore, `executeCycle` must become `async` and `await` the tool result.

The agent must analyze its entire codebase to identify every call chain affected by this change and correctly apply the `async`/`await` pattern throughout.

### **3. Conceptual API for `storage-indexeddb.js`**

The agent should aim to create a new `storage-indexeddb.js` artifact that exposes a similar, albeit asynchronous, API to the original.

```javascript
const StorageModule = (config, logger, Errors) => {
  const DB_NAME = 'REPLOID_VFS';
  const STORE_NAME = 'artifacts';
  let db;

  // Must handle the initial DB connection and schema setup
  const initDB = () => { /* ... */ };

  // Must be async
  const getArtifactContent = async (path) => { /* ... */ };

  // Must be async
  const setArtifactContent = async (path, content) => { /* ... */ };

  // Must be async
  const deleteArtifactVersion = async (path) => { /* ... */ };

  // These can wrap the core async methods
  const getState = async () => getArtifactContent('/system/state.json');
  const saveState = async (stateString) => setArtifactContent('/system/state.json', stateString);

  return {
    getArtifactContent,
    setArtifactContent,
    deleteArtifactVersion,
    getState,
    saveState,
    // ... and any other required methods
  };
};
```

### **4. Implementation Pathway**

1.  **Create New Artifact:** The agent must first create the `x/upgrades/storage-indexeddb.js` file.
2.  **Implement IDB Logic:** It needs to implement the core IndexedDB logic for:
    *   Opening the database (`indexedDB.open`).
    *   Handling schema upgrades (`onupgradeneeded`) to create the object store.
    *   Creating transactions (`db.transaction`).
    *   Implementing `get`, `put`, and `delete` operations on the store.
3.  **Refactor Call Stack:** This is the most complex step. The agent must:
    *   Use its `read_artifact` tool to analyze every module in its VFS (e.g., `state-manager.js`, `tool-runner.js`, `agent-cycle.js`).
    *   Identify all functions that call `Storage.*` methods.
    *   Propose `modified` changes for each of these files, adding `async` and `await` keywords where necessary to correctly handle the Promise-based API of the new storage module.
4.  **Update `config.json`:** If the goal is a permanent switch, the agent could propose modifying the `defaultCore` composition in its `config.json` to replace the `store` upgrade ID with `idb`.
5.  **Test:** A final cycle should test a simple I/O operation (like reading the system prompt) to ensure the entire asynchronous pipeline is functioning correctly.