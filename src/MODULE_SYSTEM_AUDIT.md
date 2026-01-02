# Reploid Module System Audit Report

## Summary

| Metric | Count |
|--------|-------|
| Total JavaScript Files | 146 |
| Files with metadata.id | 79 |
| Files in Genesis Levels | 65 |
| Files in moduleFiles | 107 |
| Files with Blueprints | 65 |
| Files Hydrated to VFS | 107 |

---

## Complete File Inventory

| File Path | Type | Has metadata.id | Module ID | Genesis Level | In moduleFiles | Has Blueprint | VFS Hydrated |
|-----------|------|-----------------|-----------|---------------|----------------|---------------|--------------|
| core/agent-loop.js | core | YES | AgentLoop | tabula | YES | 0x000008 | YES |
| core/async-utils.js | utility | NO | - | NO | NO | NO | NO |
| core/context-manager.js | core | YES | ContextManager | tabula | YES | 0x00003A | YES |
| core/llm-client.js | core | YES | LLMClient | tabula | YES | 0x000007 | YES |
| core/memory-manager.js | core | YES | MemoryManager | full | YES | 0x000068 | YES |
| core/persona-manager.js | core | YES | PersonaManager | tabula | YES | 0x000043 | YES |
| core/response-parser.js | core | YES | ResponseParser | tabula | YES | 0x00006A | YES |
| core/schema-registry.js | core | YES | SchemaRegistry | tabula | YES | 0x00006B | YES |
| core/schema-validator.js | core | YES | SchemaValidator | full | YES | NO | YES |
| core/state-helpers-pure.js | core | YES | StateHelpersPure | tabula | YES | 0x000006 | YES |
| core/state-manager.js | core | YES | StateManager | tabula | YES | 0x000005 | YES |
| core/tool-runner.js | core | YES | ToolRunner | tabula | YES | 0x00000A | YES |
| core/tool-writer.js | core | YES | ToolWriter | tabula | YES | 0x000015 | YES |
| core/transformers-client.js | core | YES | TransformersClient | full | YES | 0x00005D | YES |
| core/utils.js | core | YES | Utils | tabula | YES | 0x000003 | YES |
| core/verification-manager.js | core | YES | VerificationManager | reflection | YES | 0x000040 | YES |
| core/verification-worker.js | worker | NO | - | NO | NO | 0x00002A | NO |
| core/vfs-module-loader.js | core | YES | SubstrateLoader | full | YES | 0x000071 | YES |
| core/vfs.js | core | YES | VFS | tabula | YES | 0x000011 | YES |
| core/worker-agent.js | core | YES | WorkerManager | full | YES | NO | YES |
| core/worker-manager.js | core | YES | WorkerManager | full | YES | 0x000047 | YES |
| infrastructure/audit-logger.js | infra | YES | AuditLogger | full | YES | 0x00002B | YES |
| infrastructure/browser-apis.js | infra | YES | BrowserAPIs | full | YES | 0x000037 | YES |
| infrastructure/circuit-breaker.js | infra | YES | CircuitBreaker | tabula | YES | 0x00005C | YES |
| infrastructure/di-container.js | infra | YES | DIContainer | tabula | YES | 0x000042 | YES |
| infrastructure/error-store.js | infra | YES | ErrorStore | tabula | YES | 0x00006C | YES |
| infrastructure/event-bus.js | infra | YES | EventBus | tabula | YES | 0x00004F | YES |
| infrastructure/genesis-snapshot.js | infra | YES | GenesisSnapshot | full | YES | 0x00003C | YES |
| infrastructure/hitl-controller.js | infra | YES | HITLController | reflection | YES | 0x000049 | YES |
| infrastructure/observability.js | infra | YES | Observability | full | YES | 0x00006D | YES |
| infrastructure/policy-engine.js | infra | YES | PolicyEngine | full | YES | NO | YES |
| infrastructure/rate-limiter.js | infra | YES | RateLimiter | reflection | YES | 0x000029 | YES |
| infrastructure/replay-engine.js | infra | YES | ReplayEngine | full | YES | 0x00006E | YES |
| infrastructure/stream-parser.js | infra | YES | StreamParser | reflection | YES | 0x000039 | YES |
| infrastructure/telemetry-timeline.js | infra | YES | TelemetryTimeline | tabula | YES | 0x00006F | YES |
| infrastructure/tool-executor.js | infra | YES | ToolExecutor | tabula | YES | 0x000070 | YES |
| infrastructure/trace-store.js | infra | YES | TraceStore | full | YES | NO | YES |
| capabilities/cognition/cognition-api.js | capability | YES | CognitionAPI | full | YES | 0x000063 | YES |
| capabilities/cognition/episodic-memory.js | capability | NO | - | NO | NO | NO | NO |
| capabilities/cognition/gepa-optimizer.js | capability | YES | GEPAOptimizer | full | YES | 0x000067 | YES |
| capabilities/cognition/hybrid-retrieval.js | capability | NO | - | NO | NO | NO | NO |
| capabilities/cognition/index.js | barrel | NO | - | NO | NO | NO | NO |
| capabilities/cognition/knowledge-tree.js | capability | YES | KnowledgeTree | full | YES | 0x000068 | YES |
| capabilities/cognition/prompt-memory.js | capability | YES | PromptMemory | full | YES | NO | YES |
| capabilities/cognition/semantic/embedding-store.js | capability | YES | EmbeddingStore | full | YES | 0x00005E | YES |
| capabilities/cognition/semantic/semantic-memory.js | capability | YES | SemanticMemory | full | YES | 0x00005F | YES |
| capabilities/cognition/symbolic/knowledge-graph.js | capability | YES | KnowledgeGraph | full | YES | 0x000060 | YES |
| capabilities/cognition/symbolic/rule-engine.js | capability | YES | RuleEngine | full | YES | 0x000061 | YES |
| capabilities/cognition/symbolic/symbol-grounder.js | capability | YES | SymbolGrounder | full | YES | 0x000062 | YES |
| capabilities/communication/consensus.js | capability | YES | Consensus | full | YES | NO | YES |
| capabilities/communication/swarm-sync.js | capability | YES | SwarmSync | full | YES | NO | YES |
| capabilities/communication/swarm-transport.js | capability | YES | SwarmTransport | full | YES | NO | YES |
| capabilities/communication/webrtc-swarm.js | capability | YES | WebRTCSwarm | full | YES | 0x000038 | YES |
| capabilities/intelligence/federated-learning.js | capability | YES | FederatedLearning | full | YES | NO | YES |
| capabilities/intelligence/functiongemma-orchestrator.js | capability | YES | FunctionGemmaOrchestrator | full | YES | NO | YES |
| capabilities/intelligence/multi-model-coordinator.js | capability | BUG | MultiModelCoordinator | full | YES | NO | YES |
| capabilities/intelligence/neural-compiler.js | capability | YES | NeuralCompiler | full | YES | 0x00007E | YES |
| capabilities/performance/performance-monitor.js | capability | YES | PerformanceMonitor | full | YES | 0x000023 | YES |
| capabilities/reflection/prompt-score-map.js | capability | NO | - | NO | NO | NO | NO |
| capabilities/reflection/reflection-analyzer.js | capability | YES | ReflectionAnalyzer | reflection | YES | 0x000032 | YES |
| capabilities/reflection/reflection-store.js | capability | YES | ReflectionStore | reflection | YES | 0x000032 | YES |
| capabilities/system/substrate-loader.js | capability | YES | SubstrateLoader | full | YES | 0x000071 | YES |
| testing/arena/arena-harness.js | testing | YES | ArenaHarness | full | YES | 0x000066 | YES |
| testing/arena/arena-metrics.js | testing | YES | ArenaMetrics | full | YES | 0x000065 | YES |
| testing/arena/competitor.js | testing | YES | ArenaCompetitor | full | YES | 0x000064 | YES |
| testing/arena/doppler-integration.js | testing | NO | - | NO | NO | NO | NO |
| testing/arena/index.js | barrel | NO | - | NO | NO | NO | NO |
| testing/arena/vfs-sandbox.js | testing | YES | VFSSandbox | full | YES | 0x000040 | YES |
| tools/AwaitWorkers.js | tool | NO | - | full | YES | NO | YES |
| tools/Cp.js | tool | NO | - | full | YES | NO | YES |
| tools/CreateTool.js | tool | NO | - | full | YES | 0x000015 | YES |
| tools/DeleteFile.js | tool | NO | - | full | YES | NO | YES |
| tools/Edit.js | tool | NO | - | full | YES | NO | YES |
| tools/FileOutline.js | tool | NO | - | full | YES | NO | YES |
| tools/Find.js | tool | NO | - | full | YES | NO | YES |
| tools/Git.js | tool | NO | - | full | YES | NO | YES |
| tools/Grep.js | tool | NO | - | full | YES | NO | YES |
| tools/Head.js | tool | NO | - | full | YES | NO | YES |
| tools/ListFiles.js | tool | NO | - | full | YES | NO | YES |
| tools/ListKnowledge.js | tool | NO | - | full | YES | NO | YES |
| tools/ListMemories.js | tool | NO | - | full | YES | NO | YES |
| tools/ListTools.js | tool | NO | - | full | YES | NO | YES |
| tools/ListWorkers.js | tool | NO | - | full | YES | NO | YES |
| tools/LoadModule.js | tool | NO | - | full | YES | NO | YES |
| tools/Ls.js | tool | NO | - | full | YES | NO | YES |
| tools/Mkdir.js | tool | NO | - | full | YES | NO | YES |
| tools/Mv.js | tool | NO | - | full | YES | NO | YES |
| tools/ReadFile.js | tool | NO | - | full | YES | NO | YES |
| tools/Rm.js | tool | NO | - | full | YES | NO | YES |
| tools/RunGEPA.js | tool | NO | - | full | YES | NO | YES |
| tools/SpawnWorker.js | tool | NO | - | full | YES | NO | YES |
| tools/SwarmGetStatus.js | tool | NO | - | full | YES | NO | YES |
| tools/SwarmListPeers.js | tool | NO | - | full | YES | NO | YES |
| tools/SwarmRequestFile.js | tool | NO | - | full | YES | NO | YES |
| tools/SwarmShareFile.js | tool | NO | - | full | YES | NO | YES |
| tools/Tail.js | tool | NO | - | full | YES | NO | YES |
| tools/WriteFile.js | tool | NO | - | full | YES | NO | YES |
| tools/python/pyodide-runtime.js | tool | NO | - | NO | NO | 0x00002D | NO |
| tools/python/pyodide-worker.js | tool | NO | - | NO | NO | NO | NO |
| tools/python/python-tool.js | tool | NO | - | NO | NO | 0x00002E | NO |
| boot/config.js | boot | NO | - | NO | NO | NO | NO |
| boot/error-ui.js | boot | NO | - | NO | NO | NO | NO |
| boot/iframe-bridge.js | boot | NO | - | NO | NO | 0x000072 | NO |
| boot/index.js | boot | NO | - | NO | NO | NO | NO |
| boot/modules.js | boot | NO | - | NO | NO | NO | NO |
| boot/services.js | boot | NO | - | NO | NO | NO | NO |
| boot/vfs-hydrate.js | boot | NO | - | NO | NO | NO | NO |
| ui/boot/detection.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/goals.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/index.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/state.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/steps/awaken.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/steps/browser.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/steps/choose.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/steps/detect.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/steps/direct.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/steps/goal.js | ui | NO | - | NO | NO | NO | NO |
| ui/boot/steps/proxy.js | ui | NO | - | NO | NO | NO | NO |
| ui/components/arena-results.js | ui | NO | - | NO | YES | NO | YES |
| ui/components/confirmation-modal.js | ui | NO | - | NO | NO | NO | NO |
| ui/components/diff-viewer-ui.js | ui | NO | - | NO | NO | 0x00007D | NO |
| ui/components/hitl-widget.js | ui | NO | - | NO | NO | 0x000044 | NO |
| ui/components/inline-chat.js | ui | NO | - | NO | YES | 0x000075 | YES |
| ui/components/toast-notifications.js | ui | NO | - | NO | NO | 0x00007C | NO |
| ui/dashboard/metrics-dashboard.js | ui | NO | - | NO | NO | 0x000024 | NO |
| ui/dashboard/ui-manager.js | ui | NO | - | NO | NO | 0x00000D | NO |
| ui/dashboard/vfs-explorer.js | ui | NO | - | NO | NO | 0x000020 | NO |
| ui/panels/chat-panel.js | ui | NO | - | NO | NO | 0x00008C | NO |
| ui/panels/code-panel.js | ui | NO | - | NO | NO | 0x00008D | NO |
| ui/panels/cognition-panel.js | ui | NO | - | NO | NO | 0x00007A | NO |
| ui/panels/llm-config-panel.js | ui | NO | - | NO | NO | 0x00008E | NO |
| ui/panels/metrics-panel.js | ui | NO | - | NO | NO | NO | NO |
| ui/panels/python-repl-panel.js | ui | NO | - | NO | NO | 0x00008F | NO |
| ui/panels/vfs-panel.js | ui | NO | - | NO | NO | 0x00007B | NO |
| ui/proto.js | ui | NO | - | NO | NO | 0x00004C | NO |
| ui/proto/index.js | ui | NO | - | NO | NO | NO | NO |
| ui/proto/replay.js | ui | NO | - | NO | NO | 0x00006E | NO |
| ui/proto/schemas.js | ui | NO | - | NO | NO | NO | NO |
| ui/proto/telemetry.js | ui | NO | - | NO | NO | NO | NO |
| ui/proto/template.js | ui | NO | - | NO | NO | NO | NO |
| ui/proto/utils.js | ui | NO | - | NO | NO | NO | NO |
| ui/proto/vfs.js | ui | NO | - | NO | NO | NO | NO |
| ui/proto/workers.js | ui | NO | - | NO | NO | NO | NO |
| ui/toast.js | ui | NO | - | NO | NO | NO | NO |
| boot.js | entry | NO | - | NO | NO | NO | NO |
| sw-module-loader.js | utility | NO | - | NO | NO | NO | NO |

---

## Issues Found

### 1. Bug: multi-model-coordinator.js missing metadata.id
File has metadata object but `id` field is missing.

### 2. Orphan Files (have metadata.id but NOT in genesis)
- capabilities/cognition/episodic-memory.js
- capabilities/cognition/hybrid-retrieval.js
- capabilities/reflection/prompt-score-map.js
- testing/arena/doppler-integration.js

### 3. Dead Barrel Files (not imported anywhere)
- capabilities/cognition/index.js
- testing/arena/index.js

### 4. Utilities without metadata.id (intentional)
- core/async-utils.js - used by tools
- core/verification-worker.js - web worker
