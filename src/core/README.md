# Core Modules

**Primary Genesis Level:** SPARK (minimal agent core)

This directory contains foundational modules. Bootstrap storage and state live at `tabula`, the minimal agent core starts at `spark`, and higher levels add reflection, cognition, and substrate features.

## TABULA Level (Bootstrap)

| Module | File | Description |
|--------|------|-------------|
| StateHelpersPure | `state-helpers-pure.js` | Deterministic state logic |
| StateManager | `state-manager.js` | VFS and session persistence |
| Utils | `utils.js` | Shared utilities and error classes |
| VFS | `vfs.js` | Virtual file system (IndexedDB) |

## SPARK Level (Minimal Agent Core)

| Module | File | Description |
|--------|------|-------------|
| AgentLoop | `agent-loop.js` | Primary think-act cognitive cycle |
| ContextManager | `context-manager.js` | Token window optimization |
| LLMClient | `llm-client.js` | LLM API transport layer |
| PersonaManager | `persona-manager.js` | System prompt composition |
| ResponseParser | `response-parser.js` | LLM response extraction |
| SchemaRegistry | `schema-registry.js` | Tool schema storage |
| ToolRunner | `tool-runner.js` | Tool execution engine |
| ToolWriter | `tool-writer.js` | Dynamic tool creation |

## REFLECTION Level

| Module | File | Description |
|--------|------|-------------|
| VerificationManager | `verification-manager.js` | Test execution orchestrator |

## COGNITION Level

| Module | File | Description |
|--------|------|-------------|
| MemoryManager | `memory-manager.js` | Working memory orchestration |
| TransformersClient | `transformers-client.js` | Browser-native model inference (WebGPU) |

## SUBSTRATE Level

| Module | File | Description |
|--------|------|-------------|
| SchemaValidator | `schema-validator.js` | Schema validation utilities |
| WorkerManager | `worker-manager.js` | Sub-agent worker spawning |

## FULL Level

| Module | File | Description |
|--------|------|-------------|
| (none) | - | Full-level modules live in capabilities and infrastructure |

## See Also

- [Genesis Levels Config](../config/genesis-levels.json)
- [Blueprint 0x000002: Application Orchestration](../blueprints/0x000002-application-orchestration.md)
