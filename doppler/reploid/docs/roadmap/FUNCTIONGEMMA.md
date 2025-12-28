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

## Phase 4: Production
- [ ] Benchmark routing latency
- [ ] Add error recovery
- [ ] Integrate with agent loop
