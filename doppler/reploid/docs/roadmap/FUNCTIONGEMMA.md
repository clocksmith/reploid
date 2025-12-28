# FunctionGemma Integration Roadmap

**Scope:** Reploid orchestration for multi-FunctionGemma via Doppler primitives.
**Design doc:** [FUNCTIONGEMMA.md](../design/FUNCTIONGEMMA.md)

---

## Current Status Notes (Dec 2025)
- Doppler primitives available: `MultiModelLoader`, `MultiPipelinePool`, `MultiModelNetwork`, `MultiModelRecorder`
- Reploid wiring complete: routing, expert pool, validation, evolution all integrated

## Phase 1: Basic Integration ✓
- [x] Doppler primitives available for orchestration
- [x] Add `routeToExpert()` to SemanticMemory
- [x] Add `runExpertPool()` to ArenaHarness
- [x] Create FunctionGemmaOrchestrator skeleton

## Phase 2: Context Sharing ✓
- [x] Add KV prefix support to ContextManager (`initSharedPrefix`, `getExpertContext`)
- [x] Wire up `getExpertContext()` calls

## Phase 3: Evolution ✓
- [x] Add genome storage to ReflectionStore (`storeNetworkGenome`, `getBestGenome`)
- [x] Implement UCB1 adapter selection (`selectAdapterUCB1`, `updateAdapterStats`)
- [x] Add evolution loop to orchestrator (`evolveTopology`)

## Phase 4: Production ✓
- [x] Benchmark routing latency (`benchmarkRoutingLatency`, `getRoutingStats`)
- [x] Add error recovery (`recordError`, error tracking in `execute()`)
- [x] Integrate with agent loop

## Phase 5: Temporal Self-Ring ✓
- [x] Add `executeTemporalRing()` to Doppler `MultiModelNetwork`
- [x] Add `executeTemporalSelfRing()` to FunctionGemmaOrchestrator
- [x] Add `executeMobiusRing()` variant with small-world shortcuts
- [x] Add convergence detection and history tracking
- [x] Document in MULTI_FUNCTIONGEMMA.md (Section 2.5)

Research basis:
- Gödel Agent (arXiv:2410.04444): Self-referential recursive self-improvement
- RISE (arXiv:2407.18219): 8-24% improvement over 5 turns via multi-turn introspection
- Reflexion: Linguistic self-reflection between episodes
- Small-World Networks (arXiv:2512.18094): Shortcuts stabilize consensus
