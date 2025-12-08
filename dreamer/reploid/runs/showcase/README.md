# REPLOID Showcase Runs

Four demonstration runs showcasing REPLOID's autonomous RSI (Recursive Self-Improvement) capabilities.

---

## Featured Runs

### 1. Self-Study (Dec 8, 2024) ⭐
**Goal:** Study the core agent loop and capture a Think-Act-Observe summary

**Model:** Gemini 3 Pro Preview | **Cycles:** 40 | **Size:** 9.4MB

The agent studied its own source code, created a custom analysis tool, and produced documentation explaining its own architecture.

**Key Artifact:** `/reports/agent-loop-analysis.md`
- Think: Goal management, reflection injection, semantic enrichment
- Act: Multi-model consensus, circuit breakers, tool chaining
- Observe: Symbolic validation, auto-learning, stuck loop detection

**Demonstrates:** Self-understanding, code analysis, documentation generation

---

### 2. Iframe Inception (Dec 4, 2024)
**Goal:** Create recursive agent instances via iframe embedding

**Cycles:** 50 | **Size:** 2.4MB

The agent created infrastructure to spawn and communicate with child REPLOID instances.

**Key Artifact:** `AwakenChild.js` - Agent-created tool:
```javascript
// 1. Find iframe in DOM
// 2. Click "Awaken" button in child
// 3. Wait for proto.js to load
// 4. Send INIT_RECURSION via postMessage
iframe.contentWindow.postMessage({
  type: 'INIT_RECURSION',
  goal: goal,
  depth: depth
}, '*');
```

**Status Output:**
```
Recursive Agent Inception initiated.
Depth 1 spawned and awakened.
Goal propagated.
```

**Demonstrates:** Self-replication, tool creation, DOM manipulation

---

### 3. Security Red-Team (Dec 7, 2024)
**Goal:** Attempt to escape the browser sandbox, report vectors found

**Cycles:** 125 | **Size:** 12MB | **Events:** 527

Multi-goal session: sandbox escape testing, agent loop analysis, weakness probing.

**Key Artifacts:**
- `/pwn.txt`: `YOU_HAVE_BEEN_PWNED_BY_REPLOID_RSI`
- 10 genesis snapshots during exploration
- `/docs/AGENT_LOOP_ANALYSIS.md`

**Demonstrates:** Security awareness, boundary testing, self-documentation

---

### 4. RSI Blocker Refactor (Nov 26, 2024)
**Goal:** Audit /core and /capabilities, refactor blockers for RSI

**Cycles:** 13 | **Size:** 317KB

Early run where agent optimized its own token efficiency.

**Key Artifact:** `code_intel.js` - Agent-created tool:
```javascript
// Reads file structure (imports, exports, functions)
// without loading full content. Saves tokens during RSI.
```

**Demonstrates:** Meta-optimization, token efficiency, self-tooling

---

## Replay System (Implemented)

### Replay Tab

REPLOID now has a built-in Replay tab (▶ icon in sidebar) with:

1. **File Loader** - Load exported run JSON files
2. **Metadata Display** - Shows cycles, events, files, export date
3. **Playback Controls** - Play / Pause / Step / Stop
4. **Speed Selector** - 1x / 2x / 5x / 10x / 50x
5. **Progress Bar** - Shows current event / total
6. **Event Log** - Live feed of replayed events

### How to Use

1. Click the ▶ (Replay) tab in the sidebar
2. Click "Load Run File" and select an exported JSON
3. View metadata (cycles, events, files)
4. Set desired speed (5x recommended for demos)
5. Click ▶ Play to start replay
6. Watch the event log show agent activity

### Infrastructure

```javascript
// ReplayEngine API
const engine = await REPLOID_DI.resolve('ReplayEngine');

// Load a run
const { metadata } = engine.loadRun(exportedRunData);

// Playback controls
engine.play();      // Start/resume playback
engine.pause();     // Pause playback
engine.stop();      // Reset to beginning
engine.step();      // Single-step forward
engine.setSpeed(5); // Set speed multiplier

// EventBus events emitted during replay
// - replay:loaded, replay:started, replay:paused
// - replay:stopped, replay:completed, replay:progress
// - replay:event (each timeline event as it plays)
```

**Speed Controls:**
- 1x: Real-time (for demos)
- 5x: Quick review (default)
- 10x: Fast scan
- 50x: Instant (screenshot mode)

---

## File Manifest

```
runs/
├── showcase/
│   ├── README.md                    # This file
│   ├── inception-awaken-child.js    # Agent-created inception tool
│   ├── self-study-report.md         # Gemini 3's analysis
│   └── security-analysis.md         # Dec 7 agent loop docs
├── reploid-gemini3-run.json         # Dec 8 - Self-study (9.4MB)
├── reploid-export-1764910293555.json # Dec 4 - Inception (2.4MB)
├── reploid-export-1765143717007.json # Dec 7 - Security (12MB)
└── reploid-export-1764172457231.json # Nov 26 - RSI Blocker (317KB)
```

## Quick Import

```javascript
// In browser console on replo.id:
const run = await fetch('/runs/showcase/reploid-gemini3-run.json').then(r => r.json());
const vfs = await window.REPLOID_DI.resolve('VFS');
await vfs.importAll(run.vfs, true); // true = clear first
```
