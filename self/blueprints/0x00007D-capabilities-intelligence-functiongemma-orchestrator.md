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

The FunctionGemma Orchestrator is the **Driver** (policy layer) for multi-model inference. It owns all orchestration logic:

- **Prompt construction**: Seed/Reflect/Refine templates
- **Loop management**: Temporal self-ring iterations
- **Expert selection**: UCB1 bandit algorithm
- **Evolution**: Genetic algorithm for network topology
- **Fitness scoring**: Quality heuristics for outputs

DOPPLER provides only **primitives** (mechanism). The orchestrator makes all decisions.

### Engine vs Driver Boundary

| Responsibility | FunctionGemmaOrchestrator (Driver) | DOPPLER (Engine) |
|----------------|-----------------------------------|------------------|
| Prompt templates | `buildTemporalSelfRingPrompt()` | - |
| Loop logic | `executeTemporalSelfRing()` | - |
| Expert selection | `selectExpertUCB1()` | - |
| Evolution | `evolveTopology()`, `runArenaEvolution()` | - |
| Fitness scoring | `calculateFitness()` | - |
| Inference execution | Select the configured expert and adapter | Scoped session `generate()` |
| KV cache | Request only supported prefix operations | Session `advanced` capability |
| Logit merging | No raw-logit combination in this adapter | Model arithmetic remains in Doppler |

---

## 2. Architecture

```
FunctionGemmaOrchestrator
(core/functiongemma-orchestrator.js)

  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │ Task Router │  │ Expert Pool │  │ Evolver     │
  │ (UCB1)      │  │ (Arena)     │  │ (GA)        │
  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
         │                │                │
         └────────────────┼────────────────┘
                          ▼
              ┌─────────────────────┐
              │   DOPPLER Bridge    │
              │ (public session)    │
              └─────────────────────┘
                          │
                          ▼ Parameters only (no policy)
              ┌─────────────────────┐
              │   DOPPLER Engine    │
              │ generate()          │
              │ loadLoRA()          │
              │ close()             │
              └─────────────────────┘
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `executeTemporalSelfRing()` | Seed/Reflect/Refine loop |
| `buildTemporalSelfRingPrompt()` | Prompt templates per role |
| `evolveTopology()` | GA for network structure, with caller-supplied randomness |
| `runArenaEvolution()` | Tournament selection |
| `selectExpertUCB1()` | Exploration/exploitation |

### Dependencies

**From DOPPLER (primitives only):**
- `DopplerRuntimeService.open()` owns a public scoped session.
- `session.generate()`, `loadLoRA()`, `unloadLoRA()` execute the selected model and adapter.
- Shared KV prefix generation requires the session's advanced capability; unsupported requests fail explicitly before context initialization.

`core/functiongemma-network.js` owns text combination, embedding ranking and topology evolution. One session serializes expert requests so adapter state cannot cross requests; it does not claim parallel GPU execution. Routing `topK` selects experts; sampling `topK` is supplied in `generation`.

Loading accepts an explicit public `source`, an inline `{ manifest, baseUrl, storageContext }`, an explicit URL, or a registry ID. An arbitrary OPFS directory name is not a public source contract. The adapter does not import private storage, device, loader or pipeline classes.

**Internal:**
- `SemanticMemory` - Task embedding
- `ReflectionStore` - Genome persistence
- `SchemaRegistry` - Output validation

---

## 3. Implementation Notes

### Temporal Self-Ring

The orchestrator implements a multi-turn self-refinement loop:

```javascript
// Turn roles cycle: seed -> reflect -> refine -> reflect -> refine -> ...
const role = turn === 0 ? 'seed' : turn % 2 === 1 ? 'reflect' : 'refine';

// Build prompt based on role
const prompt = buildTemporalSelfRingPrompt(taskDescription, turn, history, lastOutput, role);

// Execute via DOPPLER primitive (no policy in DOPPLER)
const output = await network.executeExpert(expertId, prompt, options);
```

### UCB1 Expert Selection

```javascript
// UCB1 formula: mean + sqrt(exploration * ln(total) / attempts)
const ucbScore = meanFitness + Math.sqrt(
  (explorationWeight * Math.log(totalAttempts)) / expertAttempts
);
```

### Evolution Safety

Evolution requires explicit randomness, bounded population and mutation settings, and finite fitness. Scores are host heuristics, not scientific improvement or activation authority.

### Deprecated DOPPLER APIs

The following were removed from DOPPLER and must be implemented here:
- `MultiModelNetwork.executeTemporalRing()` - Now `executeTemporalSelfRing()` in orchestrator
- `MultiModelNetwork.buildTemporalPrompt()` - Now `buildTemporalSelfRingPrompt()` in orchestrator
- `FunctionGemma` class - Use this orchestrator instead

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
