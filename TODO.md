# REPLOID Improvement Roadmap

This document outlines comprehensive improvements to the REPLOID Guardian Agent system, organized by priority and impact. Each item includes specific file locations, detailed problem descriptions, and implementation guidance.

**Last Updated:** 2025-09-30

---

## ✅ COMPLETED (2025-09-30)

### ✓ 1. Fix Diff Viewer Async Race Condition
**Status:** COMPLETED
**Files:** `upgrades/diff-viewer-ui.js:68, 98-105`
- Made `parseDogsBundle()` async
- Added proper `await` for `StateManager.getArtifactContent()`
- Added error handling for failed content fetches

### ✓ 2. Implement parseProposedChanges in Sentinel FSM
**Status:** COMPLETED
**Files:** `upgrades/sentinel-fsm.js:574-622`
- Replaced hardcoded placeholder with actual regex parsing
- Extracts CREATE/MODIFY/DELETE operations from markdown
- Validates file paths and ensures they start with `/vfs/`
- Handles multiple changes in one proposal

### ✓ 3. Fix Diff Viewer Global State Bug
**Status:** COMPLETED
**Files:** `upgrades/diff-viewer-ui.js:638-656, 662-722`
- Changed from creating new factory instances to using single shared instance
- Added `_setInstance()` method to properly initialize
- All onclick handlers now reference the same state

### ✓ 4. Fix Memory Leaks in Event Listeners
**Status:** COMPLETED
**Files:** `upgrades/sentinel-fsm.js:172-230, 304-356`, `upgrades/diff-viewer-ui.js:21-37`
- Added `listeners` object to track event handlers
- Created `cleanupListeners()` functions
- Ensures cleanup on all state transitions and re-initialization

### ✓ 5. Implement Actual Verification Runner
**Status:** COMPLETED
**Files:** `upgrades/sentinel-tools.js:334-401`
- Added integration with VerificationManager (Web Worker sandbox)
- Implemented fallback patterns for common commands
- Added proper error handling and logging
- Marked VerificationManager as optional dependency

### ✓ 6. Add npm Package Configuration
**Status:** COMPLETED
**Files:** `package.json:7-22`
- Added `bin` entries for global CLI access (reploid, cats, dogs)
- Added dev scripts (dev:all, dev:proxy, dev:hermes, dev:browser)
- Added test scripts
- Added concurrently as dev dependency
- Made reploid-cli.js executable

### ✓ 7. Add Visible FSM Status Indicator
**Status:** COMPLETED
**Files:** `ui-dashboard.html:2-13`, `styles/dashboard.css:31-90`, `upgrades/sentinel-fsm.js:35-103`
- Added status bar to dashboard with icon, state, and detail text
- Added CSS styling with animations
- Integrated `updateStatusUI()` into sentinel FSM
- Updates on every state transition

### ✓ 8. Fix Security Vulnerabilities
**Status:** COMPLETED
**Files:** `ui-dashboard.html:42`, `bin/cats:112-117`, `SECURITY-NOTES.md`
- Fixed iframe sandbox (removed allow-same-origin, added CSP)
- Added shell injection mitigation in cats CLI
- Created SECURITY-NOTES.md documenting known concerns

### ✓ 9. Add Confirmation Dialogs
**Status:** COMPLETED
**Files:** `upgrades/confirmation-modal.js` (new), `upgrades/diff-viewer-ui.js:8, 377-419`, `config.json:190-195`
- Created ConfirmationModal component with full styling
- Integrated into DiffViewerUI for apply operations
- Added to config.json module registry
- Supports danger mode, details, keyboard shortcuts

### ✓ 10. Complete Git VFS Integration
**Status:** COMPLETED
**Files:** `upgrades/git-vfs.js:273-362`, `upgrades/state-manager.js:147-221`
- Implemented `getCommitChanges()` with tree comparison
- Added helper functions for tree traversal
- Fixed checkpoint data persistence to include actual content
- Fixed restoreCheckpoint to properly restore artifact contents

---

## 🔴 CRITICAL - Fix Core Functionality Blockers (ORIGINAL)

### 1. Fix Diff Viewer Async Race Condition [COMPLETED]

**Location:** `/Users/xyz/deco/reploid/upgrades/diff-viewer-ui.js:98-103`

**Problem:**
```javascript
// Current broken code:
for (const change of changes) {
  const oldContent = change.operation === 'MODIFY'
    ? StateManager.getArtifactContent(change.filePath)  // Returns Promise, not awaited!
    : '';
  // oldContent is always a Promise object, not string content
}
```

**Impact:** Diff viewer shows incorrect/empty diffs for MODIFY operations because `getArtifactContent()` is async but not awaited in the loop.

**Solution:**
- Add `await` before `StateManager.getArtifactContent()` call
- Make the parent function async if not already
- Handle promise rejections appropriately
- Add loading state while fetching content

**Implementation Details:**
```javascript
// Fixed code:
for (const change of changes) {
  let oldContent = '';
  if (change.operation === 'MODIFY') {
    try {
      oldContent = await StateManager.getArtifactContent(change.filePath);
    } catch (err) {
      console.error(`Failed to fetch old content for ${change.filePath}:`, err);
      oldContent = '// Error loading original content';
    }
  }
  // Rest of diff rendering logic...
}
```

---

### 2. Implement parseProposedChanges in Sentinel FSM

**Location:** `/Users/xyz/deco/reploid/upgrades/sentinel-fsm.js:573-582`

**Problem:**
```javascript
// Current stub implementation:
function parseProposedChanges(proposalText) {
  // TODO: Parse LLM response into structured changes
  return [
    { operation: 'CREATE', filePath: '/vfs/example.js', content: '// Example' }
  ];
}
```

**Impact:** Proposal generation is completely non-functional. Always returns hardcoded example data regardless of LLM output.

**Solution:**
Implement proper parsing of LLM-generated proposals that:
- Extracts operation type (CREATE, MODIFY, DELETE)
- Parses file paths from markdown code blocks
- Extracts file content from code blocks
- Handles multiple changes in one proposal
- Validates format and reports parsing errors

**Implementation Details:**
```javascript
function parseProposedChanges(proposalText) {
  const changes = [];

  // Expected format:
  // ## CREATE: /path/to/file.js
  // ```javascript
  // file content here
  // ```

  const regex = /##\s+(CREATE|MODIFY|DELETE):\s+([^\n]+)\n```[\w]*\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(proposalText)) !== null) {
    const [, operation, filePath, content] = match;
    changes.push({
      operation: operation.trim(),
      filePath: filePath.trim(),
      content: operation === 'DELETE' ? null : content.trim()
    });
  }

  if (changes.length === 0) {
    console.warn('No changes parsed from proposal:', proposalText);
  }

  return changes;
}
```

**Additional Requirements:**
- Support alternative formats (dogs.md format)
- Handle edge cases (missing closing backticks, special characters in paths)
- Add validation to ensure paths are within session workspace
- Log unparsed sections for debugging

---

### 3. Fix Diff Viewer Global State Bug

**Location:** `/Users/xyz/deco/reploid/upgrades/diff-viewer-ui.js:659-667`

**Problem:**
```javascript
// Broken pattern:
window.DiffViewerUI = {
  init: () => createDiffViewerUIFactory().init(),
  approveAll: () => createDiffViewerUIFactory().approveAll(),
  rejectAll: () => createDiffViewerUIFactory().rejectAll(),
  // ... each call creates NEW factory instance with independent state!
};
```

**Impact:** Every onclick handler creates a new factory instance with fresh state. UI checkboxes don't connect to approval handlers. Nothing works.

**Solution:**
Create a single shared instance:
```javascript
// Fixed pattern:
const sharedInstance = createDiffViewerUIFactory();
window.DiffViewerUI = {
  init: (...args) => sharedInstance.init(...args),
  approveAll: () => sharedInstance.approveAll(),
  rejectAll: () => sharedInstance.rejectAll(),
  toggleApproval: (filePath) => sharedInstance.toggleApproval(filePath),
  editProposal: () => sharedInstance.editProposal(),
  applyChanges: () => sharedInstance.applyChanges()
};
```

**Additional Improvements:**
- Remove onclick handlers from HTML strings (XSS risk)
- Use event delegation with data attributes instead
- Implement proper cleanup on re-initialization
- Add CSP-compliant event handling

---

### 4. Implement Actual Verification Runner

**Location:** `/Users/xyz/deco/reploid/upgrades/sentinel-tools.js:334-360`

**Problem:**
```javascript
// Current placeholder:
async function runVerification(command, options = {}) {
  log('Running verification command:', command);
  // TODO: Implement actual execution in Web Worker
  await sleep(1000);
  log('Verification passed (simulated)');
  return { success: true, output: 'All tests passed' };
}
```

**Impact:** Verification commands are never actually executed. Always returns success. Defeats the entire safety mechanism.

**Solution:**
Integrate with existing Web Worker infrastructure:
- Use `upgrades/verification-worker.js` and `upgrades/verification-manager.js`
- Execute commands in sandboxed Web Worker context
- Capture stdout/stderr
- Handle timeouts
- Return actual exit codes

**Implementation Details:**
```javascript
async function runVerification(command, options = {}) {
  const { timeout = 30000, cwd = '/vfs' } = options;

  log(`Running verification: ${command}`);

  try {
    // Get verification manager from DI container
    const verificationManager = DIContainer.resolve('VerificationManager');

    const result = await verificationManager.execute({
      command,
      cwd,
      timeout,
      env: { NODE_ENV: 'test' }
    });

    if (result.exitCode === 0) {
      log('✓ Verification passed');
      return { success: true, output: result.stdout };
    } else {
      log(`✗ Verification failed with code ${result.exitCode}`);
      return {
        success: false,
        output: result.stdout,
        error: result.stderr
      };
    }
  } catch (err) {
    log(`✗ Verification error: ${err.message}`);
    return { success: false, error: err.message };
  }
}
```

**Additional Requirements:**
- Add progress callbacks for long-running verifications
- Support common verification patterns (npm test, npm run build, pytest, etc.)
- Parse test output for structured results
- Show verification output in UI
- Allow user to skip verification with confirmation

---

### 5. Fix Memory Leaks in Event Listeners

**Location:** `/Users/xyz/deco/reploid/upgrades/sentinel-fsm.js:180-207`

**Problem:**
```javascript
// Event listeners registered but only cleaned up on successful transition
EventBus.on('context:approved', handleApproval);
EventBus.on('context:approval:timeout', handleTimeout);

// If approval is cancelled or times out, listeners accumulate
// Next time through, multiple handlers fire
```

**Impact:** Event listeners accumulate on every cycle. After several approval requests, multiple handlers fire simultaneously causing race conditions and memory bloat.

**Solution:**
Implement proper cleanup pattern:
```javascript
// Store listener references for cleanup
const listeners = {
  approval: null,
  timeout: null
};

// Register with cleanup
const registerApprovalListeners = () => {
  // Clean up any existing listeners first
  if (listeners.approval) EventBus.off('context:approved', listeners.approval);
  if (listeners.timeout) EventBus.off('context:approval:timeout', listeners.timeout);

  // Register new listeners
  listeners.approval = (data) => handleApproval(data);
  listeners.timeout = () => handleTimeout();

  EventBus.on('context:approved', listeners.approval);
  EventBus.on('context:approval:timeout', listeners.timeout);
};

// Always clean up on state exit
const cleanupApprovalListeners = () => {
  if (listeners.approval) EventBus.off('context:approved', listeners.approval);
  if (listeners.timeout) EventBus.off('context:approval:timeout', listeners.timeout);
  listeners.approval = null;
  listeners.timeout = null;
};
```

**Additional Locations:**
- `/Users/xyz/deco/reploid/upgrades/diff-viewer-ui.js:30-39` - Style injection leak (injects new styles on every init)
- `/Users/xyz/deco/reploid/upgrades/event-bus.js:16-24` - No automatic cleanup mechanism

**EventBus Enhancement:**
Add `once()` method for one-time listeners that auto-cleanup:
```javascript
once(event, listener) {
  const wrapper = (data) => {
    listener(data);
    this.off(event, wrapper);
  };
  this.on(event, wrapper);
}
```

---

## 🔵 RSI-SPECIFIC PRIORITIES - Core Self-Improvement Capabilities

These items are critical for achieving the project's core goal: **an agentic AI capable of Recursive Self-Improvement (RSI) via source code manipulation in the browser ecosystem**.

---

### RSI-1. Code Introspection & Self-Analysis

**Priority:** CRITICAL for RSI
**Complexity:** Medium
**Impact:** Enables agent to understand its own architecture

**Current State:**
- Agent can read files via VFS
- No specialized introspection API
- No self-awareness of its own module graph
- Cannot analyze its own dependencies or capabilities

**Gap:**
For RSI, the agent needs to programmatically understand its own architecture:
- Module dependency graph
- Available tools and their signatures
- Current configuration and capabilities
- Performance bottlenecks in its own code

**Implementation:**

```javascript
// upgrades/introspector.js
const Introspector = {
  metadata: {
    id: 'Introspector',
    version: '1.0.0',
    dependencies: ['DIContainer', 'StateManager', 'Utils'],
    type: 'service'
  },

  factory: (deps) => {
    const { DIContainer, StateManager, Utils } = deps;
    const { logger } = Utils;

    const getModuleGraph = () => {
      // Return dependency graph of all registered modules
      const modules = DIContainer.getAllModules();
      const graph = {};

      for (const [id, module] of Object.entries(modules)) {
        graph[id] = {
          version: module.metadata.version,
          dependencies: module.metadata.dependencies || [],
          type: module.metadata.type,
          location: module.metadata.location || 'unknown'
        };
      }

      return graph;
    };

    const getToolCatalog = () => {
      // Introspect available tools with signatures
      const toolRunner = DIContainer.get('ToolRunner');
      const tools = toolRunner.getAllTools();

      return tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        requiredCapabilities: tool.requiredCapabilities || []
      }));
    };

    const analyzeOwnCode = async (modulePath) => {
      // Read and analyze own source code
      const content = await StateManager.getArtifactContent(modulePath);

      return {
        path: modulePath,
        linesOfCode: content.split('\n').length,
        complexity: calculateComplexity(content),
        dependencies: extractDependencies(content),
        exports: extractExports(content),
        todos: extractTodos(content)
      };
    };

    const getCapabilities = () => {
      // Discover what the agent can actually do
      return {
        canReadFiles: true,
        canWriteFiles: true,
        canExecutePython: !!DIContainer.has('PyodideRuntime'),
        canRunLocalLLM: !!DIContainer.has('LocalLLM'),
        canVisualizeData: !!DIContainer.has('DataVisualizer'),
        canAccessFileSystem: 'showOpenFilePicker' in window,
        canSendNotifications: 'Notification' in window,
        canUseWebGPU: 'gpu' in navigator,
        tools: getToolCatalog()
      };
    };

    const extractDependencies = (code) => {
      // Extract require() and import statements
      const requires = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
      const imports = [...code.matchAll(/import.*from ['"]([^'"]+)['"]/g)].map(m => m[1]);
      return [...new Set([...requires, ...imports])];
    };

    const extractExports = (code) => {
      // Extract exported functions/objects
      const exports = [...code.matchAll(/(?:export|module\.exports\s*=\s*)\s*(?:function\s+)?(\w+)/g)].map(m => m[1]);
      return [...new Set(exports)];
    };

    const extractTodos = (code) => {
      // Find TODO comments in code
      return [...code.matchAll(/\/\/\s*TODO:?\s*(.+)/gi)].map(m => m[1].trim());
    };

    const calculateComplexity = (code) => {
      // Simple cyclomatic complexity approximation
      const branches = (code.match(/\b(if|else|for|while|case|catch)\b/g) || []).length;
      return branches + 1;
    };

    return {
      api: {
        getModuleGraph,
        getToolCatalog,
        analyzeOwnCode,
        getCapabilities
      }
    };
  }
};
```

**Benefits:**
- Agent can understand what it can/can't do
- Self-analysis for optimization opportunities
- Dependency-aware code changes
- Foundation for intelligent self-modification

---

### RSI-2. Reflection Persistence & Learning

**Priority:** HIGH for RSI
**Complexity:** Medium
**Impact:** Enables meta-learning across sessions

**Current State:**
- REFLECTING state exists but doesn't persist learnings
- No memory of past failures/successes
- Each session starts from scratch
- Reflections lost when page reloads

**Gap:**
For RSI, the agent needs to accumulate knowledge:
- What strategies worked/failed
- Common error patterns
- Performance metrics over time
- User preferences and patterns

**Implementation:**

```javascript
// upgrades/reflection-store.js
const ReflectionStore = {
  metadata: {
    id: 'ReflectionStore',
    version: '1.0.0',
    dependencies: ['Utils'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;
    const DB_NAME = 'reploid_reflections';
    const STORE_NAME = 'reflections';

    let db = null;

    const init = async () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          db = request.result;
          resolve();
        };

        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('sessionId', 'sessionId', { unique: false });
            store.createIndex('outcome', 'outcome', { unique: false });
          }
        };
      });
    };

    const addReflection = async (reflection) => {
      const entry = {
        ...reflection,
        timestamp: Date.now(),
        version: '1.0'
      };

      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.add(entry);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    };

    const getReflections = async (filters = {}) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          let results = request.result;

          // Apply filters
          if (filters.sessionId) {
            results = results.filter(r => r.sessionId === filters.sessionId);
          }
          if (filters.outcome) {
            results = results.filter(r => r.outcome === filters.outcome);
          }
          if (filters.limit) {
            results = results.slice(-filters.limit);
          }

          resolve(results);
        };
        request.onerror = () => reject(request.error);
      });
    };

    const getSuccessPatterns = async () => {
      const successful = await getReflections({ outcome: 'success' });

      // Analyze patterns
      const patterns = {};
      for (const reflection of successful) {
        const key = reflection.strategy || 'unknown';
        patterns[key] = (patterns[key] || 0) + 1;
      }

      return Object.entries(patterns)
        .sort((a, b) => b[1] - a[1])
        .map(([strategy, count]) => ({ strategy, successCount: count }));
    };

    const getFailurePatterns = async () => {
      const failed = await getReflections({ outcome: 'failure' });

      const patterns = {};
      for (const reflection of failed) {
        const error = reflection.error || 'unknown';
        patterns[error] = (patterns[error] || 0) + 1;
      }

      return Object.entries(patterns)
        .sort((a, b) => b[1] - a[1])
        .map(([error, count]) => ({ error, failureCount: count }));
    };

    return {
      api: {
        init,
        addReflection,
        getReflections,
        getSuccessPatterns,
        getFailurePatterns
      }
    };
  }
};
```

**Benefits:**
- Agent learns from experience
- Avoids repeating mistakes
- Builds success patterns over time
- Foundation for continuous improvement

---

### RSI-3. Self-Testing & Validation Framework

**Priority:** HIGH for RSI
**Complexity:** High
**Impact:** Essential for safe self-modification

**Current State:**
- Verification runner can run test commands
- No self-testing specifically for agent code
- No regression detection for RSI changes
- Cannot validate that self-modifications don't break core functionality

**Gap:**
For safe RSI, the agent must verify its own changes don't break itself:
- Test core FSM transitions
- Verify tool execution
- Check module dependencies
- Validate UI functionality

**Implementation:**

```javascript
// upgrades/self-tester.js
const SelfTester = {
  metadata: {
    id: 'SelfTester',
    version: '1.0.0',
    dependencies: ['DIContainer', 'StateManager', 'ToolRunner', 'Utils'],
    type: 'service'
  },

  factory: (deps) => {
    const { DIContainer, StateManager, ToolRunner, Utils } = deps;
    const { logger } = Utils;

    const testModuleLoading = async () => {
      const results = [];
      const modules = DIContainer.getAllModules();

      for (const [id, module] of Object.entries(modules)) {
        try {
          const instance = DIContainer.get(id);
          results.push({
            module: id,
            status: 'ok',
            hasApi: !!instance.api
          });
        } catch (err) {
          results.push({
            module: id,
            status: 'error',
            error: err.message
          });
        }
      }

      return {
        passed: results.filter(r => r.status === 'ok').length,
        failed: results.filter(r => r.status === 'error').length,
        details: results
      };
    };

    const testToolExecution = async () => {
      const results = [];
      const tools = ToolRunner.getAllTools();

      for (const tool of tools) {
        try {
          // Test with minimal valid input
          if (tool.name === 'read_artifact') {
            await ToolRunner.executeTool('read_artifact', { path: '/vfs/config.json' });
            results.push({ tool: tool.name, status: 'ok' });
          }
          // Add more tool-specific tests
        } catch (err) {
          results.push({ tool: tool.name, status: 'error', error: err.message });
        }
      }

      return {
        passed: results.filter(r => r.status === 'ok').length,
        failed: results.filter(r => r.status === 'error').length,
        details: results
      };
    };

    const testFSMTransitions = async () => {
      // Test that FSM can transition through states
      const sentinel = DIContainer.get('SentinelFSM');
      const results = [];

      try {
        const initialState = sentinel.api.getState();
        results.push({ test: 'getState', status: 'ok', state: initialState });
      } catch (err) {
        results.push({ test: 'getState', status: 'error', error: err.message });
      }

      // Test event emission
      try {
        sentinel.api.emit('test_event', { data: 'test' });
        results.push({ test: 'emit', status: 'ok' });
      } catch (err) {
        results.push({ test: 'emit', status: 'error', error: err.message });
      }

      return {
        passed: results.filter(r => r.status === 'ok').length,
        failed: results.filter(r => r.status === 'error').length,
        details: results
      };
    };

    const runAllTests = async () => {
      logger.info('[SelfTester] Running comprehensive self-tests...');

      const moduleTests = await testModuleLoading();
      const toolTests = await testToolExecution();
      const fsmTests = await testFSMTransitions();

      const totalPassed = moduleTests.passed + toolTests.passed + fsmTests.passed;
      const totalFailed = moduleTests.failed + toolTests.failed + fsmTests.failed;

      return {
        summary: {
          totalPassed,
          totalFailed,
          passRate: (totalPassed / (totalPassed + totalFailed) * 100).toFixed(2) + '%'
        },
        modules: moduleTests,
        tools: toolTests,
        fsm: fsmTests,
        timestamp: new Date().toISOString()
      };
    };

    return {
      api: {
        testModuleLoading,
        testToolExecution,
        testFSMTransitions,
        runAllTests
      }
    };
  }
};
```

**Benefits:**
- Safe self-modification with regression detection
- Immediate feedback on broken changes
- Confidence in RSI experiments
- Automated validation before applying changes

---

### RSI-4. Web API Integration for Enhanced Capabilities

**Priority:** MEDIUM for RSI
**Complexity:** Medium
**Impact:** Leverages browser ecosystem advantages

**Current State:**
- Basic browser APIs used (Web Workers, IndexedDB)
- No File System Access API integration
- No Web Notifications
- No Web Share API
- No Clipboard API
- Missing many browser capabilities that make browser superior to CLI

**Gap:**
The core thesis is that browser is the perfect RSI ecosystem. Must leverage:
- **File System Access API**: Direct read/write to real filesystem
- **Web Notifications**: Alert user of long-running task completion
- **Clipboard API**: Easy copy/paste of code, diffs, results
- **Web Share API**: Share agent outputs with others
- **Screen Wake Lock**: Keep agent running during long tasks
- **Storage Estimation**: Monitor quota usage

**Implementation:**

```javascript
// upgrades/browser-apis.js
const BrowserAPIs = {
  metadata: {
    id: 'BrowserAPIs',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    let fileSystemHandle = null;
    let wakeLock = null;

    // File System Access API
    const requestFileSystemAccess = async () => {
      if (!('showDirectoryPicker' in window)) {
        throw new Error('File System Access API not supported');
      }

      try {
        fileSystemHandle = await window.showDirectoryPicker({
          mode: 'readwrite'
        });
        logger.info('[BrowserAPIs] File system access granted');
        EventBus.emit('filesystem:access:granted', { handle: fileSystemHandle });
        return fileSystemHandle;
      } catch (err) {
        if (err.name === 'AbortError') {
          logger.info('[BrowserAPIs] User cancelled file system access');
        } else {
          logger.error('[BrowserAPIs] File system access error:', err);
        }
        throw err;
      }
    };

    const readRealFile = async (filename) => {
      if (!fileSystemHandle) {
        throw new Error('No file system access granted');
      }

      try {
        const fileHandle = await fileSystemHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        const content = await file.text();
        return content;
      } catch (err) {
        logger.error(`[BrowserAPIs] Error reading ${filename}:`, err);
        throw err;
      }
    };

    const writeRealFile = async (filename, content) => {
      if (!fileSystemHandle) {
        throw new Error('No file system access granted');
      }

      try {
        const fileHandle = await fileSystemHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        logger.info(`[BrowserAPIs] Wrote ${filename}`);
        EventBus.emit('filesystem:file:written', { filename });
      } catch (err) {
        logger.error(`[BrowserAPIs] Error writing ${filename}:`, err);
        throw err;
      }
    };

    // Notifications
    const requestNotificationPermission = async () => {
      if (!('Notification' in window)) {
        throw new Error('Notifications not supported');
      }

      if (Notification.permission === 'granted') {
        return true;
      }

      const permission = await Notification.requestPermission();
      return permission === 'granted';
    };

    const notify = async (title, options = {}) => {
      const hasPermission = await requestNotificationPermission();

      if (!hasPermission) {
        logger.warn('[BrowserAPIs] Notification permission denied');
        return;
      }

      new Notification(title, {
        icon: '/favicon.ico',
        badge: '/badge.png',
        ...options
      });

      logger.info(`[BrowserAPIs] Notification: ${title}`);
    };

    // Clipboard
    const copyToClipboard = async (text) => {
      if (!navigator.clipboard) {
        throw new Error('Clipboard API not supported');
      }

      try {
        await navigator.clipboard.writeText(text);
        logger.info('[BrowserAPIs] Copied to clipboard');
        return true;
      } catch (err) {
        logger.error('[BrowserAPIs] Clipboard error:', err);
        return false;
      }
    };

    const readFromClipboard = async () => {
      if (!navigator.clipboard) {
        throw new Error('Clipboard API not supported');
      }

      try {
        const text = await navigator.clipboard.readText();
        logger.info('[BrowserAPIs] Read from clipboard');
        return text;
      } catch (err) {
        logger.error('[BrowserAPIs] Clipboard read error:', err);
        throw err;
      }
    };

    // Wake Lock
    const requestWakeLock = async () => {
      if (!('wakeLock' in navigator)) {
        logger.warn('[BrowserAPIs] Wake Lock API not supported');
        return null;
      }

      try {
        wakeLock = await navigator.wakeLock.request('screen');
        logger.info('[BrowserAPIs] Wake lock acquired');

        wakeLock.addEventListener('release', () => {
          logger.info('[BrowserAPIs] Wake lock released');
        });

        return wakeLock;
      } catch (err) {
        logger.error('[BrowserAPIs] Wake lock error:', err);
        return null;
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    };

    // Share API
    const share = async (data) => {
      if (!navigator.share) {
        logger.warn('[BrowserAPIs] Web Share API not supported');
        return false;
      }

      try {
        await navigator.share(data);
        logger.info('[BrowserAPIs] Shared successfully');
        return true;
      } catch (err) {
        if (err.name === 'AbortError') {
          logger.info('[BrowserAPIs] Share cancelled');
        } else {
          logger.error('[BrowserAPIs] Share error:', err);
        }
        return false;
      }
    };

    // Storage Quota
    const getStorageEstimate = async () => {
      if (!navigator.storage || !navigator.storage.estimate) {
        throw new Error('Storage API not supported');
      }

      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage,
        quota: estimate.quota,
        percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2),
        usageMB: (estimate.usage / (1024 * 1024)).toFixed(2),
        quotaMB: (estimate.quota / (1024 * 1024)).toFixed(2)
      };
    };

    return {
      api: {
        // File System
        requestFileSystemAccess,
        readRealFile,
        writeRealFile,
        // Notifications
        requestNotificationPermission,
        notify,
        // Clipboard
        copyToClipboard,
        readFromClipboard,
        // Wake Lock
        requestWakeLock,
        releaseWakeLock,
        // Share
        share,
        // Storage
        getStorageEstimate
      }
    };
  }
};
```

**Usage Example:**

```javascript
// In SentinelFSM REFLECTING state:
const BrowserAPIs = DIContainer.get('BrowserAPIs');

// Notify when long task completes
await BrowserAPIs.notify('Agent Task Complete', {
  body: 'Successfully applied 15 changes',
  tag: 'agent-completion'
});

// Copy diff to clipboard
await BrowserAPIs.copyToClipboard(diffContent);

// Share results
await BrowserAPIs.share({
  title: 'Agent Output',
  text: 'Check out what the agent built!',
  url: window.location.href
});

// Check storage usage
const storage = await BrowserAPIs.getStorageEstimate();
if (storage.percentUsed > 80) {
  logger.warn('Storage nearly full!');
}
```

**Benefits:**
- Validates browser-native thesis
- Capabilities impossible in CLI
- Better UX than terminal tools
- Direct filesystem access for real projects
- Enhanced user feedback and collaboration

---

### RSI-5. Performance Monitoring & Self-Optimization

**Priority:** MEDIUM for RSI
**Complexity:** Medium
**Impact:** Enables data-driven self-improvement

**Current State:**
- No performance metrics collected
- No bottleneck detection
- Agent can't identify slow operations
- No data to guide optimization decisions

**Gap:**
For intelligent RSI, agent needs performance data:
- Which tools are slowest
- Which FSM states take longest
- Memory usage patterns
- LLM call latency and token usage
- UI rendering performance

**Implementation:**

```javascript
// upgrades/performance-monitor.js
const PerformanceMonitor = {
  metadata: {
    id: 'PerformanceMonitor',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    const metrics = {
      tools: {},
      states: {},
      llmCalls: [],
      memorySnapshots: []
    };

    const startTimer = (category, label) => {
      const start = performance.now();
      return () => {
        const duration = performance.now() - start;
        recordMetric(category, label, duration);
        return duration;
      };
    };

    const recordMetric = (category, label, duration) => {
      if (!metrics[category]) {
        metrics[category] = {};
      }

      if (!metrics[category][label]) {
        metrics[category][label] = {
          count: 0,
          totalDuration: 0,
          minDuration: Infinity,
          maxDuration: -Infinity,
          avgDuration: 0
        };
      }

      const m = metrics[category][label];
      m.count++;
      m.totalDuration += duration;
      m.minDuration = Math.min(m.minDuration, duration);
      m.maxDuration = Math.max(m.maxDuration, duration);
      m.avgDuration = m.totalDuration / m.count;
    };

    const recordLLMCall = (provider, model, tokensIn, tokensOut, latency) => {
      metrics.llmCalls.push({
        timestamp: Date.now(),
        provider,
        model,
        tokensIn,
        tokensOut,
        latency
      });

      // Keep last 1000 calls
      if (metrics.llmCalls.length > 1000) {
        metrics.llmCalls.shift();
      }
    };

    const snapshotMemory = () => {
      if (!performance.memory) {
        return null;
      }

      const snapshot = {
        timestamp: Date.now(),
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        percentUsed: (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit * 100).toFixed(2)
      };

      metrics.memorySnapshots.push(snapshot);

      // Keep last 100 snapshots
      if (metrics.memorySnapshots.length > 100) {
        metrics.memorySnapshots.shift();
      }

      return snapshot;
    };

    const getBottlenecks = () => {
      const bottlenecks = [];

      // Find slowest tools
      for (const [tool, m] of Object.entries(metrics.tools || {})) {
        if (m.avgDuration > 1000) { // > 1 second
          bottlenecks.push({
            type: 'tool',
            name: tool,
            avgDuration: m.avgDuration.toFixed(2) + 'ms',
            count: m.count
          });
        }
      }

      // Find slowest states
      for (const [state, m] of Object.entries(metrics.states || {})) {
        if (m.avgDuration > 5000) { // > 5 seconds
          bottlenecks.push({
            type: 'state',
            name: state,
            avgDuration: m.avgDuration.toFixed(2) + 'ms',
            count: m.count
          });
        }
      }

      return bottlenecks.sort((a, b) => parseFloat(b.avgDuration) - parseFloat(a.avgDuration));
    };

    const getLLMStats = () => {
      if (metrics.llmCalls.length === 0) return null;

      const totalCalls = metrics.llmCalls.length;
      const totalTokensIn = metrics.llmCalls.reduce((sum, c) => sum + c.tokensIn, 0);
      const totalTokensOut = metrics.llmCalls.reduce((sum, c) => sum + c.tokensOut, 0);
      const avgLatency = metrics.llmCalls.reduce((sum, c) => sum + c.latency, 0) / totalCalls;

      return {
        totalCalls,
        totalTokensIn,
        totalTokensOut,
        avgLatency: avgLatency.toFixed(2) + 'ms',
        costEstimate: estimateCost(totalTokensIn, totalTokensOut)
      };
    };

    const estimateCost = (tokensIn, tokensOut) => {
      // Rough estimate: $0.01 per 1K tokens
      const costPerToken = 0.00001;
      return ((tokensIn + tokensOut) * costPerToken).toFixed(4);
    };

    const getReport = () => {
      return {
        tools: metrics.tools,
        states: metrics.states,
        bottlenecks: getBottlenecks(),
        llm: getLLMStats(),
        memory: metrics.memorySnapshots.slice(-10) // Last 10 snapshots
      };
    };

    // Auto-snapshot memory every 30 seconds
    setInterval(() => {
      snapshotMemory();
    }, 30000);

    // Listen to events and record metrics
    EventBus.on('tool:start', (data) => {
      data.endTimer = startTimer('tools', data.toolName);
    });

    EventBus.on('tool:end', (data) => {
      if (data.endTimer) data.endTimer();
    });

    EventBus.on('fsm:state:enter', (data) => {
      data.endTimer = startTimer('states', data.state);
    });

    EventBus.on('fsm:state:exit', (data) => {
      if (data.endTimer) data.endTimer();
    });

    EventBus.on('llm:call:complete', (data) => {
      recordLLMCall(data.provider, data.model, data.tokensIn, data.tokensOut, data.latency);
    });

    logger.info('[PerformanceMonitor] Initialized');

    return {
      api: {
        startTimer,
        recordMetric,
        recordLLMCall,
        snapshotMemory,
        getBottlenecks,
        getLLMStats,
        getReport
      }
    };
  }
};
```

**Usage:**

```javascript
// In agent reflection phase:
const monitor = DIContainer.get('PerformanceMonitor');
const report = monitor.getReport();

// Analyze bottlenecks
const bottlenecks = monitor.getBottlenecks();
if (bottlenecks.length > 0) {
  logger.warn('[Agent] Performance bottlenecks detected:', bottlenecks);

  // Agent can now propose optimizations:
  // "I noticed my read_artifact tool is slow (avg 2.5s).
  //  I should add caching to improve performance."
}

// Check LLM usage
const llmStats = monitor.getLLMStats();
logger.info('[Agent] LLM usage:', llmStats);

// Memory monitoring
const memory = monitor.snapshotMemory();
if (parseFloat(memory.percentUsed) > 80) {
  logger.warn('[Agent] High memory usage detected, may need cleanup');
}
```

**Benefits:**
- Data-driven self-optimization
- Identify inefficiencies automatically
- Track improvement impact
- Foundation for autonomous optimization

---

## 🟡 HIGH PRIORITY - Critical Usability & Safety

### 6. Add Visible FSM State Indicator

**Location:** Create new component, integrate into `/Users/xyz/deco/reploid/ui-dashboard.html`

**Problem:**
- Users have no idea what state the agent is in
- No indication if agent is thinking, waiting for approval, or stuck
- Status bar referenced in code (`ui-manager.js:102`) but doesn't exist in HTML

**Solution:**
Create always-visible status bar showing:
- Current FSM state (IDLE, CURATING_CONTEXT, AWAITING_APPROVAL, etc.)
- Visual indicator (spinner, pulse, etc.)
- Current activity description
- Progress indication for multi-step operations

**Implementation:**

Add to `ui-dashboard.html`:
```html
<div id="status-bar" class="status-bar">
  <div class="status-indicator">
    <span id="status-icon" class="status-icon">⚪</span>
    <span id="status-text" class="status-text">IDLE</span>
  </div>
  <div id="status-detail" class="status-detail"></div>
  <div id="status-progress" class="status-progress" style="display:none;">
    <div class="progress-bar">
      <div id="progress-fill" class="progress-fill" style="width:0%"></div>
    </div>
  </div>
</div>
```

Add to `sentinel-fsm.js`:
```javascript
function updateStatusUI(state, detail = '', progress = null) {
  const icons = {
    IDLE: '⚪',
    CURATING_CONTEXT: '🔍',
    AWAITING_CONTEXT_APPROVAL: '⏸️',
    PLANNING_WITH_CONTEXT: '🧠',
    GENERATING_PROPOSAL: '✍️',
    AWAITING_PROPOSAL_APPROVAL: '⏸️',
    APPLYING_CHANGES: '⚙️',
    REFLECTING: '💭',
    ERROR: '❌'
  };

  const descriptions = {
    IDLE: 'Waiting for goal',
    CURATING_CONTEXT: 'Selecting relevant files',
    AWAITING_CONTEXT_APPROVAL: 'Review context bundle',
    PLANNING_WITH_CONTEXT: 'Analyzing and planning changes',
    GENERATING_PROPOSAL: 'Creating change proposal',
    AWAITING_PROPOSAL_APPROVAL: 'Review proposed changes',
    APPLYING_CHANGES: 'Applying approved changes',
    REFLECTING: 'Learning from outcome',
    ERROR: 'Error occurred'
  };

  document.getElementById('status-icon').textContent = icons[state] || '⚪';
  document.getElementById('status-text').textContent = state;
  document.getElementById('status-detail').textContent = detail || descriptions[state];

  if (progress !== null) {
    document.getElementById('status-progress').style.display = 'block';
    document.getElementById('progress-fill').style.width = `${progress}%`;
  } else {
    document.getElementById('status-progress').style.display = 'none';
  }
}

// Call on every state transition
transitionTo(STATES.CURATING_CONTEXT);
updateStatusUI(STATES.CURATING_CONTEXT, 'Analyzing project files...');
```

**Additional Features:**
- Add state transition history (last 5 states)
- Show elapsed time in current state
- Add animation for active states
- Click status bar to show detailed FSM log

---

### 7. Fix Security Vulnerabilities

**Locations:**
- `/Users/xyz/deco/reploid/ui-dashboard.html:30` - Iframe sandbox
- `/Users/xyz/deco/reploid/boot.js:238-242` - eval equivalent
- `/Users/xyz/deco/reploid/bin/cats:113-117` - Shell injection
- `/Users/xyz/deco/reploid/upgrades/diff-viewer-ui.js:131-139` - XSS via onclick

**Issues & Fixes:**

#### 7.1 Iframe Sandbox Security
```html
<!-- UNSAFE - Current code: -->
<iframe id="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>

<!-- SAFE - Fixed code: -->
<iframe id="preview-frame"
        sandbox="allow-scripts"
        csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
</iframe>
```
**Rationale:** `allow-same-origin` + `allow-scripts` = no sandbox protection. Remove `allow-same-origin` unless absolutely necessary.

#### 7.2 Remove eval-Equivalent Code Execution
```javascript
// UNSAFE - Current code in boot.js:
const moduleCode = await response.text();
const moduleFunc = new Function('DIContainer', 'EventBus', moduleCode);
moduleFunc(DIContainer, EventBus);

// SAFE - Use dynamic import instead:
const modulePath = `/upgrades/${moduleFile}`;
const module = await import(modulePath);
if (typeof module.init === 'function') {
  await module.init(DIContainer, EventBus);
}
```
**Requirements:**
- Refactor all modules to use ES6 export syntax
- Use dynamic imports instead of Function constructor
- Add CSP header: `script-src 'self'` (no unsafe-eval)

#### 7.3 Fix Shell Injection in cats CLI
```javascript
// UNSAFE - Current code:
const cmd = `find . -name "${pattern}" -type f`;
const output = execSync(cmd, { encoding: 'utf8' });

// SAFE - Use glob library instead:
const glob = require('fast-glob');
const files = await glob(pattern, {
  cwd: process.cwd(),
  onlyFiles: true
});
```

#### 7.4 Remove Inline Event Handlers
```javascript
// UNSAFE - Current code:
html += `<button onclick="DiffViewerUI.toggleApproval('${filePath}')">Toggle</button>`;

// SAFE - Use event delegation:
html += `<button class="approval-toggle" data-filepath="${escapeHtml(filePath)}">Toggle</button>`;

// In init():
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('approval-toggle')) {
    const filePath = e.target.dataset.filepath;
    this.toggleApproval(filePath);
  }
});
```

**Additional Security Measures:**
- Add input sanitization for all user inputs (goal, file paths)
- Validate file paths against session workspace
- Add rate limiting on API calls
- Use crypto.randomBytes() for session IDs instead of timestamps
- Add Content Security Policy headers

---

### 8. Add Confirmation Dialogs for Destructive Actions

**Locations to add confirmations:**
- Before applying changes (`sentinel-fsm.js`, `diff-viewer-ui.js`)
- Before deleting artifacts
- Before resetting state
- Before overwriting files

**Implementation:**

Create confirmation utility:
```javascript
// Add to utils.js or create modal-manager.js
async function confirm(message, options = {}) {
  const {
    title = 'Confirm Action',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = false
  } = options;

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        <p class="modal-message">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn-confirm ${danger ? 'btn-danger' : ''}">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    modal.querySelector('.btn-cancel').addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });

    modal.querySelector('.btn-confirm').addEventListener('click', () => {
      modal.remove();
      resolve(true);
    });

    // ESC key to cancel
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        resolve(false);
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);

    document.body.appendChild(modal);
    modal.querySelector('.btn-confirm').focus();
  });
}
```

**Usage Examples:**
```javascript
// Before applying changes:
async applyChanges() {
  const changeCount = this.proposedChanges.filter(c => c.approved).length;

  const confirmed = await confirm(
    `Apply ${changeCount} approved changes? This will modify your files.`,
    {
      title: 'Apply Changes',
      confirmText: 'Apply Changes',
      danger: true
    }
  );

  if (!confirmed) {
    log('User cancelled apply operation');
    return;
  }

  // Proceed with applying changes...
}

// Before deleting artifact:
async deleteArtifact(filePath) {
  const confirmed = await confirm(
    `Delete ${filePath}? This cannot be undone.`,
    {
      title: 'Delete File',
      confirmText: 'Delete',
      danger: true
    }
  );

  if (confirmed) {
    await StateManager.deleteArtifact(filePath);
  }
}
```

**Additional Features:**
- Add "Don't ask again this session" checkbox
- Show impact preview (files affected, lines changed)
- Add "View changes first" option that opens diff viewer

---

### 9. Complete Git VFS Integration

**Location:** `/Users/xyz/deco/reploid/upgrades/git-vfs.js:273-282`

**Problem:**
```javascript
async getCommitChanges(commitOid) {
  // TODO: Implement actual change extraction
  return [];
}
```

**Impact:** History tracking doesn't work. Can't see what changed in each commit. Breaks rollback functionality.

**Solution:**
```javascript
async getCommitChanges(commitOid) {
  try {
    const commit = await git.readCommit({ fs, dir: this.repoDir, oid: commitOid });
    const tree = commit.commit.tree;

    // Get parent commit for comparison
    const parents = commit.commit.parent;
    if (parents.length === 0) {
      // Initial commit - all files are additions
      return await this._getAllFilesInTree(tree, 'add');
    }

    const parentCommit = await git.readCommit({ fs, dir: this.repoDir, oid: parents[0] });
    const parentTree = parentCommit.commit.tree;

    // Walk both trees to find differences
    const changes = await this._compareTrees(parentTree, tree);
    return changes;

  } catch (err) {
    console.error('Failed to get commit changes:', err);
    return [];
  }
}

async _compareTrees(oldTreeOid, newTreeOid) {
  const changes = [];
  const oldFiles = await this._getTreeFiles(oldTreeOid);
  const newFiles = await this._getTreeFiles(newTreeOid);

  // Find added and modified files
  for (const [path, newOid] of Object.entries(newFiles)) {
    if (!oldFiles[path]) {
      changes.push({ type: 'add', path });
    } else if (oldFiles[path] !== newOid) {
      changes.push({ type: 'modify', path });
    }
  }

  // Find deleted files
  for (const path of Object.keys(oldFiles)) {
    if (!newFiles[path]) {
      changes.push({ type: 'delete', path });
    }
  }

  return changes;
}

async _getTreeFiles(treeOid, prefix = '') {
  const files = {};
  const { tree } = await git.readTree({ fs, dir: this.repoDir, oid: treeOid });

  for (const entry of tree) {
    const fullPath = prefix + entry.path;
    if (entry.type === 'blob') {
      files[fullPath] = entry.oid;
    } else if (entry.type === 'tree') {
      const subFiles = await this._getTreeFiles(entry.oid, fullPath + '/');
      Object.assign(files, subFiles);
    }
  }

  return files;
}
```

**Additional Requirements:**
- Add diff generation (line-by-line changes)
- Support binary file detection
- Add commit metadata (author, date, message)
- Implement file content retrieval at specific commits

**Fix Checkpoint Data Persistence:**

Location: `/Users/xyz/deco/reploid/upgrades/state-manager.js:147-164`

```javascript
async createCheckpoint(label = 'checkpoint') {
  const checkpoint = {
    id: `checkpoint-${Date.now()}`,
    label,
    timestamp: Date.now(),
    state: this.deepClone(this.state),
    artifacts: {}  // Need to actually store artifact contents!
  };

  // Store artifact contents, not just metadata
  for (const [path, metadata] of Object.entries(this.state.artifacts)) {
    checkpoint.artifacts[path] = {
      metadata: this.deepClone(metadata),
      content: await this.getArtifactContent(path)  // Actually fetch content!
    };
  }

  this.state.checkpoints.push(checkpoint);
  await this.saveState();

  return checkpoint.id;
}

async restoreCheckpoint(checkpointId) {
  const checkpoint = this.state.checkpoints.find(cp => cp.id === checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint ${checkpointId} not found`);
  }

  // Restore state
  this.state = this.deepClone(checkpoint.state);

  // Restore artifact contents
  for (const [path, data] of Object.entries(checkpoint.artifacts)) {
    await this.updateArtifact(path, data.content);
  }

  await this.saveState();
  EventBus.emit('checkpoint:restored', { checkpointId });
}
```

---

### 10. Improve Error Messages Throughout ✅ COMPLETED

**Status:** Improved error messages across the codebase with helpful context and actionable suggestions.

**Files Updated:**
- `upgrades/api-client.js` - Network, auth, rate limit errors with suggestions
- `upgrades/state-manager.js` - Session ID generation improved
- `upgrades/tool-runner.js` - Tool execution errors with debugging hints
- `upgrades/di-container.js` - Module resolution errors with dependency chains
- `bin/cats` - File finding errors with examples and tips
- `bin/dogs` - Change application errors with specific file error codes

**Pattern followed:**

```javascript
// BAD - Current pattern:
catch (err) {
  console.error('Operation failed:', err.message);
}

// GOOD - Helpful pattern:
catch (err) {
  // Context about what was being attempted
  console.error('Failed to apply changes to file:', filePath);

  // Specific error details
  console.error('Error:', err.message);

  // Why this might have happened
  if (err.code === 'ENOENT') {
    console.error('The file does not exist. It may have been deleted or moved.');
  } else if (err.code === 'EACCES') {
    console.error('Permission denied. Check file permissions.');
  }

  // What the user can do about it
  console.error('Suggestions:');
  console.error('  - Verify the file path is correct');
  console.error('  - Check that you have write permissions');
  console.error('  - Try refreshing the file list');

  // Link to docs if relevant
  console.error('See documentation: https://...');
}
```

**Specific Improvements:**

#### CLI Error Messages
```javascript
// In bin/cats:
if (files.length === 0) {
  console.error('No files found matching patterns:');
  patterns.forEach(p => console.error(`  - ${p}`));
  console.error('\nSuggestions:');
  console.error('  - Check that the patterns are correct');
  console.error('  - Try using quotes around patterns with wildcards');
  console.error('  - Use --verbose to see search details');
  console.error('\nExample: cats "src/**/*.js" --verbose');
  process.exit(1);
}
```

#### API Client Errors
```javascript
// In upgrades/api-client.js:
catch (err) {
  if (err.name === 'AbortError') {
    throw new Error('Request timeout. The AI service took too long to respond. Try again or check your connection.');
  } else if (err.status === 401) {
    throw new Error('Authentication failed. Check your API key in .env file or browser settings.');
  } else if (err.status === 429) {
    throw new Error('Rate limit exceeded. Please wait a moment before trying again.');
  } else if (!navigator.onLine) {
    throw new Error('No internet connection. Check your network and try again.');
  } else {
    throw new Error(`API request failed: ${err.message}\n\nIf this persists, check API service status.`);
  }
}
```

#### Tool Runner Errors
```javascript
// In upgrades/tool-runner.js:
if (!toolDef) {
  const availableTools = Object.keys(this.tools).join(', ');
  throw new Error(
    `Tool '${toolName}' not found.\n` +
    `Available tools: ${availableTools}\n` +
    `Did you mean one of these?`
  );
}
```

---

## 🟢 MEDIUM PRIORITY - Usability Enhancements

### 11. Add npm Package Configuration

**Location:** `/Users/xyz/deco/reploid/package.json`

**Changes:**
```json
{
  "name": "reploid",
  "version": "0.1.0",
  "description": "An autonomous, self-improving agent and development environment.",
  "main": "server/proxy.js",
  "type": "commonjs",
  "bin": {
    "reploid": "./bin/reploid-cli.js",
    "cats": "./bin/cats",
    "dogs": "./bin/dogs"
  },
  "scripts": {
    "start": "node server/proxy.js",
    "cli": "node bin/reploid-cli.js",
    "dev:all": "concurrently \"npm run dev:proxy\" \"npm run dev:hermes\" \"npm run dev:browser\"",
    "dev:proxy": "nodemon server/proxy.js",
    "dev:hermes": "cd hermes && npm install && npm run dev",
    "dev:browser": "python3 -m http.server 8080 || python -m http.server 8080",
    "test": "npm run test:cli && npm run test:units",
    "test:cli": "node bin/cats --help && node bin/dogs --help",
    "test:units": "echo 'No tests yet - TODO'",
    "postinstall": "cd hermes && npm install"
  },
  "engines": {
    "node": ">=14.0.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "concurrently": "^8.0.0"
  }
}
```

**Additional Requirements:**
- Make CLI tools executable: `chmod +x bin/cats bin/dogs bin/reploid-cli.js`
- Add shebang to all CLI files: `#!/usr/bin/env node`
- Run `npm install` in hermes directory
- Test global installation: `npm install -g . && cats --help`

---

### 12. Create Unified Configuration System ✅ COMPLETED

**Status:** Implemented unified configuration system with .reploidrc.json support.

**Files Created:**
- `utils/config-loader.js` - ConfigLoader class with environment variable expansion
- `.reploidrc.json.example` - Template configuration file
- `bin/reploid-config` - CLI tool to manage configuration (init, show, get, set, validate)

**Files Updated:**
- `bin/cats` - Uses config loader for CLI settings
- `bin/dogs` - Uses config loader for CLI settings
- `server/proxy.js` - Uses config loader for server and API settings
- `package.json` - Added reploid-config bin command

**Features Implemented:**
- ✅ Search paths: ./.reploidrc.json, ~/.reploidrc.json, /etc/reploid/config.json
- ✅ Environment variable expansion with ${VAR_NAME} syntax
- ✅ Deep merge with defaults
- ✅ Configuration validation
- ✅ Dot notation access (config.get('api.provider'))
- ✅ CLI tool for management (init, show, get, set, validate, path)
- ✅ Backward compatible with .env files

**Usage:**
```bash
# Create new config
reploid-config init

# View configuration
reploid-config show

# Get specific value
reploid-config get api.provider

# Set value
reploid-config set api.timeout 60000

# Validate config
reploid-config validate
```

**Original Problem:** Three separate config systems for browser/CLI/server modes with no shared settings.

**Original Solution:** Create `.reploidrc.json` format:

```json
{
  "version": "1.0",
  "api": {
    "provider": "gemini",
    "geminiKey": "${GEMINI_API_KEY}",
    "openaiKey": "${OPENAI_API_KEY}",
    "anthropicKey": "${ANTHROPIC_API_KEY}",
    "localEndpoint": "http://localhost:11434",
    "timeout": 120000
  },
  "server": {
    "port": 8000,
    "corsOrigins": ["http://localhost:8080"],
    "sessionTimeout": 3600000
  },
  "cli": {
    "maxFileSize": 102400,
    "verbose": false,
    "defaultOutput": "./output"
  },
  "guardian": {
    "requireApproval": true,
    "autoBackup": true,
    "verificationTimeout": 30000
  },
  "workspace": {
    "root": "./sessions",
    "maxSessions": 10,
    "gitEnabled": true
  }
}
```

**Implementation:**

Create `utils/config-loader.js`:
```javascript
const fs = require('fs-extra');
const path = require('path');

class ConfigLoader {
  constructor() {
    this.config = null;
    this.searchPaths = [
      '.reploidrc.json',
      '.reploidrc',
      path.join(os.homedir(), '.reploidrc.json'),
      '/etc/reploid/config.json'
    ];
  }

  async load() {
    // Try each search path
    for (const configPath of this.searchPaths) {
      if (await fs.pathExists(configPath)) {
        const raw = await fs.readFile(configPath, 'utf8');
        this.config = this.parseConfig(raw);
        console.log(`Loaded config from: ${configPath}`);
        return this.config;
      }
    }

    // No config found, use defaults
    this.config = this.getDefaults();
    return this.config;
  }

  parseConfig(raw) {
    const config = JSON.parse(raw);

    // Expand environment variables
    const expandEnvVars = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = obj[key].replace(/\$\{(\w+)\}/g, (_, varName) => {
            return process.env[varName] || '';
          });
        } else if (typeof obj[key] === 'object') {
          expandEnvVars(obj[key]);
        }
      }
    };

    expandEnvVars(config);
    return config;
  }

  getDefaults() {
    return {
      version: '1.0',
      api: {
        provider: 'gemini',
        timeout: 120000
      },
      // ... rest of defaults
    };
  }

  get(keyPath) {
    // Support dot notation: config.get('api.provider')
    const keys = keyPath.split('.');
    let value = this.config;
    for (const key of keys) {
      value = value?.[key];
    }
    return value;
  }
}

module.exports = new ConfigLoader();
```

**Update all modules to use shared config:**
- `boot.js` - Load config for browser mode
- `bin/cats`, `bin/dogs` - Use CLI settings
- `server/proxy.js` - Use server settings
- `hermes/index.js` - Use workspace settings

---

### 13. Implement VFS Explorer Improvements ✅ COMPLETED

**Status:** Created enhanced VFS Explorer module with full featured file browser.

**Files Created:**
- `upgrades/vfs-explorer.js` - Complete VFS Explorer module with search, expand/collapse, file viewer
- `styles/vfs-explorer.css` - Comprehensive styling for explorer and modal viewer

**Files Updated:**
- `upgrades/ui-manager.js` - Integrated new VFS Explorer with fallback to basic tree
- `config.json` - Registered VFSX module

**Features Implemented:**
- ✅ Folder expand/collapse with state tracking
- ✅ Search/filter with live filtering
- ✅ File type icons (📜 JS, 📋 JSON, 📝 MD, etc.)
- ✅ Dedicated file viewer modal with syntax highlighting
- ✅ File operations (copy, history, edit)
- ✅ Visual distinction between files and folders
- ✅ File size display
- ✅ Folder file counts
- ✅ Responsive design
- ✅ Keyboard shortcuts (ESC to close)
- ✅ Event-driven updates (auto-refresh on VFS changes)

**Original Solution:**

```javascript
class VFSExplorer {
  constructor() {
    this.expanded = new Set(['/vfs']); // Track expanded folders
    this.selectedFile = null;
    this.searchTerm = '';
  }

  render(vfsTree, container) {
    container.innerHTML = `
      <div class="vfs-explorer">
        <div class="vfs-toolbar">
          <input type="text"
                 class="vfs-search"
                 placeholder="Search files..."
                 value="${this.searchTerm}">
          <button class="vfs-refresh" title="Refresh">↻</button>
          <button class="vfs-collapse-all" title="Collapse All">⊟</button>
        </div>
        <div class="vfs-tree">${this.renderTree(vfsTree)}</div>
      </div>
    `;

    this.attachEventListeners(container);
  }

  renderTree(node, depth = 0) {
    const isExpanded = this.expanded.has(node.path);
    const matchesSearch = this.matchesSearch(node);

    if (!matchesSearch && !this.hasMatchingDescendants(node)) {
      return '';
    }

    if (node.type === 'file') {
      const icon = this.getFileIcon(node.path);
      const selected = node.path === this.selectedFile ? 'selected' : '';
      return `
        <div class="vfs-item vfs-file ${selected}"
             data-path="${node.path}"
             style="padding-left:${depth * 20}px">
          <span class="vfs-icon">${icon}</span>
          <span class="vfs-name">${node.name}</span>
          <span class="vfs-size">${this.formatSize(node.size)}</span>
        </div>
      `;
    }

    // Folder
    const icon = isExpanded ? '📂' : '📁';
    const childrenHtml = isExpanded
      ? node.children.map(child => this.renderTree(child, depth + 1)).join('')
      : '';

    return `
      <div class="vfs-folder">
        <div class="vfs-item vfs-folder-header"
             data-path="${node.path}"
             style="padding-left:${depth * 20}px">
          <span class="vfs-expand">${isExpanded ? '▼' : '▶'}</span>
          <span class="vfs-icon">${icon}</span>
          <span class="vfs-name">${node.name}</span>
          <span class="vfs-count">(${node.children.length})</span>
        </div>
        ${childrenHtml}
      </div>
    `;
  }

  getFileIcon(path) {
    const ext = path.split('.').pop().toLowerCase();
    const iconMap = {
      'js': '📜',
      'json': '📋',
      'md': '📝',
      'css': '🎨',
      'html': '🌐',
      'png': '🖼️',
      'jpg': '🖼️',
      'svg': '🎨',
      'ts': '📘',
      'py': '🐍'
    };
    return iconMap[ext] || '📄';
  }

  attachEventListeners(container) {
    // Folder expand/collapse
    container.addEventListener('click', (e) => {
      const folderHeader = e.target.closest('.vfs-folder-header');
      if (folderHeader) {
        const path = folderHeader.dataset.path;
        if (this.expanded.has(path)) {
          this.expanded.delete(path);
        } else {
          this.expanded.add(path);
        }
        this.render(this.vfsTree, container);
      }

      // File selection
      const fileItem = e.target.closest('.vfs-file');
      if (fileItem) {
        this.selectedFile = fileItem.dataset.path;
        this.openFileViewer(this.selectedFile);
        this.render(this.vfsTree, container);
      }
    });

    // Search
    const searchInput = container.querySelector('.vfs-search');
    searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.render(this.vfsTree, container);
    });

    // Collapse all
    container.querySelector('.vfs-collapse-all').addEventListener('click', () => {
      this.expanded.clear();
      this.expanded.add('/vfs'); // Keep root expanded
      this.render(this.vfsTree, container);
    });
  }

  matchesSearch(node) {
    if (!this.searchTerm) return true;
    return node.name.toLowerCase().includes(this.searchTerm) ||
           node.path.toLowerCase().includes(this.searchTerm);
  }

  hasMatchingDescendants(node) {
    if (node.type === 'file') return false;
    return node.children.some(child =>
      this.matchesSearch(child) || this.hasMatchingDescendants(child)
    );
  }

  openFileViewer(filePath) {
    // Instead of logging to console, open in dedicated viewer
    EventBus.emit('file:open', { path: filePath });

    // Show in new panel or modal
    const viewer = document.getElementById('file-viewer');
    if (viewer) {
      StateManager.getArtifactContent(filePath).then(content => {
        viewer.innerHTML = `
          <div class="file-viewer-header">
            <span class="file-path">${filePath}</span>
            <button class="btn-close">×</button>
          </div>
          <pre class="file-content"><code>${this.escapeHtml(content)}</code></pre>
        `;
        viewer.style.display = 'block';
      });
    }
  }

  formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

**Add to CSS:**
```css
.vfs-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.vfs-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.vfs-search {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
}

.vfs-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.vfs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.vfs-item:hover {
  background: rgba(0, 255, 255, 0.1);
}

.vfs-file.selected {
  background: rgba(0, 255, 255, 0.2);
}

.vfs-expand {
  width: 16px;
  text-align: center;
  font-size: 10px;
}

.vfs-icon {
  font-size: 16px;
}

.vfs-name {
  flex: 1;
}

.vfs-size, .vfs-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
```

---

### 14. Add Mobile Responsive Design ✅ COMPLETED

**Status:** Implemented comprehensive responsive design for all breakpoints.

**Files Updated:**
- `styles/dashboard.css` - Added media queries for tablet (1024px), mobile (768px), small mobile (480px), landscape, touch devices
- `styles/vfs-explorer.css` - Added responsive design for VFS explorer and file viewer modal
- `index.html` - Already had viewport meta tag

**Breakpoints Implemented:**
- ✅ Tablet (≤1024px): Single column layout, adjusted spacing
- ✅ Mobile (≤768px): Compact layout, smaller fonts, touch-friendly
- ✅ Small mobile (≤480px): Stacked layout, minimal spacing
- ✅ Landscape mobile: Optimized for height constraints
- ✅ Touch devices: Larger tap targets (44px min), smooth scrolling

**Features:**
- ✅ Responsive grid layouts (auto-stacking on mobile)
- ✅ Flexible status bar (wraps on small screens)
- ✅ Adjustable panel heights for different screens
- ✅ Touch-optimized buttons and controls
- ✅ Thinner scrollbars on mobile
- ✅ Text size scaling for readability
- ✅ Full-width modals on small screens
- ✅ Webkit touch scrolling momentum

**Original Implementation:**

Add to `dashboard.css`:
```css
/* Base layout (desktop) */
.dashboard-container {
  display: grid;
  grid-template-areas:
    "thoughts preview"
    "vfs preview"
    "sentinel preview";
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto 1fr;
  gap: 15px;
  height: 100vh;
  padding: 15px;
}

/* Factory mode (3 columns on desktop) */
.factory-mode .dashboard-container {
  grid-template-columns: 300px 1fr 400px;
  grid-template-areas: "vfs thoughts preview";
}

/* Tablet (768px - 1024px) */
@media (max-width: 1024px) {
  .dashboard-container {
    grid-template-areas:
      "thoughts thoughts"
      "vfs sentinel"
      "preview preview";
    grid-template-columns: 1fr 1fr;
  }

  .factory-mode .dashboard-container {
    grid-template-areas:
      "thoughts thoughts"
      "vfs preview"
      "sentinel preview";
  }

  #preview-frame {
    min-height: 400px;
  }
}

/* Mobile (< 768px) */
@media (max-width: 768px) {
  .dashboard-container {
    grid-template-areas:
      "thoughts"
      "sentinel"
      "vfs"
      "preview";
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 10px;
  }

  .panel {
    max-height: 400px;
  }

  #preview-frame {
    min-height: 300px;
  }

  /* Make VFS collapsible on mobile */
  .vfs-panel {
    max-height: 200px;
  }

  .vfs-panel.collapsed {
    max-height: 40px;
  }

  /* Larger touch targets */
  button, .vfs-item, input[type="checkbox"] {
    min-height: 44px;
    min-width: 44px;
  }

  /* Horizontal scroll for wide content */
  .thought-stream, .advanced-log {
    overflow-x: auto;
  }
}

/* Small mobile (< 480px) */
@media (max-width: 480px) {
  .dashboard-container {
    padding: 5px;
    gap: 5px;
  }

  .panel-header h3 {
    font-size: 14px;
  }

  .btn {
    font-size: 12px;
    padding: 8px 12px;
  }
}
```

Add to `boot/style.css`:
```css
/* Persona cards responsive */
@media (max-width: 768px) {
  #persona-selection-container {
    grid-template-columns: 1fr;
  }

  .persona-card {
    padding: 15px;
  }
}

/* Goal input responsive */
@media (max-width: 480px) {
  .goal-container {
    flex-direction: column;
  }

  #goal-input {
    width: 100%;
    margin-bottom: 10px;
  }

  #awaken-btn {
    width: 100%;
  }
}
```

**Add Mobile-Specific Features:**
- Swipe gestures to switch panels
- Collapsible panels with accordion behavior
- Bottom navigation bar for mobile
- Touch-optimized diff viewer with pinch-to-zoom

---

### 15. Implement Command System ✅ COMPLETED

**Status:** Implemented comprehensive CLI command system with 8 command groups.

**File Updated:** `bin/reploid-cli.js` - Complete rewrite with full command suite

**Commands Implemented:**

1. **status** - Show agent status, session, goal, cycle, pending approvals
2. **sessions** - Manage sessions (list, view <id>, clean --days --force)
3. **goal <text>** - Set agent goal, start/resume session
4. **approve [type]** - Approve context/proposal
5. **reject [type]** - Reject with optional reason
6. **checkpoints** - Manage checkpoints (list, create, restore <id> --force)
7. **logs [lines]** - Show logs with filtering (--level, --follow placeholder)
8. **vfs** - VFS operations (ls [path], cat <path>)

**Features:**
- ✅ HTTP request helper (no external dependencies except built-in http/https)
- ✅ Configuration integration (loads from .reploidrc.json)
- ✅ Error handling with helpful troubleshooting messages
- ✅ Safety confirmations (--force flags for destructive operations)
- ✅ Formatted output with emojis and structured display
- ✅ Server URL override (--server flag)
- ✅ JSON output option (--json flag)
- ✅ Help and version flags

**Usage Examples:**
```bash
reploid status
reploid goal "Fix all TypeScript errors"
reploid sessions list
reploid sessions view session_12345
reploid approve proposal
reploid checkpoints create "Before refactor"
reploid checkpoints restore checkpoint_67890 --force
reploid logs 100 --level error
reploid vfs ls /vfs/src
reploid vfs cat /vfs/package.json
```

**Original Current State:** Only had placeholder `goal` command

**Original New Commands:**

```javascript
#!/usr/bin/env node
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const DEFAULT_SERVER = 'http://localhost:3000';

yargs(hideBin(process.argv))
  .command('status', 'Show agent status', {}, async (argv) => {
    try {
      const response = await axios.get(`${DEFAULT_SERVER}/api/status`);
      const { state, session, goal } = response.data;

      console.log('\n🤖 REPLOID Agent Status\n');
      console.log(`State:        ${state}`);
      console.log(`Session:      ${session || 'None'}`);
      console.log(`Goal:         ${goal || 'None'}`);
      console.log(`Server:       ${DEFAULT_SERVER}`);

    } catch (err) {
      console.error('Failed to get status:', err.message);
      console.error('Is the Hermes server running? Start with: npm start');
      process.exit(1);
    }
  })

  .command('sessions', 'Manage sessions', (yargs) => {
    return yargs
      .command('list', 'List all sessions', {}, async () => {
        const response = await axios.get(`${DEFAULT_SERVER}/api/sessions`);
        const sessions = response.data;

        console.log(`\n📁 Sessions (${sessions.length})\n`);
        sessions.forEach(s => {
          console.log(`${s.id}`);
          console.log(`  Goal: ${s.goal}`);
          console.log(`  State: ${s.state}`);
          console.log(`  Created: ${new Date(s.createdAt).toLocaleString()}`);
          console.log();
        });
      })

      .command('view <id>', 'View session details', {}, async (argv) => {
        const response = await axios.get(`${DEFAULT_SERVER}/api/sessions/${argv.id}`);
        const session = response.data;

        console.log('\n📄 Session Details\n');
        console.log(JSON.stringify(session, null, 2));
      })

      .command('clean', 'Remove old sessions', {
        days: { type: 'number', default: 7, desc: 'Remove sessions older than N days' }
      }, async (argv) => {
        await axios.post(`${DEFAULT_SERVER}/api/sessions/clean`, { days: argv.days });
        console.log(`✓ Cleaned sessions older than ${argv.days} days`);
      });
  })

  .command('goal <text>', 'Set agent goal', {}, async (argv) => {
    const response = await axios.post(`${DEFAULT_SERVER}/api/goal`, { goal: argv.text });
    console.log('✓ Goal set:', argv.text);
    console.log('Session ID:', response.data.sessionId);
  })

  .command('approve [type]', 'Approve pending request', {
    type: { choices: ['context', 'proposal'], default: 'proposal' }
  }, async (argv) => {
    await axios.post(`${DEFAULT_SERVER}/api/approve`, { type: argv.type });
    console.log(`✓ Approved ${argv.type}`);
  })

  .command('reject [type]', 'Reject pending request', {
    type: { choices: ['context', 'proposal'], default: 'proposal' }
  }, async (argv) => {
    await axios.post(`${DEFAULT_SERVER}/api/reject`, { type: argv.type });
    console.log(`✓ Rejected ${argv.type}`);
  })

  .command('rollback [checkpoint]', 'Rollback to checkpoint', {
    checkpoint: { desc: 'Checkpoint ID (or "latest")' }
  }, async (argv) => {
    const response = await axios.post(`${DEFAULT_SERVER}/api/rollback`, {
      checkpoint: argv.checkpoint
    });
    console.log('✓ Rolled back to:', response.data.checkpoint);
  })

  .command('logs [lines]', 'Show recent logs', {
    lines: { type: 'number', default: 50 },
    follow: { type: 'boolean', alias: 'f', desc: 'Follow log output' }
  }, async (argv) => {
    if (argv.follow) {
      // Stream logs via WebSocket
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:3000/logs`);
      ws.on('message', (data) => {
        console.log(data.toString());
      });
    } else {
      const response = await axios.get(`${DEFAULT_SERVER}/api/logs`, {
        params: { lines: argv.lines }
      });
      console.log(response.data.logs.join('\n'));
    }
  })

  .option('server', {
    alias: 's',
    type: 'string',
    description: 'Hermes server URL',
    default: DEFAULT_SERVER
  })

  .demandCommand(1, 'You need at least one command')
  .help()
  .argv;
```

**Add Corresponding API Endpoints to Hermes:**

In `/Users/xyz/deco/reploid/hermes/index.js`:
```javascript
// Status endpoint
app.get('/api/status', (req, res) => {
  const agent = guardianAgent;
  res.json({
    state: agent.state,
    session: agent.currentSession?.id,
    goal: agent.currentSession?.goal
  });
});

// Other endpoints...
app.get('/api/sessions', (req, res) => { /* ... */ });
app.get('/api/sessions/:id', (req, res) => { /* ... */ });
app.post('/api/sessions/clean', (req, res) => { /* ... */ });
app.post('/api/goal', (req, res) => { /* ... */ });
app.post('/api/approve', (req, res) => { /* ... */ });
app.post('/api/reject', (req, res) => { /* ... */ });
app.post('/api/rollback', (req, res) => { /* ... */ });
app.get('/api/logs', (req, res) => { /* ... */ });
```

---

### 16. Add cats/dogs Validation Commands

**Add to `/Users/xyz/deco/reploid/bin/cats`:**

```javascript
// Add to yargs commands:
.command('validate <bundle>', 'Validate cats bundle format', {}, async (argv) => {
  try {
    const content = await fs.readFile(argv.bundle, 'utf8');
    const errors = validateCatsBundle(content);

    if (errors.length === 0) {
      console.log('✓ Bundle is valid');

      // Show summary
      const files = extractFileList(content);
      console.log(`\n📦 Bundle contains ${files.length} files:`);
      files.forEach(f => console.log(`  - ${f}`));

    } else {
      console.log('✗ Bundle has errors:\n');
      errors.forEach(err => console.log(`  ${err}`));
      process.exit(1);
    }
  } catch (err) {
    console.error('Validation failed:', err.message);
    process.exit(1);
  }
})

function validateCatsBundle(content) {
  const errors = [];

  // Check for required sections
  if (!content.includes('# Context Bundle')) {
    errors.push('Missing "# Context Bundle" header');
  }

  if (!content.includes('## Metadata')) {
    errors.push('Missing "## Metadata" section');
  }

  // Check file blocks format
  const fileRegex = /## File: (.+)\n```[\w]*\n([\s\S]*?)```/g;
  let fileCount = 0;
  let match;

  while ((match = fileRegex.exec(content)) !== null) {
    fileCount++;
    const [, filePath, fileContent] = match;

    // Validate file path
    if (!filePath.startsWith('/')) {
      errors.push(`File ${fileCount}: Path should be absolute: ${filePath}`);
    }

    // Check for empty content
    if (!fileContent.trim()) {
      errors.push(`File ${fileCount}: Empty file content for ${filePath}`);
    }
  }

  if (fileCount === 0) {
    errors.push('No file blocks found');
  }

  return errors;
}
```

**Add to `/Users/xyz/deco/reploid/bin/dogs`:**

```javascript
.command('validate <bundle>', 'Validate dogs bundle format', {}, async (argv) => {
  const content = await fs.readFile(argv.bundle, 'utf8');
  const errors = validateDogsBundle(content);

  if (errors.length === 0) {
    console.log('✓ Bundle is valid');
    const changes = parseDogsBundle(content);
    console.log(`\n📝 Bundle contains ${changes.length} changes:`);
    changes.forEach(c => console.log(`  ${c.operation}: ${c.filePath}`));
  } else {
    console.log('✗ Bundle has errors:\n');
    errors.forEach(err => console.log(`  ${err}`));
    process.exit(1);
  }
})

.command('diff <bundle>', 'Show what would change (enhanced dry-run)', {}, async (argv) => {
  const content = await fs.readFile(argv.bundle, 'utf8');
  const changes = parseDogsBundle(content);

  console.log('\n📊 Proposed Changes:\n');

  const stats = {
    create: changes.filter(c => c.operation === 'CREATE').length,
    modify: changes.filter(c => c.operation === 'MODIFY').length,
    delete: changes.filter(c => c.operation === 'DELETE').length
  };

  console.log(`  CREATE: ${stats.create} files`);
  console.log(`  MODIFY: ${stats.modify} files`);
  console.log(`  DELETE: ${stats.delete} files`);
  console.log();

  // Show detailed diff for each file
  for (const change of changes) {
    console.log(`\n${change.operation}: ${change.filePath}`);

    if (change.operation === 'CREATE') {
      const lines = change.newContent.split('\n').length;
      console.log(`  + ${lines} lines`);
    } else if (change.operation === 'MODIFY') {
      const oldContent = await fs.readFile(change.filePath, 'utf8');
      const diff = generateDiff(oldContent, change.newContent);
      console.log(diff);
    } else if (change.operation === 'DELETE') {
      console.log(`  - File will be deleted`);
    }
  }
})

function validateDogsBundle(content) {
  const errors = [];

  if (!content.includes('# Change Proposal')) {
    errors.push('Missing "# Change Proposal" header');
  }

  const changeRegex = /##\s+(CREATE|MODIFY|DELETE):\s+(.+)\n```[\w]*\n([\s\S]*?)```/g;
  let changeCount = 0;
  let match;

  while ((match = changeRegex.exec(content)) !== null) {
    changeCount++;
    const [, operation, filePath, content] = match;

    if (!['CREATE', 'MODIFY', 'DELETE'].includes(operation)) {
      errors.push(`Change ${changeCount}: Invalid operation: ${operation}`);
    }

    if (operation !== 'DELETE' && !content.trim()) {
      errors.push(`Change ${changeCount}: Empty content for ${operation}`);
    }
  }

  if (changeCount === 0) {
    errors.push('No change blocks found');
  }

  return errors;
}
```

---

### 17. Add Accessibility Features

**Locations to update:**
- All HTML files
- All UI components in `upgrades/`
- CSS files

**ARIA Labels:**

```html
<!-- Add to ui-dashboard.html -->
<div id="thought-stream-panel"
     class="panel"
     role="log"
     aria-label="Agent thought stream"
     aria-live="polite">
  <div class="panel-header">
    <h3 id="thought-stream-title">Thought Stream</h3>
  </div>
  <div id="thought-stream"
       class="thought-stream"
       aria-labelledby="thought-stream-title"
       tabindex="0">
  </div>
</div>

<div id="vfs-panel"
     class="panel"
     role="navigation"
     aria-label="File system explorer">
  <!-- VFS content -->
</div>

<div id="sentinel-panel"
     class="panel"
     role="region"
     aria-label="Guardian agent controls">
  <button id="approve-btn"
          class="btn btn-success"
          aria-label="Approve proposed changes">
    Approve
  </button>
  <button id="revise-btn"
          class="btn btn-warning"
          aria-label="Request revisions to proposal">
    Revise
  </button>
</div>
```

**Keyboard Navigation:**

Add to `ui-manager.js`:
```javascript
class KeyboardNavigationManager {
  constructor() {
    this.setupGlobalShortcuts();
  }

  setupGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't interfere with typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Cmd/Ctrl + K: Focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector('.vfs-search')?.focus();
      }

      // Cmd/Ctrl + Enter: Approve
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('approve-btn')?.click();
      }

      // Esc: Close modals
      if (e.key === 'Escape') {
        this.closeTopModal();
      }

      // Tab through panels with Cmd+1, Cmd+2, etc.
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const panels = ['thought-stream-panel', 'vfs-panel', 'preview-frame', 'sentinel-panel'];
        document.getElementById(panels[e.key - 1])?.focus();
      }

      // Arrow keys for VFS navigation
      if (document.activeElement?.closest('.vfs-tree')) {
        this.handleVFSKeyboard(e);
      }
    });
  }

  handleVFSKeyboard(e) {
    const current = document.activeElement;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = this.getNextVFSItem(current);
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = this.getPrevVFSItem(current);
      prev?.focus();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.expandVFSFolder(current);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.collapseVFSFolder(current);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      current.click();
    }
  }

  // Show keyboard shortcuts help
  showShortcutsHelp() {
    const shortcuts = [
      { keys: 'Cmd+K', action: 'Focus search' },
      { keys: 'Cmd+Enter', action: 'Approve changes' },
      { keys: 'Esc', action: 'Close modal' },
      { keys: 'Cmd+1-4', action: 'Switch panels' },
      { keys: '↑↓', action: 'Navigate files' },
      { keys: '→←', action: 'Expand/collapse folders' },
      { keys: 'Enter', action: 'Open file' }
    ];

    // Show modal with shortcuts table
    // ...
  }
}
```

**Focus Management:**

```javascript
// When opening modal, trap focus
class ModalManager {
  openModal(content) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = content;
    document.body.appendChild(modal);

    // Store previously focused element
    this.previousFocus = document.activeElement;

    // Focus first focusable element in modal
    const firstFocusable = modal.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    firstFocusable?.focus();

    // Trap focus within modal
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        this.trapFocus(modal, e);
      }
    });
  }

  closeModal() {
    const modal = document.querySelector('.modal-overlay');
    modal?.remove();

    // Restore focus
    this.previousFocus?.focus();
  }

  trapFocus(container, event) {
    const focusableElements = container.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }
}
```

**Screen Reader Announcements:**

```javascript
class A11yAnnouncer {
  constructor() {
    this.createAnnouncer();
  }

  createAnnouncer() {
    const announcer = document.createElement('div');
    announcer.id = 'a11y-announcer';
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    announcer.style.position = 'absolute';
    announcer.style.left = '-10000px';
    announcer.style.width = '1px';
    announcer.style.height = '1px';
    announcer.style.overflow = 'hidden';
    document.body.appendChild(announcer);
  }

  announce(message, priority = 'polite') {
    const announcer = document.getElementById('a11y-announcer');
    announcer.setAttribute('aria-live', priority);

    // Clear then set (to trigger announcement even if same text)
    announcer.textContent = '';
    setTimeout(() => {
      announcer.textContent = message;
    }, 100);
  }
}

// Usage:
const announcer = new A11yAnnouncer();
announcer.announce('Context approved. Planning changes.');
announcer.announce('Error applying changes', 'assertive');
```

---

### 18. Create Style System

**Location:** Create `/Users/xyz/deco/reploid/styles/design-system.css`

```css
/**
 * REPLOID Design System
 * Centralized styles for consistent UI
 */

:root {
  /* Colors */
  --color-primary: #0ff;
  --color-primary-dim: #4ec9b0;
  --color-primary-dark: #0cc;
  --color-secondary: #ffd700;
  --color-danger: #ff4444;
  --color-warning: #ffaa00;
  --color-success: #44ff44;

  /* Neutrals */
  --color-bg-primary: #000;
  --color-bg-secondary: rgba(0, 0, 0, 0.5);
  --color-bg-tertiary: rgba(0, 0, 0, 0.3);
  --color-surface: rgba(255, 255, 255, 0.05);
  --color-surface-hover: rgba(255, 255, 255, 0.1);
  --color-surface-active: rgba(255, 255, 255, 0.15);

  --color-border: rgba(255, 255, 255, 0.1);
  --color-border-focus: rgba(0, 255, 255, 0.5);

  --color-text-primary: #fff;
  --color-text-secondary: rgba(255, 255, 255, 0.7);
  --color-text-tertiary: rgba(255, 255, 255, 0.5);

  /* Typography */
  --font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-family-mono: 'SF Mono', Monaco, 'Courier New', monospace;

  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-base: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;
  --font-size-2xl: 24px;
  --font-size-3xl: 32px;

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --line-height-tight: 1.2;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
  --space-3xl: 48px;

  /* Borders */
  --border-radius-sm: 4px;
  --border-radius-md: 6px;
  --border-radius-lg: 8px;
  --border-radius-full: 9999px;

  --border-width-thin: 1px;
  --border-width-medium: 2px;
  --border-width-thick: 3px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
  --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.6);
  --shadow-xl: 0 16px 32px rgba(0, 0, 0, 0.7);

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow: 350ms ease;

  /* Z-index */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-fixed: 300;
  --z-modal-backdrop: 400;
  --z-modal: 500;
  --z-popover: 600;
  --z-tooltip: 700;
}

/* Typography Classes */
.text-xs { font-size: var(--font-size-xs); }
.text-sm { font-size: var(--font-size-sm); }
.text-base { font-size: var(--font-size-base); }
.text-lg { font-size: var(--font-size-lg); }
.text-xl { font-size: var(--font-size-xl); }
.text-2xl { font-size: var(--font-size-2xl); }
.text-3xl { font-size: var(--font-size-3xl); }

.font-normal { font-weight: var(--font-weight-normal); }
.font-medium { font-weight: var(--font-weight-medium); }
.font-semibold { font-weight: var(--font-weight-semibold); }
.font-bold { font-weight: var(--font-weight-bold); }

.font-sans { font-family: var(--font-family-sans); }
.font-mono { font-family: var(--font-family-mono); }

/* Button System */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);

  padding: var(--space-sm) var(--space-lg);

  font-family: var(--font-family-sans);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-normal);

  border: var(--border-width-thin) solid transparent;
  border-radius: var(--border-radius-md);

  cursor: pointer;
  transition: all var(--transition-fast);

  /* Remove default button styles */
  background: none;
  color: inherit;
}

.btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.btn:active {
  transform: translateY(0);
  box-shadow: var(--shadow-sm);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

/* Button Variants */
.btn-primary {
  background: var(--color-primary);
  color: var(--color-bg-primary);
}

.btn-primary:hover {
  background: var(--color-primary-dark);
}

.btn-secondary {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-surface-hover);
}

.btn-success {
  background: var(--color-success);
  color: var(--color-bg-primary);
}

.btn-warning {
  background: var(--color-warning);
  color: var(--color-bg-primary);
}

.btn-danger {
  background: var(--color-danger);
  color: var(--color-text-primary);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-primary);
}

.btn-ghost:hover {
  background: var(--color-surface);
}

/* Button Sizes */
.btn-sm {
  padding: var(--space-xs) var(--space-md);
  font-size: var(--font-size-sm);
}

.btn-lg {
  padding: var(--space-md) var(--space-xl);
  font-size: var(--font-size-lg);
}

/* Input System */
.input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);

  font-family: var(--font-family-sans);
  font-size: var(--font-size-base);
  color: var(--color-text-primary);

  background: var(--color-surface);
  border: var(--border-width-thin) solid var(--color-border);
  border-radius: var(--border-radius-md);

  transition: all var(--transition-fast);
}

.input:hover {
  border-color: var(--color-text-tertiary);
}

.input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px rgba(0, 255, 255, 0.1);
}

.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Panel System */
.panel {
  background: var(--color-bg-secondary);
  border: var(--border-width-thin) solid var(--color-border);
  border-radius: var(--border-radius-lg);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) var(--space-lg);
  background: var(--color-surface);
  border-bottom: var(--border-width-thin) solid var(--color-border);
}

.panel-body {
  padding: var(--space-lg);
}

/* Badge System */
.badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  border-radius: var(--border-radius-full);
  background: var(--color-surface);
  color: var(--color-text-secondary);
}

.badge-primary {
  background: rgba(0, 255, 255, 0.2);
  color: var(--color-primary);
}

.badge-success {
  background: rgba(68, 255, 68, 0.2);
  color: var(--color-success);
}

.badge-warning {
  background: rgba(255, 170, 0, 0.2);
  color: var(--color-warning);
}

.badge-danger {
  background: rgba(255, 68, 68, 0.2);
  color: var(--color-danger);
}

/* Utility Classes */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

**Update all components to use design system:**

```html
<!-- Old -->
<button style="background: #0ff; padding: 8px 16px;">Click</button>

<!-- New -->
<button class="btn btn-primary">Click</button>
```

---

## 🟢 LOWER PRIORITY - Nice to Have

### 19. Add Metrics Dashboard

**Location:** Create `/Users/xyz/deco/reploid/upgrades/metrics-collector.js`

**Metrics to Track:**
- Cycle count and duration
- State transitions (time in each state)
- Token usage per cycle
- Tool invocations (which tools, how often)
- Error rate and types
- User interactions (approvals, rejections, edits)
- File operations (reads, writes, deletes)
- Session duration

**Implementation:**

```javascript
class MetricsCollector {
  constructor() {
    this.metrics = {
      cycles: [],
      states: {},
      tools: {},
      errors: [],
      sessions: []
    };
    this.currentCycle = null;
    this.setupEventListeners();
  }

  setupEventListeners() {
    EventBus.on('cycle:start', (data) => this.onCycleStart(data));
    EventBus.on('cycle:complete', (data) => this.onCycleComplete(data));
    EventBus.on('state:transition', (data) => this.onStateTransition(data));
    EventBus.on('tool:executed', (data) => this.onToolExecuted(data));
    EventBus.on('error:occurred', (data) => this.onError(data));
  }

  onCycleStart(data) {
    this.currentCycle = {
      id: data.cycleId,
      startTime: Date.now(),
      goal: data.goal,
      tokens: 0,
      states: []
    };
  }

  onCycleComplete(data) {
    if (this.currentCycle) {
      this.currentCycle.endTime = Date.now();
      this.currentCycle.duration = this.currentCycle.endTime - this.currentCycle.startTime;
      this.currentCycle.success = data.success;
      this.metrics.cycles.push(this.currentCycle);
      this.currentCycle = null;
    }
  }

  onStateTransition(data) {
    const { from, to, timestamp } = data;

    // Track time spent in each state
    if (!this.metrics.states[from]) {
      this.metrics.states[from] = { count: 0, totalTime: 0 };
    }

    if (this.lastStateTransition) {
      const duration = timestamp - this.lastStateTransition;
      this.metrics.states[from].totalTime += duration;
    }

    this.metrics.states[from].count++;
    this.lastStateTransition = timestamp;

    if (this.currentCycle) {
      this.currentCycle.states.push({ from, to, timestamp });
    }
  }

  onToolExecuted(data) {
    const { toolName, duration, success } = data;

    if (!this.metrics.tools[toolName]) {
      this.metrics.tools[toolName] = {
        count: 0,
        totalDuration: 0,
        failures: 0
      };
    }

    this.metrics.tools[toolName].count++;
    this.metrics.tools[toolName].totalDuration += duration;
    if (!success) {
      this.metrics.tools[toolName].failures++;
    }
  }

  onError(data) {
    this.metrics.errors.push({
      timestamp: Date.now(),
      type: data.type,
      message: data.message,
      state: data.state,
      cycleId: this.currentCycle?.id
    });
  }

  getStats() {
    return {
      totalCycles: this.metrics.cycles.length,
      successfulCycles: this.metrics.cycles.filter(c => c.success).length,
      averageCycleDuration: this.getAverageDuration(this.metrics.cycles),
      mostUsedTools: this.getTopTools(5),
      errorRate: this.calculateErrorRate(),
      stateDistribution: this.getStateDistribution()
    };
  }

  getAverageDuration(cycles) {
    if (cycles.length === 0) return 0;
    const total = cycles.reduce((sum, c) => sum + c.duration, 0);
    return Math.round(total / cycles.length);
  }

  getTopTools(limit) {
    return Object.entries(this.metrics.tools)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgDuration: Math.round(data.totalDuration / data.count)
      }));
  }

  calculateErrorRate() {
    const totalOperations = this.metrics.cycles.length;
    const errors = this.metrics.errors.length;
    return totalOperations > 0 ? (errors / totalOperations * 100).toFixed(2) : 0;
  }

  getStateDistribution() {
    const total = Object.values(this.metrics.states).reduce((sum, s) => sum + s.count, 0);
    return Object.entries(this.metrics.states)
      .map(([state, data]) => ({
        state,
        percentage: ((data.count / total) * 100).toFixed(1),
        avgTime: Math.round(data.totalTime / data.count)
      }));
  }

  exportMetrics() {
    return {
      collected: Date.now(),
      stats: this.getStats(),
      raw: this.metrics
    };
  }
}
```

**Metrics Dashboard UI:**

Add panel to `ui-dashboard.html`:
```html
<div id="metrics-panel" class="panel">
  <div class="panel-header">
    <h3>Metrics</h3>
    <button class="btn btn-sm btn-ghost" id="export-metrics">Export</button>
  </div>
  <div class="panel-body">
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Total Cycles</div>
        <div class="metric-value" id="metric-total-cycles">0</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Success Rate</div>
        <div class="metric-value" id="metric-success-rate">0%</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Duration</div>
        <div class="metric-value" id="metric-avg-duration">0s</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Error Rate</div>
        <div class="metric-value" id="metric-error-rate">0%</div>
      </div>
    </div>

    <div class="metrics-section">
      <h4>Top Tools</h4>
      <div id="tool-chart"></div>
    </div>

    <div class="metrics-section">
      <h4>State Distribution</h4>
      <div id="state-chart"></div>
    </div>
  </div>
</div>
```

---

### 20. Improve Diff Viewer

**Enhancements:**
- Syntax highlighting
- Character-level diffs
- Unified diff option
- Navigation buttons
- Collapsible sections

**Add syntax highlighting:**

```javascript
// Use highlight.js or prism.js
async function renderDiffWithSyntax(oldContent, newContent, language) {
  const diffLines = generateLineDiff(oldContent, newContent);

  let html = '<div class="diff-view">';

  for (const line of diffLines) {
    const highlightedContent = await hljs.highlight(line.content, { language }).value;

    html += `
      <div class="diff-line diff-line-${line.type}">
        <span class="line-number">${line.oldNum || ''}</span>
        <span class="line-number">${line.newNum || ''}</span>
        <span class="line-indicator">${line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
        <code class="line-content">${highlightedContent}</code>
      </div>
    `;
  }

  html += '</div>';
  return html;
}
```

**Add navigation:**

```javascript
class DiffNavigator {
  constructor(diffContainer) {
    this.container = diffContainer;
    this.changes = [];
    this.currentIndex = -1;
    this.findChanges();
  }

  findChanges() {
    this.changes = Array.from(
      this.container.querySelectorAll('.diff-line.diff-line-add, .diff-line.diff-line-remove')
    );
  }

  next() {
    if (this.currentIndex < this.changes.length - 1) {
      this.currentIndex++;
      this.scrollToChange(this.currentIndex);
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.scrollToChange(this.currentIndex);
    }
  }

  scrollToChange(index) {
    const element = this.changes[index];
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Highlight briefly
    element.classList.add('highlighted');
    setTimeout(() => element.classList.remove('highlighted'), 1000);
  }
}
```

---

### 21. Add Export Functionality

**Export options:**
- Session data as JSON
- Logs as text file
- Artifacts as zip
- Metrics as CSV

```javascript
class ExportManager {
  async exportSession(sessionId) {
    const session = await StateManager.getSession(sessionId);
    const artifacts = await this.getSessionArtifacts(sessionId);

    const exportData = {
      version: '1.0',
      exported: new Date().toISOString(),
      session: {
        id: session.id,
        goal: session.goal,
        state: session.state,
        turns: session.turns
      },
      artifacts: artifacts,
      metrics: MetricsCollector.exportMetrics()
    };

    this.downloadJSON(exportData, `reploid-session-${sessionId}.json`);
  }

  async exportLogs(format = 'txt') {
    const logs = document.getElementById('thought-stream').innerText;

    if (format === 'txt') {
      this.downloadText(logs, `reploid-logs-${Date.now()}.txt`);
    } else if (format === 'html') {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>REPLOID Logs</title></head>
        <body><pre>${logs}</pre></body>
        </html>
      `;
      this.downloadText(html, `reploid-logs-${Date.now()}.html`);
    }
  }

  async exportArtifactsZip(sessionId) {
    // Requires JSZip library
    const zip = new JSZip();
    const artifacts = await this.getSessionArtifacts(sessionId);

    for (const [path, content] of Object.entries(artifacts)) {
      zip.file(path.replace(/^\/vfs\//, ''), content);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    this.downloadBlob(blob, `reploid-artifacts-${sessionId}.zip`);
  }

  downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    this.downloadBlob(blob, filename);
  }

  downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    this.downloadBlob(blob, filename);
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
```

---

### 22. Add Testing Infrastructure

**Test Structure:**

```
test/
├── unit/
│   ├── state-manager.test.js
│   ├── git-vfs.test.js
│   ├── sentinel-fsm.test.js
│   └── tool-runner.test.js
├── integration/
│   ├── guardian-flow.test.js
│   ├── cats-dogs-workflow.test.js
│   └── api-client.test.js
├── cli/
│   ├── cats.test.js
│   └── dogs.test.js
├── fixtures/
│   ├── sample-cats.md
│   ├── sample-dogs.md
│   └── mock-vfs.json
└── helpers/
    ├── test-utils.js
    └── mock-state-manager.js
```

**Example Test:**

```javascript
// test/unit/state-manager.test.js
const { StateManager } = require('../../upgrades/state-manager');

describe('StateManager', () => {
  let stateManager;

  beforeEach(() => {
    stateManager = new StateManager();
    stateManager.initState();
  });

  describe('createArtifact', () => {
    it('should create new artifact with content', async () => {
      const path = '/vfs/test.js';
      const content = 'console.log("test");';

      await stateManager.createArtifact(path, content);
      const retrieved = await stateManager.getArtifactContent(path);

      expect(retrieved).toBe(content);
    });

    it('should throw error for duplicate path', async () => {
      const path = '/vfs/test.js';
      await stateManager.createArtifact(path, 'content1');

      await expect(
        stateManager.createArtifact(path, 'content2')
      ).rejects.toThrow('Artifact already exists');
    });
  });

  describe('createCheckpoint', () => {
    it('should save artifact content in checkpoint', async () => {
      await stateManager.createArtifact('/vfs/test.js', 'original');
      const checkpointId = await stateManager.createCheckpoint('test');

      // Modify artifact
      await stateManager.updateArtifact('/vfs/test.js', 'modified');

      // Restore checkpoint
      await stateManager.restoreCheckpoint(checkpointId);
      const content = await stateManager.getArtifactContent('/vfs/test.js');

      expect(content).toBe('original');
    });
  });
});
```

**Add test script to package.json:**

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  },
  "jest": {
    "testEnvironment": "node",
    "coverageDirectory": "coverage",
    "collectCoverageFrom": [
      "upgrades/**/*.js",
      "bin/**/*.js",
      "!**/*.test.js"
    ]
  }
}
```

---

### 23. Theme Customization

**Add theme toggle:**

```javascript
class ThemeManager {
  constructor() {
    this.currentTheme = localStorage.getItem('reploid-theme') || 'dark';
    this.applyTheme(this.currentTheme);
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('reploid-theme', theme);
    this.currentTheme = theme;
  }

  toggle() {
    const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme(newTheme);
  }
}
```

**Add theme CSS:**

```css
/* Dark theme (default) */
:root[data-theme="dark"] {
  --color-bg-primary: #000;
  --color-text-primary: #fff;
  /* ... */
}

/* Light theme */
:root[data-theme="light"] {
  --color-bg-primary: #fff;
  --color-text-primary: #000;
  --color-surface: rgba(0, 0, 0, 0.05);
  --color-border: rgba(0, 0, 0, 0.1);
  /* ... */
}

/* Custom themes */
:root[data-theme="cyberpunk"] {
  --color-primary: #ff00ff;
  --color-secondary: #00ffff;
  /* ... */
}
```

---

## 🔵 DOCUMENTATION IMPROVEMENTS

### 24. Create Quick Start Guide

**Location:** Create `/Users/xyz/deco/reploid/QUICKSTART.md`

**Content:**

```markdown
# REPLOID Quick Start Guide

Get started with REPLOID in 5 minutes.

## Installation

```bash
git clone https://github.com/your-org/reploid.git
cd reploid
npm install
```

## Try Browser Mode (Easiest)

1. Start local server:
   ```bash
   python -m http.server 8000
   ```

2. Open http://localhost:8000

3. Select "RSI Lab Sandbox" persona

4. Enter goal: "Create a simple hello world function"

5. Click "Awaken Agent"

6. Watch the Guardian Agent work and approve changes when prompted

## Try CLI Mode

1. Create context bundle:
   ```bash
   bin/cats "src/**/*.js" -o context.cats.md
   ```

2. Review context.cats.md

3. (Send to AI, get back changes.dogs.md)

4. Apply changes:
   ```bash
   bin/dogs changes.dogs.md --verify "npm test"
   ```

## Try Server Mode

1. Start Hermes server:
   ```bash
   cd hermes
   npm install
   npm start
   ```

2. Use CLI to interact:
   ```bash
   bin/reploid goal "Refactor authentication module"
   bin/reploid status
   bin/reploid approve
   ```

## Next Steps

- Read [Architecture Overview](docs/ARCHITECTURE.md)
- Explore [Personas](docs/PERSONAS.md)
- Learn [PAWS Philosophy](docs/PAWS.md)
- Check [API Reference](docs/API.md)

## Troubleshooting

### "Command not found: cats"
Run: `npm link` or use `bin/cats` instead

### "API key not found"
Create `.env` file: `GEMINI_API_KEY=your_key_here`

### "Port already in use"
Change port: `PORT=9000 npm start`
```

---

### 25. Add Inline Documentation

**Add JSDoc comments throughout:**

```javascript
/**
 * Creates a checkpoint of the current state for rollback purposes.
 * Includes full state snapshot and all artifact contents.
 *
 * @param {string} label - Human-readable checkpoint label
 * @returns {Promise<string>} Checkpoint ID
 *
 * @example
 * const checkpointId = await stateManager.createCheckpoint('before-refactor');
 * // ... make changes ...
 * await stateManager.restoreCheckpoint(checkpointId);
 */
async createCheckpoint(label = 'checkpoint') {
  // Implementation...
}
```

---

## IMPLEMENTATION STRATEGY

### Phase 1: Core Stability (Week 1)
Fix critical bugs that prevent system from functioning:
1. Fix diff viewer async race condition
2. Implement parseProposedChanges
3. Fix diff viewer global state bug
4. Fix memory leaks
5. Implement verification runner

### Phase 2: Safety & Security (Week 2)
Make the system safe to use:
6. Add status visibility
7. Fix security vulnerabilities
8. Add confirmation dialogs
9. Complete Git VFS integration
10. Improve error messages

### Phase 3: Usability (Week 3)
Make the system easy to use:
11. Add package configuration
12. Create unified config system
13. VFS explorer improvements
14. Mobile responsive design
15. Command system implementation

### Phase 4: Polish (Week 4+)
Make the system delightful:
16. Accessibility features
17. Style system
18. Metrics dashboard
19. Diff viewer enhancements
20. Export functionality
21. Testing infrastructure
22. Theme customization
23. Documentation

---

## MAINTENANCE NOTES

### Regular Tasks
- Review and close memory leaks
- Update dependencies
- Run security audits
- Test across browsers
- Profile performance
- Review error logs

### Future Considerations
- TypeScript migration
- End-to-end testing with Playwright
- Performance monitoring
- Analytics integration
- Plugin system for extensions
- Multi-user collaboration features
---

## 🎯 ARCHITECTURAL GAPS - Alignment with "Browser-Native Agentic IDE" Vision

Based on comprehensive analysis comparing REPLOID to the state-of-the-art "Browser-Native Agentic IDE" architecture outlined in "The Agentic Coding Nexus", the following gaps have been identified:

### ✅ Current Strengths

REPLOID already implements many foundational components:
- ✅ Guardian Agent FSM with human-in-the-loop approvals
- ✅ PAWS workflow (cats/dogs bundles) for safe changes
- ✅ Git-based VFS with history tracking and checkpoints
- ✅ Interactive diff viewer with selective approval
- ✅ Web Worker verification sandbox
- ✅ Event-driven modular architecture (DI container, EventBus)
- ✅ Multiple deployment modes (Browser/CLI/Server)
- ✅ Mobile responsive design
- ✅ Unified configuration system
- ✅ Comprehensive CLI command interface

### ❌ Critical Architectural Gaps

---

### 30. WebAssembly Runtime Integration (Pyodide)

**Priority:** HIGH  
**Complexity:** High  
**Impact:** Enables secure, sandboxed Python execution

**Current State:**
- Verification runner limited to shell commands in Web Worker
- No ability to execute Python or complex computations
- Cannot run data science, ML, or scientific computing code

**Gap:**
The blueprint specifies a full Pyodide (Python + Wasm) runtime for executing untrusted code in a multi-layer sandbox (Python → Wasm → Browser).

**Implementation:**

```javascript
// upgrades/pyodide-runtime.js
const PyodideRuntime = {
  metadata: {
    id: 'PyodideRuntime',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    let pyodideWorker = null;
    let pyodideReady = false;

    const init = async () => {
      // Create dedicated Web Worker for Pyodide
      pyodideWorker = new Worker('/upgrades/pyodide-worker.js');

      return new Promise((resolve, reject) => {
        pyodideWorker.onmessage = (e) => {
          if (e.data.type === 'ready') {
            pyodideReady = true;
            logger.info('[PyodideRuntime] Initialized successfully');
            resolve();
          } else if (e.data.type === 'error') {
            reject(new Error(e.data.error));
          }
        };

        pyodideWorker.postMessage({ type: 'init' });
      });
    };

    const runPython = async (code, filesContext = {}) => {
      if (!pyodideReady) {
        throw new Error('Pyodide not initialized');
      }

      return new Promise((resolve, reject) => {
        const requestId = `req_${Date.now()}_${Math.random()}`;

        const handler = (e) => {
          if (e.data.requestId === requestId) {
            pyodideWorker.removeEventListener('message', handler);

            if (e.data.success) {
              resolve({
                result: e.data.result,
                stdout: e.data.stdout,
                stderr: e.data.stderr,
                files: e.data.files
              });
            } else {
              reject(new Error(e.data.error));
            }
          }
        };

        pyodideWorker.addEventListener('message', handler);

        pyodideWorker.postMessage({
          type: 'run',
          requestId,
          code,
          files: filesContext
        });
      });
    };

    const installPackage = async (packageName) => {
      return new Promise((resolve, reject) => {
        const handler = (e) => {
          if (e.data.type === 'install_complete') {
            pyodideWorker.removeEventListener('message', handler);
            resolve();
          } else if (e.data.type === 'install_error') {
            pyodideWorker.removeEventListener('message', handler);
            reject(new Error(e.data.error));
          }
        };

        pyodideWorker.addEventListener('message', handler);
        pyodideWorker.postMessage({
          type: 'install',
          package: packageName
        });
      });
    };

    return {
      init,
      api: {
        runPython,
        installPackage,
        isReady: () => pyodideReady
      }
    };
  }
};
```

```javascript
// upgrades/pyodide-worker.js
importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js');

let pyodide = null;

self.onmessage = async (event) => {
  const { type, requestId, code, files, package: packageName } = event.data;

  switch (type) {
    case 'init':
      try {
        pyodide = await loadPyodide();
        self.postMessage({ type: 'ready' });
      } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
      }
      break;

    case 'run':
      try {
        // Mount files into virtual filesystem
        if (files) {
          for (const [path, content] of Object.entries(files)) {
            pyodide.FS.writeFile(path, content);
          }
        }

        // Capture stdout/stderr
        let stdout = '';
        let stderr = '';

        pyodide.setStdout({ batched: (msg) => { stdout += msg + '\n'; } });
        pyodide.setStderr({ batched: (msg) => { stderr += msg + '\n'; } });

        // Execute code
        const result = await pyodide.runPythonAsync(code);

        // Read modified files
        const modifiedFiles = {};
        // ... logic to detect and read changed files

        self.postMessage({
          requestId,
          success: true,
          result: result,
          stdout,
          stderr,
          files: modifiedFiles
        });
      } catch (err) {
        self.postMessage({
          requestId,
          success: false,
          error: err.message
        });
      }
      break;

    case 'install':
      try {
        await pyodide.loadPackage(packageName);
        self.postMessage({ type: 'install_complete' });
      } catch (err) {
        self.postMessage({ type: 'install_error', error: err.message });
      }
      break;
  }
};
```

**Benefits:**
- Secure Python code execution in browser
- Support for NumPy, Pandas, scikit-learn
- No server-side infrastructure required
- Complete isolation from host system

---

### 31. In-Browser LLM Inference (WebLLM/WebGPU)

**Priority:** HIGH  
**Complexity:** High  
**Impact:** Privacy, latency, cost reduction, offline capability

**Current State:**
- Relies entirely on cloud Gemini API
- No local-first inference option
- Privacy concerns for proprietary code
- API costs scale with usage
- No offline capability

**Gap:**
The blueprint specifies WebGPU-accelerated local LLM inference with hybrid cloud fallback for complex tasks.

**Implementation:**

```javascript
// upgrades/local-llm.js
const LocalLLM = {
  metadata: {
    id: 'LocalLLM',
    version: '1.0.0',
    dependencies: ['Utils', 'config'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, config } = deps;
    const { logger } = Utils;

    let llmWorker = null;
    let modelLoaded = false;
    let currentModel = null;

    const init = async () => {
      if (!('gpu' in navigator)) {
        logger.warn('[LocalLLM] WebGPU not available, local inference disabled');
        return false;
      }

      llmWorker = new Worker('/upgrades/webllm-worker.js', { type: 'module' });

      return new Promise((resolve) => {
        llmWorker.onmessage = (e) => {
          if (e.data.type === 'ready') {
            logger.info('[LocalLLM] Worker initialized');
            resolve(true);
          }
        };

        llmWorker.postMessage({ type: 'init' });
      });
    };

    const loadModel = async (modelId = 'Qwen2.5-Coder-7B-Instruct-q4f16_1') => {
      return new Promise((resolve, reject) => {
        const progressHandler = (e) => {
          if (e.data.type === 'load_progress') {
            logger.info(`[LocalLLM] Loading ${e.data.progress}%`);
          } else if (e.data.type === 'load_complete') {
            llmWorker.removeEventListener('message', progressHandler);
            modelLoaded = true;
            currentModel = modelId;
            logger.info(`[LocalLLM] Model ${modelId} loaded`);
            resolve();
          } else if (e.data.type === 'load_error') {
            llmWorker.removeEventListener('message', progressHandler);
            reject(new Error(e.data.error));
          }
        };

        llmWorker.addEventListener('message', progressHandler);

        llmWorker.postMessage({
          type: 'load_model',
          modelId
        });
      });
    };

    const generate = async (prompt, options = {}) => {
      if (!modelLoaded) {
        throw new Error('Model not loaded. Call loadModel() first.');
      }

      return new Promise((resolve, reject) => {
        const requestId = `gen_${Date.now()}`;

        const handler = (e) => {
          if (e.data.requestId === requestId) {
            llmWorker.removeEventListener('message', handler);

            if (e.data.type === 'generation_complete') {
              resolve({
                text: e.data.text,
                tokensPerSecond: e.data.tokensPerSecond
              });
            } else if (e.data.type === 'generation_error') {
              reject(new Error(e.data.error));
            }
          }
        };

        llmWorker.addEventListener('message', handler);

        llmWorker.postMessage({
          type: 'generate',
          requestId,
          prompt,
          temperature: options.temperature || 0.7,
          maxTokens: options.maxTokens || 2048
        });
      });
    };

    return {
      init,
      api: {
        loadModel,
        generate,
        isModelLoaded: () => modelLoaded,
        getCurrentModel: () => currentModel
      }
    };
  }
};
```

```javascript
// upgrades/webllm-worker.js
import * as webllm from 'https://esm.run/@mlc-ai/web-llm';

let engine = null;

self.onmessage = async (event) => {
  const { type, requestId, modelId, prompt, temperature, maxTokens } = event.data;

  switch (type) {
    case 'init':
      try {
        engine = await webllm.CreateMLCEngine('Qwen2.5-Coder-1.5B-Instruct-q4f16_1', {
          initProgressCallback: (progress) => {
            self.postMessage({
              type: 'init_progress',
              progress: Math.round(progress.progress * 100)
            });
          }
        });
        self.postMessage({ type: 'ready' });
      } catch (err) {
        self.postMessage({ type: 'init_error', error: err.message });
      }
      break;

    case 'load_model':
      try {
        await engine.reload(modelId, {
          progressCallback: (progress) => {
            self.postMessage({
              type: 'load_progress',
              progress: Math.round(progress.progress * 100)
            });
          }
        });
        self.postMessage({ type: 'load_complete' });
      } catch (err) {
        self.postMessage({ type: 'load_error', error: err.message });
      }
      break;

    case 'generate':
      try {
        const startTime = performance.now();
        let tokenCount = 0;

        const completion = await engine.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
          stream: false
        });

        const elapsedSeconds = (performance.now() - startTime) / 1000;
        const text = completion.choices[0].message.content;
        tokenCount = completion.usage?.completion_tokens || text.split(' ').length;

        self.postMessage({
          type: 'generation_complete',
          requestId,
          text,
          tokensPerSecond: Math.round(tokenCount / elapsedSeconds)
        });
      } catch (err) {
        self.postMessage({
          type: 'generation_error',
          requestId,
          error: err.message
        });
      }
      break;
  }
};
```

**Configuration:**

```json
// .reploidrc.json
{
  "ai": {
    "provider": "hybrid",
    "local": {
      "enabled": true,
      "model": "Qwen2.5-Coder-7B-Instruct-q4f16_1",
      "fallbackThreshold": 0.7
    },
    "cloud": {
      "provider": "gemini",
      "apiKey": "${GEMINI_API_KEY}"
    }
  }
}
```

**Benefits:**
- Zero API costs for common tasks
- Instant response (no network latency)
- Complete privacy (code never leaves browser)
- Offline capability
- Hybrid: Use local for simple tasks, cloud for complex reasoning

---

### 32. Visual Agent Process Visualization (D3.js/WebGL)

**Priority:** MEDIUM  
**Complexity:** Medium  
**Impact:** Transparency, debuggability, understanding

**Current State:**
- Text-based status indicator
- FSM state shown as string
- No visual representation of agent's reasoning
- Difficult to understand decision flow

**Gap:**
The blueprint specifies interactive graph visualization of the agent's planning process and state transitions.

**Implementation:**

```javascript
// upgrades/agent-viz.js
const AgentVisualizer = {
  metadata: {
    id: 'AgentVisualizer',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    let svg = null;
    let simulation = null;

    const init = (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) {
        logger.error(`[AgentVisualizer] Container ${containerId} not found`);
        return;
      }

      // Create SVG canvas
      svg = d3.select(container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', [0, 0, 800, 600]);

      // Initialize force simulation
      simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(400, 300));

      // Listen for state changes
      EventBus.on('agent:state:change', updateGraph);
      EventBus.on('agent:plan:update', updateGraph);

      logger.info('[AgentVisualizer] Initialized');
    };

    const updateGraph = (event) => {
      const { state, plan, history } = event;

      // Build graph data
      const nodes = [];
      const links = [];

      // Add state nodes
      const states = ['IDLE', 'CURATING_CONTEXT', 'AWAITING_CONTEXT_APPROVAL',
                      'PLANNING_WITH_CONTEXT', 'GENERATING_PROPOSAL',
                      'AWAITING_PROPOSAL_APPROVAL', 'APPLYING_CHANGES',
                      'REFLECTING', 'ERROR'];

      states.forEach((s, i) => {
        nodes.push({
          id: s,
          label: s,
          active: s === state,
          visited: history?.includes(s),
          x: (i % 3) * 250 + 100,
          y: Math.floor(i / 3) * 150 + 100
        });
      });

      // Add transitions
      const transitions = [
        ['IDLE', 'CURATING_CONTEXT'],
        ['CURATING_CONTEXT', 'AWAITING_CONTEXT_APPROVAL'],
        ['AWAITING_CONTEXT_APPROVAL', 'PLANNING_WITH_CONTEXT'],
        ['PLANNING_WITH_CONTEXT', 'GENERATING_PROPOSAL'],
        ['GENERATING_PROPOSAL', 'AWAITING_PROPOSAL_APPROVAL'],
        ['AWAITING_PROPOSAL_APPROVAL', 'APPLYING_CHANGES'],
        ['APPLYING_CHANGES', 'REFLECTING'],
        ['REFLECTING', 'IDLE'],
        // Error transitions
        ['CURATING_CONTEXT', 'ERROR'],
        ['PLANNING_WITH_CONTEXT', 'ERROR'],
        ['APPLYING_CHANGES', 'ERROR']
      ];

      transitions.forEach(([source, target]) => {
        links.push({ source, target });
      });

      renderGraph(nodes, links);
    };

    const renderGraph = (nodes, links) => {
      // Clear existing
      svg.selectAll('*').remove();

      // Add arrow markers
      svg.append('defs').selectAll('marker')
        .data(['arrow'])
        .enter().append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'rgba(0, 255, 255, 0.5)');

      // Links
      const link = svg.append('g')
        .selectAll('line')
        .data(links)
        .enter().append('line')
        .attr('stroke', 'rgba(0, 255, 255, 0.3)')
        .attr('stroke-width', 2)
        .attr('marker-end', 'url(#arrow)');

      // Nodes
      const node = svg.append('g')
        .selectAll('g')
        .data(nodes)
        .enter().append('g')
        .call(d3.drag()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended));

      node.append('circle')
        .attr('r', 20)
        .attr('fill', d => d.active ? '#00ffff' : 
                           d.visited ? 'rgba(0, 255, 255, 0.3)' : 
                           'rgba(255, 255, 255, 0.1)')
        .attr('stroke', 'rgba(0, 255, 255, 0.5)')
        .attr('stroke-width', 2);

      node.append('text')
        .text(d => d.label.substring(0, 3))
        .attr('text-anchor', 'middle')
        .attr('dy', 4)
        .attr('fill', '#00ffff')
        .attr('font-size', '10px');

      // Tooltips
      node.append('title')
        .text(d => d.label);

      // Update simulation
      simulation.nodes(nodes);
      simulation.force('link').links(links);

      simulation.on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);
      });

      simulation.alpha(1).restart();
    };

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    return {
      api: {
        init,
        updateGraph
      }
    };
  }
};
```

**Add to dashboard:**

```html
<!-- ui-dashboard.html -->
<div id="agent-visualization-panel" class="panel">
  <h2>Agent Process Graph</h2>
  <div id="agent-viz-canvas" style="width: 100%; height: 400px;"></div>
</div>
```

**Benefits:**
- See agent's entire decision tree at a glance
- Understand why agent chose specific path
- Debug stuck or looping states
- Interactive exploration of agent reasoning

---

### 33. Abstract Syntax Tree (AST) Visualization

**Priority:** MEDIUM  
**Complexity:** Medium  
**Impact:** Code understanding, structural editing

**Current State:**
- Text-based code editing only
- No structural code analysis
- Agent treats code as strings

**Gap:**
The blueprint specifies AST parsing and visualization for deep structural understanding.

**Implementation:**

```javascript
// upgrades/ast-viz.js
import { parse } from 'https://esm.run/acorn';
import * as walk from 'https://esm.run/acorn-walk';

const ASTVisualizer = {
  metadata: {
    id: 'ASTVisualizer',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    let container = null;
    let currentAST = null;

    const init = (containerId) => {
      container = document.getElementById(containerId);
      if (!container) {
        logger.error(`[ASTVisualizer] Container ${containerId} not found`);
        return;
      }

      logger.info('[ASTVisualizer] Initialized');
    };

    const parseCode = (code, language = 'javascript') => {
      try {
        if (language === 'javascript') {
          currentAST = parse(code, { ecmaVersion: 2023, sourceType: 'module' });
          return currentAST;
        }
        // Add support for other languages using tree-sitter
        throw new Error(`Language ${language} not supported yet`);
      } catch (err) {
        logger.error('[ASTVisualizer] Parse error:', err);
        return null;
      }
    };

    const visualize = (ast = currentAST) => {
      if (!ast || !container) return;

      // Convert AST to tree structure
      const treeData = astToTree(ast);

      // Render with D3
      renderTree(treeData);
    };

    const astToTree = (node, depth = 0) => {
      if (!node || typeof node !== 'object') return null;

      const tree = {
        name: node.type,
        value: node.name || node.value || '',
        loc: node.loc,
        children: []
      };

      // Walk AST
      for (const key in node) {
        if (key === 'type' || key === 'loc' || key === 'range') continue;

        const child = node[key];

        if (Array.isArray(child)) {
          child.forEach(c => {
            const t = astToTree(c, depth + 1);
            if (t) tree.children.push(t);
          });
        } else if (child && typeof child === 'object' && child.type) {
          const t = astToTree(child, depth + 1);
          if (t) tree.children.push(t);
        }
      }

      return tree;
    };

    const renderTree = (data) => {
      container.innerHTML = '';

      const width = container.clientWidth;
      const height = 600;

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

      const tree = d3.tree().size([height - 100, width - 200]);
      const root = d3.hierarchy(data);

      tree(root);

      // Links
      svg.selectAll('.link')
        .data(root.links())
        .enter().append('path')
        .attr('class', 'link')
        .attr('d', d3.linkHorizontal()
          .x(d => d.y + 100)
          .y(d => d.x + 50))
        .attr('fill', 'none')
        .attr('stroke', 'rgba(0, 255, 255, 0.3)')
        .attr('stroke-width', 1);

      // Nodes
      const node = svg.selectAll('.node')
        .data(root.descendants())
        .enter().append('g')
        .attr('class', 'node')
        .attr('transform', d => `translate(${d.y + 100},${d.x + 50})`);

      node.append('circle')
        .attr('r', 5)
        .attr('fill', '#00ffff');

      node.append('text')
        .attr('dy', 3)
        .attr('x', d => d.children ? -8 : 8)
        .attr('text-anchor', d => d.children ? 'end' : 'start')
        .text(d => d.data.name)
        .attr('fill', '#00ffff')
        .attr('font-size', '11px');

      // Hover to highlight in editor
      node.on('click', (event, d) => {
        EventBus.emit('ast:node:selected', {
          type: d.data.name,
          loc: d.data.loc
        });
      });
    };

    return {
      api: {
        init,
        parseCode,
        visualize
      }
    };
  }
};
```

**Benefits:**
- Visual code structure understanding
- Click AST node to jump to code
- Structural code navigation
- Better agent code comprehension

---

*Continued in next sections...*

**Summary of Major Gaps:**

1. ❌ WebAssembly/Pyodide runtime (no secure Python execution)
2. ❌ WebGPU/WebLLM (no local-first inference)
3. ❌ Agent process visualization (FSM graph not rendered)
4. ❌ AST parsing and visualization
5. ❌ LangGraph-style multi-agent orchestration
6. ❌ Model Context Protocol (MCP) integration
7. ❌ Modern browser storage (File System Access API, IndexedDB)
8. ❌ WebGPU compute acceleration
9. ❌ Pyodide FFI for JS↔Python bridge
10. ❌ Multi-layer security sandbox architecture

**Recommendation:** Prioritize items #30 (Pyodide), #31 (Local LLM), and #32 (Visualization) as they provide the highest impact toward achieving the browser-native vision.

