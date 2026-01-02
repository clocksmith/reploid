# Reploid Module Index

*Generated in JavaScript mode (limited analysis)*

## runs

| Module | Exports |
|--------|---------|
| `runs/showcase/inception-awaken-child.js` | async, tool |

## scripts

| Module | Exports |
|--------|---------|
| `scripts/build-genesis-manifest.js` | - |

## server

| Module | Exports |
|--------|---------|
| `server/agent-bridge.js` | AgentBridge |
| `server/proxy.js` | - |
| `server/signaling-server.js` | SignalingServer |

## src

| Module | Exports |
|--------|---------|
| `src/boot.js` | - |
| `src/boot/config.js` | buildCoreToolSet, getGenesisLevel, getLevelConfig, loadGenesisConfig, resolveModules |
| `src/boot/error-ui.js` | renderErrorUI |
| `src/boot/iframe-bridge.js` | getPendingGoal, initIframeBridge, isIframeChild, setSystemReadyCallback |
| `src/boot/index.js` | boot, error, s |
| `src/boot/modules.js` | loadExternalDependencies, registerModules |
| `src/boot/services.js` | createGenesisSnapshot, initializeSwarm, resolveServices, s, setupExportFunctions |
| `src/boot/vfs-hydrate.js` | hydrateVFS, resetSession, seedCodeIntel |
| `src/capabilities/cognition/cognition-api.js` | CognitionAPI |
| `src/capabilities/cognition/episodic-memory.js` | EpisodicMemory |
| `src/capabilities/cognition/gepa-optimizer.js` | GEPAOptimizer |
| `src/capabilities/cognition/hybrid-retrieval.js` | HybridRetrieval |
| `src/capabilities/cognition/index.js` | - |
| `src/capabilities/cognition/knowledge-tree.js` | KnowledgeTree |
| `src/capabilities/cognition/prompt-memory.js` | PromptMemory |
| `src/capabilities/cognition/semantic/embedding-store.js` | EmbeddingStore |
| `src/capabilities/cognition/semantic/semantic-memory.js` | SemanticMemory |
| `src/capabilities/cognition/symbolic/knowledge-graph.js` | KnowledgeGraph |
| `src/capabilities/cognition/symbolic/rule-engine.js` | RuleEngine |
| `src/capabilities/cognition/symbolic/symbol-grounder.js` | SymbolGrounder |
| `src/capabilities/communication/consensus.js` | Consensus |
| `src/capabilities/communication/swarm-sync.js` | SwarmSync |
| `src/capabilities/communication/swarm-transport.js` | SwarmTransport |
| `src/capabilities/communication/webrtc-swarm.js` | WebRTCSwarm |
| `src/capabilities/intelligence/federated-learning.js` | FederatedLearning |
| `src/capabilities/intelligence/functiongemma-orchestrator.js` | FunctionGemmaOrchestrator |
| `src/capabilities/intelligence/multi-model-coordinator.js` | MultiModelCoordinator |
| `src/capabilities/intelligence/neural-compiler.js` | NeuralCompiler |
| `src/capabilities/performance/performance-monitor.js` | PerformanceMonitor |
| `src/capabilities/reflection/prompt-score-map.js` | PromptScoreMap |
| `src/capabilities/reflection/reflection-analyzer.js` | ReflectionAnalyzer |
| `src/capabilities/reflection/reflection-store.js` | ReflectionStore |
| `src/capabilities/system/substrate-loader.js` | SubstrateLoader |
| `src/core/agent-loop.js` | AgentLoop, async, tool |
| `src/core/async-utils.js` | RetryExhaustedError, TimeoutError, createDeferred, default, executeWithTimeouts, isTransientError, raceWithTimeout, sleep, withRetry, withTimeout, withTimeoutAndRetry |
| `src/core/context-manager.js` | ContextManager |
| `src/core/llm-client.js` | LLMClient |
| `src/core/memory-manager.js` | MemoryManager |
| `src/core/persona-manager.js` | PersonaManager, async |
| `src/core/response-parser.js` | ResponseParser |
| `src/core/schema-registry.js` | SchemaRegistry, default |
| `src/core/schema-validator.js` | SchemaValidator |
| `src/core/state-helpers-pure.js` | StateHelpersPure |
| `src/core/state-manager.js` | StateManager |
| `src/core/tool-runner.js` | ToolRunner |
| `src/core/tool-writer.js` | ToolWriter, default, or, tool |
| `src/core/transformers-client.js` | TransformersClient |
| `src/core/utils.js` | Utils |
| `src/core/verification-manager.js` | VerificationManager |
| `src/core/verification-worker.js` | default, or, tool |
| `src/core/vfs-module-loader.js` | clearVfsModuleCache, getVfsModuleStats, isModuleCached, loadVfsModule, preloadModules, resetVfsModuleStats |
| `src/core/vfs.js` | VFS |
| `src/core/worker-agent.js` | - |
| `src/core/worker-manager.js` | WorkerManager |
| `src/infrastructure/audit-logger.js` | AuditLogger |
| `src/infrastructure/browser-apis.js` | BrowserAPIs |
| `src/infrastructure/circuit-breaker.js` | CircuitBreaker |
| `src/infrastructure/di-container.js` | DIContainer |
| `src/infrastructure/error-store.js` | ErrorStore |
| `src/infrastructure/event-bus.js` | EventBus |
| `src/infrastructure/genesis-snapshot.js` | GenesisSnapshot |
| `src/infrastructure/hitl-controller.js` | HITLController |
| `src/infrastructure/observability.js` | Observability |
| `src/infrastructure/policy-engine.js` | PolicyEngine |
| `src/infrastructure/rate-limiter.js` | RateLimiter |
| `src/infrastructure/replay-engine.js` | ReplayEngine |
| `src/infrastructure/stream-parser.js` | StreamParser |
| `src/infrastructure/telemetry-timeline.js` | TelemetryTimeline |
| `src/infrastructure/tool-executor.js` | ToolExecutor |
| `src/infrastructure/trace-store.js` | TraceStore |
| `src/sw-module-loader.js` | - |
| `src/testing/arena/arena-harness.js` | ArenaHarness |
| `src/testing/arena/arena-metrics.js` | ArenaMetrics |
| `src/testing/arena/competitor.js` | ArenaCompetitor |
| `src/testing/arena/doppler-integration.js` | DopplerArenaIntegration |
| `src/testing/arena/index.js` | - |
| `src/testing/arena/vfs-sandbox.js` | VFSSandbox |
| `src/tools/AwaitWorkers.js` | call, tool |
| `src/tools/Cp.js` | call, tool |
| `src/tools/CreateTool.js` | async, call, tool |
| `src/tools/DeleteFile.js` | call, tool |
| `src/tools/Edit.js` | call, tool |
| `src/tools/FileOutline.js` | call, styles, tool |
| `src/tools/Find.js` | call, tool |
| `src/tools/git.js` | call, tool |
| `src/tools/Grep.js` | call, tool |
| `src/tools/Head.js` | call, tool |
| `src/tools/ListFiles.js` | call, tool |
| `src/tools/ListKnowledge.js` | call, tool |
| `src/tools/ListMemories.js` | call, tool |
| `src/tools/ListTools.js` | call, tool |
| `src/tools/ListWorkers.js` | call, tool |
| `src/tools/LoadModule.js` | call, tool |
| `src/tools/Ls.js` | call, tool |
| `src/tools/Mkdir.js` | call, tool |
| `src/tools/Mv.js` | call, tool |
| `src/tools/python/pyodide-runtime.js` | PyodideRuntime |
| `src/tools/python/pyodide-worker.js` | - |
| `src/tools/python/python-tool.js` | PythonTool |
| `src/tools/ReadFile.js` | call, tool |
| `src/tools/Rm.js` | call, tool |
| `src/tools/RunGEPA.js` | call, tool |
| `src/tools/SpawnWorker.js` | call, tool |
| `src/tools/SwarmGetStatus.js` | call, tool |
| `src/tools/SwarmListPeers.js` | call, tool |
| `src/tools/SwarmRequestFile.js` | call, tool |
| `src/tools/SwarmShareFile.js` | call, tool |
| `src/tools/Tail.js` | call, tool |
| `src/tools/WriteFile.js` | call, tool |
| `src/ui/boot/detection.js` | checkDoppler, checkHttps, checkWebGPU, estimateGPUMemory, probeOllama, probeProxy, runDetection, testApiKey, testLocalConnection, testProxyConnection |
| `src/ui/boot/goals.js` | GOAL_CATEGORIES, filterGoalsByCapability, getRecommendedGoals, getUnlockedGoals |
| `src/ui/boot/index.js` | initWizard |
| `src/ui/boot/state.js` | PROVIDER_TEST_ENDPOINTS, STEPS, VERIFY_STATE, canAwaken, checkSavedConfig, forgetDevice, getCapabilityLevel, getPrimaryVerifyState, getState, goToStep, hydrateSavedConfig, resetWizard, saveConfig, setNestedState, setState, subscribe |
| `src/ui/boot/steps/awaken.js` | renderAwakenStep |
| `src/ui/boot/steps/browser.js` | renderBrowserConfigStep |
| `src/ui/boot/steps/choose.js` | renderChooseStep |
| `src/ui/boot/steps/detect.js` | renderDetectStep, renderStartStep |
| `src/ui/boot/steps/direct.js` | CLOUD_MODELS, renderDirectConfigStep |
| `src/ui/boot/steps/goal.js` | renderGoalStep |
| `src/ui/boot/steps/proxy.js` | renderProxyConfigStep |
| `src/ui/components/arena-results.js` | ArenaResults |
| `src/ui/components/confirmation-modal.js` | ConfirmationModal |
| `src/ui/components/diff-viewer-ui.js` | DiffViewerUI |
| `src/ui/components/hitl-widget.js` | HITLWidget |
| `src/ui/components/inline-chat.js` | InlineChat |
| `src/ui/components/toast-notifications.js` | ToastNotifications |
| `src/ui/dashboard/metrics-dashboard.js` | - |
| `src/ui/dashboard/ui-manager.js` | UIManager |
| `src/ui/dashboard/vfs-explorer.js` | VFSExplorer |
| `src/ui/panels/chat-panel.js` | ChatPanel |
| `src/ui/panels/code-panel.js` | CodePanel |
| `src/ui/panels/cognition-panel.js` | CognitionPanel |
| `src/ui/panels/llm-config-panel.js` | LLMConfigPanel |
| `src/ui/panels/metrics-panel.js` | MetricsPanel |
| `src/ui/panels/python-repl-panel.js` | PythonReplPanel |
| `src/ui/panels/vfs-panel.js` | VFSPanel |
| `src/ui/proto.js` | from |
| `src/ui/proto/index.js` | Proto, failed |
| `src/ui/proto/replay.js` | createReplayManager |
| `src/ui/proto/schemas.js` | createSchemaManager |
| `src/ui/proto/telemetry.js` | createTelemetryManager |
| `src/ui/proto/template.js` | renderProtoTemplate |
| `src/ui/proto/utils.js` | formatDuration, formatPayloadSummary, formatSince, formatTimestamp, summarizeText |
| `src/ui/proto/vfs.js` | createVFSManager |
| `src/ui/proto/workers.js` | createWorkerManager |
| `src/ui/toast.js` | Toast |

## tests

| Module | Exports |
|--------|---------|
| `tests/benchmarks/memory-benchmark.js` | MemoryBenchmark |
| `tests/e2e/debug-console.js` | - |
| `tests/e2e/rsi-mock-provider.js` | MockLLMProvider, ReadFile, handler, injectMockProvider |

