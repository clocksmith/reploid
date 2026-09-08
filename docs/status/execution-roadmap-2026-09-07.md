# Reploid & Doppler Execution Roadmap: September 7, 2026

**Status:** Active Canonical Roadmap  
**Named reported test target (user inspection only):** Doppler `b47d1f5d712e8ffdbb2ef2676fb201b5bea43e8f`, Reploid `c27298c259dd80e58625d0d55a2685cd8120b05d`
**Prerequisite Boundary:** History-based scheduling and distributed MoE remain deactivated until Milestones 1–5 are proven with physical evidence.

The September 8 user direction supersedes the earlier instruction to build a
pre-generation answer-state classifier. Repair the sentence-level generation
contract, then qualify the existing assistant. Cleanup is limited to defects
the qualified-answer and connected physical journeys expose.

The user inspected the named revisions, not their physical evaluations. The
reported 7/8 result remains unverified development progress. Its raw answers and
exact run configuration must be retained and reviewed before qualification.
Later commits and working-tree changes require their own
byte-bound evidence; ancestry does not transfer certification.

The [September 8 shared-contract evidence](../../artifacts/generation-contract-2026-09-08/README.md)
records the installed-package and physical operator checks separately from
answer qualification. Its candidate package has not been published or admitted
as Reploid's checked-in dependency. Milestone 1 remains incomplete.

---

## The 5-Step Finish-Line Sequence

```text
[1. Sentence Citations & Independent Answer Qualification]
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
[5. Separate Adapter Usefulness, Startup & Adoption Experiments]
                      │
                      ▼
[GATED: History-Based Scheduling & Distributed MoE]
```

---

### Milestone 1: Fix Assistant Answer Quality Without Changing Acceptance Rules
*Immediate Blocker / Active Work*

The reported 7/8 development result supports a bounded generation-contract
repair. The eight exposed cases remain development data.

- [ ] **1.1 Sentence-level contract:** One supported claim per cited sentence;
  allow multiple cited sentences and an explicit missing-information statement.
  Prevent an uncited opening through general generation instructions. No
  question-specific branch, output deletion, or unsupported citation insertion.
- [ ] **1.2 Review every development answer:** Inspect all factual claims against
  their cited passages and every requested part for completeness. In particular,
  `partial-deadline` must handle unknown throughput, `partial-storage` must handle
  unknown capacity, and `contradiction-port` must represent the disagreement.
  Preserve existing permitted complete abstentions and report their usefulness
  separately. Citation syntax alone is not semantic acceptance.
- [ ] **1.3 Preserve output identity:** Retain raw generation, token IDs, prompts,
  settings, receipts, and passage identities. Identify any application formatting
  separately from model output; never replace the raw observation.
- [ ] **1.4 Freeze the candidate:** Bind model and adapter bytes, compatibility,
  prompt, sampling settings, runtime/package and served-source identities,
  browser/device, and unchanged acceptance rules before untouched evaluation.
- [ ] **1.5 Blind independent qualification:** An independent reviewer sees the
  questions, passages, raw answers, and frozen rubric without configuration
  identities. Retain the hidden configuration mapping and reveal it only after
  review is sealed. A failed holdout is retained; further tuning requires a new
  untouched evaluation. An agent review is not human/operator qualification.

---

### Milestone 2: Close Physical Remote LoRA
*Two-Machine Distributed Generation Contract*

Use the same frozen model and adapter that pass Milestone 1. One episode must
connect these boundaries on two physical computers:

- [ ] **2.1 Dual-Machine Peer Setup:**
  - Machine A (Base + LoRA), Machine B (Base only).
- [ ] **2.2 Adapter Custody Transfer:**
  - Acquire only missing adapter bytes, verify byte digests and base/adapter
    compatibility, then execute the exact approved task and persist completion.
  - Record actual transferred bytes by base, adapter, metadata, retry, and
    rejected contribution; establish base reuse from zero base-weight transfer.
- [ ] **2.3 Fault-Tolerant Transfer:**
  - Interrupt data channel mid-transfer; verify resume from OPFS cache without re-downloading verified chunks.
- [ ] **2.4 Process Restart & Completion Replay:**
  - After completion is persisted, lose the connection or restart the receiver,
    then replay the saved output and receipt with their original identities.
  - Count actual Doppler execution calls before and after recovery. A repeated
    response must leave that count unchanged; a matching answer alone is not
    proof of replay. Preserve failed and incomplete attempts separately.
- [ ] **2.5 Adapter Ownership Reversal:**
  - Reverse ownership: Machine B supplies the adapter and approved execution to
    Machine A. Retain the same artifact identities, byte accounting, persistence,
    and replay checks in the reversed direction.

---

### Milestone 3: Finish Borrowed-Compute Assistant
*Strict 3-Tier Task Privacy Boundary*

Extend the same qualified two-machine setup to test the declared privacy boundary:

- [ ] **3.1 Task Class Partitioning:**
  - `local-only`: Ingest, text chunking, local embeddings, vector search, private citations.
  - `derived-remote`: Anonymized derivative payloads with explicit preview modal and consent invalidation upon prompt change.
  - `public-remote`: Public protein/scientific jobs (ESM-2) delegable across the pool.
- [ ] **3.2 End-to-End Two-Host Validation:**
  - Verify local private retrieval + approved remote WebRTC execution + local
    answer composition across two distinct operators. Capture transmitted
    payloads and prove exact preview/recipient/model binding and invalidation.

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

### Milestone 5: Separate Adapter Usefulness, Startup & Operator Adoption Experiments

Keep adapter usefulness and startup reliability as separate experiments with
their own frozen controls and acceptance; a connected journey does not establish
either claim by itself.

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

*Last updated: September 2026*
