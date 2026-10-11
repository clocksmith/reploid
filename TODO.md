# Doppler–Reploid implementation checklist

**One track: finish dependable distributed chat, then add durable independent jobs through the same libraries.**

This is the canonical implementation checklist for both repositories. Doppler's
`TODO.md` links here; other plans describe contracts or historical evidence and
must not select a competing work queue. Check off an item only when its complete
acceptance passes, with an evidence link. Partial implementation stays unchecked.

The supplied checklist combines the specification with the review of **Doppler
`4fba3766` and Reploid `1326720d`, using Doppler 0.6.27**. That review was not a
fresh repository check. Checked items represent retained, scoped completion,
not full release acceptance. The specification predates several completed fixes.
Subsequent evidence is recorded beneath the relevant item without erasing failures.

**Sequencing adjustment:** finish unresolved distributed-chat acceptance before
starting R4 independent units. Callback isolation in R5 has already landed.

## A. Preserve the completed foundations

- [x] **1. Both: keep one implementation and explicit ownership.**
  Use one ordinary Doppler package and matching browser delivery, identified by archive digests rather than version names alone. Doppler owns computation and state; Reploid owns coordination, permissions, assignments and history; transport owns delivery. Keep existing layers and wire protocols. Record contract, physical execution, application quality and deployment acceptance separately.

  Evidence: both checked-out consumers retain the identical standard 0.6.27 archive, SHA-256 `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`; generated delivery and installed-consumer checks pass in the [failure-category receipt](artifacts/partition-failure-categories-20261011/README.md). Ownership and separately scoped acceptance remain unchanged.

- [x] **2. Reploid R1: preserve canonical identity validation.**
  Retain the shared binding in `partition-contract.js` and its use by `partition-step-receiver.js`. Validate all nine identity fields, requiring requester and placement fields together when supplied. Reject changed bindings during execution, duplicate handling, cancellation and settlement. Matching duplicates reuse retained results; changed inputs reject. Contributor replacement creates a new attempt.

- [x] **3. Doppler D1 / Reploid R2: preserve public contract authority.**
  Keep resident types authoritative through `doppler-gpu/partitions`; derive Reploid’s runtime-facing declarations from installed public exports. Preserve separate coordination types. Validate `generationDigest`, readiness, model, plan, index, layer range and required methods before admission. Keep `tests/contracts/doppler-partition-signed-opening.js` covering incompatible versions and rejected-program cleanup. Synthetic opening remains distinct from physical inference.

- [x] **4. Doppler D2 / Reploid R3: preserve honest recovery.**
  Retain `getRecoveryCapabilities()` with `inputReplay`, `checkpointExport` and `checkpointImport` false. Distinguish resuming artifact acquisition, replaying committed outcomes and starting a fresh attempt. None restores lost generation state. Recheck disclosure authorization before replay or restart; preserve previous partial output. A disconnected channel does not establish that remote GPU cleanup completed.

- [x] **5. Reploid R5: preserve callback isolation.**
  Keep awaited output delivery outside the shared execution lease in `partition-runner.js`. Each attempt retains ordered delivery and bounded backpressure, while a stalled consumer cannot hold another conversation’s GPU lease. Test delayed callbacks, rejection and cancellation together. This completed isolation change does not authorize concurrent mutation or establish faster stage overlap.

- [x] **6. Both: preserve scoped memory and lifecycle acceptance.**
  Retain the passing 494-token and repeated 1,588-token controls, submitted cancellation, allocation rejection, resident reuse and settled cleanup. Preserve the **1,420,000,000-byte per-device ceiling**. Distinguish resident weights, reusable pools, active attempt state and deferred destruction. These results cover the tested archive and placement; rerun affected controls after numerical or integration changes.

  Evidence for 2–6: [0.6.27 contracts and physical controls](artifacts/partition-contracts-20261010/README.md). These checks do not close sections B or C.

## B. Close the remaining execution and integration blockers

- [ ] **7. Doppler: isolate remaining numerical error.**
  The retained independent source control fails 34 of 55 Doppler comparisons; matching GPUs therefore cannot certify accuracy. Extend `tools/qwen35-deployed-reference.py` and existing probes to a failing decode prefix. Use identical deployed weights, input tokens and state, separating inherited differences from local operation error. Test one justified correction against complete comparisons.

  Progress: [independent deployed-weight controls](https://github.com/clocksmith/doppler/blob/02c864cf/artifacts/source-model-reference-20261010/README.md) include request 2 / decode step 3. The logit difference is 0.0014121532440185547. Actual-operand normalization and projection checks separate local rounding from inherited state; no sufficient correction is established.

  Further evidence: [captured attention histories](https://github.com/clocksmith/doppler/blob/cf252462/artifacts/source-model-reference-20261011/README.md) match independent float64 attention within 0.000000397 across all six full-attention layers. Independently evolved F16 caches differ. Using the source sequential recurrence for prefill reduces the selected logit difference to 0.0011813640594482422, still failing 0.001. No runtime or reference change is justified by these controls alone.

- [ ] **8. Doppler: resolve the reference-contract mismatch explicitly.**
  Preserve declared normalization entry points rather than restoring the historical `main_subgroup` substitution. Keep old fixtures and failed receipts unchanged. Independently assess any correction before proposing a versioned reference replacement, requiring explicit approval. Retain precision, inputs, token expectations and **0.001 tolerance**. Newly captured Doppler outputs alone cannot validate their own correctness.

- [ ] **9. Doppler and application: diagnose repetitive answers.**
  Replay the failing counting request through independent source-model computation with identical deployed weights and generation settings. Its uncancelled unsplit Doppler control reproduces the distributed prefix, so cancellation is not a necessary cause. Fix runtime differences if demonstrated; otherwise evaluate model or prompt changes on fresh tasks without weakening protected correctness cases.

  Progress: [source-model replay](https://github.com/clocksmith/doppler/blob/02c864cf/artifacts/source-model-reference-20261010/count-generation.json) matches all 4,096 tokens and 16,821 characters, ending without EOS. Independent reproduction is complete; fresh task-quality evaluation and a qualified application correction remain open.

- [ ] **10. Reploid: explain and repair acquisition disconnects.**
  Trace the first failed peer acquisition through `self/host/work-model-files.js`, custody and transport: actual connection loss, retained inventory, requested piece, permissions and supplier replacement. Preserve the earlier failed run even when retry succeeds. Retain the already-repaired manifest binding. Completion requires a reproduced cause, targeted regression and successful selective acquisition with origins blocked.

- [ ] **11. Reploid: decouple signaling loss from healthy channels.**
  In `packages/reploid/src/transport/swarm.js`, remove indiscriminate destruction of healthy peer connections solely because signaling disappears. Preserve channels only while their own identity, authorization and liveness remain valid. Explicit disconnect or permission revocation still stops affected work. Test signaling interruption during acquisition and generation; this coupling is not yet the proven acquisition-failure cause.

  Progress: channel lifetime repair and authenticated RTC/custody controls are retained in the [introduction receipt](artifacts/peer-introductions-20261010/README.md). Physical acquisition and generation interruption acceptance remains separate.

- [x] **12. Both: deliver useful, bounded failure information.**
  Carry sanitized error categories through the resident interface, `partition-peer.js` and chat adapter instead of flattening failures into “Partition peer declined or failed request.” Distinguish output allowance, unavailable capacity, authorization, connection and cleanup failures. Preserve partial output and actual stop reasons. Do not expose private prompts or unrestricted remote exception details.

  Evidence: [complete bounded failure categories](artifacts/partition-failure-categories-20261011/README.md), 81 focused tests, 2,983 repository tests, 17 browser tests and installed-consumer checks. Signed chat retains partial output and charged capacity after failed cleanup. This closes the reporting contract; physical application acceptance remains in 14–15.

- [ ] **13. Both: connect signed contracts to physical execution.**
  The last review found physical manifest-based execution but only synthetic signed-Capsule opening coverage. After numerical qualification, connect the existing Capsule-backed resident path in `self/host/work-partitions.js` to real selective piece acquisition. Verify partition-specific qualification and rejected-opening cleanup. Do not claim signed physical acceptance from manifest execution or introduce another release framework.

## C. Qualify and deliver the complete product

- [ ] **14. Both: complete ordinary distributed conversations.**
  Run the existing application journey in both physical placements using identical accepted bytes. A fresh requester downloads no weights; contributors obtain verified assigned pieces with origins blocked, then cooperatively stream complete answers. Exercise repeated prompts, concurrent conversations, document reuse, citations and output copying through the ordinary interface, not only resident test APIs.

- [ ] **15. Both: finish interruption, replacement and settlement.**
  Cancel submitted work while another conversation continues to a valid completion. Stop and rejoin each contributor, replace an unavailable executor, and explicitly retry using a new authorized attempt. Preserve unaffected weights and histories. Await owned cleanup rather than arbitrary sleeps. Complete document and extended-retry checks previously skipped when earlier application assertions failed.

- [ ] **16. Both: prove useful combined capacity separately.**
  Qualify the larger model’s complete lifecycle under identical per-contributor limits, precision and context requirements. Show that neither executor can run the same workload alone within those limits while combined placement succeeds. Distinguish allocation ceilings from physical memory. Higher-budget unsplit diagnostics remain numerical controls, not evidence of capacity equivalence or production performance.

- [ ] **17. Both: qualify one exact deliverable.**
  Build one standard archive from the reviewed source, regenerate its browser delivery, and run full repository, installed-consumer and affected physical checks against those exact bytes. Preserve failed invocations and historical packages. Update support documentation to the accepted scope. Synchronize with `rdpush`/`rdpull` without overwriting unrelated work; version changes do not create separate development tracks.

- [ ] **18. Reploid: deploy the usable product.**
  Deploy only the configuration whose applicable acceptance gates pass, then verify served package and browser identities. Test a fresh phone and an existing installation: automatic discovery, readable sharing approval, complete answers, persistent drafts and history, cancellation and explicit retry. Keep contribution optional, local download secondary, and technical details out of the primary conversation.

## D. Add durable independent work units: R4

- [ ] **19. Reploid R4: qualify separable embeddings.**
  Make durable independent units the next functional extension, not a substitute for finishing distributed chat. Start with one `embed.v1` application whose per-input semantics explicitly permit batch subdivision. Compare split and unsplit results under its declared numerical policy and preserve original ordering. Do not apply this assumption to list-dependent reranking or autoregressive generation.

- [ ] **20. Reploid R4: add the thin unit coordinator.**
  Implement the coordinator under `packages/reploid/src/mesh/jobs/`, executing every unit through existing signed jobs. Persist its aggregate manifest under `packages/reploid/src/artifacts/`. Bind parent request, stable unit identity, input and execution configuration, original positions, assignment/attempt references and committed outcome location. Preserve `provider.js`, `requester.js` and `job-journal.js`; do not invent another wire retry protocol.

- [ ] **21. Reploid R4: commit aggregate outcomes atomically.**
  Guarantee **one committed outcome per unit, not exactly-once execution**. Preserve provider-side commit-before-send behavior; requester commits reject superseded attempts and duplicate inclusion. Reconstruct pending work from durable records after restart, not saved percentages. Keep requester aggregation separate from the provider journal, preserving existing schemas, bounded retention and authorization over stored results.

- [ ] **22. Reploid R4: qualify interrupted multi-unit execution.**
  Exercise coordinator restart, provider replacement, lost acknowledgments, duplicate delivery, out-of-order completion and cancellation around actual durable commits. Completed units must remain attributable and appear exactly once in the aggregate; unfinished units may receive eligible new attempts. Validate final vectors against the operation’s independent reference, because matching hashes establish identity rather than numerical correctness.

## E. Measured improvements and explicitly deferred capabilities

- [ ] **23. Reploid R5: measure before overlapping stages.**
  Measure local execution, remote execution, transport, callbacks and stage waiting separately. Introduce bounded stage scheduling only when useful overlap is demonstrated against the existing scheduler. Preserve per-attempt token order and Doppler’s mutable-state protections. Compare correctness, cancellation, progress, queued activation bytes and memory. Never obtain throughput gains through unbounded buffering or hidden budget increases.

- [ ] **24. Reploid: peer-carried introductions.**
  After the core journey passes, add bounded peer-carried introductions behind existing connection interfaces. Use authenticated, expiring contacts and replaceable bootstrap participants; ordinary use should not require manual pairing. Keep introduction, computing and disclosure permissions separate. Test fresh discovery and inference with company signaling blocked, retaining explicit bootstrap and relay limitations.

  Progress: [bounded implementation and browser controls](artifacts/peer-introductions-20261010/README.md) already exist. Preserve them; do not rebuild the protocol. Full fresh-discovery inference acceptance follows the core journey.

- [ ] **25. Later: portable checkpoints.**
  Defer portable checkpoints and expansion beyond two model partitions. Doppler must serialize every future-affecting state, including caches, recurrence, token context, sequence position, sampling and decoding. Reploid must enforce custody, compatibility, authorization and one consistent boundary across partitions. Restore into a new attempt, reject replaced-assignment output, and compare uninterrupted versus restored execution, including supported stochastic generation.

**No second scheduler framework, new WebRTC transport, model-runtime rewrite, or arbitrary remote shader execution. Independent jobs are not independent tokens, and saved outcomes are not saved model state.**

*Last updated: October 2026*
