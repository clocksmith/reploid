# REPLOID Blueprint Atlas

**[Back to Harness README](../README.md)**

---

> **Note:** This atlas organizes the 102 architectural blueprints of the REPLOID system into 7 functional domains. Each blueprint describes a specific capability, module, or pattern essential to the agent's operation and recursive self-improvement.

## 1. Core Infrastructure (The Kernel)
*Bootstrapping, dependency injection, configuration, and system utilities.*

| ID | Title | Description |
| :--- | :--- | :--- |
| `0x000001` | [System Prompt Architecture](0x000001-system-prompt-architecture.md) | Template-based identity construction. |
| `0x000002` | [Application Orchestration](0x000002-application-orchestration.md) | Boot sequence and module loading. |
| `0x000003` | [Core Utilities & Error Handling](0x000003-core-utilities-and-error-handling.md) | Shared helpers and error taxonomy. |
| `0x000013` | [System Configuration](0x000013-system-configuration-structure.md) | JSON schema for runtime config. |
| `0x00001F` | [Universal Module Loader](0x00001F-universal-module-loader.md) | Lifecycle governance for upgrades. |
| `0x000020` | [Module Manifest Governance](0x000020-module-manifest-governance.md) | Dependency definitions and load order. |
| `0x000026` | [Performance Monitoring Stack](0x000026-performance-monitoring-stack.md) | Telemetry collection and metrics. |
| `0x000049` | [Dependency Injection Container](0x000049-dependency-injection-container.md) | Service resolution and singletons. |
| `0x00004A` | [Config Management](0x00004A-config-management.md) | Logic for loading/saving config. |
| `0x00005D` | [System Tools Manifest](0x00005D-system-tools-manifest.md) | Core system operation definitions. |

## 2. State & Memory (The Hippocampus)
*Data persistence, virtual file system (VFS), and context management.*

| ID | Title | Description |
| :--- | :--- | :--- |
| `0x000004` | [Default Storage (localStorage)](0x000004-default-storage-backend-localstorage.md) | Basic persistence layer. |
| `0x000005` | [State Management Architecture](0x000005-state-management-architecture.md) | Transactional state updates. |
| `0x000006` | [Pure State Helpers](0x000006-pure-state-helpers.md) | Deterministic state logic. |
| `0x000011` | [Advanced Storage (IndexedDB)](0x000011-advanced-storage-backend-indexeddb.md) | High-capacity async storage. |
| `0x000014` | [Working Memory Scratchpad](0x000014-working-memory-scratchpad.md) | Transient thought storage. |
| `0x000023` | [VFS Explorer Interaction](0x000023-vfs-explorer-interaction.md) | File system browsing logic. |
| `0x000035` | [Reflection Store Architecture](0x000035-reflection-store-architecture.md) | Long-term episodic memory. |
| `0x000040` | [Context Management](0x000040-context-management.md) | Token window optimization. |
| `0x000043` | [Genesis Snapshot System](0x000043-genesis-snapshot-system.md) | Boot state preservation. |
| `0x000053` | [Git VFS Version Control](0x000053-git-vfs-version-control.md) | Git-backed file system. |
| `0x00005C` | [VFS Tools Manifest](0x00005C-vfs-tools-manifest.md) | File operation definitions. |
| `0x000062` | [Internal Patch Format](0x000062-internal-patch-format.md) | JSON-based delta format. |

## 3. Agent Cognition (The Frontal Cortex)
*Reasoning, planning, decision-making, and LLM interaction.*

| ID | Title | Description |
| :--- | :--- | :--- |
| `0x000007` | [API Client & Communication](0x000007-api-client-and-communication.md) | LLM transport layer. |
| `0x000008` | [Agent Cognitive Cycle](0x000008-agent-cognitive-cycle.md) | The primary think-act loop. |
| `0x000009` | [Pure Agent Logic Helpers](0x000009-pure-agent-logic-helpers.md) | Deterministic reasoning logic. |
| `0x000017` | [Goal Modification Safety](0x000017-goal-modification-safety.md) | Rules for changing objectives. |
| `0x000021` | [Multi-Provider API Gateway](0x000021-multi-provider-api-gateway.md) | Routing between AI providers. |
| `0x000022` | [Confirmation Modal Safety](0x000022-confirmation-modal-safety.md) | Human-in-the-loop interlocks. |
| `0x000033` | [Hybrid LLM Orchestration](0x000033-hybrid-llm-orchestration.md) | Mixing local and cloud AI. |
| `0x000039` | [API Cost Tracker](0x000039-api-cost-tracker.md) | Token usage and budget governance. |
| `0x00003F` | [Streaming Response Handler](0x00003F-streaming-response-handler.md) | Real-time token streaming. |
| `0x000041` | [Structured Agent Cycle](0x000041-structured-agent-cycle.md) | Advanced reasoning loop. |
| `0x000051` | [HITL Controller](0x000051-hitl-controller.md) | Autonomy level management. |
| `0x000059` | [Sentinel FSM](0x000059-sentinel-fsm.md) | Finite State Machine for safety. |
| `0x000063` | [Browser Native Paxos](0x000063-browser-native-paxos.md) | Consensus algorithms. |
| `0x000064` | [Recursive Prompt Engineering](0x000064-recursive-prompt-engineering.md) | Self-improving prompts. |
| `0x000065` | [Meta-Cognitive Evaluator](0x000065-meta-cognitive-evaluator.md) | Assessing own thought quality. |
| `0x000066` | [Recursive Goal Decomposition](0x000066-recursive-goal-decomposition.md) | Breaking down complex tasks. |

## 4. Tooling & Runtime (The Hands)
*Execution engines, Python/Pyodide environments, and tool capabilities.*

| ID | Title | Description |
| :--- | :--- | :--- |
| `0x00000A` | [Tool Runner Engine](0x00000A-tool-runner-engine.md) | Execution environment for tools. |
| `0x00000B` | [Pure Tool Logic Helpers](0x00000B-pure-tool-logic-helpers.md) | Tool schema mapping. |
| `0x00000C` | [Sandboxed Tool Worker](0x00000C-sandboxed-tool-worker.md) | Isolated execution thread. |
| `0x000010` | [Static Tool Manifest](0x000010-static-tool-manifest.md) | Built-in tool definitions. |
| `0x000015` | [Dynamic Tool Creation](0x000015-dynamic-tool-creation.md) | Runtime tool generation. |
| `0x000016` | [Meta-Tool Creation Patterns](0x000016-meta-tool-creation-patterns.md) | Patterns for tool building. |
| `0x00001C` | [Write Tools Manifest](0x00001C-write-tools-manifest.md) | File modification capabilities. |
| `0x000030` | [Pyodide Runtime Orchestration](0x000030-pyodide-runtime-orchestration.md) | Python environment manager. |
| `0x000031` | [Python Tool Interface](0x000031-python-tool-interface.md) | Python execution tools. |
| `0x000032` | [Local LLM Runtime](0x000032-local-llm-runtime.md) | WebGPU model execution. |
| `0x000034` | [Swarm Orchestration](0x000034-swarm-orchestration.md) | Multi-agent coordination. |
| `0x00003E` | [WebRTC Swarm Transport](0x00003E-webrtc-swarm-transport.md) | P2P agent communication. |
| `0x000047` | [Verification Manager](0x000047-verification-manager.md) | Test execution orchestrator. |
| `0x00004D` | [Sentinel Tools Library](0x00004D-sentinel-tools-library.md) | Safety-critical toolset. |
| `0x00004F` | [Worker Pool Parallelization](0x00004F-worker-pool-parallelization.md) | Thread management. |
| `0x000052` | [Hot Module Reload](0x000052-hot-module-reload.md) | Live code updating. |
| `0x000055` | [Pyodide Worker Visualization](0x000055-pyodide-worker-visualization.md) | Python runtime monitor. |
| `0x000056` | [Verification Worker Sandboxing](0x000056-verification-worker-sandboxing.md) | Isolated testing environment. |

## 5. User Interface & Panels (The Face)
*Visual proto, modular panels, and interaction components.*

| ID | Title | Description |
| :--- | :--- | :--- |
| `0x00000D` | [UI Manager](0x00000D-ui-manager.md) | Central UI orchestration. |
| `0x00000E` | [UI Styling (CSS)](0x00000E-ui-styling-css.md) | Theming and layout. |
| `0x00000F` | [UI Body Template (HTML)](0x00000F-ui-body-template-html.md) | Core DOM structure. |
| `0x00002B` | [Toast Notification System](0x00002B-toast-notification-system.md) | User alerts and feedback. |
| `0x00002F` | [Interactive Tutorial System](0x00002F-interactive-tutorial-system.md) | Onboarding flow. |
| `0x00003A` | [Tab Coordination](0x00003A-tab-coordination.md) | Multi-tab synchronization. |
| `0x000042` | [DOGS/CATS Browser Parser](0x000042-dogs-cats-browser-parser.md) | Bundle file viewing. |
| `0x000048` | [Module Widget Protocol](0x000048-module-widget-protocol.md) | Standardized UI contract. |
| `0x00004C` | [HITL Control Panel UI](0x00004C-hitl-control-panel-ui.md) | Autonomy controls. |
| `0x00004E` | [Tool Execution Panel](0x00004E-tool-execution-panel.md) | Active tool monitor. |
| `0x000050` | [Diff Viewer UI](0x000050-diff-viewer-ui.md) | Code change reviewer. |
| `0x000054` | [Module Proto Orchestration](0x000054-module-proto-orchestration.md) | Main proto layout. |
| `0x00005A` | [Thought Panel](0x00005A-thought-panel.md) | Cognitive stream viewer. |
| `0x00005B` | [Goal Panel](0x00005B-goal-panel.md) | Objective tracker. |
| `0x00005E` | [Sentinel Panel](0x00005E-sentinel-panel.md) | Safety/Approval interface. |
| `0x00005F` | [Progress Tracker](0x00005F-progress-tracker.md) | Task completion monitor. |
| `0x000060` | [Status Bar](0x000060-status-bar.md) | Global system state. |
| `0x000061` | [Log Panel](0x000061-log-panel.md) | System logs. |

## 6. Visualization & Analytics (The Monitor)
*Charts, graphs, introspection visuals, and performance tracking.*

| ID | Title | Description |
| :--- | :--- | :--- |
| `0x00001E` | [Penteract Analytics](0x00001E-penteract-analytics-and-visualization.md) | Competition telemetry. |
| `0x000024` | [Canvas Visualization Engine](0x000024-canvas-visualization-engine.md) | 2D graphics system. |
| `0x000025` | [Visualization Data Adapter](0x000025-visualization-data-adapter.md) | Data transformation layer. |
| `0x000027` | [Metrics Proto Visuals](0x000027-metrics-proto-visuals.md) | Performance charts. |
| `0x000028` | [Agent FSM Visualizer](0x000028-agent-fsm-visualizer.md) | State machine diagram. |
| `0x000029` | [AST Visualization Framework](0x000029-ast-visualization-framework.md) | Code structure view. |
| `0x00002A` | [Module Graph Visualizer](0x00002A-module-graph-visualizer.md) | Dependency mapping. |
| `0x00002C` | [Rate Limiting Strategies](0x00002C-rate-limiting-strategies.md) | Throttling logic. |
| `0x00002E` | [Audit Logging Policy](0x00002E-audit-logging-policy.md) | Security event logging. |
| `0x000038` | [Tool Usage Analytics](0x000038-tool-usage-analytics.md) | Tool performance tracking. |
| `0x000057` | [Penteract Visualizer](0x000057-penteract-visualizer.md) | Consensus visualizer. |

## 7. Recursive Self-Improvement (The Growth Loop)
*Introspection, blueprint generation, and evolution.*

| ID | Title | Description |
| :--- | :--- | :--- |
| `0x000012` | [Structured Self-Evaluation](0x000012-structured-self-evaluation.md) | Performance grading. |
| `0x000018` | [Blueprint Creation Meta](0x000018-blueprint-creation-meta.md) | Self-documentation. |
| `0x000019` | [Visual Self-Improvement](0x000019-visual-self-improvement.md) | Visual pattern detection. |
| `0x00001A` | [RFC Authoring](0x00001A-rfc-authoring.md) | Change proposal format. |
| `0x00001B` | [Code Introspection](0x00001B-code-introspection-self-analysis.md) | Source code analysis. |
| `0x00001D` | [Autonomous Curator Mode](0x00001D-autonomous-orchestrator-curator-mode.md) | Overnight improvement. |
| `0x00002D` | [Module Integrity](0x00002D-module-integrity-verification.md) | Code signing/hashing. |
| `0x000036` | [Reflection Analysis Engine](0x000036-reflection-analysis-engine.md) | Memory mining. |
| `0x000037` | [Reflection Semantic Search](0x000037-reflection-semantic-search.md) | Knowledge retrieval. |
| `0x00003B` | [Tool Doc Generator](0x00003B-tool-documentation-generator.md) | Auto-documentation. |
| `0x00003C` | [Self-Testing Framework](0x00003C-self-testing-framework.md) | Automated validation. |
| `0x00003D` | [Browser API Integration](0x00003D-browser-api-integration.md) | Native capabilities. |
| `0x000044` | [Déjà Vu Pattern Detection](0x000044-deja-vu-pattern-detection.md) | Repetition analysis. |
| `0x000045` | [Meta-Cognitive Coordination](0x000045-meta-cognitive-coordination.md) | Improvement strategy. |
| `0x000046` | [Diff Utilities](0x000046-diff-utilities.md) | Code comparison logic. |
| `0x00004B` | [Persona Management](0x00004B-persona-management-system.md) | Personality switching. |

