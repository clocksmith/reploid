# REPLOID API Documentation

This document is a current module map for the live Reploid tree. It is intentionally less exhaustive than older versions: source files and `src/config/module-registry.json` are the source of truth for exact wiring.

---

## Source of Truth

Use these files first:
- `src/config/module-registry.json` for runtime module identity and dependencies
- `src/config/genesis-levels.json` for level composition
- `src/core/`, `src/infrastructure/`, `src/capabilities/`, `src/testing/arena/`, and `src/ui/` for implementation
- `src/blueprints/` for architectural intent

---

## Module Conventions

Most runtime modules follow the standard metadata/factory pattern:

```javascript
const ExampleModule = {
  metadata: {
    id: 'ExampleModule',
    version: '1.0.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils'],
    async: true,
    type: 'core'
  },

  factory: (deps) => {
    return {
      init() {
        return true;
      }
    };
  }
};

export default ExampleModule;
```

Tools are file-based modules under `src/tools/` and typically export:

```javascript
export default async function(args, deps) {
  return result;
}

export const schema = {
  name: 'ToolName',
  description: 'What the tool does',
  parameters: {}
};
```

---

## Core Runtime Modules

| Module | Path | Purpose |
|--------|------|---------|
| Utils | `src/core/utils.js` | Error classes, logging, helpers |
| StateManager | `src/core/state-manager.js` | Session and artifact state |
| PersonaManager | `src/core/persona-manager.js` | System prompt composition, persona overrides |
| AgentLoop | `src/core/agent-loop.js` | Main think -> act -> observe loop |
| VFS | `src/core/vfs.js` | IndexedDB-backed virtual filesystem |
| ToolRunner | `src/core/tool-runner.js` | Tool discovery, registration, execution |
| WorkerManager | `src/core/worker-manager.js` | Worker orchestration and tool filtering |
| LLMClient | `src/core/llm-client.js` | Model-provider abstraction |
| ResponseParser | `src/core/response-parser.js` | Tool-call and JSON response parsing |
| SchemaRegistry | `src/core/schema-registry.js` | Runtime schema validation |
| VerificationManager | `src/core/verification-manager.js` | Pre-write validation and policy checks |
| MultiModelEvaluator | `src/core/multi-model-evaluator.js` | Task-suite evaluation across models |
| FunctionGemmaOrchestrator | `src/core/functiongemma-orchestrator.js` | Multi-expert orchestration surface |

---

## Infrastructure Modules

| Module | Path | Purpose |
|--------|------|---------|
| EventBus | `src/infrastructure/event-bus.js` | Pub/sub for runtime coordination |
| DIContainer | `src/infrastructure/di-container.js` | Dependency resolution |
| HITLController | `src/infrastructure/hitl-controller.js` | Approval-mode control |
| AuditLogger | `src/infrastructure/audit-logger.js` | Audit log persistence |
| CircuitBreaker | `src/infrastructure/circuit-breaker.js` | Failure throttling and isolation |
| RateLimiter | `src/infrastructure/rate-limiter.js` | Request pacing |
| TraceStore | `src/infrastructure/trace-store.js` | Structured execution traces |
| BrowserAPIs | `src/infrastructure/browser-apis.js` | File System Access, notifications, storage, clipboard, wake lock |

---

## Capability Modules

| Module | Path | Purpose |
|--------|------|---------|
| GEPAOptimizer | `src/capabilities/cognition/gepa-optimizer.js` | Prompt evolution and candidate scoring |
| SemanticMemory | `src/capabilities/cognition/semantic/semantic-memory-llm.js` | Semantic retrieval |
| KnowledgeGraph | `src/capabilities/cognition/symbolic/knowledge-graph.js` | Symbolic entity and relationship storage |
| RuleEngine | `src/capabilities/cognition/symbolic/rule-engine.js` | Deterministic symbolic reasoning |
| ReflectionStore | `src/capabilities/reflection/reflection-store.js` | Persistent learning and reflection storage |
| PerformanceMonitor | `src/capabilities/performance/performance-monitor.js` | Metrics collection and reporting |
| IntentBundleLoRA | `src/capabilities/intelligence/intent-bundle-lora.js` | Intent-bundle gated LoRA activation |

---

## Experimental Modules

These modules are real code but remain outside the main stable capability tree:

| Module | Path | Purpose |
|--------|------|---------|
| NeuralCompiler | `src/experimental/intelligence/neural-compiler.js` | LoRA routing and adapter scheduling |

Treat experimental paths as implementation details until they move into the main capability tree.

---

## UI Modules

| Module | Path | Purpose |
|--------|------|---------|
| Proto UI | `src/ui/proto/index.js` | Main operator UI |
| UIManager | `src/ui/dashboard/ui-manager.js` | Dashboard orchestration |
| VFSExplorer | `src/ui/dashboard/vfs-explorer.js` | File tree UI |

---

## Tool Surface

Current built-in tool files under `src/tools/`:

- `AwaitWorkers.js`
- `CreateTool.js`
- `DeleteFile.js`
- `EditFile.js`
- `FileOutline.js`
- `Find.js`
- `Grep.js`
- `Head.js`
- `ListFiles.js`
- `ListKnowledge.js`
- `ListMemories.js`
- `ListTools.js`
- `ListWorkers.js`
- `LoadModule.js`
- `ReadFile.js`
- `RunGEPA.js`
- `SpawnWorker.js`
- `SwarmGetStatus.js`
- `SwarmListPeers.js`
- `SwarmRequestFile.js`
- `SwarmShareFile.js`
- `Tail.js`
- `WriteFile.js`
- `git.js`

At runtime, tool visibility is filtered by genesis level and worker type.

---

## Persistence Paths

Important runtime storage paths:

| Path | Purpose |
|------|---------|
| `/.memory/persona-overrides.json` | Persona overrides |
| `/.memory/multi-model-eval/` | Multi-model evaluation runs |
| `/.memory/neural-compiler/adapters.json` | Adapter registry |
| `/.memory/traces/` | Structured trace sessions |
| `/.logs/audit/` | Audit logs |
| `/.system/intent-bundle.json` | Default intent bundle path |

---

## Status Notes

- `FunctionGemmaOrchestrator` is a live runtime module at `src/core/functiongemma-orchestrator.js`.
- `NeuralCompiler` currently lives under `src/experimental/intelligence/`, not `src/capabilities/intelligence/`.
- There is no standalone runtime module at `src/infrastructure/introspector.js`.
- There is no standalone runtime module at `src/core/sentinel-fsm.js`; the current reference is the blueprint `src/blueprints/0x000050-sentinel-fsm.md`.
- Older docs may refer to `ui/diff-generator.js`; the current UI surface is centered on `src/ui/proto/` and `src/ui/dashboard/`.

---

## Related Docs

- [QUICK-START.md](./QUICK-START.md)
- [CONFIGURATION.md](./CONFIGURATION.md)
- [system-architecture.md](./system-architecture.md)
- [multi-model-evaluation.md](./multi-model-evaluation.md)
- [intent-bundle-lora.md](./intent-bundle-lora.md)
- [SECURITY.md](./SECURITY.md)

---

*Last updated: March 2026*
