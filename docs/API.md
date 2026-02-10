# REPLOID API Documentation

**Version:** 1.2.0
**Last Updated:** March 2026

This document provides an overview of REPLOID's module API. For detailed JSDoc comments, see the source files.

---

## Core Modules

### Utils (`core/utils.js`)

**Type:** Pure utility module (no dependencies)
**Status:** [x] Fully documented with JSDoc

**Error Classes:**
- `ApplicationError` - Base error class with details object
- `ApiError` - LLM API communication errors
- `ToolError` - Tool execution errors
- `StateError` - State management errors
- `ConfigError` - Configuration validation errors
- `ArtifactError` - VFS artifact operation errors
- `AbortError` - Operation abortion (user or timeout)
- `WebComponentError` - Web component initialization errors

**Logging:**
- `logger.debug(message, details)` - Debug level logging
- `logger.info(message, details)` - Info level logging
- `logger.warn(message, details)` - Warning level logging
- `logger.error(message, details)` - Error level logging

**String Utilities:**
- `kabobToCamel(string)` - Convert kebab-case to camelCase
- `trunc(str, len)` - Truncate string with ellipsis
- `escapeHtml(unsafe)` - Escape HTML special characters
- `sanitizeLlmJsonRespPure(rawText, logger)` - Extract JSON from LLM responses

**HTTP:**
- `post(url, body)` - HTTP POST with JSON handling

**DRY Helpers (Added 2025-09-30):**
- `createSubscriptionTracker()` - EventBus subscription tracking for memory leak prevention
- `showButtonSuccess(button, originalText, successText, duration)` - Temporary button feedback
- `exportAsMarkdown(filename, content)` - Export content as .md file

---

### StateManager (`core/state-manager.js`)

**Type:** Singleton state management with VFS
**Dependencies:** Utils, Storage (IndexedDB or localStorage)

**Core API:**
- `getState()` - Get current agent state
- `setState(updates)` - Update state (shallow merge)
- `resetState()` - Reset to initial state

**VFS Operations:**
- `saveArtifact(path, content, metadata)` - Save file to VFS
- `getArtifactContent(path)` - Read file content
- `getArtifactMetadata(path)` - Get file metadata
- `getAllArtifactMetadata()` - Get all files metadata
- `deleteArtifact(path)` - Delete file from VFS
- `clearAllData()` - Clear entire VFS

**Session Management:**
- `loadSession(sessionId)` - Load saved session
- `saveSession()` - Save current session
- `deleteSession(sessionId)` - Delete session
- `getAllSessions()` - List all sessions

**Checkpoints:**
- `createCheckpoint(label)` - Create rollback point
- `restoreCheckpoint(checkpointId)` - Rollback to checkpoint

---

### PersonaManager (`core/persona-manager.js`)

**Type:** Persona prompt composition and overrides
**Dependencies:** Utils, VFS

**API:**
- `getSystemPrompt()` - Build the active system prompt
- `getPersonas()` - List persona definitions from config
- `getActivePersona()` - Get resolved active persona (with overrides)
- `getPromptSlots(personaId?)` - Return prompt slots for a persona
- `applySlotMutation({ personaId, slot, content, mode })` - Mutate a slot (replace/append/prepend)
- `buildSystemPrompt(personaDef, override)` - Compose system prompt from persona + override

**Notes:**
- Overrides persist to `/.memory/persona-overrides.json`

---

### EventBus (`infrastructure/event-bus.js`)

**Type:** Pub/sub event system
**Dependencies:** Utils
**Status:** [x] Enhanced with subscription tracking (2025-09-30)

**API:**
- `on(eventName, listener, moduleId?)` - Subscribe to event (returns unsubscribe function)
- `off(eventName, listener)` - Unsubscribe from event
- `emit(eventName, data)` - Publish event
- `unsubscribeAll(moduleId)` - Cleanup all subscriptions for module
- `getSubscriptionReport()` - Get active subscription counts

**Common Events:**
- `agent:state:change` - FSM state transitions
- `artifact:saved` - VFS file saved
- `artifact:deleted` - VFS file deleted
- `tool:executed` - Tool execution completed
- `llm:response` - LLM API response received
- `performance:update` - Performance metrics updated

---

### MultiModelEvaluator (`core/multi-model-evaluator.js`, `capabilities/intelligence/multi-model-evaluator.js`)

**Type:** Multi-model evaluation harness
**Dependencies:** Utils, LLMClient, EventBus?, SchemaRegistry?
**Status:** Implemented (March 2026)

**API:**
- `evaluate(tasks, modelConfigs, options)` - Evaluate task suites across models
- `listRuns(limit?)` - List recent persisted runs (VFS)
- `loadRun(runId)` - Load a persisted run by id (VFS)
- `replayRun(runId, options)` - Re-run a persisted task suite

**Options:**
- `modelConcurrency` - Max concurrent model evaluations (default: 2)
- `matchMode` - Output match mode: `exact` or `contains`
- `lengthTarget` - Output length target for scoring
- `scoreOutput` - Custom scoring callback
- `timeoutMs` - Per-task timeout in milliseconds (0 disables)
- `abortOnError` - Stop remaining tasks for a model after first error
- `persist` - Persist run to VFS (boolean or config object)
- `persist.includeInputs` - Store tasks and model configs (default: true)
- `persist.includeOutputs` - Store per-task outputs (default: true)
- `persist.includeOptions` - Store evaluation options (default: true)
- `persist.path` - Override run file path (optional)

**Events:**
- `multi-model:eval:start` - Evaluation run started
- `multi-model:eval:progress` - Task completed for a model
- `multi-model:eval:complete` - Run completed with summary stats

**Notes:**
- Task entries can include `messages`, `prompt`, `schema`, and `expected`
- Timeouts are not enforced by default unless `timeoutMs` is set
- Persistence writes to `/.memory/multi-model-eval/` when VFS is available

**See Also:** [docs/multi-model-evaluation.md](./multi-model-evaluation.md)

---

## RSI Modules

### Introspector (`infrastructure/introspector.js`)

**Type:** Self-analysis and code introspection
**Dependencies:** Utils, EventBus, StateManager

**API:**
- `getModuleGraph()` - Analyze dependency graph
- `getToolCatalog()` - Discover available tools
- `analyzeOwnCode(modulePath)` - Complexity analysis, TODO extraction
- `getCapabilities()` - Browser feature detection
- `generateSelfReport()` - Export markdown report

**Use Cases:**
- Agent understanding its own architecture
- Identifying refactoring opportunities
- Detecting circular dependencies
- Browser capability awareness

---

### ReflectionStore (`infrastructure/reflection-store.js`)

**Type:** Persistent learning storage
**Dependencies:** Utils, IndexedDB

**API:**
- `addReflection(reflection)` - Save learning experience
- `getReflections(filters)` - Query reflections
- `getPatterns()` - Identify recurring patterns
- `clearOldReflections(cutoffTimestamp)` - Cleanup old data
- `generateReport()` - Export markdown report

**Reflection Schema:**
```javascript
{
  id: 'uuid',
  timestamp: 1234567890,
  type: 'success' | 'failure' | 'insight',
  context: 'What was happening',
  outcome: 'What resulted',
  lesson: 'What was learned',
  tags: ['tag1', 'tag2']
}
```

---

## Cognition Modules

### GEPAOptimizer (`capabilities/cognition/gepa-optimizer.js`)

**Type:** Genetic-Pareto prompt evolution system
**Dependencies:** Utils, EventBus, VFS, LLMClient
**Status:** Implemented (December 2025)

**API:**
- `evolve(seedPrompt, taskSet, options)` - Run evolution loop
- `evaluate(population, taskBatch)` - Score candidates on objectives
- `reflect(evaluationResults)` - Analyze failures, propose mutations
- `mutate(candidate, reflections)` - Apply reflection-guided changes
- `paretoSelect(candidates, objectives, targetSize)` - NSGA-II selection
- `promoteCandidate(candidate, options)` - Promote a candidate into safe storage

**Options:**
- `populationSize` - Number of candidates (default: 10)
- `maxGenerations` - Evolution iterations (default: 20)
- `objectives` - Score dimensions: `['accuracy', 'efficiency', 'robustness']`
- `evaluationModel` - Model for task evaluation
- `reflectionModel` - Model for failure analysis (recommend: Sonnet)
- `targetType` - Target type: `'prompt'` | `'persona_slot'`
- `targetMeta` - Extra targeting metadata (personaId, slot, etc)
- `promoteBest` - Promote best candidate to safe store
- `promoteOptions` - Promotion config (storagePath, arenaValidate, applyToPersona)

**Events:**
- `gepa:started` - Evolution begun
- `gepa:evaluated` - Generation scored
- `gepa:reflected` - Failure analysis complete
- `gepa:generation-complete` - Generation finished with frontier stats

**Checkpoints:** `/.memory/gepa/gen_X.json`

**See Also:** [Blueprint 0x000078](../blueprints/0x000078-gepa-prompt-evolution.md)

---

## Intelligence Modules

### FunctionGemmaOrchestrator (`core/functiongemma-orchestrator.js`)

**Type:** Multi-expert orchestration and topology evolution
**Dependencies:** Utils, EventBus?, SemanticMemory?, ArenaHarness?, ContextManager?, SchemaRegistry?, ReflectionStore?, VFS
**Status:** Implemented (March 2026)

**API:**
- `initBase(options)` - Initialize base model and pipeline
- `registerExperts(experts)` - Register LoRA experts and routing metadata
- `execute(task, options)` - Execute task with expert routing
- `runArenaEvolution(tasks, options)` - Evolve and persist topologies
- `runHeadToHead(genomeA, genomeB, tasks, options)` - Head to head evaluation
- `executeTemporalSelfRing(task, config)` - Temporal self-ring execution

---

### NeuralCompiler (`capabilities/intelligence/neural-compiler.js`)

**Type:** LoRA adapter router and task scheduler
**Dependencies:** Utils, VFS, LLMClient, SemanticMemory, IntentBundleGate?, EventBus?
**Status:** Implemented (December 2025)

**API:**
- `registerAdapter(name, manifestPath, options)` - Register adapter metadata for routing
- `unregisterAdapter(name)` - Remove adapter from registry
- `listAdapters()` - List registered adapters
- `getActiveAdapter()` - Current active adapter name
- `applyIntentBundle(bundleOrPath, options)` - Load adapter from intent bundle with gating
- `executeTask(task, options)` - Route a single task and execute with LoRA swap
- `scheduleTasks(tasks, options)` - Batch tasks by adapter and execute in swap-minimizing order

**Registry:** `/.memory/neural-compiler/adapters.json`

**See Also:** [Blueprint 0x000095](../blueprints/0x000095-hot-swappable-neural-compiler.md)

---

### IntentBundleLoRA (`capabilities/intelligence/intent-bundle-lora.js`)

**Type:** Intent bundle LoRA workflow
**Dependencies:** Utils, NeuralCompiler, EventBus?
**Status:** Implemented (March 2026)

**API:**
- `applyIntentBundle(bundleOrPath, options)` - Approve intent bundle and apply LoRA adapter

**Options:**
- `registerAdapter` - Register adapter in NeuralCompiler registry (default: true)
- `verifyAssets` - Verify LoRA shard paths in VFS (default: false)
- `routingText` - Override routing text for adapter registration
- `action` - HITL approval prompt label
- `timeout` - HITL approval timeout in ms

**Notes:**
- Delegates to NeuralCompiler for loading and adapter routing
- Returns `missing_assets` with `stub: true` when manifest or shards are missing
- Uses IntentBundleGate approvals when available
- TODO: Provide LoRA manifest and shard assets in VFS to resolve stub responses
- Default bundle path: `/.system/intent-bundle.json`

---

## Infrastructure Modules

### TraceStore (`infrastructure/trace-store.js`)

**Type:** Persistent execution traces
**Dependencies:** Utils, VFS, EventBus

**API:**
- `startSession(meta)` - Start a trace session
- `record(sessionId, type, payload, options?)` - Append a trace entry
- `endSession(sessionId, summary?)` - Close a session with summary
- `listSessions(limit?)` - Read recent session index entries
- `getSessionTraces(sessionId)` - Read a session's trace entries
- `getSessionSummary(sessionId)` - Summarize a session

**Storage:**
- `/.memory/traces/index.jsonl`
- `/.memory/traces/<sessionId>.jsonl`

---

### PerformanceMonitor (`infrastructure/performance-monitor.js`)

**Type:** Metrics collection and analysis
**Dependencies:** Utils, EventBus

**API:**
- `startTracking()` - Begin metrics collection
- `stopTracking()` - Stop collection
- `recordToolExecution(toolName, duration)` - Log tool call
- `recordLLMCall(model, tokens, duration)` - Log API call
- `recordStateTransition(from, to, duration)` - Log FSM transition
- `getMetrics()` - Get all metrics
- `getLLMStats()` - Get API call statistics
- `getMemoryStats()` - Get memory usage
- `resetMetrics()` - Clear all data
- `generateReport()` - Export markdown report

**Metrics Tracked:**
- Session uptime
- Tool execution counts and durations
- LLM API calls and token usage
- Memory usage samples
- State transition timing

---

### BrowserAPIs (`infrastructure/browser-apis.js`)

**Type:** Web API integration layer
**Dependencies:** Utils, EventBus, StateManager

**File System Access API:**
- `requestDirectoryAccess(mode)` - Get directory handle
- `readFile(path)` - Read from real filesystem
- `writeFile(path, content)` - Write to real filesystem
- `syncArtifactToFilesystem(artifactPath)` - VFS → Disk sync

**Notifications API:**
- `requestNotificationPermission()` - Request permission
- `showNotification(title, options)` - Display notification

**Storage API:**
- `getStorageEstimate()` - Get quota/usage stats
- `requestPersistentStorage()` - Prevent eviction

**Other APIs:**
- `copyToClipboard(text)` - Clipboard API
- `shareContent(title, text, url)` - Web Share API
- `requestWakeLock()` - Keep screen awake
- `releaseWakeLock()` - Release wake lock

**Capabilities:**
- `getCapabilities()` - Check which APIs are available
- `generateReport()` - Export markdown report

---

## UI Modules

### UI (`ui/ui-manager.js`)

**Type:** Proto orchestration
**Dependencies:** Utils, EventBus, StateManager, DiffGenerator, VFSExplorer, PerformanceMonitor, Introspector, ReflectionStore, BrowserAPIs

**API:**
- `init(config)` - Initialize proto
- `setupEventListeners()` - Attach button handlers
- `showOnlyPanel(panel)` - Panel visibility helper (DRY pattern)

**Panel Rendering:**
- `renderVfsExplorer()` - File tree display
- `renderPerformancePanel()` - Metrics proto
- `renderIntrospectionPanel()` - Self-analysis view
- `renderReflectionsPanel()` - Learning history
- `renderBrowserAPIsPanel()` - Browser capabilities

**Session Export:**
- `exportSessionReport()` - Generate markdown report
- `generateSessionReport()` - Build report content

---

### VFSExplorer (`ui/vfs-explorer.js`)

**Type:** File tree UI component
**Dependencies:** Utils, EventBus, StateManager

**API:**
- `init(containerId)` - Initialize in DOM element
- `refresh()` - Rebuild file tree
- `search(query)` - Filter files
- `selectFile(path)` - Programmatic selection

**Features:**
- Collapsible directory tree
- File search with highlighting
- Click to preview content
- Copy path to clipboard
- Folder/file icons
- Context menu (future)

---

### DiffGenerator (`ui/diff-generator.js`)

**Type:** Diff computation
**Dependencies:** Utils

**API:**
- `generateDiff(path, oldContent, newContent)` - Compute line-by-line diff
- `generateHtmlDiff(diff)` - Render as HTML
- `exportDiffAsMarkdown(diffs)` - Export all diffs

**Diff Format:**
```javascript
{
  path: '/file.js',
  oldContent: '...',
  newContent: '...',
  changes: [
    { type: 'added', line: 5, content: 'new code' },
    { type: 'removed', line: 10, content: 'old code' },
    { type: 'unchanged', line: 15, content: 'same code' }
  ]
}
```

---

## Agent Modules

### SentinelFSM (`core/sentinel-fsm.js`)

**Type:** Sentinel Agent finite state machine
**Dependencies:** Utils, EventBus, StateManager, Tools

**States:**
1. `IDLE` - Waiting for goal
2. `CURATING_CONTEXT` - Selecting files
3. `AWAITING_CONTEXT_APPROVAL` - Human approval needed
4. `PLANNING_WITH_CONTEXT` - LLM planning
5. `GENERATING_PROPOSAL` - Creating dogs.md
6. `AWAITING_PROPOSAL_APPROVAL` - Human approval needed
7. `APPLYING_CHANGES` - Writing files to VFS
8. `REFLECTING` - Learning from outcome
9. `DONE` - Task complete
10. `ERROR` - Unrecoverable error

**API:**
- `start(goal)` - Begin agent cycle
- `transitionTo(state)` - Manual state change
- `getCurrentState()` - Get current state
- `approveContext()` - User approves context bundle
- `reviseContext()` - User requests revision
- `approveProposal()` - User approves changes
- `rejectProposal()` - User rejects changes
- `reset()` - Return to IDLE

**Event Emissions:**
- `agent:state:change` - On every transition
- `agent:goal:set` - When goal is set
- `agent:cycle:complete` - When DONE reached
- `agent:error` - On ERROR state

---

## Tool System

### ToolRunner (`core/tool-runner.js`)

**Type:** Tool execution engine
**Dependencies:** Utils, EventBus, StateManager

**API:**
- `executeTool(toolName, args)` - Execute tool by name
- `getAvailableTools()` - List all tools
- `registerTool(definition)` - Add dynamic tool
- `unregisterTool(toolName)` - Remove tool

**Built-in Tools (CamelCase naming):**
- `ReadFile` - Read VFS file
- `WriteFile` - Write VFS file
- `ListFiles` - List VFS files
- `DeleteFile` - Delete VFS file
- `Grep` - Search file contents
- `Find` - Find files by name
- `EditFile` - Find/replace in file

**RSI Tools:**
- `CreateTool` - Meta-tool for tool creation
- `LoadModule` - Dynamic module loading
- `ListTools` - List available tools

**Worker Tools:**
- `SpawnWorker` - Spawn sub-agent worker
- `ListWorkers` - List active workers
- `AwaitWorkers` - Wait for worker completion

**Cognition Tools:**
- `RunGEPA` - Execute GEPA prompt evolution
  - Supports `targetType: "persona_slot"` with `personaSlot` and `personaId`
  - Supports promotion via `promote: true` and `promoteOptions`

---

## Integration Examples

### Example 1: Using Utils for Logging

```javascript
const { logger } = await DIContainer.resolve('Utils');

logger.info('Operation started', { operation: 'saveArtifact', path: '/test.txt' });

try {
  // do work
  logger.debug('Progress update', { progress: 50 });
} catch (error) {
  logger.error('Operation failed', { error: error.message, stack: error.stack });
}
```

### Example 2: EventBus with Auto-Cleanup

```javascript
const EventBus = await DIContainer.resolve('EventBus');

// Subscribe with module ID for auto-cleanup
const unsubscribe = EventBus.on('artifact:saved', (data) => {
  console.log('File saved:', data.path);
}, 'MyModule');

// Later, cleanup all subscriptions for module
EventBus.unsubscribeAll('MyModule');
```

### Example 3: VFS Operations

```javascript
const StateManager = await DIContainer.resolve('StateManager');

// Save file
await StateManager.saveArtifact('/docs/README.md', '# Hello World', {
  author: 'Agent',
  created: Date.now()
});

// Read file
const content = await StateManager.getArtifactContent('/docs/README.md');
console.log(content); // "# Hello World"

// List all files
const allFiles = await StateManager.getAllArtifactMetadata();
console.log(Object.keys(allFiles)); // ['/docs/README.md', ...]
```


### Example 5: Performance Monitoring

```javascript
const PerformanceMonitor = await DIContainer.resolve('PerformanceMonitor');

// Record tool execution
PerformanceMonitor.recordToolExecution('ReadFile', 45); // 45ms

// Record LLM call
PerformanceMonitor.recordLLMCall('gemini-1.5-flash', 1500, 2300); // 1500 tokens, 2.3s

// Get metrics
const metrics = PerformanceMonitor.getMetrics();
console.log('Uptime:', metrics.session.uptime, 'ms');
console.log('Tool calls:', metrics.tools.totalCalls);

// Export report
const report = PerformanceMonitor.generateReport();
exportAsMarkdown('performance.md', report);
```

---

## Further Reading

- **Architecture Blueprints:** `blueprints/` directory - Design specifications
- **Module Source Code:** `core/` and `infrastructure/` - Fully documented with JSDoc
- **Quick Start Guide:** `docs/quick-start.md` - Interactive tutorial
- **Testing:** `docs/testing.md` - Common failure modes and how to validate changes
- **Security Model:** `docs/security.md` - Containment and safety architecture

---

## Versioning

REPLOID follows semantic versioning:
- **Major:** Breaking API changes
- **Minor:** New features, backward compatible
- **Patch:** Bug fixes, documentation updates

---

*For detailed API documentation, see JSDoc comments in source files.*

*Last updated: January 2026*
