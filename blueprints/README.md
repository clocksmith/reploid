# REPLOID Knowledge Base

**[Back to Harness README](../README.md)**

---

> **Architecture Note:** Blueprints form the knowledge foundation for REPLOID's Sentinel Agent capabilities. They are technical specifications that guide the agent's self-improvement and evolution. This directory contains architectural patterns and implementation guides for major capabilities.

This directory contains REPLOID's conceptual knowledge base. The files herein are instructional markdown documents, or **"blueprints,"** designed to be discovered and studied by the agent itself. Each blueprint provides a high-level guide to potential self-improvements, outlining architectural principles, strategic goals, and implementation pathways for major capabilities.

The knowledge base serves as a catalyst for the agent's Recursive Self-Improvement (RSI) cycles. These blueprints provide structured, expert-level knowledge that accelerates development through the Sentinel Agent's human-in-the-loop approval flow.

## Blueprint Style Guide

### 1. Philosophy

This guide ensures every blueprint in the REPLOID knowledge base is consistent, machine-readable, and pedagogically sound. Blueprints are the agent's textbooks; their structure and clarity are paramount for facilitating autonomous learning and evolution. Adherence to this guide is mandatory for all new blueprint artifacts.

### 2. File Naming Convention

Blueprint files MUST follow a strict naming convention:

`0x{HEX_ID}-{kebab-case-title}.md`

- `0x{HEX_ID}`: A zero-padded, 6-digit hexadecimal identifier (e.g., `0x000001`, `0x00000A`, `0x000012`).
- `kebab-case-title`: A short, descriptive title in lowercase, with words separated by hyphens.

**Example:** `0x000008-agent-cognitive-cycle.md`

### 3. Core Blueprint Structure

Every blueprint artifact MUST contain the following sections, in this precise order, using the specified Markdown formatting.

```markdown
# Blueprint 0x{HEX_ID}: [Title Case Title]

**Objective:** A single, concise sentence articulating the primary goal or purpose of the concept described in this blueprint.

**Prerequisites:** A list of other blueprint IDs that should be understood before tackling this one. Use "None" if it is a foundational concept.
- *Example: `Prerequisites: 0x000004, 0x000005`*

**Affected Artifacts:** A list of the primary VFS artifacts that will likely be created, modified, or deleted if the agent acts on this blueprint.
- *Example: `/modules/agent-cycle.js`, `/modules/prompt-system.md`*

---

### 1. The Strategic Imperative
*(This section explains the "Why." It provides the high-level strategic reasoning behind the concept. It should be focused and concise, ideally between 50-150 words).*

### 2. The Architectural Solution
*(This section explains the "How." It describes the technical design and architectural pattern that solves the strategic challenge. It may include small code snippets using Markdown code fences to illustrate key ideas).*

### 3. The Implementation Pathway
*(This section provides the "What." It is a clear, step-by-step list of actions the agent could take to implement the solution. This serves as a guide for the agent's own planning process).*
```

### 4. Content and Formatting Rules

- **Headings:** Use a single H1 for the title and H3 for the three core sections.
- **Keywords:** Use `**bold**` for critical terms, file paths, and artifact IDs.
- **Code:** Use `backticks` for inline code and fenced code blocks for multi-line examples.
- **Tone:** The language MUST be objective, technical, and pedagogical. The blueprint is a formal technical document.
- **Conciseness:** Each section should be focused and to the point. The goal is clarity and efficient machine-parsing by the agent.

---

## Catalog of Active Blueprints

### Blueprint-to-Upgrade Map (Current)

The table below provides a machine-auditable cross-reference between blueprint artifacts and the upgrades/modules they govern.

| Blueprint | File | Description |
| --- | --- | --- |
| `0x000001` | `0x000001-system-prompt-architecture.md` | System Prompt Architecture |
| `0x000002` | `0x000002-application-orchestration.md` | Application Orchestration |
| `0x000003` | `0x000003-core-utilities-and-error-handling.md` | Core Utilities and Error Handling |
| `0x000004` | `0x000004-default-storage-backend-localstorage.md` | Default Storage Backend (localStorage) |
| `0x000005` | `0x000005-state-management-architecture.md` | State Management Architecture |
| `0x000006` | `0x000006-pure-state-helpers.md` | Pure State Helpers |
| `0x000007` | `0x000007-api-client-and-communication.md` | API Client and Communication |
| `0x000008` | `0x000008-agent-cognitive-cycle.md` | Agent Cognitive Cycle |
| `0x000009` | `0x000009-pure-agent-logic-helpers.md` | Pure Agent Logic Helpers |
| `0x00000A` | `0x00000A-tool-runner-engine.md` | Tool Runner Engine |
| `0x00000B` | `0x00000B-pure-tool-logic-helpers.md` | Pure Tool Logic Helpers |
| `0x00000C` | `0x00000C-sandboxed-tool-worker.md` | Sandboxed Tool Worker |
| `0x00000D` | `0x00000D-ui-manager.md` | UI Manager |
| `0x00000E` | `0x00000E-ui-styling-css.md` | UI Styling (CSS) |
| `0x00000F` | `0x00000F-ui-body-template-html.md` | UI Body Template (HTML) |
| `0x000010` | `0x000010-static-tool-manifest.md` | Static Tool Manifest |
| `0x000011` | `0x000011-advanced-storage-backend-indexeddb.md` | Advanced Storage Backend (IndexedDB) |
| `0x000012` | `0x000012-structured-self-evaluation.md` | Structured Self-Evaluation |
| `0x000013` | `0x000013-system-configuration-structure.md` | System Configuration Structure |
| `0x000014` | `0x000014-working-memory-scratchpad.md` | Working Memory Scratchpad |
| `0x000015` | `0x000015-dynamic-tool-creation.md` | Dynamic Tool Creation |
| `0x000016` | `0x000016-meta-tool-creation-patterns.md` | Meta-Tool Creation Patterns |
| `0x000017` | `0x000017-goal-modification-safety.md` | Goal Modification Safety |
| `0x000018` | `0x000018-blueprint-creation-meta.md` | Blueprint Creation Meta |
| `0x000019` | `0x000019-visual-self-improvement.md` | Visual Self-Improvement |
| `0x00001A` | `0x00001A-rfc-authoring.md` | RFC Authoring |
| `0x00001B` | `0x00001B-code-introspection-self-analysis.md` | Code Introspection & Self-Analysis |
| `0x00001C` | `0x00001C-write-tools-manifest.md` | Write Tools Manifest |
| `0x00001D` | `0x00001D-autonomous-orchestrator-curator-mode.md` | Autonomous Orchestrator Curator Mode |
| `0x00001E` | `0x00001E-penteract-analytics-and-visualization.md` | Penteract Analytics & Visualization |
| `0x00001F` | `0x00001F-universal-module-loader.md` | Universal Module Loader |
| `0x000020` | `0x000020-module-manifest-governance.md` | Module Manifest Governance |
| `0x000021` | `0x000021-multi-provider-api-gateway.md` | Multi-Provider API Gateway |
| `0x000022` | `0x000022-confirmation-modal-safety.md` | Confirmation Modal Safety |
| `0x000023` | `0x000023-vfs-explorer-interaction.md` | VFS Explorer Interaction |
| `0x000024` | `0x000024-canvas-visualization-engine.md` | Canvas Visualization Engine |
| `0x000025` | `0x000025-visualization-data-adapter.md` | Visualization Data Adapter |
| `0x000026` | `0x000026-performance-monitoring-stack.md` | Performance Monitoring Stack |
| `0x000027` | `0x000027-metrics-dashboard-visuals.md` | Metrics Dashboard Visuals |
| `0x000028` | `0x000028-agent-fsm-visualizer.md` | Agent FSM Visualizer |
| `0x000029` | `0x000029-ast-visualization-framework.md` | AST Visualization Framework |
| `0x00002A` | `0x00002A-module-graph-visualizer.md` | Module Graph Visualizer |
| `0x00002B` | `0x00002B-toast-notification-system.md` | Toast Notification System |
| `0x00002C` | `0x00002C-rate-limiting-strategies.md` | Rate Limiting Strategies |
| `0x00002D` | `0x00002D-module-integrity-verification.md` | Module Integrity Verification |
| `0x00002E` | `0x00002E-audit-logging-policy.md` | Audit Logging Policy |
| `0x00002F` | `0x00002F-interactive-tutorial-system.md` | Interactive Tutorial System |
| `0x000030` | `0x000030-pyodide-runtime-orchestration.md` | Pyodide Runtime Orchestration |
| `0x000031` | `0x000031-python-tool-interface.md` | Python Tool Interface |
| `0x000032` | `0x000032-local-llm-runtime.md` | Local LLM Runtime |
| `0x000033` | `0x000033-hybrid-llm-orchestration.md` | Hybrid LLM Orchestration |
| `0x000034` | `0x000034-swarm-orchestration.md` | Swarm Orchestration |
| `0x000035` | `0x000035-reflection-store-architecture.md` | Reflection Store Architecture |
| `0x000036` | `0x000036-reflection-analysis-engine.md` | Reflection Analysis Engine |
| `0x000037` | `0x000037-reflection-semantic-search.md` | Reflection Semantic Search |
| `0x000038` | `0x000038-tool-usage-analytics.md` | Tool Usage Analytics |
| `0x000039` | `0x000039-api-cost-tracker.md` | API Cost Tracker |
| `0x00003A` | `0x00003A-tab-coordination.md` | Tab Coordination |
| `0x00003B` | `0x00003B-tool-documentation-generator.md` | Tool Documentation Generator |
| `0x00003C` | `0x00003C-self-testing-framework.md` | Self-Testing Framework |
| `0x00003D` | `0x00003D-browser-api-integration.md` | Browser API Integration |
| `0x00003E` | `0x00003E-webrtc-swarm-transport.md` | WebRTC Swarm Transport |
| `0x00003F` | `0x00003F-streaming-response-handler.md` | Streaming Response Handler |
| `0x000040` | `0x000040-context-management.md` | Context Management |
| `0x000041` | `0x000041-structured-agent-cycle.md` | Structured Agent Cycle |
| `0x000042` | `0x000042-dogs-cats-browser-parser.md` | DOGS/CATS Browser Parser |
| `0x000043` | `0x000043-genesis-snapshot-system.md` | Genesis Snapshot System |
| `0x000044` | `0x000044-deja-vu-pattern-detection.md` | Deja Vu Pattern Detection |
| `0x000045` | `0x000045-meta-cognitive-coordination.md` | Meta-Cognitive Coordination |
| `0x000046` | `0x000046-diff-utilities.md` | Diff Utilities |
| `0x000047` | `0x000047-verification-manager.md` | Verification Manager |
| `0x000048` | `0x000048-module-widget-protocol.md` | Module Widget Protocol |
| `0x000049` | `0x000049-dependency-injection-container.md` | Dependency Injection Container |
| `0x00004A` | `0x00004A-config-management.md` | Config Management |
| `0x00004B` | `0x00004B-persona-management-system.md` | Persona Management System |
| `0x00004C` | `0x00004C-hitl-control-panel-ui.md` | HITL Control Panel UI |
| `0x00004D` | `0x00004D-sentinel-tools-library.md` | Sentinel Tools Library |
| `0x00004E` | `0x00004E-tool-execution-panel.md` | Tool Execution Panel |
| `0x00004F` | `0x00004F-worker-pool-parallelization.md` | Worker Pool Parallelization |
| `0x000050` | `0x000050-diff-viewer-ui.md` | Diff Viewer UI |
| `0x000051` | `0x000051-hitl-controller.md` | HITL Controller |
| `0x000052` | `0x000052-hot-module-reload.md` | Hot Module Reload |
| `0x000053` | `0x000053-git-vfs-version-control.md` | Git VFS Version Control |
| `0x000054` | `0x000054-module-dashboard-orchestration.md` | Module Dashboard Orchestration |
| `0x000055` | `0x000055-pyodide-worker-visualization.md` | Pyodide Worker Visualization |
| `0x000056` | `0x000056-verification-worker-sandboxing.md` | Verification Worker Sandboxing |
| `0x000057` | `0x000057-penteract-visualizer.md` | Penteract Visualizer |
| `0x000058` | `0x000058-event-bus-infrastructure.md` | Event Bus Infrastructure |
| `0x000059` | `0x000059-sentinel-fsm.md` | Sentinel FSM |
| `0x00005A` | `0x00005A-thought-panel.md` | Thought Panel |
| `0x00005B` | `0x00005B-goal-panel.md` | Goal Panel |
| `0x00005C` | `0x00005C-vfs-tools-manifest.md` | VFS Tools Manifest |
| `0x00005D` | `0x00005D-system-tools-manifest.md` | System Tools Manifest |
| `0x00005E` | `0x00005E-sentinel-panel.md` | Sentinel Panel |
| `0x00005F` | `0x00005F-progress-tracker.md` | Progress Tracker |
| `0x000060` | `0x000060-status-bar.md` | Status Bar |
| `0x000061` | `0x000061-log-panel.md` | Log Panel |
| `0x000062` | `0x000062-internal-patch-format.md` | Internal Patch Format |
| `0x000063` | `0x000063-browser-native-paxos.md` | Browser Native Paxos |
| `0x000064` | `0x000064-recursive-prompt-engineering.md` | Recursive Prompt Engineering |
| `0x000065` | `0x000065-meta-cognitive-evaluator.md` | Meta-Cognitive Evaluator |
| `0x000066` | `0x000066-recursive-goal-decomposition.md` | Recursive Goal Decomposition |

---

## Integration with Sentinel Agent

All blueprints integrate with the Sentinel Agent system (Project Sentinel), which implements:

1. **Context Curation**: Agent selects relevant blueprints for goals
2. **Human Approval**: Review and approve proposed implementations
3. **Safe Application**: Changes applied with checkpoint/rollback capability
4. **Learning**: Agent reflects on outcomes to improve future blueprint usage

## Testing & Validation

Blueprint implementations are validated through:

1. **Self-Testing Framework**: `self-tester.js` validates system integrity (80% pass threshold)
2. **Automated Test Suite**: 85 passing tests with Vitest (see `tests/README.md`)
3. **CI/CD Pipeline**: GitHub Actions validates all changes on push/PR

**RSI Safety**: All RSI core modules (Introspection, Reflection, Self-Testing, Performance, Browser APIs) are complete and tested, enabling safe self-modification.

---

*Blueprints power the Sentinel Agent's evolution through structured knowledge and human-approved implementation.*
