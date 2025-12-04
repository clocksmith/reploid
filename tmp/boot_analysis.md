# REPLOID BOOT SEQUENCE - DETAILED FILE LOADING

## PHASE 1: Initial Page Load (Browser Request)

**User navigates to:** `http://localhost:8080/`

### Files Loaded from Network (Blocking):
1. `index.html` - HTML document
2. `styles/theme.css` - CSS variables, design system
3. `styles/boot.css` - Boot screen styling
4. `styles/proto.css` - Dashboard styling

**DOM State:** Boot screen visible, "Awaken Agent" button disabled

**JavaScript State:**
- Service Worker registration initiated (async)
- Genesis level selector rendered (default: 'full')
- Model cards container empty
- No modules loaded yet

---

## PHASE 2: Service Worker Registration (Async)

**File Loaded:**
- `sw-module-loader.js` - Registers as Service Worker

**What it does:**
- Creates IndexedDB: `reploid-vfs-v2` with `files` object store
- Installs fetch event listener
- **Does NOT populate VFS yet** - VFS is completely empty

**Service Worker Intercept Logic:**
```javascript
// For any .js file request:
1. Check if file exists in VFS IndexedDB
2. If YES: serve from VFS with header X-VFS-Source: true
3. If NO: fetch from network and return
```

---

## PHASE 3: boot.js Execution (ES6 Module Load)

**File Loaded:**
- `boot.js` - Main bootstrapper

### boot.js Imports (Lines 6-56) - 40 Files from Network:

**Core (13 files):**
1. ./core/utils.js
2. ./core/vfs.js
3. ./core/state-manager.js
4. ./core/state-helpers-pure.js
5. ./core/llm-client.js
6. ./core/transformers-client.js
7. ./core/response-parser.js
8. ./core/context-manager.js
9. ./core/verification-manager.js
10. ./core/tool-runner.js
11. ./core/tool-writer.js
12. ./core/agent-loop.js
13. ./core/persona-manager.js

**Infrastructure (10 files):**
14. ./infrastructure/di-container.js
15. ./infrastructure/event-bus.js
16. ./infrastructure/audit-logger.js
17. ./infrastructure/rate-limiter.js
18. ./infrastructure/circuit-breaker.js
19. ./infrastructure/stream-parser.js
20. ./infrastructure/indexed-db-helper.js
21. ./infrastructure/hitl-controller.js
22. ./infrastructure/genesis-snapshot.js
23. ./infrastructure/observability.js
24. ./infrastructure/vfs-hmr.js

**Capabilities (12 files):**
25. ./capabilities/system/substrate-loader.js
26. ./capabilities/reflection/reflection-store.js
27. ./capabilities/reflection/reflection-analyzer.js
28. ./capabilities/performance/performance-monitor.js
29. ./capabilities/testing/self-tester.js
30. ./capabilities/cognition/semantic/embedding-store.js
31. ./capabilities/cognition/semantic/semantic-memory.js
32. ./capabilities/cognition/symbolic/knowledge-graph.js
33. ./capabilities/cognition/symbolic/rule-engine.js
34. ./capabilities/cognition/symbolic/symbol-grounder.js
35. ./capabilities/cognition/cognition-api.js
36. ./capabilities/intelligence/multi-model-coordinator.js

**Testing (4 files):**
37. ./testing/arena/index.js (exports 4 modules)

**UI (2 files):**
38. ./ui/boot/model-config/index.js
39. ./ui/goal-history.js

**Total: 39 unique files loaded from NETWORK via ES6 import**

**Important:**
- Service Worker intercepts these requests
- VFS is empty, so ALL serve from network
- Files are parsed and executed by browser
- Module objects stored in JavaScript memory

---

## PHASE 4: Configuration Load

**File Fetched:**
40. `./config/genesis-levels.json` (via fetch() from network)

**Determines:**
- Which modules to register with DI container
- Full/Minimal/Tabula mode selection

---

## PHASE 5: Conditional Transformers.js Load

**IF genesis level === 'full':**
41. `https://cdn.jsdelivr.net/npm/@huggingface/transformers@3` (CDN)
    - Loaded via dynamic import
    - Sets `window.transformers`
    - ~10MB library

**ELSE:**
- Skipped for minimal/tabula modes

---

## PHASE 6: DI Container Registration

**No file loading** - Just in-memory registration:
- Creates DI container with Utils
- Registers 39 modules (already in memory from Phase 3)
- Modules not initialized yet, just registered

---

## PHASE 7: VFS Initialization

**Code:** `const vfs = await container.resolve('VFS')`

**What happens:**
- Calls `VFS.factory()` → `init()` → `openDB()`
- IndexedDB `reploid-vfs-v2` already exists (created by Service Worker)
- Opens connection to database
- **VFS is still EMPTY** - no files written yet

---

## PHASE 8: VFS Hydration (seedWorkspaceFiles)

### Step 1: Seed code_intel.js
**File Fetched:**
42. `./tools/code_intel.js` (via fetch() from network)
    - Checks: `if (await vfs.exists('/tools/code_intel.js')) return;`
    - If not exists, fetches and writes to VFS

**VFS Write:**
- `await vfs.write('/tools/code_intel.js', toolCode)`
- File now in IndexedDB: `{path: '/tools/code_intel.js', content: '...', type: 'file'}`

### Step 2: Seed All Module Files (Double Loading!)

**Files Fetched Again via fetch():**
43-81. All 39 module files from Phase 3 (fetched AGAIN!)
    - ./core/utils.js
    - ./core/vfs.js
    - ... (all 39 files)

**Why double load?**
1. **First load (Phase 3):** ES6 import → Browser needs code NOW to execute boot.js
2. **Second load (Phase 8):** fetch() → VFS needs source code for self-hosting

**VFS Writes:**
- Each file: `await vfs.write('/core/utils.js', contents)`
- 39 files now in IndexedDB VFS

### Step 3: Seed Tool Files

**Files Fetched:**
82-88. Tool files (via fetch() from network)
    - ./tools/search_content.js
    - ./tools/find_by_name.js
    - ./tools/git.js
    - ./tools/create_directory.js
    - ./tools/remove.js
    - ./tools/move.js
    - ./tools/copy.js

**VFS Writes:**
- 7 files written to VFS

### Step 4: Seed UI File

**File Fetched:**
89. `./ui/proto.js` (via fetch() from network)

**VFS Write:**
- 1 file written to VFS

**VFS Now Contains: 48 files**
- 39 module files
- 8 tool files
- 1 UI file (proto.js)

---

## PHASE 9: Genesis Snapshot Creation

**Code:** `GenesisSnapshot.createSnapshot('genesis-2025-12-03')`

**What happens:**
1. Reads ALL files from VFS (48 files)
2. Excludes: `/.genesis/`, `/.logs/`, `/apps/`
3. Creates JSON snapshot:
```javascript
{
  id: 'genesis-abc123',
  name: 'genesis-2025-12-03',
  timestamp: 1733270400000,
  fileCount: 48,
  files: {
    '/core/utils.js': '...code...',
    '/core/vfs.js': '...code...',
    // ... 48 files total
  }
}
```
4. Writes snapshot to VFS: `/.genesis/snapshots/genesis-abc123.json`

**VFS Now Contains: 49 files** (48 + 1 snapshot)

---

## PHASE 10: Boot Screen Ready

**DOM State:**
- Boot screen visible
- "Awaken Agent" button ENABLED
- Model selector populated
- Goal input ready

**Memory State:**
- 39 modules in JavaScript memory (from Phase 3 imports)
- DI container has references to all modules
- VFS service initialized and connected to IndexedDB
- Agent not running yet

**VFS State:**
- 49 files in IndexedDB
- Service Worker ready to intercept imports

---

## PHASE 11: User Clicks "Awaken Agent"

### Step 1: Goal Saved
```javascript
localStorage.setItem('REPLOID_GOAL', goal);
GoalHistory.add(goal);
```

### Step 2: Proto.js Dynamic Import

**Code:** `const { default: Proto } = await import('./ui/proto.js');`

**What happens:**
1. Browser requests `/ui/proto.js`
2. **Service Worker intercepts**
3. Checks VFS: `await readFromVFS('/ui/proto.js')`
4. **FOUND** in VFS (from Phase 8)
5. **Serves from IndexedDB** with header `X-VFS-Source: true`
6. Browser receives code from VFS, not network

**Important:** This is proto.js's FIRST import. It wasn't in Phase 3.

### Step 3: Proto Factory Called

```javascript
const proto = Proto.factory({
  Utils: Utils.factory(),
  EventBus: await container.resolve('EventBus'),
  AgentLoop: agent,
  StateManager: await container.resolve('StateManager')
});
```

**Dependencies resolved from DI container** (already in memory)

### Step 4: DOM Transformation

**Removed:**
- `<div id="boot-container">` - entire boot screen
- Reticle lines (crosshair)
- Grid pattern background

**Result:** Boot screen completely gone from DOM

### Step 5: Dashboard Mounted

**Code:** `proto.mount(appEl);`

**DOM State:**
- `<div id="app">` now contains dashboard
- Activity panel
- Execution panel
- Context panel
- VFS panel
- Controls

**VFS Passed to UI:**
```javascript
proto.setVFS(vfs);
```

Dashboard can now browse/preview VFS files

### Step 6: Agent Auto-Start (if goal set)

```javascript
agent.setModels(models);
agent.setConsensusStrategy(consensusStrategy);
agent.run(goal);
```

**Agent starts executing:**
- Calls LLM with goal
- LLM may call tools
- Tools read/write VFS
- Dashboard updates in real-time

---

## WHAT'S IN MEMORY vs VFS vs NETWORK

### JavaScript Memory (Loaded Once in Phase 3):
- 39 module objects (Utils, VFS, AgentLoop, etc.)
- DI container
- EventBus
- All registered services

**These NEVER reload unless page refreshes**

### VFS (IndexedDB):
- 39 module files (source code as strings)
- 8 tool files
- 1 UI file (proto.js)
- 1 genesis snapshot
- Any files agent creates later

**Total: 49 files**

### Network-Only (Never in VFS):
- index.html
- boot.js
- sw-module-loader.js
- 3 CSS files
- config/genesis-levels.json
- ui/boot/model-config/index.js
- ui/goal-history.js

---

## SERVICE WORKER BEHAVIOR AFTER HYDRATION

### Before VFS Hydration (Phase 1-7):
**Request:** `GET /core/vfs.js`
1. Service Worker checks VFS → NOT FOUND
2. Fetches from network
3. Returns to browser

### After VFS Hydration (Phase 8+):
**Request:** `GET /core/vfs.js`
1. Service Worker checks VFS → FOUND
2. Reads from IndexedDB
3. Returns VFS content (no network!)

### After Agent Modifies Code:
**Agent does:** `await vfs.write('/core/vfs.js', newCode)`
1. VFS writes to IndexedDB
2. VFS emits: `vfs:file_changed` event
3. VFSHMR listens and triggers reload
4. **Next import:** Service Worker serves NEW version from VFS

---

## CRITICAL INSIGHT: DOUBLE LOADING EXPLAINED

### Phase 3 Import:
```javascript
import VFS from './core/vfs.js';
```
- Browser NEEDS code to execute boot.js
- Module loaded into JavaScript memory
- Service Worker sees VFS empty, fetches from network
- Code parsed and executed

### Phase 8 Hydration:
```javascript
const resp = await fetch('./core/vfs.js');
const contents = await resp.text();
await vfs.write('/core/vfs.js', contents);
```
- VFS NEEDS source code for self-hosting
- Same file fetched again (as text, not module)
- Stored in IndexedDB as string
- Enables agent to read/modify its own code

**Result:**
- Module in memory (executing)
- Source in VFS (modifiable)
- Service Worker bridges both

---

## WHAT DOES NOT GET LOADED AGAIN

After "Awaken Agent" clicked:
- ✅ proto.js loads for first time (from VFS)
- ❌ Core modules (already in memory)
- ❌ Infrastructure modules (already in memory)
- ❌ Boot screen files (removed from DOM)

**The 39 modules from Phase 3 stay in memory. VFS just has their source code as backup.**

---

## FILE COUNT SUMMARY

**Total Files Involved:** 89 files

**Phase 1:** 4 files (HTML + CSS)
**Phase 2:** 1 file (Service Worker)
**Phase 3:** 39 files (Module imports)
**Phase 4:** 1 file (Config JSON)
**Phase 5:** 1 file (Transformers.js CDN, conditional)
**Phase 8:** 48 files (VFS hydration - 39 modules + 8 tools + proto.js)
**Phase 9:** 1 file (Genesis snapshot created)

**In VFS at Boot Complete:** 49 files
**In Browser Memory:** 39 module objects
**Network-Only:** 10 files
