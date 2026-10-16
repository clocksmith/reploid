# REPLOID API Documentation

This document is a current module map for the live Reploid tree. It is intentionally less exhaustive than older versions: source files and `self/config/module-registry.json` are the source of truth for exact wiring.

---

## Reploid and Doppler chat boundary

Ordinary chat uses Doppler's public scoped session. The host owns the model
lease, permissions and conversation identity. Doppler owns chat templates,
tokenization, numerical execution and Unicode decoding.

```javascript
session.stream([{ role: 'user', content: 'Question' }], {
  ...generationOptions, signal
});
// Ordered events, schema: 'doppler.generation-event/v1':
// { type: 'text-delta', text: 'An addition to the answer', ... }
// { type: 'complete', outputText: 'The entire answer', completion?, ... }
```

`consumeWorkGenerationStream` in
[`work-generation-completion.js`](../self/providers/work-generation-completion.js)
accepts only that schema and those event types. Text additions are bounded and
delivered in order, awaiting each consumer. Exactly one completion must follow;
its output must equal the accumulated text. Missing completion, unknown events,
events after completion and contradictory output fail the request. Exceptions
remain failures, not answer text. Aborting waits for iterator and session cleanup.

The optional Doppler `completion` record preserves its stop reason and raw prompt
and generated token counts. Older pinned runtimes may omit it; absence remains
unknown. Chunk count and text length never stand in for token usage. Adapter
generation additionally checks Doppler's model and adapter evidence. Signed
Capsule operations retain their separate verified event and receipt contracts.

[`chat-execution.js`](../self/host/chat-execution.js) attaches `threadId`,
`attemptId` and an increasing `sequence` to text additions. Local and whole-model
peer results share one mapper for `content`, model and adapter identities,
completion, stop reason and reported timing. The local request's
`maxOutputTokens` maps to Doppler's `maxTokens`, capped by host generation policy;
it does not mutate the resident model's configuration for the next request.
The scheduler retains its slot until execution and cleanup settle.

Tests: [stream boundary and installed Doppler session](../tests/unit/work-generation-completion.test.js),
[resident lifecycle](../tests/unit/work-resident-provider.test.js).
These exercise contracts with injected model execution, not model quality.

---

## Source of Truth

Use these files first:
- `self/config/module-registry.json` for runtime module identity and dependencies
- `self/config/genesis-levels.json` for level composition
- `self/core/`, `self/infrastructure/`, `self/capabilities/`, `self/testing/arena/`, and `self/ui/` for implementation
- `self/blueprints/` for architectural intent

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

Tools are file-based modules under `self/tools/` and typically export:

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
| Utils | `self/core/utils.js` | Error classes, logging, helpers |
| StateManager | `self/core/state-manager.js` | Session and artifact state |
| PersonaManager | `self/core/persona-manager.js` | System prompt composition, persona overrides |
| AgentLoop | `self/core/agent-loop.js` | Main think -> act -> observe loop |
| VFS | `self/core/vfs.js` | IndexedDB-backed virtual filesystem |
| ToolRunner | `self/core/tool-runner.js` | Tool discovery, registration, execution |
| WorkerManager | `self/core/worker-manager.js` | Worker orchestration and tool filtering |
| LLMClient | `self/core/llm-client.js` | Model-provider abstraction |
| ResponseParser | `self/core/response-parser.js` | Tool-call and JSON response parsing |
| SchemaRegistry | `self/core/schema-registry.js` | Runtime schema validation |
| VerificationManager | `self/core/verification-manager.js` | Pre-write validation and policy checks |
| MultiModelEvaluator | `self/core/multi-model-evaluator.js` | Task-suite evaluation across models |
| FunctionGemmaOrchestrator | `self/core/functiongemma-orchestrator.js` | Multi-expert orchestration surface |

---

## Infrastructure Modules

| Module | Path | Purpose |
|--------|------|---------|
| EventBus | `self/infrastructure/event-bus.js` | Pub/sub for runtime coordination |
| DIContainer | `self/infrastructure/di-container.js` | Dependency resolution |
| HITLController | `self/infrastructure/hitl-controller.js` | Approval-mode control |
| AuditLogger | `self/infrastructure/audit-logger.js` | Audit log persistence |
| CircuitBreaker | `self/infrastructure/circuit-breaker.js` | Failure throttling and isolation |
| RateLimiter | `self/infrastructure/rate-limiter.js` | Request pacing |
| TraceStore | `self/infrastructure/trace-store.js` | Structured execution traces |
| BrowserAPIs | `self/infrastructure/browser-apis.js` | File System Access, notifications, storage, clipboard, wake lock |

## Core Evidence Modules

| Module | Path | Purpose |
|--------|------|---------|
| ImprovementEpisodeLedger | `self/core/improvement-episode.js` | Signed append-only improvement episodes, metric contracts, generation ancestry, promotion readiness, rollback, and algorithm manifests |

---

## Capability Modules

| Module | Path | Purpose |
|--------|------|---------|
| GEPAOptimizer | `self/capabilities/cognition/gepa-optimizer.js` | Prompt evolution and candidate scoring |
| SemanticMemory | `self/capabilities/cognition/semantic/semantic-memory-llm.js` | Semantic retrieval |
| KnowledgeGraph | `self/capabilities/cognition/symbolic/knowledge-graph.js` | Symbolic entity and relationship storage |
| RuleEngine | `self/capabilities/cognition/symbolic/rule-engine.js` | Deterministic symbolic reasoning |
| ReflectionStore | `self/capabilities/reflection/reflection-store.js` | Persistent observations plus structured hypothesis reflections; not promotion authority |
| PerformanceMonitor | `self/capabilities/performance/performance-monitor.js` | Metrics collection and reporting |
| IntentBundleLoRA | `self/capabilities/intelligence/intent-bundle-lora.js` | Intent-bundle gated LoRA activation |

---

## Experimental Modules

These modules are real code but remain outside the main stable capability tree:

| Module | Path | Purpose |
|--------|------|---------|
| NeuralCompiler | `self/experimental/intelligence/neural-compiler.js` | LoRA routing and adapter scheduling |

Treat experimental paths as implementation details until they move into the main capability tree.

---

## UI Modules

| Module | Path | Purpose |
|--------|------|---------|
| Proto UI | `self/ui/proto/index.js` | Main operator UI |

---

## Tool Surface

Current built-in tool files under `self/tools/`:

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

- `FunctionGemmaOrchestrator` is a live runtime module at `self/core/functiongemma-orchestrator.js`.
- `NeuralCompiler` currently lives under `self/experimental/intelligence/`, not `self/capabilities/intelligence/`.
- There is no standalone runtime module at `self/infrastructure/introspector.js`.
- There is no standalone runtime module at `self/core/sentinel-fsm.js`; the current reference is the blueprint `self/blueprints/0x000050-sentinel-fsm.md`.
- Older docs may refer to `ui/diff-generator.js`; the current operator UI lives under `self/ui/proto/`.

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
