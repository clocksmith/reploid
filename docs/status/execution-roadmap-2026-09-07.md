# Reploid & Doppler Execution Roadmap: September 7, 2026

**Status:** Active Canonical Roadmap  
**Head Revisions:** Reploid `bdf9d639`, Doppler `24d33a48`  
**Prerequisite Boundary:** History-based scheduling and distributed MoE remain deactivated until Milestones 1–5 are proven with physical evidence.

---

## The 5-Step Finish-Line Sequence

```text
[1. Answer Quality & Contradiction Decoupling]
                      │
                      ▼
[2. Physical Remote LoRA (2 Independent Machines)]
                      │
                      ▼
[3. Borrowed Compute (3-Tier Task Privacy)]
                      │
                      ▼
[4. Four-Machine P2P Acquisition Proof (Hostile / Offline)]
                      │
                      ▼
[5. Coding Adapter Promotion, AMD Startup & Operator Adoption]
                      │
                      ▼
[GATED: History-Based Scheduling & Distributed MoE]
```

---

### Milestone 1: Fix Assistant Answer Quality Without Changing Acceptance Rules
*Immediate Blocker / Active Work*

Prompt-only shortening was rejected (2/8 pass rate; format echoing, uncited claims, and contradiction failures remained). We halt prompt-only tuning and isolate each dimension independently while keeping acceptance rules frozen:

- [ ] **1.1 Retrieved Context Construction:**
  - Structure retrieved passages with explicit provenance and temporal metadata.
  - Tag detected fact collisions (e.g. conflicting dates/numbers in the roof and team cases) during context assembly rather than requiring implicit generation reasoning.
- [ ] **1.2 Decoding & Sampling Controls:**
  - Integrate presence penalty and repetition penalty window tuning in Doppler text sampling (`src/inference/pipelines/text/sampling.js`).
  - Isolate sampling parameters (`topP`, `topK`, `temperature`, greedy thresholds) specifically for citation emission.
- [ ] **1.3 Decoupled Contradiction & Abstention Classification:**
  - Introduce an explicit pre-generation support-check stage classifying query state: `[SUPPORTED, PARTIAL, CONFLICT, UNSUPPORTED]`.
  - For `CONFLICT` and `UNSUPPORTED`, bind the exact frozen contract strings without relying on model hallucination resistance.
- [ ] **1.4 Verification on Exposed Dev Cases (8 Cases):**
  - Verify all 8 development cases pass the unmodified structural citation and abstention rules without prompt example copying.
- [ ] **1.5 Untouched Held-Out Semantic Qualification:**
  - Run inference on held-out test cases with independent human/semantic review.

---

### Milestone 2: Close Physical Remote LoRA
*Two-Machine Distributed Generation Contract*

Transition from simulated Capsule handoffs to physical multi-node verification:

- [ ] **2.1 Dual-Machine Peer Setup:**
  - Machine A (Base + LoRA), Machine B (Base only).
- [ ] **2.2 Adapter Custody Transfer:**
  - Machine B requests adapter from Machine A over WebRTC data channel, validates SHA-256 byte digest, and compiles PEFT layer in WebGPU.
- [ ] **2.3 Fault-Tolerant Transfer:**
  - Interrupt data channel mid-transfer; verify resume from OPFS cache without re-downloading verified chunks.
- [ ] **2.4 Process Restart & Completion Replay:**
  - Kill browser process on receiver; verify attempt persists and replays without recomputation.
- [ ] **2.5 Adapter Ownership Reversal:**
  - Machine A requests adapted task from Machine B, demonstrating symmetric peering.

---

### Milestone 3: Finish Borrowed-Compute Assistant
*Strict 3-Tier Task Privacy Boundary*

Prove that private user data never egresses the local browser while enabling remote execution:

- [ ] **3.1 Task Class Partitioning:**
  - `local-only`: Ingest, text chunking, local embeddings, vector search, private citations.
  - `derived-remote`: Anonymized derivative payloads with explicit preview modal and consent invalidation upon prompt change.
  - `public-remote`: Public protein/scientific jobs (ESM-2) delegable across the pool.
- [ ] **3.2 End-to-End Two-Host Validation:**
  - Verify local private retrieval + remote WebRTC execution + local answer composition across two distinct operators.

---

### Milestone 4: Four-Machine Acquisition Proof
*Hostile / Origin-Disabled P2P Swarm*

Fulfill the canonical `GOALS.md` acquisition proof:

- [ ] **4.1 Swarm Topology:**
  - 3 supplier peers hosting verified model/adapter shards.
  - 1 clean requester peer.
  - Origin server and CDNs completely disabled (`offline-only`).
- [ ] **4.2 Adversarial Invariants:**
  - *Corruption rejection:* Supplier 1 emits corrupted bytes; Requester detects hash failure and drops Supplier 1.
  - *Supplier departure:* Supplier 2 disconnects mid-stream; Requester re-routes to Supplier 3.
  - *Clean execution:* Requester completes artifact reconstruction in OPFS and executes passing inference.

---

### Milestone 5: Useful Coding Adapter, AMD RADV Diagnosis & Operator Adoption

- [ ] **5.1 Genuinely Useful Coding LoRA:**
  - Train and promote an adapter on an objective benchmark (e.g. WGSL repair) demonstrating measurable gain over base Qwen.
- [ ] **5.2 AMD Chromium Startup Diagnosis:**
  - Trace WebGPU device initialization on Linux/RADV to eliminate intermittent adapter drops.
- [ ] **5.3 Independent Repeat-Use Records:**
  - Gather documented adoption evidence from unrelated human operators.

---

### Gated Architecture (Do Not Implement Until 1–5 Are Complete)

* **History-Based Scheduling:** Inactive until heterogeneous execution records prove predictive advantage over random/load-based placement.
* **Distributed MoE:** Inactive until intermediate tensor disclosure, remote expert routing, and replication are fully specified and tested.
