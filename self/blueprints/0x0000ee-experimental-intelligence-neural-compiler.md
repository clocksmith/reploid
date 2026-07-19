# Blueprint 0x0000ee: experimental intelligence neural compiler

**Objective:** Describe implementation for experimental/intelligence/neural-compiler.js.

**Target Upgrade:** experimental/intelligence/neural-compiler.js

**Affected Artifacts:** /experimental/intelligence/neural-compiler.js

---

### 1. Intent
Route tasks among LoRA adapters while preventing an externally trained adapter
from bypassing artifact, evaluation, and human-promotion gates.

### 2. Architecture

Ordinary local adapters retain the existing registration and routing path.
Tinker-attributed adapters use a separate path:

```text
Doppler identity and parity + Gamma selection
  -> stageTrainedAdapter
  -> Shadow registry state
  -> always-human HITL request
  -> hash-bound approval receipt
  -> loadAdapter eligibility
```

Gamma selection authorizes candidate competition only. It never authorizes
activation. Reploid verifies every receipt hash and every cross-receipt artifact
identity before staging.

### 3. Implementation Notes

- `reploid.trained-adapter-admission/v1` binds complete Doppler and Gamma
  receipts to the adapter manifest.
- Required determinism levels in the Gamma receipt must pass. Optional failed
  levels remain visible and do not acquire stronger names.
- `HITLController` must return a controller-owned human context. Missing HITL,
  autonomous mode, security-disabled mode, or candidate-provided approval data
  cannot auto-promote a trained adapter.
- The persisted human receipt binds adapter bytes and all three upstream
  receipt hashes. Activation revalidates it after registry reload.

### 4. Verification Checklist
- [ ] Behavior matches blueprint intent
- [ ] Dependencies are declared and available
- [ ] Tests or verification steps updated as needed
- [ ] A staged trained adapter cannot load
- [ ] Tampered Doppler, Gamma, manifest, or human receipts fail closed
- [ ] Human rejection leaves the adapter staged and inactive

*Last updated: March 2026*
