# Blueprint 0x00007D: FunctionGemma Orchestrator

**Classification:** Canonical Full Specification

**Implementation Status:** In-Progress

**Verified Artifacts:** `/self/core/functiongemma-orchestrator.js`, `/self/core/functiongemma-network.js`, `/tests/unit/functiongemma-orchestrator.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/functiongemma-orchestrator.js`, `core/functiongemma-network.js`

**Former Blueprint Paths:** `self/blueprints/0x00007D-capabilities-intelligence-functiongemma-orchestrator.md`
**Objective:** Orchestrate multi-expert code generation using FunctionGemma models with DOPPLER primitives.

**Target:** `core/functiongemma-orchestrator.js`

---

## 1. Intent

The FunctionGemma Orchestrator is the policy layer for multi-expert inference: expert
routing, topology execution and evolution, output scoring and the temporal self-ring loop.
Doppler provides the mechanism (sessions, `generate()`, LoRA load and unload); model
arithmetic stays in Doppler.

| Responsibility | Orchestrator (`core/functiongemma-orchestrator.js`) | Doppler |
| --- | --- | --- |
| Prompt templates | `buildTemporalSelfRingPrompt` (internal, :979) | - |
| Loop logic | `executeTemporalSelfRing` (:865) | - |
| Adapter selection | `selectAdapterUCB1` (:435), delegating to `ReflectionStore.selectAdapterUCB1` | - |
| Evolution | `evolveTopology` (:410), `runArenaEvolution` (:651) | - |
| Output scoring | `scoreCombinedOutput` (internal, :340) | - |
| Inference execution | Select the configured expert and adapter | Scoped session `generate()` |
| KV cache | Request only supported prefix operations | Session `advanced` capability |
| Logit merging | No raw-logit combination | Model arithmetic remains in Doppler |

There is no `selectExpertUCB1` or `calculateFitness` function; earlier text used those
names.

## 2. Interface

The module is a DI factory (`id: 'FunctionGemmaOrchestrator'`, genesis level `full`). Its
dependencies are `Utils`, `EventBus?`, `SemanticMemory?`, `ArenaHarness?`,
`ContextManager?`, `SchemaRegistry?`, `ReflectionStore?` and `VFS` (:14).

| Member | Line | Behavior |
| --- | --- | --- |
| `initBase(options)` | :125 | Opens the Doppler network through `createFunctionGemmaNetwork` |
| `registerExperts(experts)` | :138 | Registers experts and their adapters |
| `selectExperts(task, topK)` | :207 | Embedding-ranked expert routing; records routing latency |
| `executeExpert(expertId, prompt, options)` | :252 | One expert request with its context applied |
| `executeTopology(genome, task)` | :261 | Runs a genome's nodes in topological order and combines outputs |
| `runExpertPool(task, options)` | :355 | Delegates to `ArenaHarness.runExpertPool`; throws if absent |
| `evolveTopology(tasks, options)` | :410 | Genetic search through `evolveFunctionGemmaNetwork` (`core/functiongemma-network.js:121`) |
| `setCombiner`, `setSharedPrefix`, `setSharedPrefixFromContext`, `initExpertContext` | :163-:182 | Combination and shared-prefix setup |
| `getCachedGenome`, `storeGenome` | :419, :427 | Read and write the best genome per task type in `ReflectionStore` |
| `selectAdapterUCB1`, `updateAdapterStats` | :435, :445 | UCB1 adapter choice and success counts (`capabilities/reflection/reflection-store.js:403`) |
| `benchmarkRoutingLatency`, `getRoutingStats` | :225, :247 | Routing latency samples |
| `execute(task, options)` | :461 | Uses the cached genome for the task type if present, else routes and runs the expert pool, then stores the winner |
| `runArenaEvolution`, `runHeadToHead` | :651, :798 | Tournament over genomes; head-to-head A/B |
| `executeTemporalSelfRing`, `executeMobiusRing` | :865, :1037 | Seed, reflect, refine loop until convergence or the turn limit; Mobius adds shortcuts |
| `close()` | :1046 | Closes the network and clears the shared prefix |

Events emitted on `EventBus`: `functiongemma:routing:latency`, `functiongemma:error`,
`functiongemma:routing:benchmark`, `functiongemma:execute:cached`,
`functiongemma:execute:pool`, `functiongemma:arena:start`, `functiongemma:arena:complete`,
`functiongemma:headtohead:complete`, `functiongemma:temporal:complete`.

`core/functiongemma-network.js` owns text combination, embedding ranking and topology
evolution. One session serializes expert requests so adapter state cannot cross requests; it
does not claim parallel GPU execution. Routing `topK` selects experts; sampling `topK` is
supplied in `generation`. Loading accepts an explicit public `source`, an inline
`{ manifest, baseUrl, storageContext }`, an explicit URL, or a registry ID. An arbitrary OPFS
directory name is not a public source contract, and the adapter does not import private
Doppler storage, device, loader or pipeline classes. Shared KV prefix generation requires
the session's advanced capability; unsupported requests fail before context initialization.

## 3. Scoring and authority

- `scoreCombinedOutput` returns 0.4 when the task has no schema, 0.7 for schema-valid JSON,
  and 0 otherwise. It is a host heuristic.
- `evolveFunctionGemmaNetwork` requires an explicit `random` function, bounded population,
  elite and mutation settings, and finite fitness.
- Stored genomes are per-task routing state inside `ReflectionStore`: `execute` reuses them
  on the next call for that task type. They do not load new adapters, change files under
  `/self`, or change boot. Any of those needs operator adoption through HITL or `Promote`
  ([`promotion-contract.md`](promotion-contract.md)); a score never grants activation.

---

## 4. Verification requirements

- Focused tests exercise scoped-session wiring, adapter isolation, cancellation settlement, model-switch cleanup, text combination and topology scoring.
- These use test sessions. Real model loading, shared-prefix compatibility and physical inference remain unqualified here.

---

## 5. Cross-References

- [API overview](../../docs/API.md)
- [FunctionGemma unit checks](../../tests/unit/functiongemma-orchestrator.test.js)

---

*Last updated: November 2026*
