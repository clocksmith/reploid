# Pipeline.ts Refactoring Plan

The `pipeline.ts` file is ~3880 lines and mixes concerns. This plan splits it into focused modules.

## Current State

**Existing modules in `inference/pipeline/` (split but NOT wired):**
| Module | Lines | Status |
|--------|-------|--------|
| `config.ts` | 325 | **WIRED** - imported by pipeline.ts |
| `sampling.ts` | 203 | **WIRED** - imported by pipeline.ts |
| `generate.ts` | 279 | NOT wired |
| `layer.ts` | 180 | NOT wired |
| `prefill.ts` | 131 | NOT wired |
| `decode.ts` | 144 | NOT wired |
| `embed.ts` | 173 | NOT wired |
| `stats.ts` | 174 | NOT wired |
| `stopping.ts` | 178 | NOT wired |
| `index.ts` | 150 | Barrel export |

**Main pipeline.ts:** 3,884 lines (target: ~300-500 after refactor)

**Missing modules to create:**
- `types.ts` - Extract interfaces from pipeline.ts
- `moe.ts` - MoE routing and expert execution
- `logits.ts` - Logits computation
- `init.ts` - Initialization and model loading
- `weights.ts` - Weight buffer management

**Key risk:** Avoid duplicating logic between batched and non-batched paths. The `*Batched` methods should call the same core logic.

---

## Migration Checklist

### Phase 1: Wire Existing Modules

- [ ] **1.1 Wire `generate.ts`**
  - [ ] Review existing generate.ts, compare with pipeline.ts generate()
  - [ ] Update pipeline.ts to delegate to generate.ts
  - [ ] Remove duplicate code from pipeline.ts

- [ ] **1.2 Wire `prefill.ts`**
  - [ ] Review existing prefill.ts, compare with pipeline.ts _prefill()
  - [ ] Update pipeline.ts to delegate
  - [ ] Remove duplicate code

- [ ] **1.3 Wire `decode.ts`**
  - [ ] Review existing decode.ts, compare with pipeline.ts _decodeStep()
  - [ ] Update pipeline.ts to delegate
  - [ ] Remove duplicate code

- [ ] **1.4 Wire `layer.ts`**
  - [ ] Review existing layer.ts, compare with pipeline.ts _processLayerGPU()
  - [ ] Update pipeline.ts to delegate
  - [ ] Remove duplicate code

- [ ] **1.5 Wire `embed.ts`**
  - [ ] Review existing embed.ts, compare with pipeline.ts _embed()
  - [ ] Update pipeline.ts to delegate
  - [ ] Remove duplicate code

- [ ] **1.6 Wire `stats.ts`**
  - [ ] Review existing stats.ts
  - [ ] Update pipeline.ts to use stats module

- [ ] **1.7 Wire `stopping.ts`**
  - [ ] Review existing stopping.ts
  - [ ] Update pipeline.ts to use stopping module

- [ ] **1.8 Verify build and test**

### Phase 2: Extract Types

- [ ] **2.1 Create `types.ts`**
  - [ ] Extract GenerateOptions, LayerConfig, PipelineStats, etc.
  - [ ] Extract LayerWeights, ExpertWeights, RouterWeights
  - [ ] Update imports across all modules

### Phase 3: Extract Missing Modules

- [ ] **3.1 Create `moe.ts`**
  - [ ] Move _moeFeedForward(), _moeFeedForwardGPU()
  - [ ] Move _runExpertGPU(), _runExpert()
  - [ ] Move _isMoELayer(), _ensureExpertLoaded()
  - [ ] Move _gatherTokens()

- [ ] **3.2 Create `logits.ts`**
  - [ ] Move _computeLogits()
  - [ ] Move _rmsNormCPU(), _matmulCPU(), _layerNorm()

- [ ] **3.3 Create `init.ts`**
  - [ ] Move initialize(), loadModel()
  - [ ] Move _initRoPEFrequencies()
  - [ ] Move applyGemmaChatTemplate()

- [ ] **3.4 Create `weights.ts`**
  - [ ] Move _getWeightBuffer(), _getNormWeightBuffer()
  - [ ] Move _getGPUWeightBuffer()
  - [ ] Move isLayerWeights(), getLayerWeights()

### Phase 4: Consolidate Batched Logic

- [ ] **4.1 Refactor batched methods to call core logic**
  - [ ] _forwardBatched → calls layer.ts with recorder
  - [ ] _embedBatched → calls embed.ts with recorder
  - [ ] _attentionBatched → calls attention logic with recorder
  - [ ] Avoid separate parallel implementations

- [ ] **4.2 Move batched orchestration to `batched.ts`**
  - [ ] Only batched-specific orchestration code
  - [ ] Core compute stays in layer.ts, embed.ts, etc.

### Phase 5: Final Cleanup

- [ ] `pipeline.ts` becomes thin orchestrator (~300-500 lines)
- [ ] Update `index.ts` exports
- [ ] Update README
- [ ] Verify all tests pass
- [ ] Delete this plan file

---

## Target Structure

```
inference/pipeline/
├── index.ts          - Re-exports
├── types.ts          - All interfaces (NEW)
├── config.ts         - Config parsing (EXISTS, WIRED)
├── sampling.ts       - Sampling logic (EXISTS, WIRED)
├── generate.ts       - Generation loop (EXISTS, wire it)
├── prefill.ts        - Prefill phase (EXISTS, wire it)
├── decode.ts         - Decode step (EXISTS, wire it)
├── layer.ts          - Layer processing (EXISTS, wire it)
├── embed.ts          - Embedding (EXISTS, wire it)
├── stats.ts          - Performance stats (EXISTS, wire it)
├── stopping.ts       - Stop conditions (EXISTS, wire it)
├── moe.ts            - MoE routing/experts (NEW)
├── logits.ts         - Logits computation (NEW)
├── init.ts           - Initialization (NEW)
├── weights.ts        - Weight helpers (NEW)
├── batched.ts        - Batched orchestration (NEW, thin)
```

---

## Risk Mitigation

1. **Wire before extract** - Use existing modules first, then extract new ones
2. **One phase at a time** - Verify build after each step
3. **Batched consolidation** - Refactor batched to call core logic, not duplicate it
4. **Test after each phase** - Run inference to verify no regression
