# Core Modules

**Primary Genesis Level:** TABULA (minimal agent substrate)

This directory contains foundational modules. Most are loaded at `tabula`, with some requiring higher levels.

## TABULA Level (Loaded First)

| Module | File | Description |
|--------|------|-------------|
| AgentLoop | `agent-loop.js` | Primary think-act cognitive cycle |
| ContextManager | `context-manager.js` | Token window optimization |
| LLMClient | `llm-client.js` | LLM API transport layer |
| PersonaManager | `persona-manager.js` | System prompt composition |
| ResponseParser | `response-parser.js` | LLM response extraction |
| SchemaRegistry | `schema-registry.js` | Tool schema storage |
| StateHelpersPure | `state-helpers-pure.js` | Deterministic state logic |
| StateManager | `state-manager.js` | VFS and session persistence |
| ToolRunner | `tool-runner.js` | Tool execution engine |
| ToolWriter | `tool-writer.js` | Dynamic tool creation |
| Utils | `utils.js` | Shared utilities and error classes |
| VFS | `vfs.js` | Virtual file system (IndexedDB) |

## REFLECTION Level

| Module | File | Description |
|--------|------|-------------|
| VerificationManager | `verification-manager.js` | Test execution orchestrator |

## FULL Level

| Module | File | Description |
|--------|------|-------------|
| TransformersClient | `transformers-client.js` | Browser-native model inference (WebGPU) |
| WorkerManager | `worker-manager.js` | Sub-agent worker spawning |

## See Also

- [Genesis Levels Config](../config/genesis-levels.json)
- [Blueprint 0x000002: Application Orchestration](../blueprints/0x000002-application-orchestration.md)
