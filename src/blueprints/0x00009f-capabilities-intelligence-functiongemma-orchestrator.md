# Blueprint 0x00009f: FunctionGemma Orchestrator

**Objective:** Orchestrate multi-expert code generation using FunctionGemma models with DOPPLER primitives.

**Target:** `capabilities/intelligence/functiongemma-orchestrator.js`

**Status:** Implemented (1171 lines)

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
| Inference execution | - | `executeExpert()` |
| KV cache | - | `setSharedPrefix()` |
| Logit merging | - | `mergeLogits()` |

---

## 2. Architecture

```
FunctionGemmaOrchestrator
(capabilities/intelligence/functiongemma-orchestrator.js)

  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │ Task Router │  │ Expert Pool │  │ Evolver     │
  │ (UCB1)      │  │ (Arena)     │  │ (GA)        │
  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
         │                │                │
         └────────────────┼────────────────┘
                          ▼
              ┌─────────────────────┐
              │   DOPPLER Bridge    │
              │ (MultiModelNetwork) │
              └─────────────────────┘
                          │
                          ▼ Parameters only (no policy)
              ┌─────────────────────┐
              │   DOPPLER Engine    │
              │ executeExpert()     │
              │ setSharedPrefix()   │
              │ mergeLogits()       │
              └─────────────────────┘
```

### Key Methods

| Method | Lines | Purpose |
|--------|-------|---------|
| `executeTemporalSelfRing()` | 958-1067 | Seed/Reflect/Refine loop |
| `buildTemporalSelfRingPrompt()` | 1072-1085 | Prompt templates per role |
| `evolveTopology()` | 458-503 | GA for network structure |
| `runArenaEvolution()` | 744-879 | Tournament selection |
| `selectExpertUCB1()` | 263-307 | Exploration/exploitation |

### Dependencies

**From DOPPLER (primitives only):**
- `MultiModelNetwork.executeExpert()`
- `MultiModelNetwork.executeGenome()`
- `MultiModelNetwork.setSharedPrefix()`

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

Mutations are bounded to prevent runaway complexity:
- Max topology depth: 5
- Max branching factor: 3
- Crossover preserves valid structure

### Deprecated DOPPLER APIs

The following were removed from DOPPLER and must be implemented here:
- `MultiModelNetwork.executeTemporalRing()` - Now `executeTemporalSelfRing()` in orchestrator
- `MultiModelNetwork.buildTemporalPrompt()` - Now `buildTemporalSelfRingPrompt()` in orchestrator
- `FunctionGemma` class - Use this orchestrator instead

---

## 4. Verification Checklist

- [x] Behavior matches blueprint intent
- [x] Dependencies are declared and available
- [x] DOPPLER primitives used correctly (no policy in engine)
- [x] UCB1 selection implemented
- [x] Temporal ring implemented
- [x] Evolution implemented
- [ ] Tests for orchestrator logic
- [ ] Integration test with real DOPPLER pipeline

---

## 5. Cross-References

- `doppler/docs/ARCHITECTURE.md#engine-vs-driver-boundary`
- `doppler/docs/plans/FUNCTIONGEMMA_ARCHITECTURE_REFACTOR.md`
- `reploid/docs/design/FUNCTIONGEMMA.md`
- `ouroboros/ARCHITECTURE.md#engine-vs-driver-the-fundamental-split`

---

*Last updated: January 2026*
