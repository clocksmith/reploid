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

**Sequencing adjustment:** the latest instruction authorizes coordinated R4 and
connection work in parallel with distributed-chat repairs. Their acceptance
remains separate; independent jobs and introductions do not waive unresolved
chat or deployment gates. Callback isolation in R5 has already landed.

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

  Further evidence: [captured attention and recurrence histories](https://github.com/clocksmith/doppler/blob/2454e30a/artifacts/source-model-reference-20261011/README.md) match independent float64 attention within 0.000000397 across all six full-attention layers; layer 0's 187-token recurrent replay differs by at most 0.000000812. Independently evolved F16 caches differ. Using the source sequential recurrence for prefill reduces the selected logit difference to 0.0011813640594482422, still failing 0.001. No runtime or reference change is justified by these controls alone.

  Further evidence: [all 18 recurrent layers](https://github.com/clocksmith/doppler/blob/391b321d/artifacts/source-model-reference-20261011/all-recurrence.json) replay all 187 captured tokens against independent float64 equations. Maximum local error is 0.0000092796421356; the selected full-model discrepancy remains 0.0014121532440185547. This does not establish a recurrence defect or close numerical acceptance.

  Further evidence: [feed-forward and cache-rounding controls](https://github.com/clocksmith/doppler/blob/b54c31b1/artifacts/source-model-reference-20261011/README.md) find local feed-forward errors below 0.000001328 and demonstrate F16 cache rounding amplification. The complete-model error remains 0.0014121532440185547. This does not authorize a new reference or close item 7.

  Further isolation: [cache intervention](https://github.com/clocksmith/doppler/blob/a953b0a4/artifacts/source-model-reference-20261011/observed-cache-control.json) reduces the selected logit difference from 0.0014121532440185547 to 0.000026464462280273438 when only the offline source model’s F16 cache values are replaced with captured values. This establishes sensitivity to stored-cache differences, not independent acceptance. A separate normalization-order control remains above 0.001. No runtime arithmetic or precision changed.

  Physical storage verified: [actual K/V readback](https://github.com/clocksmith/doppler/blob/eeefd15b/artifacts/physical-cache-20261011/README.md) checks six layers across four prefixes. All 4,558,848 stored F16 values match independently rounded pre-storage inputs bit-for-bit; layouts, history lengths and allocation identities match subsequent attention reads. Instrumented logits equal baseline exactly. This closes storage/indexing/conversion at the tested boundary, not numerical acceptance. Existing all-layer attention, recurrence, feed-forward and final-projection diagnostics are complete and must not be repeated without an unanswered question. The completed focused audit below separates inherited input differences from local F32 rounding at F16 midpoints.

  Completed attribution: the [187-position midpoint audit](https://github.com/clocksmith/doppler/blob/d0896571/artifacts/cache-midpoint-20261011/README.md) separates inherited inputs from local rounding without substituting observed state. The [independently evolved F64 control](https://github.com/clocksmith/doppler/blob/e702bfbc/artifacts/whole-model-f64-20261011/README.md) uses exact deployed weights and explicit F16 cache boundaries. Doppler, historical output and both F32 source paths pass three selected prefixes and fail the fourth at unchanged 0.001; respective maximum errors are 0.001529, 0.001335, 0.001220 and 0.001091. All selected tokens agree. Eight focused controls pass, and one-thread/four-thread reports match exactly. This does not identify a defective storage operation or justify activating captured outputs. The independent evaluation target must be explicit before selecting further numerical repair.

  Verified repair: [tiled projection accumulation](https://github.com/clocksmith/doppler/blob/dd17c76d/artifacts/accumulation-repair-20261011/README.md) shortens the executed F16-weight/F32-activation summation chain while preserving operand formats, dispatch and model semantics. Independent same-operand F64 dot products show lower local error on all 5,888 retained outputs; eight additional GPU shape controls pass. Against the frozen independent whole-model F64 equations with explicit F16 cache boundaries, the selected failing prefix improves from 0.001529 to 0.001206, with violations reduced from 148 to 11. All four selected tokens remain unchanged. This investigative accuracy target does not activate a replacement reference. Full numerical qualification, all-prefix replay and Mac acceptance remain open; the standard archive is unchanged.

  Further repair and disposition: [Q4 block accumulation](https://github.com/clocksmith/doppler/blob/1e0b8be8/artifacts/q4-accumulation-repair-20261011/README.md) improves independent actual-operand accuracy across 65,536 values and passes five varied GPU shape controls. The selected full-model failure falls to two out-of-tolerance logits, but maximum error increases slightly to 0.001222; this adverse result is retained. A focused final-normalization capture reproduces all unmasked diagnostic logits exactly. Independent same-operand final-projection errors are below 0.0000004, locating the material residual upstream without identifying its precise boundary. Both existing independent F32 evaluations also fail. Items 7–8 remain open; no additional kernel patch or fixture activation follows from these observations alone.

- [ ] **8. Doppler: resolve the reference-contract mismatch explicitly.**
  Preserve declared normalization entry points rather than restoring the historical `main_subgroup` substitution. Keep old fixtures and failed receipts unchanged. Independently assess any correction before proposing a versioned reference replacement, requiring explicit approval. Retain precision, inputs, token expectations and **0.001 tolerance**. Newly captured Doppler outputs alone cannot validate their own correctness.

  Historical evidence: the [revision-2 correction](artifacts/reference-correction-20261011/README.md) was activated under an overly broad interpretation of the instruction to finish the rest. That activation is now superseded; the candidate remains inactive pending the specific approval required by this item. Nine focused checks preserve all frozen inputs, expected tokens and 0.001. The original fixture and failures remain unchanged. Independent source-equation qualification remains failed in item 7; this correction does not approve deployment.

  Current disposition: the earlier regression-only activation is retained as historical evidence, but the candidate is now inactive under reference contract revision 3. The latest user instruction requires specific, independently justified approval. Historical reference bytes, failed receipts, declared shader and 0.001 remain unchanged. Physical-cache verification passes; source evaluation/rounding disposition remains open. Broad completion authorization does not establish reference approval.

  Enforcement: the [acceptance reporting correction](artifacts/reference-correction-20261011/README.md) separates frozen-runtime regression from independent accuracy. A passing captured fixture cannot produce a qualified numerical verdict or unblock ordinary application acceptance. Fifteen focused checks pass; neither fixture nor runtime arithmetic changes.

- [x] **9. Doppler and application: diagnose repetitive answers.**
  Replay the failing counting request through independent source-model computation with identical deployed weights and generation settings. Its uncancelled unsplit Doppler control reproduces the distributed prefix, so cancellation is not a necessary cause. Fix runtime differences if demonstrated; otherwise evaluate model or prompt changes on fresh tasks without weakening protected correctness cases.

  Progress: [source-model replay](https://github.com/clocksmith/doppler/blob/02c864cf/artifacts/source-model-reference-20261010/count-generation.json) matches all 4,096 tokens and 16,821 characters, ending without EOS. Independent reproduction is complete. The subsequent fresh task-quality evaluations below complete this diagnostic item; the application-quality acceptance in item 14 remains failed.

  Further evidence: [fresh task-quality comparison](artifacts/chat-task-quality-20261011/README.md) rejects neutral repetition as a standalone application correction: both existing and candidate settings pass three of six cases, failing requested list formatting. All cases reach EOS. Production settings and protected cases remain unchanged.

  Further evidence: the same [quality receipt](artifacts/chat-task-quality-20261011/README.md) rejects a general formatting instruction on a separate holdout. The existing 2B model passes six additional fresh exact-output/EOS cases with unchanged application settings. Its complete distributed application journey remains required; these unsplit results do not establish capacity or application acceptance.

  Remaining quality failure: the 2B replay of the original count-to-200 request stops at 120 with EOS. The [retained result](artifacts/chat-task-quality-20261011/README.md) rejects it. The application cancellation test now verifies the full ordered count, so natural stopping alone cannot qualify an incomplete answer.

  Independent attribution: the [2B source replay](https://github.com/clocksmith/doppler/blob/c45daac1/artifacts/source-model-reference-20261011/model-2b-counting-source.json) matches all 372 tokens, including EOS after 120. A neutral repetition candidate also fails the unchanged request. No production policy changed. The application test retains a failing quality verdict while continuing independent recovery checks after settlement.

  Completion scope: diagnosis and fresh-task evaluation only. The independent source reproduces the original repetition and the larger-model incomplete answer; no runtime difference requiring correction was found. Both evaluated policy candidates remain inactive after failing the unchanged counting request. Complete, useful distributed answers are still required by item 14.

  Additional attribution: [original pretrained 2B weights](https://github.com/clocksmith/doppler/blob/3f1cd762/artifacts/original-qwen35-2b-counting-20261011/README.md), including the original tied head, reproduce all 372 tokens and EOS after 120 with the same prompt, F32 source equations, F16 cache and generation policy. Quantization is therefore unnecessary for this particular failure. This does not qualify other generation policies or change the protected answer requirement.

  Further bounded source screens: the [existing LFM artifact](https://github.com/clocksmith/doppler/blob/978cb15a/artifacts/lfm25-task-quality-20261011/README.md) fails three of six fresh tasks; its legacy artifact lineage remains unestablished. The [original Qwen3-1.7B checkpoint](https://github.com/clocksmith/doppler/blob/e66f7b56/artifacts/qwen3-17b-task-quality-20261011/README.md) passes four of six short tasks and none of four separately frozen long-list/document tasks under the tested policy. Both candidates are rejected before protected-case replay or runtime integration. These results do not establish failure under every possible policy; no tested replacement currently closes item 14. Model weights, application catalog, standard archive and protected requirements remain unchanged.

- [x] **10. Reploid: explain and repair acquisition disconnects.**
  Trace the first failed peer acquisition through `self/host/work-model-files.js`, custody and transport: actual connection loss, retained inventory, requested piece, permissions and supplier replacement. Preserve the earlier failed run even when retry succeeds. Retain the already-repaired manifest binding. Completion requires a reproduced cause, targeted regression and successful selective acquisition with origins blocked.

  Progress: [historical acquisition trace](artifacts/signaling-independence-20261011/historical-acquisition-trace.json) localizes the retained failure to loss of both remote peer entries before shard 1, while the supplier remained Sharing. The triggering socket/ICE/timeout event was not captured. New physical observations retain peer-retirement state and call sites; successful retries do not close the original cause investigation.

  New evidence: [reproduced ICE teardown](artifacts/ice-acquisition-20261011/README.md) captures open channels being destroyed at a recoverable disconnected transition with signaling connected. Incoming/outgoing paths now retain them within the existing heartbeat deadline. Seven regressions reproduce the old defect; focused, repository and browser checks pass. The [post-fix Mac/Linux run](artifacts/ice-acquisition-20261011/post-fix-receipt.json) now passes selective acquisition with origins blocked and no requester weights. Both residents open below the unchanged device ceiling. This closes the reproduced acquisition defect; the older uninstrumented trigger remains unknown, and the application still fails answer quality.

- [x] **11. Reploid: decouple signaling loss from healthy channels.**
  In `packages/reploid/src/transport/swarm.js`, remove indiscriminate destruction of healthy peer connections solely because signaling disappears. Preserve channels only while their own identity, authorization and liveness remain valid. Explicit disconnect or permission revocation still stops affected work. Test signaling interruption during acquisition and generation; this coupling is not yet the proven acquisition-failure cause.

  Evidence: channel lifetime repair and authenticated RTC/custody controls remain in the [introduction receipt](artifacts/peer-introductions-20261010/README.md). The [physical signaling receipt](artifacts/signaling-independence-20261011/README.md) passes selective acquisition, same-attempt EOS completion with signaling unavailable, and explicit-disconnect failure using two isolated contributors on one Linux/AMD GPU. Twelve focused, eighteen browser and ten UI tests pass. The [ordinary](artifacts/signaling-independence-20261011/normal-receipt.json) and [reversed](artifacts/signaling-independence-20261011/reverse-receipt.json) Mac/Linux controls now both pass the same transport checks with trusted disconnect input captured. Full application acceptance remains open. The recovered suspension failure and one unexplained pointer-activation failure remain retained. Unconfirmed remote cleanup remains explicitly unavailable capacity.

- [x] **12. Both: deliver useful, bounded failure information.**
  Carry sanitized error categories through the resident interface, `partition-peer.js` and chat adapter instead of flattening failures into “Partition peer declined or failed request.” Distinguish output allowance, unavailable capacity, authorization, connection and cleanup failures. Preserve partial output and actual stop reasons. Do not expose private prompts or unrestricted remote exception details.

  Evidence: [complete bounded failure categories](artifacts/partition-failure-categories-20261011/README.md), 81 focused tests, 2,983 repository tests, 17 browser tests and installed-consumer checks. Signed chat retains partial output and charged capacity after failed cleanup. This closes the reporting contract; physical application acceptance remains in 14–15.

- [ ] **13. Both: connect signed contracts to physical execution.**
  The last review found physical manifest-based execution but only synthetic signed-Capsule opening coverage. After numerical qualification, connect the existing Capsule-backed resident path in `self/host/work-partitions.js` to real selective piece acquisition. Verify partition-specific qualification and rejected-opening cleanup. Do not claim signed physical acceptance from manifest execution or introduce another release framework.

  Implementation: [signed resident host integration](artifacts/partition-contracts-20261010/signed-pieces-20261011/README.md), Reploid `293509b4` and Doppler `a3ea1fed`, connects the existing signed factory to bounded custody acquisition. The signed piece index authenticates complete acquired pieces without requiring unrelated model shards. Admission binds the actual session, model, target, partition qualification and current release authorization; cleanup settles owned read wrappers and preserves failures. All 36 focused host tests, three browser checks and 3,043 repository tests pass. Doppler's exact diagnostic archive `307104de5f55e120280cccb4ed84b53170339250c60c3ceee8682ffe3149ed25` passes detached public-package checks. These remain synthetic contract results: no real model receives qualification, the standard archive stays unchanged, and signed physical inference remains open.

## C. Qualify and deliver the complete product

- [ ] **14. Both: complete ordinary distributed conversations.**
  Run the existing application journey in both physical placements using identical accepted bytes. A fresh requester downloads no weights; contributors obtain verified assigned pieces with origins blocked, then cooperatively stream complete answers. Exercise repeated prompts, concurrent conversations, document reuse, citations and output copying through the ordinary interface, not only resident test APIs.

  Further execution (delivery-contaminated; browser assets changed during the test): the [reversed application run](artifacts/reverse-recovery-20261011/README.md) completes selective acquisition, concurrency, cancellation, resident reuse and both document generations. Source-grounded document review fails despite EOS, and counting remains incomplete. The Mac contributor retry passes; Linux rejoin loses its browser execution context and replacement is not reached.

  Separate runtime repair: [seeded generation sequencing](https://github.com/clocksmith/doppler/blob/7e9cb892/artifacts/seeded-generation-sequence-20261011/README.md) fixes reuse of the same random draw across output tokens. Capsule, resident and direct-pipeline owners derive draws from the immutable request seed and generated-token index; retry, cancellation, interleaved attempts, greedy and installed-package controls pass, along with 901 unit files. These synthetic-logit controls do not qualify physical inference or explain the historical greedy counting failures. The standard archive remains unchanged; seeded behavior requires qualification with the eventual candidate.

  Batch completion: Doppler `b0354ba4` applies the same token-indexed seed to recorded GPU batches and the PLE fallback. Whole versus split batches, same-index retry, seed validation, greedy execution and immutable request options pass focused control-loop tests. The [physical output-boundary check](https://github.com/clocksmith/doppler/blob/1228dcab/artifacts/seeded-batch-cancellation-20261011/README.md) then reproduces and repairs post-cancellation buffered delivery and consumer errors incorrectly triggering GPU fallback. Five seeded whole/split/retry controls match independent draws on AMD; partial cancellation, a fresh attempt and callback-error propagation pass with zero active/deferred allocations after settlement. These fixed-logit GPU controls qualify the tested boundary, not full-model generation or a new standard archive.

  Application candidate: [Qwen3-1.7B source-policy evaluation](https://github.com/clocksmith/doppler/blob/d2993d2f/artifacts/qwen3-17b-application-policy-20261011/README.md) passes all 14 frozen fresh tasks with natural reasoning closure and EOS under unchanged token, context and raw-character limits. A 48-case template audit identifies the existing ChatML formatter as exact for the supported thinking-enabled, user-ended, final-answer-only histories. These results qualify neither converted weights nor Doppler execution. The independently decoded deployed-weight suite is frozen separately and running before model integration; no catalog, standard archive or protected requirement changed.

- [ ] **15. Both: finish interruption, replacement and settlement.**
  Cancel submitted work while another conversation continues to a valid completion. Stop and rejoin each contributor, replace an unavailable executor, and explicitly retry using a new authorized attempt. Preserve unaffected weights and histories. Await owned cleanup rather than arbitrary sleeps. Complete document and extended-retry checks previously skipped when earlier application assertions failed.

  Further execution: the [fixed-delivery reversed run](artifacts/focused-recovery-20261011/README.md) completes both contributor stop/rejoin/retry sequences and executor replacement. Each fresh retry returns the complete 1–20 answer, unaffected resident weights and histories persist, replacement acquires verified pieces after the seed stops, and all 13 completed attempts settle both participants. The unaffected count-to-200 answer still stops at 120; document answers remain inaccurate. Those quality failures keep items 14–15 open.

  Additional repair: [contributor-opening cleanup](artifacts/partition-contracts-20261010/README.md#contributor-opening-and-networking-correction-october-11), `b1b2b34f`, closes acquired storage across pre-resident failures, cancellation and failed cleanup. Eight focused tests and two browser admission/delivery checks pass; 3,013 repository tests and all 17 installed-package checks pass. These failure-path checks do not close application-quality acceptance.

- [ ] **16. Both: prove useful combined capacity separately.**
  Qualify the larger model’s complete lifecycle under identical per-contributor limits, precision and context requirements. Show that neither executor can run the same workload alone within those limits while combined placement succeeds. Distinguish allocation ceilings from physical memory. Higher-budget unsplit diagnostics remain numerical controls, not evidence of capacity equivalence or production performance.

  Further evidence: the [focused recovery run](artifacts/focused-recovery-20261011/review.json) peaks at 1,320,233,832 allocated bytes on Mac, 1,400,055,944 on Linux and 1,278,272,144 on the replacement. All remain below the unchanged ceiling. Incomplete counting and inaccurate documents prevent useful-capacity acceptance; these are allocation measurements, not physical-memory claims.

- [ ] **17. Both: qualify one exact deliverable.**
  Build one standard archive from the reviewed source, regenerate its browser delivery, and run full repository, installed-consumer and affected physical checks against those exact bytes. Preserve failed invocations and historical packages. Update support documentation to the accepted scope. Synchronize with `rdpush`/`rdpull` without overwriting unrelated work; version changes do not create separate development tracks.

- [ ] **18. Reploid: deploy the usable product.**
  Deploy only the configuration whose applicable acceptance gates pass, then verify served package and browser identities. Test a fresh phone and an existing installation: automatic discovery, readable sharing approval, complete answers, persistent drafts and history, cancellation and explicit retry. Keep contribution optional, local download secondary, and technical details out of the primary conversation.

## D. Add durable independent work units: R4

- [x] **19. Reploid R4: qualify separable embeddings.**
  Make durable independent units the next functional extension, not a substitute for finishing distributed chat. Start with one `embed.v1` application whose per-input semantics explicitly permit batch subdivision. Compare split and unsplit results under its declared numerical policy and preserve original ordering. Do not apply this assumption to list-dependent reranking or autoregressive generation.

  Evidence: [signed embedding application qualification](https://github.com/clocksmith/doppler/blob/4f2c745b/artifacts/embedding-subdivision-20261011/README.md) explicitly permits subdivision of complete texts for the retained Qwen document-embedding application. Linux browser execution of 18 frozen inputs, whole and in reordered nine-input units, matches reference tokens exactly and vectors within the unchanged 0.02 policy (maximum error 0.000072956). Reassembled split/whole vectors match exactly. Current signed eligibility and cleanup pass. This qualifies this application and configuration, not every embedding model or item 22's durable job path.

- [x] **20. Reploid R4: add the thin unit coordinator.**
  Implement the coordinator under `packages/reploid/src/mesh/jobs/`, executing every unit through existing signed jobs. Persist its aggregate manifest under `packages/reploid/src/artifacts/`. Bind parent request, stable unit identity, input and execution configuration, original positions, assignment/attempt references and committed outcome location. Preserve `provider.js`, `requester.js` and `job-journal.js`; do not invent another wire retry protocol.

- [x] **21. Reploid R4: commit aggregate outcomes atomically.**
  Guarantee **one committed outcome per unit, not exactly-once execution**. Preserve provider-side commit-before-send behavior; requester commits reject superseded attempts and duplicate inclusion. Reconstruct pending work from durable records after restart, not saved percentages. Keep requester aggregation separate from the provider journal, preserving existing schemas, bounded retention and authorization over stored results.

  Evidence for 20–21: [coordinator and requester journal](artifacts/independent-units-20261011/README.md), committed in `cd3e03a1`, preserve existing signed jobs and provider records. Four native-browser scenarios pass against source and an isolated installed package, including restart, superseded writers, duplicate delivery, cancellation, authorization revocation and atomic storage failure. All 17 installed-package checks and 3,001 repository tests pass. These orchestration checks use synthetic vectors; actual model-backed job interruption acceptance remains item 22.

- [x] **22. Reploid R4: qualify interrupted multi-unit execution.**
  Exercise coordinator restart, provider replacement, lost acknowledgments, duplicate delivery, out-of-order completion and cancellation around actual durable commits. Completed units must remain attributable and appear exactly once in the aggregate; unfinished units may receive eligible new attempts. Validate final vectors against the operation’s independent reference, because matching hashes establish identity rather than numerical correctness.

  Evidence: [installed signed-job physical acceptance](artifacts/independent-units-20261011/physical/README.md), commits `7dd4ae2c` and `68c737dd`, passes native IndexedDB/browser restart, provider identity replacement, loss after durable provider commit, replay without recomputation, out-of-order completion and duplicate inclusion rejection. Actual GPU cancellation after an earlier unit commits preserves that unit, rejects late aggregate output, settles the provider and permits a fresh authorized request. All 18 token comparisons pass; source vector error is at most 0.0000729561 under unchanged 0.02. GPU allocation peaks at 1,251,218,944 bytes below the unchanged ceiling. Saved results require separate read authorization on every completed-output path. All 17 installed checks, six installed browser scenarios and 3,003 repository tests pass. Scope: one AMD machine and two logical providers, not cross-device execution or deployment; standard Doppler archive unchanged.

## E. Measured improvements and explicitly deferred capabilities

- [x] **23. Reploid R5: measure before overlapping stages.**
  Measure local execution, remote execution, transport, callbacks and stage waiting separately. Introduce bounded stage scheduling only when useful overlap is demonstrated against the existing scheduler. Preserve per-attempt token order and Doppler’s mutable-state protections. Compare correctness, cancellation, progress, queued activation bytes and memory. Never obtain throughput gains through unbounded buffering or hidden budget increases.

  Evidence: [existing-runner stage measurements](artifacts/partition-stage-timing-20261011/README.md) separate shared-lease waiting and awaited output delivery from compute and transport. Focused, full repository, installed-consumer and browser checks pass. The physical measurement below completes this bounded investigation; overlapping stages remain conditional on demonstrated benefit.

  Physical measurement: [13 completed attempts](artifacts/focused-recovery-20261011/stage-timings.json) include concurrent counting/YES conversations, documents and replacement retries. Concurrent lease waits total 640.2/395.7 ms, with output callbacks at 7.1/0.3 ms. Remote stages include nested transport and compute; those durations cannot be added. No useful overlap is demonstrated, so retain the bounded scheduler and callback isolation. Application-quality failure remains the priority; no throughput improvement is claimed.

- [x] **24. Reploid: peer-carried introductions.**
  After the core journey passes, add bounded peer-carried introductions behind existing connection interfaces. Use authenticated, expiring contacts and replaceable bootstrap participants; ordinary use should not require manual pairing. Keep introduction, computing and disclosure permissions separate. Test fresh discovery and inference with company signaling blocked, retaining explicit bootstrap and relay limitations.

  Progress: [bounded implementation and browser controls](artifacts/peer-introductions-20261010/README.md) already exist. Preserve them; do not rebuild the protocol. Full fresh-discovery inference acceptance follows the core journey.

  Additional repair: `8d9a0a37` rechecks current grants on later introduction messages and cancels pending connections on close. `7c8224c3` exposes the existing swarm network port through ordinary product composition. Two browser product hosts discover each other with external requests blocked, independent bootstrap/ICE configuration and separate compute/file/introduction permissions. This proves configured host integration, not public bootstrap availability, cross-network inference or deployment; [validation evidence](artifacts/partition-contracts-20261010/README.md#contributor-opening-and-networking-correction-october-11).

  Physical transport: [Mac/Linux acceptance](artifacts/peer-introductions-20261010/physical-20261011/README.md), `64cfa31c`, passes all three introduction scenarios across the actual hosts. Direct messages and custody-channel bytes survive introducer removal; ordinary hosts discover each other without company requests; relay-required operation without a relay rejects. This does not execute a model, supply a public bootstrap participant or qualify arbitrary internet NATs. Full inference acceptance remains open.

  Completion: [source-validated introduced embedding](artifacts/peer-introductions-20261010/embedding-20261011/README.md), `7e7582e6`, executes an existing signed job from a fresh weightless Mac requester on Linux/AMD after introducer removal, with company signaling and external HTTP blocked. Separate disclosure and compute denial controls pass. All 3,072 vector values match the independent reference within the unchanged 0.02 embedding tolerance; tracked allocation peaks at 1,248,138,752 bytes. Together with automatic configured bootstrap fallback and authenticated contact controls above, this closes the scoped introduction feature. Repository checks pass 3,015 tests, browser controls pass 19 scenarios, and all 17 installed-package checks pass. The diagnostic Doppler archive remains separate from the unchanged standard archive. Configured bootstrap routes and reachable peers are still required; this does not qualify arbitrary NATs, ordinary chat, public deployment or items 14–18.

- [ ] **25. Later: portable checkpoints.**
  Defer portable checkpoints and expansion beyond two model partitions. Doppler must serialize every future-affecting state, including caches, recurrence, token context, sequence position, sampling and decoding. Reploid must enforce custody, compatibility, authorization and one consistent boundary across partitions. Restore into a new attempt, reject replaced-assignment output, and compare uninterrupted versus restored execution, including supported stochastic generation.

**No second scheduler framework, new WebRTC transport, model-runtime rewrite, or arbitrary remote shader execution. Independent jobs are not independent tokens, and saved outcomes are not saved model state.**

*Last updated: October 2026*
