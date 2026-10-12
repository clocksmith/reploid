# Reploid, Doppler, and Doe implementation checklist

**Goal: a clear, usable Reploid conversation interface that reliably runs one model across multiple physical computers through one standard Doppler package.** The requester downloads no model weights. Discovery, preparation, permission, streaming, stopping and recovery belong to the same ordinary conversation journey.

This is the single cross-project implementation queue; evidence stays in its owning repository. Checked means the stated scope is complete, including a completed rejection. Partial acceptance stays unchecked. “Retained” means inspected existing evidence, not a new hardware run. Each open item names the next delta and its completion condition.

**Active priority (2026-10-11): finish the distributed conversation product.** The five steps below are the working order, linked to the existing item IDs. The seven ownership sections retain evidence and deferred work; their document order does not schedule work.

1. **Finish the existing conversation UI — [REP-7](#rep-7).** Walk the actual application on desktop and phone-sized browsers through empty, unavailable, preparing, permission, streaming, stopping, interrupted and completed states. Keep the composer visible, approvals readable, messages stable and the next action clear. Preserve the recent compact status, header Actions, phone guidance and thread drawer. Fix observed failures in existing components; do not redesign navigation or build another diagram/dashboard.
2. **Connect that UI to real distributed execution — [REP-5](#rep-5), [DR-3](#dr-3), [DR-5](#dr-5).** From a fresh requester: automatically discover eligible capacity, choose the model, approve the actual disclosure, acquire only the executors' assigned verified pieces and stream one complete answer. At least two physical executors must perform complementary model partitions. No invitations, manual computer selection, requester weights or hidden fallback to whole-request execution. Trace and repair the first broken boundary in this journey.
3. **Make that answer correct and useful — [DOP-6](#dop-6), [DR-4](#dr-4), [DR-5](#dr-5), [ALL-4](#all-4).** Use the explicitly approved independent F64 contract, preserve 0.001 and manifest enforcement, and fix demonstrated computation errors in Doppler. Diagnose the failed original-weight document answers separately; do not repeat completed experiments or select a lucky seed. Use one already authorized model/configuration and a standard package. This work proceeds alongside UI/integration repairs; failed runtime qualification blocks promotion, not useful local UI work.
4. **Make continuing and recovering work — [REP-4](#rep-4), [REP-6](#rep-6), [DR-5](#dr-5).** Run two conversations, switch while streaming, stop one, lose a contributor, replace it and explicitly retry. Preserve drafts, earlier partial answers, completed history and the other conversation. Verify actual settlement and successful resident reuse. Repeat 1,588-token prompts within 1,420,000,000 allocated bytes, including rejection and cancellation, without trimming inputs or reopening weights to manufacture a pass.
5. **Ship and verify this exact experience — [DR-1](#dr-1), [ALL-3](#all-3), [ALL-6](#all-6).** Once the applicable gates pass, install the single standard archive, build browser delivery from it and deploy the tested application. Verify served identities, fresh and returning users, saved drafts/history and a successful distributed answer after interruption. Passing fixtures alone does not close this step.

**Start here:** REP-7's real application walkthrough, then repair its largest observed obstacle and connect the same flow to physical executors. Record UI-only and mocked results honestly. Use browser/device simulation while physical phones or unfamiliar users are unavailable; do not label those checks human observation. Coordinate remote execution under ALL-2 and use the heavy Linux host for heavy diagnostics and Suby as an additional physical node when compatible. A remote host being reachable does not mean its GPU is free.

**Current blockers:** the newest separately identified normalization/projection candidate still fails the approved F64 target: AMD 5/55 prefixes (maximum 0.00222172), Mac 12/55 (maximum 0.00261702), at unchanged 0.001. The exact archive is `10704208fc5562f22db77dcb29a021a6ce3eb9fcb9772959ef830ee3d0ae681c`; it is not the accepted application pin. [Retained candidate and causal audits](https://github.com/clocksmith/doppler/blob/main/artifacts/source-prefix-correction-20261012/README.md) preserve the earlier failures. Original-weight document answers remain factually unreliable; signed physical opening and exact replacement release acceptance remain open. Reference authority is settled. No dependency or public deployment changed.

**Deferred until this journey works:** durable indexing (REP-2/3), scoring expansion (DR-2), W8A8 measurements/candidates (DOP-4/7), Doe/compiler/provider research (DOE/DD/ER), learned placement (ALL-8), new models and new architecture. Existing embedding/scoring functionality stays intact. These are not prerequisites for distributed chat. After this milestone, DR-6 evaluates a larger model that benefits from combined capacity through the same interface.

**Evidence history:** the initial audit at Reploid `dd4e1275`, Doppler `b7b94713` and Doe `50f118901` covered source and retained receipts, with offline projection and archive checks. Later physical/source results are linked under DOP-6 and DR-4/5. Completed experiments remain recorded even when they rejected the capability.

**Latest execution (2026-10-12):** the [ordinary conversation run](artifacts/live-conversation-20261012/README.md) now completes browser/browser and browser/native (Suby + actual Node/Dawn on x@128) requests with no requester weight downloads. Both pairs pass isolated cancellation; native replacement, a separately approved retry, 15-second permission review, actual RTC reconnection, and a successful follow-up have physical receipts. The [native participant](artifacts/native-participant-20261012/README.md) owns selective verified reads, resident reuse and provider settlement. UI repairs preserve drafts and history, keep attachment serialization out of titles, show both partition recipients, and distinguish observed remote preparation from unavailable capacity. A fresh empty-cache Node host acquired all 75 assigned pieces over signed browser custody and completed the ordinary $36/$48 conversation with retained weights; browser↔Node file supply is separately verified. This is not frozen release acceptance: numerical and document-quality failures, signed physical Capsule opening, long-prompt revalidation and deployment remain open. Recheck live process ownership before scheduling GPUs; the cold native host has settled all four requests and exited after unload/device destruction, releasing AMD. Browser participants remain available. A browser output replacement required fresh approval and correctly continued the saved ticket conversation ($60), preserving all prior messages. Twelve final browser interaction/layout checks pass; their initial fixture failures are retained.

## 1. Doppler only: computation, numerical correctness, and packaging

Doppler owns preparation, executable packages, tensor contracts, sampling, and generation state. It remains usable without Doe or Reploid. Active work here is DOP-6 and package correctness needed by DR-5; projection research remains deferred.

<a id="dop-1"></a>
- [x] **DOP-1 — W8A8 projection foundation.** Retain symmetric signed quantization, per-channel weight scales, per-token activation scales, bounded I32 accumulation, and ordered F32 rescaling. JSON declares policy; conversion emits weights; JavaScript orchestrates; WGSL packs activations and computes. This qualifies linear projections, not an entire model. Evidence: [conversion][dop-conversion], [operator controls][dop-operators], and `src/gpu/kernels/w8a8.js` in Doppler.

<a id="dop-2"></a>
- [x] **DOP-2 — Independent projection and scoped lifecycle acceptance.** Retained portable/packed controls cover quantization, packing, integer accumulators, output bits, boundaries, padding, invalid inputs, cancellation, resident reuse, and settled cleanup. The final candidate's 668,488,920-byte accounted peak is neither process RAM nor physical GPU residency. Preserve completion versus cancellation distinctions and the 1,420,000,000-byte ceiling. Evidence: [operators][dop-operators], [installed lifecycle and quality][dop-quality], [candidate record][dop-package].

<a id="dop-3"></a>
- [x] **DOP-3 — Complete the Gemma quality rejection.** Installed variants agree but pass only 4/12 frozen tasks against the 10/12 requirement and fail the F16-relative likelihood allowance. Independent source W8 passes 5/12 and also fails. This experiment is complete; Gemma W8A8 remains rejected. Evidence: [quality disposition][dop-quality]. Do not turn implementation agreement into model acceptance.

<a id="dop-4"></a>
- [ ] **DOP-4 — Finish missing frozen measurements. Partial; paused at user-priority handoff.** All four F16-versus-packed cases completed with ten pairs each. Packed complete-operation median paired ratios are approximately 2.16–2.39 times F16: slower, on these unqualified fixed-prefix workloads. Q4 stopped after five complete pairs in its first case; portable was not started. [Batch disposition][dop-benchmark] retains the controlled stop, all samples, and the failed both-resident attempt.

  If this measurement batch is resumed in an assigned window: use `tools/w8a8-benchmark-scenario.js` with the retained benchmark contracts; record a continuation identity, complete remaining Q4 coverage and portable comparisons without silently pooling incompatible sessions. Keep serialized residency and equal reuse; include quantization, packing, rescaling, submission, required completion/readback in the declared operation. Report loading/warmup separately. Completion requires all planned cases and adverse results retained, not a speed win or model promotion. No native provider claim follows from these quantization comparisons.

<a id="dop-5"></a>
- [x] **DOP-5 — Freeze and validate the projection exporter.** Already implemented in `tools/export-w8a8-projection.js`. [Projection handoff][dop-export] contains deterministic F32 operands, scales, packed bytes, expected I32 intermediates, intermediate/final F32 bits, exact installed WGSL, layouts, constants, bindings, dispatches, and identities. Synthetic query shape is M=1, N=1024, K=640; seed 7331. Fresh offline test and all payload hashes pass in this audit. No new GPU evidence is implied. Retain for deferred DD-1; this handoff is not needed to finish distributed chat.

<a id="dop-6"></a>
- [ ] **DOP-6 — Resolve distributed numerical accuracy. Failed gate; next hypothesis must be explicit.** [Complete 55-prefix comparison][dop-numerical] rejects all retained candidates at unchanged 0.001. Local F16 projection accuracy improved, but the Q4 addition worsened maximum full-model error; neither qualifies. Physical cache readback, attention, recurrence, normalization, and projection investigations already exist—do not rerun them without a new question.

  Fresh [target-compatibility check](https://github.com/clocksmith/doppler/blob/main/artifacts/reference-target-compatibility-20261011/README.md): 174 logits across three frozen prefixes place the historical and independent F64 targets more than 0.002 apart. At the worst coordinate, no value can be within 0.001 of both (minimum possible worst error 0.00161574). This proves incompatible simultaneous targets, not a passing implementation or automatic reference authority. The user subsequently approved the unchanged independent F64-equation contract under ALL-4; this does not qualify a failing implementation.

  Numerical handoff: the user approved the exact existing [F64 proposal and three contracts](https://github.com/clocksmith/doppler/blob/main/artifacts/whole-model-f64-complete-20261011/approval.json). Reploid now assembles all 55 hash-bound independent vectors without rounding them to F32. Historical captures still supply the unchanged workload/continuations and remain regression evidence. The accepted numerical target uses exact deployed weights, independently evolved state and nearest-even F16 KV stores. Runtime precision and 0.001 remain unchanged. Existing candidates still fail; next isolate a justified correction against this target, then run both placements.

  Next: use the retained failed-prefix and midpoint evidence to specify one unresolved upstream boundary and an independent same-operand test. Separate F64 mathematical accuracy from conformance to a specified F32 evaluation, including materialization, reduction order, fusion, and F16 cache boundaries. Keep manifest normalization enforced. Test a single correction locally, then the unchanged complete comparison. Historical captures cannot become their own oracle. A changed acceptance reference requires independent justification and explicit approval (ALL-4); Mac/directional acceptance belongs to DR-4.

<a id="dop-7"></a>
- [ ] **DOP-7 — Require a cause before another W8 quality candidate. Not selected.** After DOP-4, identify a specific quantization or quality mechanism from [actual-operand/source comparisons][dop-quality], rather than adjusting policy until old tasks pass. Freeze a new hypothesis, identity, independent checks, and fresh quality cases. Preserve model constants and the rejected candidate. No new model family, quantization policy, or numerical substitution is authorized by an operator speed result.

<a id="dop-8"></a>
- [x] **DOP-8 — Exact candidate record and repository checks.** [Candidate record][dop-package] binds archive SHA-256 `7c240dad…`, version 0.6.27, installed receipts and package inventory. [Frozen-source repository sweep][dop-checks] passed, including 917 unit files. Subsequent exporter controls pass separately. [Core-operation checks][dop-core] retain successful embedding/scoring apart from failed generation qualification. These are archive hash prefixes, not Git commits. No archive promotion, publication, or Reploid pin change follows. Keep the record current only when owned bytes change.

## 2. Doe only: compiler completeness and attributable Vulkan improvements

Doe owns general WGSL compilation, native execution, resources, synchronization, and diagnostics. Gemma quantization policy stays in Doppler. **This section is deferred for the current distributed-chat milestone.**

<a id="doe-1"></a>
- [x] **DOE-1 — Packed-operation correctness.** [Retained compiler and AMD/Vulkan controls][doe-packed] cover signed/unsigned packing, clamping, unpacking, dot products, constant expressions, and single argument evaluation. Preserve normalized-packing repairs and failed Dawn tie controls separately. Portable integer lowering remains the baseline; hardware acceleration and physical Metal/D3D12 support are not established by it.

<a id="doe-2"></a>
- [ ] **DOE-2 — Smallest qualified mixed-compiler boundary. Source gap identified.** `runtime/zig/src/native/shader/doe_shader_native.zig:createFromSPIRVOwned` stores imported words but initializes binding metadata empty and workgroup dimensions to one. The ordinary JavaScript shader path is WGSL; imported C-ABI support alone does not qualify the matrix.

  Next: map the frozen fixture's entry points, explicit binding layouts/ranges, workgroup dimensions, specialization constants, validation and safety requirements to native admission. Repair only the metadata path needed to execute this fixture; add rejection checks for mismatches and unsupported requirements. Account for Dawn's validation/reflection/retranslation when testing its import path. Completion is a reconstructable, validated import contract, not merely SPIR-V emission. Source/interface work needs no benchmark GPU.

<a id="doe-3"></a>
- [ ] **DOE-3 — Record actual Vulkan integer-dot capabilities. Not established.** The existing [device discovery][doe-device] identifies the tested AMD adapter/driver but does not establish signed/unsigned packed-dot acceleration properties. Next: retain the relevant feature and property query values, enabled device features, exact GPU/driver/configuration, and unsupported disposition. Query availability separately from accelerated signed/unsigned behavior. This lightweight discovery must not interrupt an occupied measurement window; never infer acceleration from WGSL feature exposure.

<a id="doe-4"></a>
- [ ] **DOE-4 — One accelerated-lowering candidate. Waits for DD-2 and DOE-3.** Target a supported packed integer-dot instruction while preserving signedness, exact integer semantics, and single argument evaluation. Keep model names/scales/application policy outside `runtime/zig/src/compiler/wgsl/emit/emit_integer_dot.zig`. Preserve the portable path explicitly when acceleration is unavailable. Record emitted binary identity before qualification.

<a id="doe-5"></a>
- [ ] **DOE-5 — Qualify accelerated execution before timing. Waits for DOE-4.** Validate SPIR-V; run exact outputs against the independent projection reference, boundary operands, applicable allocation/failure and cleanup controls. Observe the actual loaded library and executed shader, not just generated bytes. Completion applies to the tested Vulkan device; translations do not grant physical Metal/D3D12 acceptance.

<a id="doe-6"></a>
- [ ] **DOE-6 — Select the next general correction from measurements. Waits for DD-4.** If generated code limits the workload, repair lowering. If execution costs dominate, fix the measured preparation/allocation/synchronization/readback owner. Retain unfavorable results and readable ownership/failure paths. Do not launch an unrelated optimizer campaign before the matrix identifies a useful target.

## 3. Reploid only: application integration and dependable participation

Reploid owns conversations, authorized participation, placement, connectivity, and evaluated coordination. It does not implement model mathematics or compiler policy.

<a id="rep-1"></a>
- [x] **REP-1 — Preserve completed foundations.** The [independent-unit coordinator and aggregate journal](artifacts/independent-units-20261011/README.md), [installed interrupted-job controls](artifacts/independent-units-20261011/physical/README.md), and [contribution-stop repair](artifacts/operation-participation-lifecycle-20261011/receipt.json) exist. Actual embedding interruption evidence is one AMD machine with logical providers; the sharing-control repair uses synthetic model results. Do not rebuild these as another scheduler or journal. Retain callback isolation and the [completed stage-overlap investigation](artifacts/partition-stage-timing-20261011/README.md), which established no useful overlap gain.

<a id="rep-2"></a>
- [ ] **REP-2 — Connect ordinary indexing. Deferred; integration gap retained.** `self/host/product-session.js` constructs the document assistant with a local executor. `self/pool/document-search.js:search` sends corpus passages plus query directly to `executor.run` and retains its index in memory. It does not invoke `createIndependentUnitCoordinator`.

  Next: compose the existing coordinator and `openIndependentUnitJournal` in the host, with existing signed-job preparation, placement and per-operation disclosure. Feed stable complete passage texts and original positions into the qualified embedding operation; subdivision must not retokenize arbitrary fragments or change input semantics. Separate durable corpus indexing from query embedding, reranking and generation. Project existing progress/stop/retry through `self/ui/pool-home/document-search.js`; keep local-only operation deliberate. Verify accepted-pin eligibility before a physical job; diagnostic-package evidence does not transfer automatically. Done when normal document controls create and consume a durable signed aggregate through public interfaces.

<a id="rep-3"></a>
- [ ] **REP-3 — Prove durable indexing in the application. Deferred; waits for REP-2.** Extend existing `tests/e2e/independent-units.spec.js` and document-search journeys instead of adding a new protocol. Stop admission, retain committed units across reload, replace/retry unfinished units, reject duplicate inclusion and superseded attempts, restore original ordering, and preserve unrelated conversations. Include storage failure and revoked read permission. Guarantee one accepted outcome per unit, not exactly-once remote execution. Library interruption proofs already exist; the missing proof is the ordinary host/UI path and its output vectors.

<a id="rep-4"></a>
- [ ] **REP-4 — Complete contribution lifecycle integration. Partial.** Both the existing operation owner and shared automatic partition owner now coalesce overlapping stops, block replacement until settlement, and retain failed cleanup for explicit retry. [New failing-before regressions and physical stop/retry](artifacts/live-conversation-20261012/README.md#contribution-settlement-and-explicit-recovery) pass 74 focused tests and 12 browser checks. The physical Mac output contributor stopped during a Suby/Mac answer; a separately approved retry completed and preserved earlier partial output. Immediate retry first exposed a stale-ready/prepared-path failure, retained for repair. Native piece cancellation preserves verified completed pieces and retries unfinished acquisition. Full exact-package long-prompt and signed release acceptance remain open; physical cleanup-failure injection is not claimed.

  Fresh [ordinary physical checks](artifacts/live-conversation-20261012/README.md): browser/browser and browser/native concurrent cancellation preserve the other answer and the stopped partial. Mac contribution stopped before Node replaced its partition; new recipient approval and a fresh attempt succeed. Native receipts show settled attempts and retained weights. The additional [input-owner loss](artifacts/live-conversation-20261012/input-owner-loss.json) and [replacement retry](artifacts/live-conversation-20261012/input-owner-retry.json) terminate Suby mid-stream, preserve the 306-character partial and prior attempt exactly, and complete a separately approved new attempt after restart with a new identity. The generated checklist still has quality defects. A [GPU-free physical native acquisition control](artifacts/native-files-20261012/README.md#physical-acquisition-cancellation-and-retry) now interrupts a second piece after 1,835,008 bytes, settles overlapping source/host closes, preserves the first verified 4 MiB and retries only the incomplete piece. Failed cleanup injection and the complete long-prompt sequence are not newly closed.

<a id="rep-5"></a>
- [ ] **REP-5 — Verify integrated acquisition and introductions. Scoped mechanisms complete; ordinary journey open.** [ICE teardown reproduction and repair](artifacts/ice-acquisition-20261011/README.md) closes a reproduced acquisition defect. The earlier uninstrumented missing-piece trigger remains unknown. [Signaling independence](artifacts/signaling-independence-20261011/README.md) and [introduced embedding across Mac/Linux](artifacts/peer-introductions-20261010/embedding-20261011/README.md) pass their recorded controls; the latter used diagnostic archive `414f61c3…`.

  The ordinary journey exposed terminal RTC loss that never retried while signaling stayed healthy. `c34ba38d` reuses bounded discovery rejoin; focused regression fails before repair. [Physical requester connection close](artifacts/live-conversation-20261012/rtc-recovery.json) re-establishes a route while all three unrelated connections remain connected; [a follow-up then completes](artifacts/live-conversation-20261012/after-rtc-recovery.json), with no page reload. This controlled close is not an arbitrary-NAT or cable-outage claim.

  Next: reuse these mechanisms in the accepted-pin journey with authenticated introductions, configured bootstrap alternatives, supplier replacement and reconnect. Preserve manifest/grant binding, separate introduction/file/compute permissions, and bounded error categories. Record the missing piece, advertisements, verified retention, grants, cancellation and replacement if acquisition fails. A healthy data channel must survive signaling loss; bootstrap availability is not execution readiness. No claim of arbitrary NAT traversal or public discovery follows from configured fixture routes.

<a id="rep-6"></a>
- [x] **REP-6 — Preserve honest recovery contracts.** [Contract controls](artifacts/partition-contracts-20261010/README.md) and [bounded failure categories](artifacts/partition-failure-categories-20261011/README.md) retain canonical attempt identities, paired requester/placement fields, explicit readiness, and unavailable replay/checkpoint capabilities. Changed bindings reject; authorized restart creates a new attempt and keeps prior partial text separately. Transport loss never proves remote GPU cleanup. This checked contract does not close physical recovery/quality acceptance in DR-5.

<a id="rep-7"></a>
- [ ] **REP-7 — Complete ordinary use on the accepted pin. Partial and failed quality evidence retained.** Exercise signed-Capsule opening, selective acquisition, zero requester weight downloads, automatic configured discovery, concurrent conversations, repeated long prompts, document reuse, citations and copying. [Signed resident integration](artifacts/partition-contracts-20261010/signed-pieces-20261011/README.md) is implemented but its proof is synthetic. [Focused physical recovery](artifacts/focused-recovery-20261011/README.md) passes several interruption/replacement boundaries but retains incomplete counting and inaccurate document answers. [Source quality attribution](artifacts/chat-task-quality-20261011/README.md) separates model failures from coordination defects.

  **Next: inspect and repair the ordinary conversation UI, then use it for the physical journey.** Keep DR-1 identities fixed. Chat attachments use the existing supported passage path; durable indexing REP-2/3 is not a dependency. Cover these acceptance conditions in the existing components and journey tests:

  - Empty/unavailable/preparing: composer and draft remain accessible; status reflects actual model capacity; one relevant next action; no forced local download or silent deferred sending.
  - Permission: readable content, recipient and scope, clear Approve/Decline; denial or revocation remains scoped to the affected request.
  - Streaming/completed: stable message nodes, readable prose/code, working source links and Copy, preserved selection/scroll, visible composer and keyboard focus.
  - Threads/settings/network: preserve draft, reading position and execution while navigating; optional details and contribution do not displace the main task. Keep the current compact status design.
  - Stop/interrupted/retry: distinguish stopping from settled, preserve partial text, start a visibly separate authorized attempt, leave unrelated work intact.
  - Desktop/phone: both themes, long histories, attachments, repeated panels, narrow widths and simulated keyboard viewports; no clipped guidance or inaccessible controls. Preserve the completed phone fix.

  Done when a fresh requester can discover, approve, ask, attach, read/copy, follow up, switch, stop, retry and return through the actual application with zero requester weights. Use fixtures for interaction regressions and physical peers for distributed claims. Keep factual answer failures even when output reaches EOS. Deploy only under ALL-6.

  Fresh [conversation journey evidence](artifacts/chat-journey-20261011/README.md): 22 desktop/phone interaction checks pass. Real Mac/Suby selective acquisition, zero requester weight requests and idle contributor restart followed by complete YES answers pass. Chromium 136 lacked required Ed25519 verification; selecting installed Chromium 145 restores authenticated discovery. The runner now checks crypto before participation. The extended run completes concurrent short answers but fails after isolated cancellation: the survivor continues incorrect repetitive output and times out. Its final history and cancelled partial answer are retained in the same handoff. The entire 12,269-character survivor prefix matches the retained standalone control without cancellation, narrowing this output defect to shared runtime/model behavior. Active contribution interruption, long documents and signed Capsule opening remain open.

  UI checkpoint: [usability handoff](artifacts/chat-usability-handoff-20261011/README.md)
  retains simplified navigation, compact availability, readable transcript width,
  archive actions and empty-state guidance. Fifty focused tests, eleven browser
  fixture cases, CSS, generated browser identity and Verification Worker checks
  pass. The subsequent [phone guidance repair](artifacts/chat-phone-guidance-20261011/README.md) gives status text its own full-width row, moves conversation Actions into the header, and keeps Attach/Stop together. The original 320px regression failed at 12.375px guidance width; the fix passes the strengthened layouts, twelve browser/worker checks and 3,082 repository tests with 29 existing skips. Real phone keyboards, unfamiliar-user observation and full product acceptance remain open. Neither presentation checkpoint closes numerical or release gates.

## 4. Doppler + Doe: projection handoff, compiler/runtime matrix, and performance

Doppler supplies reproducible computations; Doe provides optional execution. Attribute compiler, runtime and lowering effects separately. **This section is deferred; it does not gate the Reploid conversation.**

<a id="dd-1"></a>
- [ ] **DD-1 — Doe accepts the frozen projection. Deferred; DOP-5 prerequisite complete.** Use [projection.tar.gz and manifest][dop-export]. The producer's export test/hash audit passes; a Doe-owned consumer has not yet demonstrated reconstruction. Extend the existing native benchmark ownership to load every declared buffer, stage, constant and expected result. Verify activation bytes, I32 accumulators, both F32 scaling stages and zero status. Keep the oracle external to Doe's compiler. Record fixture/package/library identities and explicit rejection of incomplete metadata.

<a id="dd-2"></a>
- [ ] **DD-2 — Ordinary-provider projection controls. Waits for DD-1 and ALL-2.** Extend `bench/executors/run-packed-integer-controls.mjs` or a focused runner in that existing surface. Execute the same full projection through ordinary Dawn and Doe WebGPU on the same AMD/Vulkan host, observing compilation, submission, readback and cleanup. Existing packed-integer microcontrols are not this projection. Separate normalized-packing halfway failures. Correctness must pass before timing or DOE-4 promotion.

<a id="dd-3"></a>
- [ ] **DD-3 — Incremental compiler/runtime matrix. Waits for qualified DOE-2 metadata.** Record Tint+Dawn, Tint+Doe, Doe-compiler+Dawn and Doe-compiler+Doe separately. Start from ordinary-provider controls; mark unavailable arms unsupported with a concrete reason. Observe compiled and executed bytes. Disclose Tint validation, reflection or retransformation; WGSL preprocessing is not direct SPIR-V execution. Useful ordinary-provider findings need not wait for every experimental arm.

<a id="dd-4"></a>
- [ ] **DD-4 — Attribute measured effects. Waits for qualified comparable arms.** Compare compilers within one runtime and runtimes using the same compiled artifact where supported. Compare portable/accelerated lowering separately after DOE-5. Freeze adapter/preparation/cache/reuse/timing boundaries; include CPU, memory and complete execution costs, with loading/warmup reported separately. Confirm results without instrumentation. Failed/unsupported arms and interference remain visible; no causal attribution from an unseparated provider swap.

<a id="dd-5"></a>
- [ ] **DD-5 — Transfer an eligible gain through Doppler. Waits for DD-4 and applicable model acceptance.** Measure the admitted mechanism through Doppler's unchanged public operation with identical application requirements. Gemma W8A8's quality rejection blocks promoting that model configuration, not projection correctness research. Q4/F16 versus W8 comparisons are quantization experiments, not provider comparisons. A Node path must qualify opening, repeated invocation, cancellation and settlement before ER-1.

<a id="dd-6"></a>
- [ ] **DD-6 — Confirm generality outside Doppler. Waits for an accepted mechanism.** Reuse an unrelated computation or Doe's existing ONNX workload with its own independent outputs and lifecycle. Compatibility is not transferred performance; measure any claimed benefit separately. This is not a gate for Reploid's accepted provider.

## 5. Doppler + Reploid: exact-package integration and distributed acceptance

This boundary owns public operation identities, signed requests, permissions, execution events and recovery, without duplicating either library's internals.

<a id="dr-1"></a>
- [x] **DR-1 — Keep accepted and candidate identities separate.** Both archives call themselves 0.6.27; their bytes differ. [Reploid pin](self/config/doppler-package.json) still selects the standard archive. This audit freshly hashed that archive and compared every installed archive member without mismatches. Candidate installed identity is retained in [DOP-8][dop-package], not freshly installed on this Mac. Candidate testing is not an upgrade.

  | Identity | SHA-256 / location |
  | --- | --- |
  | Accepted archive | `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`; `deploy/artifacts/doppler-gpu-0.6.27.tgz` |
  | Accepted package member inventory | `45754d29df6b280431fae0806a1872cf694841dbdffe05acab38e4864aa82572`; sorted UTF-8 `path TAB sha256 LF` over regular archive members; all matched `node_modules/doppler-gpu/` |
  | Candidate archive | `7c240dad4d1ae98e204e9727e687b9bc4379abd758b16af0fd857a99d7adac8d`; retained Linux installed receipt/inventory in DOP-8 |
  | Projection archive | `128bbc084593483c2f4e4c532f8b118e2c25b68d7f7f1b0dd3ee73adec8911af`; DOP-5 |

<a id="dr-2"></a>
- [ ] **DR-2 — Replay embedding and scoring through Reploid. Partial.** [Candidate public-library controls][dop-core] pass eighteen complete-text embeddings, ordering/subdivision/repetition/cancellation/reuse, twenty-four choice logits and twelve selections. Independent jobs and introduced embedding have their own scoped Reploid evidence (REP-1/REP-5). These do not establish ordinary application acceptance with `7c240dad…`.

  Next: bind the exact tested installation to existing signed operation adapters, replay all outputs against independent references, and test UI/host reuse/cancellation. Preserve operation-specific tolerances and uncalibrated score semantics; neither 0.02 embedding nor 0.05 scoring changes chat's 0.001. Reject model/application identity or eligibility mismatches before work.

<a id="dr-3"></a>
- [ ] **DR-3 — Verify permissions in the distributed conversation. Active; no indexing dependency.** Bind operation, complete input scope, model identity and placement in each signed request. Test disclosure denial, changed input, wrong operation, expiration and revocation in generation and attachment flows before execution. Durable-output checks resume with REP-2/3. Embedding permission does not authorize generation, reranking or extra disclosure. Reuse current signed-job and permission controls rather than a new grant system.

  `5a1f6e27` repairs stale readiness after human review, freezes the reviewed input, retains consent expiry and rejects changed recipients/model/plan before sending. [Fifteen-second physical review](artifacts/live-conversation-20261012/delayed-approval.json) succeeds with the same approved browser/native pair. Regression controls cover expiry, replacement during review and payload mutation. `17dbfed0` exposes both recipients and disclosure roles in the existing permission card. The [physical reuse/revoke sequence](artifacts/live-conversation-20261012/permission-revocation.json) uncovered and repaired the input/output recipient mismatch in reusable grants. Grants bind both actual contributors; replacement requires fresh approval. Revocation cancels its active follow-up, and subsequent declined input is not dispatched or mislabeled as an execution failure.

<a id="dr-4"></a>
- [ ] **DR-4 — Coordinated distributed numerical acceptance. Failed/unqualified.** After one DOP-6 correction earns retesting, use matching installed package and application identities on both hosts and placements at unchanged 0.001 and precision. Mac runs require the agreed session owner. Retain every failed prefix and invalid/truncated observation. Operation controls, matching tokens and cross-GPU agreement alone do not replace independent numerical acceptance.

  Fresh Mac/Intel execution: [both directional comparisons](artifacts/mac-intel-numerical-20261011/README.md) complete but fail 28/55 and 23/55 frozen steps at unchanged 0.001. All tokens agree; allocation and settled cleanup observations pass their scoped checks. This does not qualify the runtime or application. The user subsequently approved the independent F64 contract under ALL-4; these historical capture failures remain retained. The [approved-target Mac/AMD comparison](artifacts/chat-journey-20261011/approved-reference/summary.json) now completes all 55 prefixes in both placements: each fails 22/55, maximum 0.002666609627555161. The implementation remains unqualified; archive and tolerance are unchanged.

<a id="dr-5"></a>
- [ ] **DR-5 — Exact integrated chat journey and lifecycle revalidation. Integration active; release waits for applicable gates.** Use one immutable candidate archive, signed physical opening and real selective acquisition. Test both placements, complete useful answers, concurrent conversations, isolated cancellation, contributor stop/loss/replacement, explicit authorized retry, and settlement. Repeat the previously passed successive 1,588-token workload, allocation rejection and reuse within 1,420,000,000 allocated bytes without reopening weights. Keep earlier partial answers separate and distinguish model counting/grounding defects from distribution. REP-7 accepted-provider work continues independently.

  Fresh [original-weight contractor control](https://github.com/clocksmith/doppler/blob/main/artifacts/contractor-source-quality-20261011/README.md) is complete with rejection. Both seed-17 responses naturally terminate within unchanged budgets, but fail frozen factual review: wrong price rankings/removal costs and a correction pass that endorses the historical false answer. Original weights used F32 source equations and F16 K/V; this is not native BF16 or GPU acceptance. The two seed-53 cases did not complete after a deliberate stop and count as neither failures nor passes. The ordered-message evaluator and atomic-report regression are implemented; exact executed code and all outputs are retained. Prior fourteen-task source success does not qualify this conversation. Next quality work needs a specific cause and separately identified control on an already authorized model; do not repeat seeds merely to seek a passing answer. Converted Q4 remains rejected, and no new model authorization follows.

<a id="dr-6"></a>
- [ ] **DR-6 — Useful combined capacity. Unqualified.** Compare cooperative execution with constrained standalone controls using fixed per-contributor budgets, precision, context and useful-answer requirements. Retained recovery allocations are below budget but do not establish successful larger-model capacity. Multiple participants/routing alone is insufficient. Do this through the same interface after DR-5, not by increasing budgets or trimming prompts.

**Upgrade rule:** adopt one standard archive only after its applicable numerical, lifecycle, model-quality and application gates pass. Successful embedding does not qualify generation or W8A8; unrelated Doe performance research is not a release gate.

## 6. Doe + Reploid: optional native participation through Doppler

No direct Reploid–Doe dependency or new scheduling protocol. **This section is deferred.** A qualified native provider can be evaluated later; it does not delay the existing Doppler-provider journey.

<a id="er-1"></a>
- [ ] **ER-1 — Expose a qualified Node executor through Doppler. Waits for eligible local qualification.** Reploid calls existing supported model operations. Doe selection is explicit inside the executor; browser requesters need no native replacement. Verify installed exports and the actual provider library at startup; reject unsupported operations.

<a id="er-2"></a>
- [ ] **ER-2 — Preserve reservation/admission ownership. Waits for ER-1.** Reploid enforces grants, budgets and conversation reservations; Doppler owns residency/invocation; Doe owns GPU resources. Test budget rejection and unrelated conversation isolation. Do not expose compiler internals through the job protocol.

<a id="er-3"></a>
- [ ] **ER-3 — Remote interruption with observed settlement. Waits for ER-1/ER-2.** Interrupt delivery, stop contribution and replace a participant during outstanding work. Observe cleanup via Doppler's existing lifecycle and keep unknown ownership charged/unavailable. Neither disconnect nor deadline expiration proves GPU release. Retain partial output and use a fresh authorized attempt.

<a id="er-4"></a>
- [ ] **ER-4 — Requester-level provider benefit. Waits for DD-5 and ER-3.** Compare Node+Doppler+Dawn with Node+Doppler+Doe for the same authorized operation, model, placements, budgets, history and comparable network conditions. Include total request cost and failures, not just isolated kernel time.

<a id="er-5"></a>
- [ ] **ER-5 — Useful optional contribution. Waits for an eligible executor.** Record foreground responsiveness, energy where measurable, transfers, useful completed work and failures with providers disabled/enabled. Report unavailable measurements. Keep admission opt-in, queues bounded and stop responsive. No spare-capacity benefit claim without the contributor's cost; no obligation to fill idle cycles.

## 7. All three: canonical tracking, shared machines, releases, and evidence

<a id="all-1"></a>
- [x] **ALL-1 — One canonical queue.** This audit reorganizes the existing TODO into the seven requested sections with all 46 stable IDs. Doppler's TODO and the checklist pointers in Doe's status front door have been removed. Repo-local evidence remains with its owner. No duplicate active roadmap was created.

  The [previous checklist at dd4e1275](https://github.com/clocksmith/reploid/blob/dd4e12759128e9a38f63f16a3c02c132835eeab5/TODO.md) preserves the complete earlier chronology, rejected candidates and reference-activation reversal. It is historical, not a second work queue. Migration: W1/W2 → DOP-1/2; W3 → DOP-3/4/7/8; old 1 → DR-1; 2–5 → REP-6/REP-1; 6 → DOP-2/DR-5; 7–8 → DOP-6/ALL-4; 9 → REP-7/DR-5; 10–12 → REP-5/REP-6; 13–15 → REP-7/DR-5; 16 → DR-6; 17–18 → DOP-8/ALL-6; 19–22 → REP-1/2/3/DR-2; 23 → REP-1/DD-4; 24 → REP-5; 25 → ALL-7. Earlier completed diagnosis remains complete even where broader acceptance is open.

<a id="all-2"></a>
- [ ] **ALL-2 — Assign physical windows. Required for each new run.** Use the authorized heavy Linux host for expensive diagnostics, Suby for another compatible physical executor, and Mac through the agreed controller. Before each run, check live owners and record the controlling session, host/GPU, browser/profile, workload, other GPU consumers and release/settlement. The previous owned CPU/browser runs are closed; that is not a standing reservation or proof of present availability. Preserve the existing public contributor and retain any measurement interference. UI/source work can proceed without a GPU reservation.

<a id="all-3"></a>
- [ ] **ALL-3 — Freeze and verify each handoff. Ongoing.** Record application bundle, archive and installed files, model, tokenizer, shader, independent reference, provider library, GPU and driver. Verify actual served/loaded bytes and execution path, not just advertised hashes. DR-1 and DOP-5 are audited starting points; native and physical candidate handoffs remain open. Refresh generated artifacts from their source, never patch browser copies independently.

<a id="all-4"></a>
- [ ] **ALL-4 — Preserve reference authority. Independent contract explicitly approved; accuracy still open.** Separate F64 mathematics, explicitly specified F32 evaluation, source-model checks and historical runtime captures. Retain the historical reference correction/reversal in [reference disposition](artifacts/reference-correction-20261011/README.md). A replacement requires independent justification and explicit approval. Never activate captured results merely because they match. Keep frozen inputs, precision and tolerances unchanged.

<a id="all-5"></a>
- [ ] **ALL-5 — Commit owned deltas and report identity. Ongoing.** Work directly on each owning main branch; preserve concurrent edits; stage only this task, check relevant links/anchors and diffs, then commit/push without force. Existing source sweeps remain retained; focused checks accompany subsequent tooling changes. This audit changes tracking only, not runtime or generated delivery. Each implementing agent updates its canonical item with evidence and pushed revision rather than adding a separate queue.

<a id="all-6"></a>
- [ ] **ALL-6 — Promote and deploy only applicable qualified configurations. Not ready for candidate chat.** After applicable package/numerical/lifecycle/quality/application gates and deployment authorization, verify served app/package identities, fresh-browser use, saved history/drafts and successful requests after interruption. Contribution remains optional. Do not invent Doe performance, optional mesh capacity or external adoption as gates for an otherwise qualified feature. Do not deploy failed Gemma W8A8 or silently replace the standard archive.

<a id="all-7"></a>
- [ ] **ALL-7 — Maintain scope. Ongoing.** Defer Metal/D3D12 campaigns, browser replacement, portable checkpoints, language rewrites, new schedulers, transport platforms and publication frameworks. Preserve completed strategy synchronization/evaluation publication; do not reopen them. Keep hygiene findings separate from runtime acceptance. No new dashboard, model catalog or architecture campaign is needed for the next deltas.

<a id="all-8"></a>
- [ ] **ALL-8 — Evaluate learning after dependable execution. Deferred.** Bayesian placement and reversible policy adoption need independent future evidence and unfamiliar tasks. External adoption matters but is not an engineering gate. Retries, journals and multiple agents are not demonstrated self-improvement. Resume only after dependable application execution and a specific measurable improvement hypothesis.

**Finish condition for this milestone:** a person opens ordinary Reploid, uses available capacity without downloading weights or arranging computers, grants the actual disclosure and gets a useful complete answer computed by complementary partitions on multiple physical machines. They can continue, stop one of two conversations, recover by explicit retry and return to intact history. The UI works at desktop and phone sizes; the exact shipped Doppler package passes the applicable numerical, memory and lifecycle checks. Indexing, scoring expansion and Doe performance research are later milestones.

[dop-conversion]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/w8a8-conversion-20261011/README.md
[dop-operators]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/w8a8-kernels-20261011/README.md
[dop-quality]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/w8a8-model-qualification-20261011/README.md
[dop-benchmark]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/w8a8-model-qualification-20261011/benchmark/results.json
[dop-export]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/w8a8-native-projection-20261011/README.md
[dop-package]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/w8a8-package-20261011/README.md
[dop-checks]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/w8a8-repository-checks-20261011/README.md
[dop-core]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/w8-runtime-core-completion-20261011/README.md
[dop-numerical]: https://github.com/clocksmith/doppler/blob/b7b9471330e7cacf3bb842105adc993b986cb7a6/artifacts/whole-model-f64-complete-20261011/README.md
[doe-packed]: https://github.com/doerun/doe/blob/50f1189012d1952772a67ae7b846314cdfc49b62/reports/maintenance/20261011-wgsl-packed-integers/README.md
[doe-device]: https://github.com/doerun/doe/blob/50f1189012d1952772a67ae7b846314cdfc49b62/reports/maintenance/20261011-wgsl-packed-integers/vulkan-summary.txt
