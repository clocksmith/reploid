# Canonical task register

This is the sole detailed acceptance register linked from [ROADMAP](../../ROADMAP.md). Each stable ID occurs once. The original task and nested checkboxes retain their exact status and evidence scope; completed rejected experiments stay completed. “Unqualified” never means “unimplemented.” Source, installed and physical evidence are only claimed where the preserved entry explicitly records them. No new runtime tests or deployments occurred during this documentation migration. The newer storage-participation evidence from `92642382` is retained under REP-4 and REP-5.

Snapshot: [229a6e601adbd970de38c3315d069de4ba707cce](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/TODO.md). The existing delivery coordinator retains execution ownership; this migration creates no coordinator or GPU reservation.

[RD-CANON/1](rd-canon-1.md) retains mandatory contract and test fixtures. [Historical context](history.md) is not another queue.

## 1. Correct execution

### DOP-1

Owner: Doppler. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dop-1"></a>
- [x] **DOP-1 — W8A8 projection foundation.** Retain symmetric signed quantization, per-channel weight scales, per-token activation scales, bounded I32 accumulation, and ordered F32 rescaling. JSON declares policy; conversion emits weights; JavaScript orchestrates; WGSL packs activations and computes. This qualifies linear projections, not an entire model. Evidence: [conversion][dop-conversion], [operator controls][dop-operators], and `src/gpu/kernels/w8a8.js` in Doppler.

### DOP-2

Owner: Doppler. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dop-2"></a>
- [x] **DOP-2 — Independent projection and scoped lifecycle acceptance.** Retained portable/packed controls cover quantization, packing, integer accumulators, output bits, boundaries, padding, invalid inputs, cancellation, resident reuse, and settled cleanup. The final candidate's 668,488,920-byte accounted peak is neither process RAM nor physical GPU residency. Preserve completion versus cancellation distinctions and the 1,420,000,000-byte ceiling. Evidence: [operators][dop-operators], [installed lifecycle and quality][dop-quality], [candidate record][dop-package].

### DOP-3

Owner: Doppler. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dop-3"></a>
- [x] **DOP-3 — Complete the Gemma quality rejection.** Installed variants agree but pass only 4/12 frozen tasks against the 10/12 requirement and fail the F16-relative likelihood allowance. Independent source W8 passes 5/12 and also fails. This experiment is complete; Gemma W8A8 remains rejected. Evidence: [quality disposition][dop-quality]. Do not turn implementation agreement into model acceptance.

### DOP-5

Owner: Doppler. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dop-5"></a>
- [x] **DOP-5 — Freeze and validate the projection exporter.** Already implemented in `tools/export-w8a8-projection.js`. [Projection handoff][dop-export] contains deterministic F32 operands, scales, packed bytes, expected I32 intermediates, intermediate/final F32 bits, exact installed WGSL, layouts, constants, bindings, dispatches, and identities. Synthetic query shape is M=1, N=1024, K=640; seed 7331. Fresh offline test and all payload hashes pass in this audit. No new GPU evidence is implied. Retain for deferred DD-1; this handoff is not needed to finish distributed chat.

### DOP-6

Owner: Doppler. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dop-6"></a>
- [x] **DOP-6 — Resolve distributed numerical accuracy for the declared AMD/Mac candidates.** Archive `102fd0c4…` passes both browser placements; replacement `0fadac51…` passes both native/browser placements, all 55 prefixes at unchanged 0.001. See DR-4 for exact evidence. Signed application, long-concurrency, other hardware and changed archives require their own gates. The chronological checkpoints below retain earlier failures and next actions as historical context, not a second active queue.

  Changed three-host archive acceptance remains explicitly open under [DR-6](#dr-6). The checked AMD/Mac result above applies only to its named historical packages; changed bytes inherit neither numerical nor lifecycle qualification.

  **Historical investigation:** The historical [complete 55-prefix comparison][dop-numerical] rejected its candidates at unchanged 0.001; the corrected paired archive now passes the unsplit checks described below. Local F16 projection accuracy improved, but the Q4 addition worsened maximum full-model error; neither qualifies. Physical cache readback, attention, recurrence, normalization, and projection investigations already exist—do not rerun them without a new question.



  **AMD and Mac numerical pass:** the exact corrected archive above completes all 55 prefixes and two identical reuse controls on each provider. Maximum tracked device-buffer allocation is 1,132,260,560 bytes, below 1,420,000,000; active, deferred and retained-model pool ownership settle to zero. Reusable pool buffers remain allocated, so this is not a zero-memory claim. The independent comparisons and raw physical captures are retained under `7ab7c393` and `417d8d26`. Mac peak is 1,129,107,472 bytes. Cross-provider outputs are not all byte-identical, but both independently pass the approved target. Physical partition acceptance remains required; DOP-6 stays open.


  Fresh [target-compatibility check](https://github.com/clocksmith/doppler/blob/main/artifacts/reference-target-compatibility-20261011/README.md): 174 logits across three frozen prefixes place the historical and independent F64 targets more than 0.002 apart. At the worst coordinate, no value can be within 0.001 of both (minimum possible worst error 0.00161574). This proves incompatible simultaneous targets, not a passing implementation or automatic reference authority. The user subsequently approved the unchanged independent F64-equation contract under ALL-4; this does not qualify a failing implementation.







  The [Reploid paired-frame boundary](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/paired-activation-boundary-20261012/README.md), `7a3ff73c`, now consumes provider-declared layout and validates exact high/low bytes without changing its accepted pin. Synthetic RPC/allowance/malformed-header controls, 3,200 full-suite tests (29 skipped), types and the actual Worker pass. This source integration is not deployed paired inference or numerical qualification.

  **Paired source checkpoint:** [logits implementation and Mac operator receipts](https://github.com/clocksmith/doppler/blob/main/artifacts/paired-logits-20261012/README.md), `0365d512` / `d6abca90`, preserve explicit paired intermediates and final scalar output. [FFN orchestration](https://github.com/clocksmith/doppler/commit/7eb47eae) declares split gate/up projections, paired SiLU and down projection, with ownership/representation regressions. These are component checks, not whole-model qualification; subsequent physical FFN and layer-plan receipts are being retained by their owner. All-55 numerical, signed long-conversation, allocation and model-quality gates remain open.

  Current next action: consume the passing exact-package evidence under DR-4 for signed opening and memory/lifecycle gates; do not rerun completed numerical investigations without changed bytes or a new failure. The approved paired producer/consumer chain and activation contract are implemented; preserve the independent operator controls and failed whole-model receipts. A passing ideal-arithmetic control alone cannot qualify WGSL execution. Continue Reploid capacity and accepted-pin lifecycle work independently. Mac/directional acceptance belongs to DR-4.

### DOP-8

Owner: Doppler. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dop-8"></a>
- [x] **DOP-8 — Exact candidate record and repository checks.** [Candidate record][dop-package] binds archive SHA-256 `7c240dad…`, version 0.6.27, installed receipts and package inventory. [Frozen-source repository sweep][dop-checks] passed, including 917 unit files. Subsequent exporter controls pass separately. [Core-operation checks][dop-core] retain successful embedding/scoring apart from failed generation qualification. These are archive hash prefixes, not Git commits. No archive promotion, publication, or Reploid pin change follows. Keep the record current only when owned bytes change.

### DR-4

Owner: Reploid / existing delivery coordinator. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dr-4"></a>
- [x] **DR-4 — Coordinated distributed numerical acceptance for the declared browser/native routes.** Archive `102fd0c4…` passes all 55 prefixes in both browser placements. Archive `0fadac51…` adds the readiness and signed-reader repairs and independently passes all 55 in both Node/Dawn AMD + Mac browser placements at unchanged 0.001. [Results and cleanup](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/resident-readiness-qualification-20261012/results/summary.json), [released reservation](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/resident-readiness-qualification-20261012/reservation.json), and [four actual resident reports](https://github.com/clocksmith/doppler/tree/2128b6de/artifacts/resident-pipeline-preparation-20261012/native-qualification) are retained. This does not qualify Suby, signed opening, canonical forks/replay, simultaneous long conversations, quality or release. Changed package bytes require applicable requalification. Historical controls below retain their original failed or partial disposition.

### ALL-4

Owner: Doppler reference owner / existing coordinator. Status: Scoped references accepted; changed candidates separately unqualified.

Next action: Retain approved reference, precision, weights, cache and budgets. Dependencies: Explicit approval before any reference replacement.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-4"></a>
- [ ] **ALL-4 — Preserve reference authority. Approved target passes the declared browser and native/browser splits; remaining acceptance is scoped above.** Separate F64 mathematics, explicitly specified F32 evaluation, source-model checks and historical runtime captures. Retain the historical reference correction/reversal in [reference disposition](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/reference-correction-20261011/README.md). A replacement requires independent justification and explicit approval. Never activate captured results merely because they match. Keep frozen inputs and tolerances unchanged. The user separately approved the bounded recurrent-state and broader paired-intermediate proposals under DOP-6; these do not change reference authority or authorize unrelated precision changes.

## 2. Complete conversations

### REP-7

Owner: Reploid chat / host / UI. Status: Partial; source and scoped public physical controls retained.

Next action: Complete useful installed signed N-stage conversations. Dependencies: DOP-6 changed-package qualification; DR-3; DR-6.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="rep-7"></a>
- [ ] **REP-7 — Complete ordinary chat on the accepted pin. Partial evidence retained.** Exercise signed-Capsule opening, selective acquisition, zero requester weight downloads, automatic configured discovery, streamed replies, follow-ups, concurrent conversations, repeated long prompts and copying. Attachment/document reuse and citations remain secondary, outside the basic-chat release gate. [Signed resident integration](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/partition-contracts-20261010/signed-pieces-20261011/README.md) is implemented but its proof is synthetic. [Focused physical recovery](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/focused-recovery-20261011/README.md) passes several interruption/replacement boundaries but retains incomplete counting and inaccurate document answers. [Source quality attribution](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/chat-task-quality-20261011/README.md) separates model failures from coordination defects. **Signed installed chat (2026-10-14):** the [run-5 requester journey](../../artifacts/signed-completion-journey-20261013/README.md) passes signed opening, selective acquisition with zero requester weight requests, automatic route selection, streaming, follow-up, copy, reload, two concurrent requesters, isolated cancellation and explicit retry. Repeated long prompts are not covered; answer usefulness awaits review, and two answers state wrong example outputs.

  **Primary consumer surface:** choose an actually available model, understand preparation or unavailable capacity, approve the actual recipients, receive streaming answers and follow-ups, and restore conversations without manual stage assignment. Requesting and contribution can overlap; either role can operate independently. Developer APIs later consume the same prepared capacity rather than a separate service pool.

  **Candidate delivery preparation:** [isolated archive9 delivery](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/paired-candidate-delivery-20261012/README.md) uses clean Reploid `37c7bc9f`, the unchanged frozen candidate archive, existing browser/native packaging and an outside-checkout amd-host installation. All 95 native delivery entries and 1,974 installed runtime files match their declared bytes; the 1,977-file hosting package verifies. CLI help opens no GPU. This prepares real native qualification and does not establish inference, signed acquisition or deployment. The public pin remains unchanged.


  The actual signed producer exposed a packaged-path mismatch before piece acquisition: `artifacts/model/weights.bin` versus original `weights.bin`. [Browser/native repair](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/signed-resident-paths-20261012/README.md), `342f0760`, resolves paths against the selected signed manifest directory and checks exact source identity; no basename fallback. Twenty-five focused tests and the Verification Worker pass. Doppler `92df53c4` supplies resident qualification/piece-index producer closure; physical signed inference still requires real qualifying evidence, not synthetic passing reports.

  **Next: preserve the deployed conversation UI and use it for the remaining signed physical journey.** Keep DR-1 identities fixed. Chat attachments use the existing supported passage path; durable indexing REP-2/3 is not a dependency. Cover these acceptance conditions in the existing components and journey tests:

  - Empty/unavailable/preparing: composer and draft remain accessible; status reflects actual model capacity; one relevant next action; no forced local download or silent deferred sending.
  - Permission: readable content, recipient and scope, clear Approve/Decline; denial or revocation remains scoped to the affected request.
  - Streaming/completed: stable message nodes, readable prose/code, working source links and Copy, preserved selection/scroll, visible composer and keyboard focus.
  - Threads/settings/network: preserve draft, reading position and execution while navigating; optional details and contribution do not displace the main task. Keep the current compact status design.
  - Stop/interrupted/retry: distinguish stopping from settled, preserve partial text, start a visibly separate authorized attempt, leave unrelated work intact.
  - Desktop/phone: both themes, long histories, attachments, repeated panels, narrow widths and simulated keyboard viewports; no clipped guidance or inaccessible controls. Preserve the completed phone fix.

  - [ ] **First-use product acceptance (CHAT-01):** A fresh desktop/phone requester can discover useful prepared capacity, understand which recipients receive their input, ask and follow up without operator coaching, invitations, manual placement or requester weights. Show one actionable unavailable/preparing state; distinguish contributing compute from using capacity. Observe unfamiliar users on physical phones and desktops, including onscreen keyboards and returning sessions. Against the pinned baseline, measure setup actions, time to first useful answer, task/recovery success and assistance required. Ship working documentation/examples and a reproducible demo from the tested release. Retain task outcomes and failures, not only screenshots or token completion; this uses the existing UI, not a new onboarding architecture.

  - [ ] **Community adoption experiment (REP-7 / CHAT-01):** recruit an explicitly consented initial model community and measure repeat useful use and voluntary contribution, including reasons for stopping or declining. Freeze tasks, cohorts and observation method; separate service failures from demand and retention. Adoption evidence does not replace numerical, package or lifecycle qualification, and technical release does not establish adoption.

    Preparation-state repair: the composer now consumes the selected whole-request model's projected loading/preparing state, matching the header and suppressing an inappropriate connection retry. Other models preparing cannot hide the selected model's unavailability. [Focused evidence](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/first-use-preparation-20261013/README.md) retains the observed mismatch, draft-preserving transitions and exact source scope. This does not close physical first-use or unfamiliar-user acceptance.
  - [ ] **Developer compatibility (DEV-02):** Inventory existing public adapters, then implement and qualify explicitly versioned OpenAI Chat Completions/Responses and Anthropic Messages compatibility through existing host/library interfaces. Cover streaming event order, completion reasons, cancellation, tool-call/result boundaries, structured outputs, errors and usage semantics. Publish a parameter support matrix with seed/top_p and other sampling controls either faithfully mapped or explicitly rejected before execution; never silently ignore them. Preserve host-owned credentials, grants and durable accepted output. Use protocol fixtures and installed consumers; protocol similarity is not conformance. This later capability follows dependable consumer access and preserves the native API; it is not a universal prerequisite for every comparative claim. Run actual model-backed coding-agent sessions through installed SDKs/clients, including tool results, structured outputs, continuation, cancellation and recovery. For every required parameter, either implement its faithful semantics or retain an explicit parity gap; rejecting unsupported controls is honest but does not complete required compatibility.

    Sequence DEV-02 after dependable consumer access to the same shared prepared capacity. Preserve the existing adapter evidence; installed, model-backed compatibility remains required, and no independent developer-only capacity pool is introduced.

    Text adapter checkpoint `66b25fc1`: [installed Chat Completions](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/text-chat-completions-20261013/README.md) uses the existing ordinary requester with separate authentication/execution/disclosure approval. Thirty-nine API/host and twelve native controls pass; official OpenAI SDK 7.32.0 streams and completes against the installed adapter. Seed/top_p and other unsupported parameters reject explicitly. Computation is injected in these checks; no GPU, cloud, public endpoint or runtime pin changes.



  - [ ] **Coding workflow (JOB-06):** Compose existing file tools, preview and console-feedback owners into one bounded edit/test/review journey. Require separately scoped read, execution and real-folder write authorization; show a reviewable diff before applying changes. Test preview isolation, denied/outside-root writes, stale file versions, failed tests, cancellation and unknown tool outcomes with reconciliation before retry. Preserve prior files and expose failures. Qualify on the supported model/runtime rather than manufacturing successful answers. Include working browser previews, console-error feedback, approved real-folder changes, mobile coding views and export on frozen real tasks. This remains an explicit later capability after basic chat, with acceptance on its declared coding workload rather than every competitor feature.

    JOB-06 follows dependable consumer access and DEV-02. Coding workflows, placement learning (ALL-8), and coding-model improvement (ALL-9) advance the cooperating-intelligence destination through their existing consent, independent evaluation, promotion and rollback gates; multiple agents or training activity alone cannot establish improved outcomes.

  **Completion-reason source repair:** [ordered propagation and limit handling](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-completion-reasons-20261013/README.md) preserves runtime endings through chat and bounded requester summaries. Token/context-limit output remains an incomplete partial, not a successful answer. Sixty-five focused tests, declarations and the actual Verification Worker pass; installed/physical release acceptance remains open.

  **Browser source delivery:** [shared validation repair](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-boundary-repair-20261013/README.md) removes discovery-to-placement coupling while preserving public helpers; 64 focused controls, layer/type/charter checks and the actual Worker pass. [Generated delivery](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-browser-delivery-20261013/README.md) matches all 207 canonical library files and a 1,932-file browser manifest. This prepares current source bytes without deploying them or changing the accepted Doppler pin.


  Basic-chat acceptance: a fresh requester can discover, approve, ask, read/copy a complete streamed reply, follow up, switch, stop, retry and return through the actual application with zero requester weights. Attachment interpretation is a separate later acceptance scope. Use fixtures for interaction regressions and physical peers for distributed claims. Keep factual answer failures even when output reaches EOS. Deploy only under ALL-6.



  **2026-10-12 shared public/local network:** [discovery and authentication repair](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/unified-network-20261012/README.md) makes public localhost origins on arbitrary ports use the same rendezvous and authenticated RTC service as hosted clients. Discovery service deployed; fresh hosted and two loopback browsers see the same ready browser/native nodes with zero weight requests. Private networks and disclosure grants stay separate. This is connectivity evidence, not new inference qualification.

  **2026-10-12 interface repair:** [chat rails and readable permissions](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/chat-rails-20261012/README.md) implements independent left/right rails, a single transcript scroller, shared icons, readable attachment review and per-answer observed execution activity. 73 focused unit tests, 17 Chromium cases, CSS, browser identity and the Verification Worker pass. Aggregate timing currently arrives at completion; no live per-token telemetry or physical inference claim. The interface is deployed through `c13cd97e`, with all 1,909 served assets verified; integrated runtime release acceptance remains open.

### DR-5

Owner: Reploid chat / history; Doppler state. Status: Source composition complete in declared scope; installed/physical gates open.

Next action: Qualify one requester-owned writer, signed conversation and long lifecycle. Dependencies: Changed-package numerical acceptance; DR-3; ordinary ordered wiring.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dr-5"></a>
- [ ] **DR-5 — Exact integrated chat journey and lifecycle revalidation. Integration active; release waits for applicable gates.** Use one immutable candidate archive, signed physical opening and real selective acquisition. Test both placements, complete useful answers, concurrent conversations, isolated cancellation, contributor stop/loss/replacement, explicit authorized retry, and settlement. Repeat the previously passed successive 1,588-token workload, allocation rejection and reuse within 1,420,000,000 allocated bytes without reopening weights. Keep earlier partial answers separate and distinguish model counting/grounding defects from distribution. REP-7 accepted-provider work continues independently. **Installed signed three-stage journey (2026-10-14):** on delivery `final-5` (Reploid `95641fe7`, candidate archive `2df37d88…`, test signing authority), the [journey harness](../../artifacts/signed-completion-journey-20261013/README.md) passes the requester journey 13/13 (run 5) and contributor loss 7/7 (run 6). A SIGKILLed stage is reported as `CONNECTION_LOST`, its cleanup stays unknown and is never settled, capacity returns through the restored contributor's fresh session, and the explicit retry completes. Still open: the 1,588-token workload and allocation reuse (about 95 minutes per answer at the measured ~3.5 s per token), the other placement, and independent answer review.

  **Canonical peer checkpoint:** [Reploid `df7b1068`](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/canonical-peer-integration-20261012/README.md) connects the existing peer to actual canonical source transitions, authenticated stage signatures and publication acknowledgments under explicit opt-in. CPU/in-memory-channel controls and 114 legacy/transport/charter tests pass; computation and durable transaction receipts are injected. This does not close physical or durable-publication acceptance. Next persist exact stage evidence with the transaction, then connect the existing runner and UI to the durable owner.

  Current integration checklist (all owned by this thread; requirements remain in the canonical topology contract):
  - [x] **Public interruption repair and short journey:** [four-contributor rollout](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/public-code-answer-20261012/followup-rollout.json), [question/follow-up](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/public-code-answer-20261012/final-public-journey.json) with no requester weights and settled cleanup, and [history/draft restoration without redispatch](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/public-code-answer-20261012/returning-requester-corrected.json). Served bundle `88b4f6bb…` reverified across all 1,921 files on 2026-10-13; accepted runtime unchanged. This does not qualify candidate signed/long use.
  - [x] **Physical signed native input opening:** [artifact `a1659225…` with runtime `0fadac51…`](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/signed-host-opener-20261012/physical/result.json) reaches ready through public host composition with signed piece verification and zero unsettled attempts. This is opening evidence, not inference, counterpart acquisition, both placements or final shutdown.
  - [x] **Physical signed Mac output opening:** [same-runtime preparation receipt](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/signed-host-opener-20261012/compact-model-advertisement/mac-opening-summary.json), model layers 12–23, 312,813,888-byte peak. This is opening after retained acquisition retries, not a completed requester conversation.
  - [x] **Native signed opener source repair:** `d9e80304`, [84 controls/types/Worker](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/signed-host-opener-20261012/summary.json); physical replacement artifact retry remains below.
  - [x] **Authenticated canonical peer source integration:** `df7b1068`, [real signatures/transitions and bounded channel controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/canonical-peer-integration-20261012/README.md); injected computation is not physical acceptance.
  - [x] **Durable signed evidence and restart verification:** `8753775e`, [atomic publication/evidence/receipt and four IndexedDB browser tests](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/canonical-publication-evidence-20261012/README.md).
  - [x] **Canonical runner publication ordering:** `7d340a95`, [durable publication before output, cancellation and independent-thread source controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/canonical-runner-integration-20261012/README.md); 114 legacy tests, types and Worker pass.
  - [x] **Latest source-ledger experiment concluded as rejected:** [flat treatment](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/cited-calculation-experiment-20261012/source-ledger/flat-experiment/RESULTS.md), zero accepted of two attempted; five unrun. This checks completion of the experiment, not answer quality.
  - [x] **Canonical requester/history/UI source composition:** `085c987c`, `0008803d`, `f9d90a08`; [automatic application evidence](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/canonical-application-composition-20261013/README.md) exercises the actual composer, authenticated entry, real signatures and IndexedDB publication before visible output. Failed admission retains drafts; newer typed text survives delayed admission. Unknown writes and rejected cleanup remain failures. Numerical steps are injected; default activation, installed-runtime and physical canonical acceptance are not established.
  - [x] **Native canonical host source composition:** `054ff994`, [native evidence](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/native-canonical-composition-20261013/README.md). Explicit opt-in, durable epochs, exact-owner settlement reconciliation and retryable participant/discovery cleanup pass source controls; startup contention and spent-budget persistence are covered. Full suite: 3,368 passed, 30 skipped; actual Worker passes. Accepted installed archive correctly refuses unsupported canonical activation. No installed canonical numerical or physical claim.
  - [ ] Package required canonical public runtime exports and qualify requester-owned durable publication through installed and physical signed execution. Preserve the passing browser/native source boundaries and default-off activation.
  - [ ] Qualify signed Capsule opening and rejected-opening cleanup using genuine qualification for the same runtime archive, real selective pieces and exact disclosure recipients.
  - [ ] Complete bounded long-concurrency runtime checks and the ordinary signed conversation journey in both browser/native placements; retain partials, surviving output and resource ownership through replacement, explicit retry and failed cleanup.
  - [ ] **Secondary; paused, not a basic-chat release gate:** document factual/citation treatment and converted/runtime application checks. Preserve rejected experiments without repairing outputs into fixture answers; resume only after core chat or explicit user direction.
  - [ ] Implement and qualify a registered, authorized composite local fork from a published cursor, including independent numerical/decoder state, real ring restoration and alias-free settlement.
  - [ ] Complete fixed two-stage replay evaluation, preparation, commit, durable publication and retry retention; enforce complete route reservations, shared device budgets, grants, epochs and unknown ownership.
  - [ ] Qualify exact-package canonical ordinary/fork/replay behavior and fixed-block performance before enabling speculation. Existing all-55 evidence proves numerical accuracy only for its declared profiles and routes.

  **Secondary attachment evidence — retained, experiments paused:** [fresh matched source-role control](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/cited-calculation-experiment-20261012/source-ledger/price-relation-diagnostic/context-ablation/result/review.json) is rejected (5/9 for both arms); no calculator/final answer executed. These results do not block basic chat.






  - [ ] **Useful inference-state reuse (DR-5 / REP-4 / REP-6):** Through existing resident, cache, attempt and recovery owners, compare cold requests, warm history-aware follow-ups, unchanged-prefix reuse, local state restoration and work lost after interruption against the pinned baseline. Saved text and resident weights alone do not satisfy inference-state reuse. Bind reusable state to exact model/adapter/tokenizer/generation/input/route identities; reject stale or mismatched state, isolate conversations and account for retained memory. Require measured end-to-end benefit, cancellation/revocation and restart controls. Qualify local reuse first; portable cross-device checkpoints remain a distinct later decision, not a prerequisite for local reuse or the first chat release.

    This is a separate benefit and isolation gate: retained weights or saved text do not establish reusable inference state. Durable publication and physical concurrent lifecycle stay on the ordinary-release path. Composite local forks and fixed speculative replay qualify separately and cannot block ordinary multistage service or Flash-Next onboarding.

### DR-2

Owner: Doppler / Reploid. Status: Partial; later expansion.

Next action: Replay embedding and scoring through the installed application. Dependencies: Separate operation and package qualification; not a chat gate.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dr-2"></a>
- [ ] **DR-2 — Replay embedding and scoring through Reploid. Partial.** [Candidate public-library controls][dop-core] pass eighteen complete-text embeddings, ordering/subdivision/repetition/cancellation/reuse, twenty-four choice logits and twelve selections. Independent jobs and introduced embedding have their own scoped Reploid evidence (REP-1/REP-5). These do not establish ordinary application acceptance with `7c240dad…`.

  Next: bind the exact tested installation to existing signed operation adapters, replay all outputs against independent references, and test UI/host reuse/cancellation. Preserve operation-specific tolerances and uncalibrated score semantics; neither 0.02 embedding nor 0.05 scoring changes chat's 0.001. Reject model/application identity or eligibility mismatches before work.

### REP-2

Owner: Reploid. Status: Deferred integration gap.

Next action: Connect existing independent-unit coordinator to ordinary indexing. Dependencies: After basic chat or explicit reprioritization.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="rep-2"></a>
- [ ] **REP-2 — Connect ordinary indexing. Deferred; integration gap retained.** `self/host/product-session.js` constructs the document assistant with a local executor. `self/pool/document-search.js:search` sends corpus passages plus query directly to `executor.run` and retains its index in memory. It does not invoke `createIndependentUnitCoordinator`.

  Next: compose the existing coordinator and `openIndependentUnitJournal` in the host, with existing signed-job preparation, placement and per-operation disclosure. Feed stable complete passage texts and original positions into the qualified embedding operation; subdivision must not retokenize arbitrary fragments or change input semantics. Separate durable corpus indexing from query embedding, reranking and generation. Project existing progress/stop/retry through `self/ui/pool-home/document-search.js`; keep local-only operation deliberate. Verify accepted-pin eligibility before a physical job; diagnostic-package evidence does not transfer automatically. Done when normal document controls create and consume a durable signed aggregate through public interfaces.

### REP-3

Owner: Reploid. Status: Deferred.

Next action: Qualify durable indexing through the actual application. Dependencies: REP-2.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="rep-3"></a>
- [ ] **REP-3 — Prove durable indexing in the application. Deferred; waits for REP-2.** Extend existing `tests/e2e/independent-units.spec.js` and document-search journeys instead of adding a new protocol. Stop admission, retain committed units across reload, replace/retry unfinished units, reject duplicate inclusion and superseded attempts, restore original ordering, and preserve unrelated conversations. Include storage failure and revoked read permission. Guarantee one accepted outcome per unit, not exactly-once remote execution. Library interruption proofs already exist; the missing proof is the ordinary host/UI path and its output vectors.

## 3. Independent concurrency

### REP-4

Owner: Reploid / Doppler. Status: Partial source and scoped physical acceptance.

Next action: Qualify exact-package long concurrent lifecycle and contribution isolation. Dependencies: Correct installed execution and ordinary chat.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="rep-4"></a>
- [ ] **REP-4 — Complete contribution lifecycle integration. Partial.** Both the existing operation owner and shared automatic partition owner now coalesce overlapping stops, block replacement until settlement, and retain failed cleanup for explicit retry. [New failing-before regressions and physical stop/retry](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/live-conversation-20261012/README.md#contribution-settlement-and-explicit-recovery) pass 74 focused tests and 12 browser checks. The physical Mac output contributor stopped during a Suby/Mac answer; a separately approved retry completed and preserved earlier partial output. Immediate retry first exposed a stale-ready/prepared-path failure. The [repair and physical repeat](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/live-conversation-20261012/README.md#readiness-after-a-physical-restart) now withdraw the rejected offer, preserve explicit retry, and complete after new readiness; the initial failure stays retained. Native piece cancellation preserves verified completed pieces and retries unfinished acquisition. Full exact-package long-prompt and signed release acceptance remain open; the [physical idle cleanup-failure control](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/cleanup-failure-20261012/README.md) now passes: failed close retains ownership and blocks reuse, Retry stopping closes the old resident, and a replacement prepares/stops independently. The subsequent [active streaming cleanup/retry](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/cleanup-failure-20261012/README.md#active-conversation-follow-up) also passes: two real approvals, interrupted partial retained, replacement retry produces exactly 1–100, and 27 prior histories remain unchanged. Measured retained-model/active/deferred pool resources reach zero, with 9,411,328 reusable bytes and 10,776 cached uniform bytes remaining. Peak device allocation is 504,255,752. This is output-owner evidence, not zero GPU allocation or the combined long/signed candidate journey. Subsequent input-side observer cleanup and debugger-resume bugs terminated that contributor after the test; both diagnostic failures and final uninstrumented same-profile restoration are retained. Input reservation settlement was not captured and remains open. The [shared signed-opening repair](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/native-signed-opening-20261012/README.md) preserves failed preparation owners across both hosts and adds durable native release checkpoints; the final canonical sweep passes 3,156 tests (29 skipped) and twelve browser checks. An updated native/browser physical two-turn control completes and observes settled unload/device destruction; physical signed opening remains unqualified. **Launch 2 contribution alongside ordered chat (2026-10-14):** the [run-5 contribution harness](../../artifacts/signed-completion-journey-20261013/README.md) passes 7/7 on `final-5`: sharing within the allowance while chatting, peer acquisition of the shared pieces, cached-only, reload, competing tabs, interrupted resume and a stop that settles in-flight transfers without cancelling the conversation. A lost ordered contributor now leaves an unknown receipt rather than retryable debt, so Stop succeeds after the loss (run 6).

  **Storage increment accepted in scoped browser controls:** [independent file participation](../../artifacts/storage-contribution-20261013/README.md) adds cached-only, bounded authenticated-piece acquisition and explicit full-model seeding independently of compute. Durable acquisition allowances survive reload and serialize tabs; stopping storage settles its work without stopping an injected active conversation. 116 unit tests and 16 Chromium checks pass, including the Verification Worker and one real 4 MiB model-piece acquisition. This does not close physical installed conversation acceptance.

  **Ordinary contribution acceptance (independent of Doe):** the action is helping keep a selected model available, followed by explicit resource allowances and permissions. Assign useful work within those allowances; idle a device when additional work is unnecessary. Verify responsive stop, observed contribution outcomes, unrelated-conversation survival and honest uncertain settlement through existing owners. Measure foreground responsiveness, energy/transfer cost and useful completed work where available; report unavailable metrics. Generic contributor impact belongs here; ER-5 retains provider-specific comparisons.

## 4. Flagship support

### ALL-7

Owner: Doppler model owner / Reploid integration. Status: Flash-Next target; checkpoint-specific qualification open.

Next action: Pin source/license/reference and prepare operator fixtures during repair. Dependencies: Installed flagship execution waits for repaired engine; no older-model port.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-7"></a>
- [ ] **ALL-7 — Maintain scope. Ongoing.** Finish the current execution foundation and dependable community chat. Qwen3.8-Flash-Next is the primary next model under DR-6. Its source analysis, reference preparation and operator fixtures can proceed during repair; installed distributed qualification requires the repaired engine and checkpoint-specific proof, not assumed compatibility from existing operators. No mandatory older-model port, release or speculative decoding dependency applies. Qwen3.6 is optional diagnostic work, 122B/397B are not mandatory milestones, and 2.4T remains conditional on licensed hardware, budgets and justified benefit. Preserve broader platform coverage as separately qualified work. Doe/compiler/provider experiments are optional measured-bottleneck improvements, not community-release gates. Continue to defer browser replacement, portable cross-device checkpoints, language rewrites and parallel schedulers/publication frameworks unless an explicit owned gap requires a reviewed extension. Preserve completed synchronization/evaluation publication and existing canonical fork/replay constraints.

## 5. Efficient acquisition

### REP-5

Owner: Reploid custody / transport / host. Status: Scoped mechanisms complete; ordinary journey open.

Next action: Exercise acquisition, introductions and the bounded storage modes below in installed chat. Dependencies: Actual disclosure grants and installed package.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="rep-5"></a>
- [ ] **REP-5 — Verify integrated acquisition and introductions. Scoped mechanisms complete; ordinary journey open.** [ICE teardown reproduction and repair](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ice-acquisition-20261011/README.md) closes a reproduced acquisition defect. The earlier uninstrumented missing-piece trigger remains unknown. [Signaling independence](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/signaling-independence-20261011/README.md) and [introduced embedding across Mac/Linux](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/peer-introductions-20261010/embedding-20261011/README.md) pass their recorded controls; the latter used diagnostic archive `414f61c3…`. **Launch 2 acquisition (2026-10-14):** in the [run-5 contribution harness](../../artifacts/signed-completion-journey-20261013/README.md) another computer acquired 32 verified pieces (4.86 MB) from a browser sharer with no weight HTTP requests, and an interrupted acquisition resumed without re-downloading verified pieces.

  **Bounded storage participation:** [source and browser evidence](../../artifacts/storage-contribution-20261013/README.md) verifies authenticated inventory reconstruction, zero-download cache-only behavior, exact-range acquisition, metadata/retry charging before transfer, and shared-tab allowance enforcement. The real-origin receipt binds 4,442,765 reserved bytes to pinned Qwen metadata and one verified piece. The remaining ordinary installed acquisition/introduced-peer journey below is unchanged.

  **Service and acquisition boundary:** community service serves shared model demand through currently available authorized capacity in the open mesh. Discovery remains automatic. Preserve operator-approved authorization scopes, separate custody/compute/disclosure grants, expiry, revocation and actionable unavailable-capacity behavior without requiring rooms. Future reserved service would require admitted supply and independently situated replacement coverage; defer subscriptions, billing and availability commitments until dependable capacity exists. Verified supply and discovery never authorize private disclosure; contribution creates no unlimited entitlement. Reuse DR-3 grants and DR-6 reservations.

  The ordinary journey exposed terminal RTC loss that never retried while signaling stayed healthy. `c34ba38d` reuses bounded discovery rejoin; focused regression fails before repair. [Physical requester connection close](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/live-conversation-20261012/rtc-recovery.json) re-establishes a route while all three unrelated connections remain connected; [a follow-up then completes](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/live-conversation-20261012/after-rtc-recovery.json), with no page reload. This controlled close is not an arbitrary-NAT or cable-outage claim.



  Next: reuse these mechanisms in the accepted-pin journey with authenticated introductions, configured bootstrap alternatives, supplier replacement and reconnect. Preserve manifest/grant binding, separate introduction/file/compute permissions, and bounded error categories. Record the missing piece, advertisements, verified retention, grants, cancellation and replacement if acquisition fails. A healthy data channel must survive signaling loss; bootstrap availability is not execution readiness. No claim of arbitrary NAT traversal or public discovery follows from configured fixture routes.

### REP-5 progressive storage acceptance

Source and scoped browser acceptance now pass in [the storage increment](../../artifacts/storage-contribution-20261013/README.md), source `e8258bc7`, evidence `92642382`. Owner: existing Reploid custody/accounting and host owners. Next: qualify these modes alongside real installed conversations and introduced suppliers. Dependencies: explicit allowances, verified metadata/bytes, durable shared accounting and the qualified installed runtime. The completed controls use injected chat execution; the real-origin download does not qualify GPU conversation or live-mesh delivery.

Required storage acceptance, attached to REP-5:

- **Cached-only sharing:** serve only already-cached, verified bytes and locally available verified metadata. Never fetch missing metadata or pieces. Missing local verification material leaves the piece unavailable for sharing.
- **Bounded acquisition:** explicit allowances cover metadata, pieces and retries. Persist usage and reservations across reloads and competing tabs so concurrent activity cannot overspend a shared allowance. Test interrupted transfers, exhausted budgets and retry accounting.
- **Explicit full-model seeding:** separately authorize full-model acquisition and retention with visible resource scope. Neither cached-only nor bounded acquisition implies this grant.
- Rebuild inventory from verified metadata and actual cached bytes after reload or interruption; stale inventory is not proof of custody. Extend existing custody/accounting rather than creating another framework.


## 6. Automatic prepared placement

### DR-6

Owner: Reploid placement / reservations; Doppler execution. Status: Configured source composition passes; repaired archive `2df37d88…` passes the 55-prefix physical capture and cleanup; a first correctly bound rerun was interrupted by the supervisor deadline after 39 prefixes; a second completed all 55 prefixes and its three partition reports were accepted by the unchanged producer and the archive's validators.

Next action: Bind the genuine `2df37d88…` reports into signed delivery, then qualify signed installed chat on configured prepared routes. Dependencies: Unchanged independent reference/tolerance, complete route admission and automatic requester selection; autonomous cold preparation is Launch 3.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dr-6"></a>
- [ ] **DR-6 — Useful combined capacity. Unqualified.** Compare cooperative execution with constrained standalone controls using fixed per-contributor budgets, precision, context and useful-answer requirements. Retained recovery allocations are below budget but do not establish successful larger-model capacity. Multiple participants/routing alone is insufficient. Implement through the same interface in parallel with DR-5; physical capacity claims require the applicable ordinary execution and lifecycle gates, without increasing budgets or trimming prompts.

  - [ ] **Changed three-host archive qualification (DOP-6 / DR-6):** historical archive `9264d265…` fails the original long-prefill prefix after four passing prefixes. Doppler `a5f3ca4c` repairs immediate paired-kernel completion in current archive `2df37d88…`; its [installed original-prefix comparison](https://github.com/clocksmith/doppler/blob/f540465c/artifacts/kernel-completion-repair-20261013/installed-prefix-comparison.json) passes all 248,320 logits with maximum error `9.47e-7` at unchanged `0.001`. The [three-host capture](../../artifacts/completion-candidate-20261013/summary.json) now passes all 55 prefixes (maximum error `9.52e-7`) and cleanup. Report production remains rejected by a frozen graph-file versus execution-identity hash mismatch; the freeze script is fixed and the [original rejection](../../artifacts/completion-candidate-20261013/report-binding-rejection.json) retained. This checkbox stays open pending correctly bound qualification. [Raw failure and cleanup](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/cold-compile-native-20261013/three-stage/disposition.json) and [F64 stage attribution](https://github.com/clocksmith/doppler/tree/5b009277/artifacts/ordered-partitions-20261013/long-prefill-boundary) are separate evidence: preparation passes, inference fails, cleanup passes. Fresh candidate bytes require fresh applicable qualification.

  **Launch boundary:** Launch 1 requires automatic requester selection of eligible configured prepared routes, signed conversations and bounded isolation/retry behavior. It does not require autonomous cold assignment or demand-driven replicas (Launch 3). Storage/chat compatibility testing preserves Launch 2 as a separate capability. The numerical fixed route is not evidence of automatic application behavior. The [projection diagnostic](https://github.com/clocksmith/doppler/blob/175ec7a4/artifacts/kernel-completion-repair-20261013/projection-outlier-simulation.json) remains failed at its original `2e-12` synthetic bound; CPU reduction reproduces the retained GPU pair.

  **N-stage implementation checkpoint (2026-10-13):** source work is active, not deferred. Doppler `76a9d4fe` adds versioned ordered layer plans and `81a5a345` adds generic entry/middle/final resident execution with final-only sampling and provider-owned generation hashing. Reploid `cefbd715` adds immutable full-route identities, explicitly versioned discovery offers and bounded replica matching. The [ordered ordinary runner](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-route-runner-20261013/README.md) traverses every stage, admits the complete route before input disclosure and retains uncertain cleanup until retry settles it; source tests exercise 2–7 and 16 logical stages and twenty requesters. [Actual source composition](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-route-integration-20261013/README.md) joins real resident admission/sampling/decoding to the runner with injected numerical kernels; it retains the initial digest mismatch and passing correction. This is source/component acceptance, not signed remote execution, physical capacity or deployment. Coordinator-mediated intermediate disclosure is explicit; direct adjacent delivery, installed/physical authenticated host acceptance, shared-device admission and N-stage signed qualification remain open; explicit host/transport wiring now has scoped source acceptance below.

  - [x] **Ordered resident/peer source boundary:** `b784c91a` maps immutable route identity through the actual resident lifecycle; `369c324f` adds authenticated ordered binary peer execution with full transfer grants, duplicate protection and cleanup ownership. Focused CPU/source controls pass; no physical-network or GPU claim. Real facade/v4-grant composition is retained in [source integration](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-route-integration-20261013/README.md).
  - [x] **Per-stage conversation pipeline controls:** the existing ordered runner leases each stage independently, allowing another conversation onto an earlier stage while a later stage is occupied. Same-stage execution remains serialized; queued cancellation/revocation and unrelated-conversation survival pass. [Runner evidence](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-route-runner-20261013/README.md) records 48 focused controls and actual Verification Worker acceptance. This does not establish cross-route fairness, physical-device accounting or hardware speedup.
  - [x] **Explicit browser/native stage preparation:** [host controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-host-preparation-20261013/README.md) snapshot the assigned stage, require public ordered provider capability before acquisition/native GPU initialization, validate the actual plan index, and await resident preparation. Ninety focused tests and actual Verification Worker pass. Automatic host identity composition and physical N-stage opening remain open.
  - [x] **Ordinary ordered chat/entry source path:** `33fa5b90` connects full-route chat, v4 grants, authenticated entry streaming and route-preserving summaries; public requester retries bind fresh attempts to exact approved routes. Ninety-four focused tests and actual Verification Worker pass. Independent [actual source integration](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-route-integration-20261013/README.md) uses real peer/facade/runtime lifecycle with injected numerical kernels; physical chat and installed delivery remain open.
  - [x] **Inventory versus complete entry readiness:** [discovery controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-discovery-20261013/README.md) retain ready stage inventory without exposing incomplete routes as usable chat models. Full coordinator/transport/resident/execution/plan/model/layout bindings are required for ordered entry hints; legacy requesters exclude ordered routes. Thirty-one focused controls and actual Verification Worker pass.
  - [x] **Full-route activity projection:** [source and Chromium controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-chat-activity-20261013/README.md) display every assigned stage, retain labels after discovery loss, and use bounded measured stage timings for one time-share bar and token rates. Missing timings remain pending; current requester streaming does not forward live stage timing. This is presentation/measurement plumbing, not hardware speed or physical N-stage acceptance.
  - [x] **Explicit ordered automatic source composition:** [ownership and in-process network controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/automatic-ordered-participation-20261013/README.md) connect declared stage preparation, full-route discovery, authenticated route-keyed peers and ordinary chat/entry. Local stage zero can request its own route without RTC-to-self; weightless requesters load no model. Exact recipients/input/deadline remain bound through approval, healthy channels survive discovery loss, and unknown cleanup stays owned through retry. Seventy-four focused tests, library types, charters and actual Verification Worker pass (warnings retained). Certificate verification and numerical stage ports in the four-logical-participant control are injected; host composition, autonomous cold stage assignment and physical/installed/signed qualification remain open.
  - [x] **Automatic cross-size source composition:** the same [actual network-owner controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/automatic-ordered-participation-20261013/README.md) pass 2–7 stages, each with two concurrent local/remote requesters, zero weightless-requester loads, exactly N−1 execution channels, signaling-enumeration loss and settled per-stage attempts. Certificate verification and numerical stage ports are injected; these are 3–8 logical participants in one process. Physical scale, overload, replicas and the broader cross-size failure matrix below remain open.
  - [x] **Browser/native ordered host composition and retry ownership:** `9f55a5f1` forwards an explicit ordered configuration from product-session/native CLI through actual participant/transport binding; failed connection, contribution and network owners remain retryable and block replacement until settled. `d29cdec8` retains the native provider through the owned device loss barrier, including bounded timeout and confirmed-loss retry. [Combined source checkpoint](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-source-checkpoint-20261013/README.md) passes 511 tests with one existing skip. The [installed native candidate](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-native-delivery-20261013/README.md) verifies 108 application and 1,976 runtime files; the [narrow actual Suby host control](https://github.com/clocksmith/doppler/tree/2cfc892c/artifacts/ordered-partitions-20261013/suby-paired-control/actual-native-host) passes four paired casts and actual provider close with observed device loss and natural process exit. Full-model lifecycle and signed N-stage execution remain open; no public default or pin changed.




  - [ ] **Ordinary ordered application wiring:** browser/native host composition and configured 2–7-stage source composition above remain checked. Complete installed authenticated execution with one exact qualified archive, signed opening, actual route recipients, streamed useful replies and requester-owned history. Keep multiple route bindings independently owned. Known configured routes are not autonomous preparation: cold stage assignment, demand-driven replicas, cross-route fairness and shared-device accounting remain distinct open controls below.

  - [ ] **Multistage contract extension:** ordered stage/model/layout identities and source route composition exist. Complete installed/physical proof of per-stage permissions/acknowledgments, all-route admission and settlement, then autonomous cold assignment, replica preparation, fair bounded queues and shared browser/native device budgets. Bind route and every boundary before disclosure. Lost-state replacement creates a fresh authorized attempt. Extend existing placement/reservation owners beyond RD-CANON/1's two-stage acceptance explicitly; do not infer automatic preparation from configured routes.

  - [ ] **Cross-size and multi-requester coverage:** use the same ordered-route implementation for 2, 3, 4, 5, 6 and 7 stages, plus larger generated cases within declared bounds. Cover uneven contiguous layer ranges, absent/mismatched middle stages, replica alternatives, heterogeneous browser/native capabilities, nodes both requesting and contributing, queue saturation, cancellation at every stage, expired grants, disconnects, duplicate/out-of-order deliveries and unknown settlement. Test interactions with generated/replayable schedules instead of claiming exhaustive coverage of an unbounded network. Label logical-node simulation separately from independent physical machines.
  - [ ] **Independent-user demonstration (MESH-01):** Freeze two distinct basic-chat tasks with independently checkable outcomes and follow-ups, separate users, histories and recipient grants. Run overlapping requests over shared physical contributors. Join additional capacity, withdraw an idle supplier, cancel one request, then lose an assigned executor in separate controls. Unaffected work must finish correctly and remain durably saved; affected output stays separate, replacement requires a fresh authorized attempt, and reservations settle or remain charged as unknown. Record actual host failure domains, route/replica choices, per-user results and zero requester weights. Source-only or two tabs on one machine do not establish this physical claim.

    Source checkpoint `95dda466`: [automatic multiuser isolation](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/automatic-ordered-isolation-20261013/README.md) exercises two requesters and two three-stage routes sharing a final resident. Distinct fixture responses remain isolated through cancellation, a replica joining, selected-middle withdrawal and separately approved replacement. Forty-seven focused controls and the actual Worker pass. Its reproduced retirement failure is repaired by `73beb41a`: [authenticated settlement receipts](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/ordered-peer-retirement-20261013/README.md) retain delayed/lost acknowledgments for retry before channel closure. Eight logical owners in one process, injected computation and ordinary output do not qualify useful model answers, physical failure domains, canonical durable publication or this physical demonstration.

  - [ ] **Workload-specific comparative evidence:** test the hypothesis that pooling already-owned memory and computation provides persistent access to a useful large model. Declare the workload, configuration, consequential advantage margin and explicit regression limits before measurement. Use relevant Pooled, strongest-feasible standalone and equivalent centralized controls; competitor features do not independently create requirements. Compare matched model/weight/tokenizer/generation settings where compatible, and separately compare useful alternatives within the same task and hardware budgets. Record incompatibilities, procurement gaps and unfavorable results. Measure useful-answer quality, latency/tails, sustained availability, throughput, allocated versus observed memory, transfers, recovery, contributor impact and complete cost as applicable. Separate preparation from resident use and publish reproducible evidence. Affordability remains unproven until measured. A claimed gain cannot excuse a breach of the declared regression limits; signatures do not prove honest or secret remote computation.
  - [ ] **Selected-model/platform coverage (DOP-6 / DR-6 / ALL-7):** Qwen3.8-Flash-Next is the primary next model. Pin the checkpoint, tokenizer, license and source architecture; establish an independent reference and conversion-quality controls. Explicitly cover sparse attention, gated residuals, n-grams and expert execution against that checkpoint; feature names are acceptance questions until source contracts verify their semantics. Before physical qualification, establish real hardware, memory-tier placement, concurrent-state requirements and admitted budgets. Include browser/native and relevant Mac/Metal, Linux/Vulkan, Windows/D3D12 and phone roles with separately scoped evidence. Qwen3.6 is optional diagnostic work; 122B/397B are not mandatory milestones; 2.4T is conditional on feasible licensed hardware and independently justified useful benefit. Source analysis, independent reference preparation and operator fixtures can proceed during repair. Installed distributed qualification depends on the repaired engine; existing operators do not establish checkpoint compatibility. No mandatory older-model port, deployment or speculation dependency applies. Doppler owns model/offload mathematics; Reploid owns eligible acquisition, placement and admission.

    **Economic hypothesis and comparison:** affordability is unproven. Compare complete service cost with relevant hosted APIs, rented capacity, conventional hybrid-memory execution and simpler coordination on identical machines for the declared workload. These are controls for the claimed advantage, not a universal competitor feature checklist. For Flash-Next, test local host-memory embedding offload before attributing memory savings to the mesh. Freeze quality, context, concurrency and latency requirements; compare complete service cost including donated resources, compensation, preparation, transfers, replication, recovery and rejected demand. Report unavailable costs and incompatible configurations without silently substituting them.

  - [ ] **Efficiency mechanisms with separate acceptance:** retain verified weight-piece custody and resident reuse; measure route costs and stage bottlenecks before introducing adaptive ranking or demand-driven replicas. Layer pipelines, weight storage, tensor parallelism, speculative token drafting/replay and replicated computation are distinct mechanisms. Inventory their existing contracts before implementation. Predictive tokens require target-model acceptance and safe publication; peer agreement or majority voting cannot replace numerical correctness, authorize disclosure, or silently change the requested model. Any tensor-parallel or consensus extension needs explicit semantics, resource ownership and measured end-to-end benefit, not merely more participating nodes.

    For Flash-Next, conventional local host-memory embedding offload is an explicit control before a distributed-savings claim. Select a mechanism only for a measured application bottleneck and include preparation, retained state, communication and recovery in its benefit calculation; an isolated kernel gain cannot qualify the service.

  - [ ] **Replica and scheduling acceptance:** test the intended 12-node/3-stage/4-replica arrangement, 20 questions/60 stage states with five-state per-node limits where measured memory permits, and a 100-node/multiple-model mix. Share immutable resident weights while charging each admitted conversation’s private state and temporary buffers. Bound admission and queued work by memory, compute allowances and permissions; measure fairness and starvation under overload. Replicate stages from observed demand and preparation/transfer cost within explicit supply and compute grants. Include storage-only and mixed suppliers with separate consent, cold preparation, competing requests, constrained compute, stage failure, explicit retry and useful-work/latency/cost comparisons. These are targets, not current support or claims of simultaneous GPU execution.

    **Placement acceptance:** each admitted placement must measurably complete a missing route, relieve a bottleneck, provide independently situated replacement capacity, or admit another useful request. Count preparation time, transfers, retained state and correlated failure domains. Preserve the 12/20/100 targets, but advertise a configuration only after measured per-device budgets, bounded queues, fairness and unaffected-conversation survival pass. Community supply is availability-based. Sustained useful access and complete-cost evidence precede commercial commitments; future reserved service would require the admission and replacement coverage in DR-3/REP-5.

**Upgrade rule:** adopt one standard archive only after its applicable numerical, lifecycle, model-quality and application gates pass. Successful embedding does not qualify generation or W8A8; unrelated Doe performance research is not a release gate.

## 7. Progressive contribution

### REP-1

Owner: Reploid / existing delivery coordinator. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="rep-1"></a>
- [x] **REP-1 — Preserve completed foundations.** The [independent-unit coordinator and aggregate journal](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/independent-units-20261011/README.md), [installed interrupted-job controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/independent-units-20261011/physical/README.md), and [contribution-stop repair](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/operation-participation-lifecycle-20261011/receipt.json) exist. Actual embedding interruption evidence is one AMD machine with logical providers; the sharing-control repair uses synthetic model results. Do not rebuild these as another scheduler or journal. Retain callback isolation and the [completed stage-overlap investigation](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/partition-stage-timing-20261011/README.md), which established no useful overlap gain.

## 8. Permission and recovery

### REP-6

Owner: Reploid / existing delivery coordinator. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="rep-6"></a>
- [x] **REP-6 — Preserve honest recovery contracts.** [Contract controls](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/partition-contracts-20261010/README.md) and [bounded failure categories](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/partition-failure-categories-20261011/README.md) retain canonical attempt identities, paired requester/placement fields, explicit readiness, and unavailable replay/checkpoint capabilities. Changed bindings reject; authorized restart creates a new attempt and keeps prior partial text separately. Transport loss never proves remote GPU cleanup. This checked contract does not close physical recovery/quality acceptance in DR-5.

### DR-3

Owner: Reploid grants / reservations. Status: Active; source controls do not establish full physical acceptance.

Next action: Qualify exact input and actual-recipient grants in installed conversations. Dependencies: Installed signed execution; indexing only for deferred durable outputs.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dr-3"></a>
- [ ] **DR-3 — Verify permissions in the distributed conversation. Active; no indexing dependency.** Bind operation, complete input scope, model identity and placement in each signed request. Test disclosure denial, changed input, wrong operation, expiration and revocation in generation and attachment flows before execution. Durable-output checks resume with REP-2/3. Embedding permission does not authorize generation, reranking or extra disclosure. Reuse current signed-job and permission controls rather than a new grant system.

  **Community versus reserved service:** community is shared demand for one model in the open, self-organizing mesh, not a room or membership prerequisite. Discovery is automatic; contribution, operator-approved recipient scopes and private input disclosure require separate grants with expiry and revocation. Current access depends on available authorized supply. Define future reservation admission, replacement coverage and unavailable-capacity behavior, but defer subscriptions, billing and availability commitments until dependable capacity is proven. Contribution grants no unlimited future service.

## 9. Physical release

### DR-1

Owner: Reploid / existing delivery coordinator. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dr-1"></a>
- [x] **DR-1 — Keep accepted and candidate identities separate.** The accepted archive is 0.6.27. Current unpromoted numerical candidate: 0.6.28 archive `2df37d88…`, source `a5f3ca4c`. Historical 0.6.28 archive `0fadac51…` retains its earlier two-stage evidence; the shared version string grants no shared acceptance. [Reploid pin](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/self/config/doppler-package.json) still selects the standard archive. This audit freshly hashed that archive and compared every installed archive member without mismatches. Historical installed identity is retained in [DOP-8][dop-package]; current isolated [installation and qualification evidence](../../artifacts/completion-candidate-20261013/README.md) binds the replacement archive separately. Candidate testing is not an upgrade.

  | Identity | SHA-256 / location |
  | --- | --- |
  | Accepted archive | `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`; `deploy/artifacts/doppler-gpu-0.6.27.tgz` |
  | Accepted package member inventory | `45754d29df6b280431fae0806a1872cf694841dbdffe05acab38e4864aa82572`; sorted UTF-8 `path TAB sha256 LF` over regular archive members; all matched `node_modules/doppler-gpu/` |
  | Historical 0.6.27 candidate archive | `7c240dad4d1ae98e204e9727e687b9bc4379abd758b16af0fd857a99d7adac8d`; retained Linux installed receipt/inventory in DOP-8 |
  | Current 0.6.28 numerical candidate | `2df37d88f592b523bb90c4c79840354fd301af9803a7d9009e1c8939561c71f8`; [exact archive and single-prefix receipt](https://github.com/clocksmith/doppler/tree/f540465c/artifacts/kernel-completion-repair-20261013), [three-host campaign](../../artifacts/completion-candidate-20261013/README.md); no public promotion |
  | Historical 0.6.28 two-stage candidate | `0fadac5113d2cc154f65d9d40de50722a16454995e927c7d22bedc5f1a4925cd`; [native/browser evidence](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/resident-readiness-qualification-20261012/results/summary.json), unpromoted |
  | Projection archive | `128bbc084593483c2f4e4c532f8b118e2c25b68d7f7f1b0dd3ee73adec8911af`; DOP-5 |

### ALL-1

Owner: Reploid / existing delivery coordinator. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Exact original artifact and declared scope.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-1"></a>
- [x] **ALL-1 — One canonical queue and sole driver.** This thread (`/root`) directs all ordinary release and RD-CANON/1 work, delegates bounded tasks, coordinates shared machines, integrates evidence and controls applicable promotion. The former independent topology roadmap is consolidated below. The original audit reorganizes the existing TODO into the seven requested sections with all 46 stable IDs. Doppler's TODO and the checklist pointers in Doe's status front door have been removed. Repo-local evidence remains with its owner. No duplicate active roadmap was created.

  The [previous checklist at dd4e1275](https://github.com/clocksmith/reploid/blob/dd4e12759128e9a38f63f16a3c02c132835eeab5/TODO.md) preserves the complete earlier chronology, rejected candidates and reference-activation reversal. It is historical, not a second work queue. Migration: W1/W2 → DOP-1/2; W3 → DOP-3/4/7/8; old 1 → DR-1; 2–5 → REP-6/REP-1; 6 → DOP-2/DR-5; 7–8 → DOP-6/ALL-4; 9 → REP-7/DR-5; 10–12 → REP-5/REP-6; 13–15 → REP-7/DR-5; 16 → DR-6; 17–18 → DOP-8/ALL-6; 19–22 → REP-1/2/3/DR-2; 23 → REP-1/DD-4; 24 → REP-5; 25 → ALL-7. Earlier completed diagnosis remains complete even where broader acceptance is open.

### ALL-2

Owner: Existing delivery coordinator. Status: Required per physical run.

Next action: Check live controllers and reserve the bounded physical run. Dependencies: No inherited standing GPU reservation.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-2"></a>
- [ ] **ALL-2 — Assign physical windows. Required for each new run.** Use the authorized heavy Linux host for expensive diagnostics, Suby for another compatible physical executor, and Mac through the agreed controller. Before each run, check live owners and record the controlling session, host/GPU, browser/profile, workload, other GPU consumers and release/settlement. The previous owned CPU/browser runs are closed; that is not a standing reservation or proof of present availability. Preserve the existing public contributor and retain any measurement interference. UI/source work can proceed without a GPU reservation.

### ALL-3

Owner: Existing delivery coordinator / owning repositories. Status: Ongoing; candidate handoffs open.

Next action: Freeze and verify exact served and installed identities. Dependencies: Applicable source and package checks.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-3"></a>
- [ ] **ALL-3 — Freeze and verify each handoff. Ongoing.** Record application bundle, archive and installed files, model, tokenizer, shader, independent reference, provider library, GPU and driver. Verify actual served/loaded bytes and execution path, not just advertised hashes. DR-1 and DOP-5 are audited starting points; native and physical candidate handoffs remain open. Refresh generated artifacts from their source, never patch browser copies independently.

  Keep one accountable owner and one current next action per existing ID. Record applicable evidence states with exact identities and links; separate source, installed, physical, lifecycle and product proof when the milestone actually crosses those boundaries. Minor tasks do not require five reporting exercises. Preserve historical acceptance, while changed packages remain separately unqualified and cannot inherit it.

### ALL-5

Owner: Existing delivery coordinator. Status: Ongoing.

Next action: Integrate only owned deltas with applicable checks and report identity. Dependencies: Preserve concurrent edits and repository instructions.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-5"></a>
- [ ] **ALL-5 — Commit owned deltas and report identity. Ongoing.** Work directly on each owning main branch; preserve concurrent edits; stage only this task, check relevant links/anchors and diffs, then commit/push without force. Existing source sweeps remain retained; focused checks accompany subsequent tooling changes. This audit changes tracking only, not runtime or generated delivery. Each implementing agent reports evidence and pushed revisions to root; root updates canonical acceptance status rather than creating another queue.

  Keep current actions in this checklist and move chronological investigations into linked evidence summaries, preserving original failures, approvals and identities. Update the existing ID's next action and applicable evidence at material handoffs; do not duplicate reports for minor changes. Committing evidence does not change its acceptance scope.

### ALL-6

Owner: Existing delivery coordinator. Status: Candidate chat not ready.

Next action: Qualify exact configuration, then seek applicable deployment authorization. Dependencies: Numerical, package, lifecycle, permission and basic-chat gates.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-6"></a>
- [ ] **ALL-6 — Promote and deploy only applicable qualified configurations. Not ready for candidate chat.** After applicable package/numerical/lifecycle/basic-chat application gates and deployment authorization, verify served app/package identities, fresh-browser use, saved history/drafts and successful requests after interruption. Contribution remains optional. Document/attachment quality, speculation, Doe performance, optional mesh capacity and external adoption are not gates for an otherwise qualified basic-chat release. Do not deploy failed Gemma W8A8 or silently replace the standard archive.

  Release approval applies only to explicitly qualified model/runtime/host/route configurations. Show community adoption, reserved commercial commitments and technical release decisions separately; none silently grants the others. An older-model release is not a prerequisite for primary-next-model implementation.

## 10. Demonstrated advantage

### DOP-4

Owner: Doppler. Status: Paused.

Next action: Resume only on renewed priority; finish retained missing measurements. Dependencies: No basic-chat dependency.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dop-4"></a>
- [ ] **DOP-4 — Finish missing frozen measurements. Partial; paused at user-priority handoff.** All four F16-versus-packed cases completed with ten pairs each. Packed complete-operation median paired ratios are approximately 2.16–2.39 times F16: slower, on these unqualified fixed-prefix workloads. Q4 stopped after five complete pairs in its first case; portable was not started. [Batch disposition][dop-benchmark] retains the controlled stop, all samples, and the failed both-resident attempt.

  If this measurement batch is resumed in an assigned window: use `tools/w8a8-benchmark-scenario.js` with the retained benchmark contracts; record a continuation identity, complete remaining Q4 coverage and portable comparisons without silently pooling incompatible sessions. Keep serialized residency and equal reuse; include quantization, packing, rescaling, submission, required completion/readback in the declared operation. Report loading/warmup separately. Completion requires all planned cases and adverse results retained, not a speed win or model promotion. No native provider claim follows from these quantization comparisons.

### DOP-7

Owner: Doppler. Status: Not selected.

Next action: Identify a cause before proposing another W8 quality candidate. Dependencies: DOP-4.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dop-7"></a>
- [ ] **DOP-7 — Require a cause before another W8 quality candidate. Not selected.** After DOP-4, identify a specific quantization or quality mechanism from [actual-operand/source comparisons][dop-quality], rather than adjusting policy until old tasks pass. Freeze a new hypothesis, identity, independent checks, and fresh quality cases. Preserve model constants and the rejected candidate. No new model family, quantization policy, or numerical substitution is authorized by an operator speed result.

### DOE-1

Owner: Doe. Status: Complete only for retained scope.

Next action: Preserve accepted or rejected scope; requalify changed bytes. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="doe-1"></a>
- [x] **DOE-1 — Packed-operation correctness.** [Retained compiler and AMD/Vulkan controls][doe-packed] cover signed/unsigned packing, clamping, unpacking, dot products, constant expressions, and single argument evaluation. Preserve normalized-packing repairs and failed Dawn tie controls separately. Portable integer lowering remains the baseline; hardware acceleration and physical Metal/D3D12 support are not established by it.

### DOE-2

Owner: Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="doe-2"></a>
- [ ] **DOE-2 — Smallest qualified mixed-compiler boundary. Source gap identified.** `runtime/zig/src/native/shader/doe_shader_native.zig:createFromSPIRVOwned` stores imported words but initializes binding metadata empty and workgroup dimensions to one. The ordinary JavaScript shader path is WGSL; imported C-ABI support alone does not qualify the matrix.

  Next: map the frozen fixture's entry points, explicit binding layouts/ranges, workgroup dimensions, specialization constants, validation and safety requirements to native admission. Repair only the metadata path needed to execute this fixture; add rejection checks for mismatches and unsupported requirements. Account for Dawn's validation/reflection/retranslation when testing its import path. Completion is a reconstructable, validated import contract, not merely SPIR-V emission. Source/interface work needs no benchmark GPU.

### DOE-3

Owner: Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="doe-3"></a>
- [ ] **DOE-3 — Record actual Vulkan integer-dot capabilities. Not established.** The existing [device discovery][doe-device] identifies the tested AMD adapter/driver but does not establish signed/unsigned packed-dot acceleration properties. Next: retain the relevant feature and property query values, enabled device features, exact GPU/driver/configuration, and unsupported disposition. Query availability separately from accelerated signed/unsigned behavior. This lightweight discovery must not interrupt an occupied measurement window; never infer acceleration from WGSL feature exposure.

### DOE-4

Owner: Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="doe-4"></a>
- [ ] **DOE-4 — One accelerated-lowering candidate. Waits for DD-2 and DOE-3.** Target a supported packed integer-dot instruction while preserving signedness, exact integer semantics, and single argument evaluation. Keep model names/scales/application policy outside `runtime/zig/src/compiler/wgsl/emit/emit_integer_dot.zig`. Preserve the portable path explicitly when acceleration is unavailable. Record emitted binary identity before qualification.

### DOE-5

Owner: Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="doe-5"></a>
- [ ] **DOE-5 — Qualify accelerated execution before timing. Waits for DOE-4.** Validate SPIR-V; run exact outputs against the independent projection reference, boundary operands, applicable allocation/failure and cleanup controls. Observe the actual loaded library and executed shader, not just generated bytes. Completion applies to the tested Vulkan device; translations do not grant physical Metal/D3D12 acceptance.

### DOE-6

Owner: Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="doe-6"></a>
- [ ] **DOE-6 — Select the next general correction from measurements. Waits for DD-4.** If generated code limits the workload, repair lowering. If execution costs dominate, fix the measured preparation/allocation/synchronization/readback owner. Retain unfavorable results and readable ownership/failure paths. Do not launch an unrelated optimizer campaign before the matrix identifies a useful target.

### DD-1

Owner: Doppler / Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dd-1"></a>
- [ ] **DD-1 — Doe accepts the frozen projection. Deferred; DOP-5 prerequisite complete.** Use [projection.tar.gz and manifest][dop-export]. The producer's export test/hash audit passes; a Doe-owned consumer has not yet demonstrated reconstruction. Extend the existing native benchmark ownership to load every declared buffer, stage, constant and expected result. Verify activation bytes, I32 accumulators, both F32 scaling stages and zero status. Keep the oracle external to Doe's compiler. Record fixture/package/library identities and explicit rejection of incomplete metadata.

### DD-2

Owner: Doppler / Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dd-2"></a>
- [ ] **DD-2 — Ordinary-provider projection controls. Waits for DD-1 and ALL-2.** Extend `bench/executors/run-packed-integer-controls.mjs` or a focused runner in that existing surface. Execute the same full projection through ordinary Dawn and Doe WebGPU on the same AMD/Vulkan host, observing compilation, submission, readback and cleanup. Existing packed-integer microcontrols are not this projection. Separate normalized-packing halfway failures. Correctness must pass before timing or DOE-4 promotion.

### DD-3

Owner: Doppler / Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dd-3"></a>
- [ ] **DD-3 — Incremental compiler/runtime matrix. Waits for qualified DOE-2 metadata.** Record Tint+Dawn, Tint+Doe, Doe-compiler+Dawn and Doe-compiler+Doe separately. Start from ordinary-provider controls; mark unavailable arms unsupported with a concrete reason. Observe compiled and executed bytes. Disclose Tint validation, reflection or retransformation; WGSL preprocessing is not direct SPIR-V execution. Useful ordinary-provider findings need not wait for every experimental arm.

### DD-4

Owner: Doppler / Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dd-4"></a>
- [ ] **DD-4 — Attribute measured effects. Waits for qualified comparable arms.** Compare compilers within one runtime and runtimes using the same compiled artifact where supported. Compare portable/accelerated lowering separately after DOE-5. Freeze adapter/preparation/cache/reuse/timing boundaries; include CPU, memory and complete execution costs, with loading/warmup reported separately. Confirm results without instrumentation. Failed/unsupported arms and interference remain visible; no causal attribution from an unseparated provider swap.

### DD-5

Owner: Doppler / Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dd-5"></a>
- [ ] **DD-5 — Transfer an eligible gain through Doppler. Waits for DD-4 and applicable model acceptance.** Measure the admitted mechanism through Doppler's unchanged public operation with identical application requirements. Gemma W8A8's quality rejection blocks promoting that model configuration, not projection correctness research. Q4/F16 versus W8 comparisons are quantization experiments, not provider comparisons. A Node path must qualify opening, repeated invocation, cancellation and settlement before ER-1.

### DD-6

Owner: Doppler / Doe. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="dd-6"></a>
- [ ] **DD-6 — Confirm generality outside Doppler. Waits for an accepted mechanism.** Reuse an unrelated computation or Doe's existing ONNX workload with its own independent outputs and lifecycle. Compatibility is not transferred performance; measure any claimed benefit separately. This is not a gate for Reploid's accepted provider.

### ER-1

Owner: Doe / Doppler / Reploid. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="er-1"></a>
- [ ] **ER-1 — Expose a qualified Node executor through Doppler. Waits for eligible local qualification.** Reploid calls existing supported model operations. Doe selection is explicit inside the executor; browser requesters need no native replacement. Verify installed exports and the actual provider library at startup; reject unsupported operations.

### ER-2

Owner: Doe / Doppler / Reploid. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="er-2"></a>
- [ ] **ER-2 — Preserve reservation/admission ownership. Waits for ER-1.** Reploid enforces grants, budgets and conversation reservations; Doppler owns residency/invocation; Doe owns GPU resources. Test budget rejection and unrelated conversation isolation. Do not expose compiler internals through the job protocol.

### ER-3

Owner: Doe / Doppler / Reploid. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="er-3"></a>
- [ ] **ER-3 — Remote interruption with observed settlement. Waits for ER-1/ER-2.** Interrupt delivery, stop contribution and replace a participant during outstanding work. Observe cleanup via Doppler's existing lifecycle and keep unknown ownership charged/unavailable. Neither disconnect nor deadline expiration proves GPU release. Retain partial output and use a fresh authorized attempt.

### ER-4

Owner: Doe / Doppler / Reploid. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="er-4"></a>
- [ ] **ER-4 — Requester-level provider benefit. Waits for DD-5 and ER-3.** Compare Node+Doppler+Dawn with Node+Doppler+Doe for the same authorized operation, model, placements, budgets, history and comparable network conditions. Include total request cost and failures, not just isolated kernel time.

### ER-5

Owner: Doe / Doppler / Reploid. Status: Deferred optional work; qualification requirements retained.

Next action: Follow the next delta in the preserved acceptance entry below. Dependencies: Existing entry dependencies; optional Doe work never gates release.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="er-5"></a>
- [ ] **ER-5 — Useful optional contribution. Waits for an eligible executor.** Record foreground responsiveness, energy where measurable, transfers, useful completed work and failures with providers disabled/enabled. Report unavailable measurements. Keep admission opt-in, queues bounded and stop responsive. No spare-capacity benefit claim without the contributor's cost; no obligation to fill idle cycles.

  Generic contributor outcomes, idling, responsive stopping and foreground impact belong to ordinary Reploid acceptance under REP-4 without a Doe dependency. This item remains the narrower Doppler+Dawn versus Doppler+Doe comparison on the same qualified workload and hardware.

### ALL-8

Owner: Reploid evaluation / adoption. Status: Deferred.

Next action: Define an independently testable improvement after dependable execution. Dependencies: Dependable application execution and explicit measurable hypothesis.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-8"></a>
- [ ] **ALL-8 — Evaluate learning after dependable execution. Deferred.** Bayesian placement and reversible policy adoption need independent future evidence and unfamiliar tasks. External adoption matters but is not an engineering gate. Retries, journals and multiple agents are not demonstrated self-improvement. Resume only after dependable application execution and a specific measurable improvement hypothesis.

  This later capability follows dependable consumer access and developer compatibility. Retain independent evaluation, consent, explicit promotion and rollback; learning activity or more participating agents alone does not prove better outcomes.

### ALL-9

Owner: Reploid evaluation / consent; Doppler training. Status: Foundations exist; complete learning loop unqualified.

Next action: Qualify bounded coding-learning loop on unseen work with approved adoption. Dependencies: Dependable consumer access; DEV-02; JOB-06.

Acceptance and source/installed/physical evidence: the scoped entry below is authoritative; absent evidence is not a pass.

<a id="all-9"></a>
- [ ] **ALL-9 — Coding-model learning with independently qualified adoption. Required beyond inference parity; begins after dependable execution.** Preserve existing Doppler training and Reploid adapter owners. Complete one bounded loop: authorized coding task → independently verified outcome and consented training example → exact adapter training → unseen coding and retention evaluation → installed Doppler parity/identity → separately approved activation → subsequent tasks and tested rollback. Reploid owns consent, provenance, evaluation coordination and adoption; Doppler owns supported forward/backward/optimizer/checkpoint/export computations. Keep independent evaluation and existing human promotion authority intact; a trainer or runtime cannot self-approve. Opt-in inference does not authorize retention for training or disclosure of private source code. Freeze base/model/adapter/tokenizer/data/config identities, training/serving memory and compute limits, evaluation populations and gain/no-regression criteria before training. Measure time to usable improvement, train/inference interference, transferred bytes, energy/cost where measurable and failed updates; retain unfavorable results. Distributed/federated training needs its own real local trainer, synchronization/aggregation correctness, dropout/retry/isolation and lifecycle proof. Call it real-time only after measured turnaround and usefulness support that claim; ordinary retries, task journals, inference, adapter loading or lower training loss are insufficient.

  Sequence this capability after dependable shared consumer access, DEV-02 and useful JOB-06 coding workflows. It serves the cooperating-intelligence destination without turning ordinary inference or contribution permission into training consent; existing evaluation, adoption and rollback requirements remain unchanged.

  **Existing foundation, source/document review only:** [Doppler's experimental training API](https://github.com/clocksmith/doppler/blob/1a829fef/docs/api/training.md) owns native forward/backward, AdamW and LoRA export for declared fixtures and the narrow Qwen3.5-0.8B Q4K final `down_proj` target; other targets remain capability-gated or require an external trainer. The [WGSL writer result](https://github.com/clocksmith/doppler/blob/1a829fef/docs/status/wgsl-writer-v2-result-2026-07-14.md) records externally trained PyTorch/ROCm Qwen3.5-9B adapters, 95.83% mean semantic confirmation on a restricted shader population and selected-adapter Doppler completion parity. It is not general coding, external promotion or continuous online training. Reploid's [federated coordinator](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/self/experimental/intelligence/federated-learning.js) requires a supplied local update provider; [trained-adapter promotion](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/docs/trained-adapter-promotion.md) already separates identity, independent task/retention evidence, human activation, signed distribution and rollback. Reuse these foundations; their existence does not check off the complete learning loop.


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

## Preserved finish conditions

**First chat release finish condition:** a person opens ordinary Reploid, uses available capacity without downloading weights or arranging computers, grants the actual disclosure and gets a useful complete answer computed by complementary partitions on multiple physical machines. They can continue, stop one of two conversations, recover by explicit retry and return to intact history. The UI works at desktop and phone sizes; the exact shipped Doppler package passes the applicable numerical, memory and lifecycle checks. Indexing, scoring expansion and Doe performance research are later milestones.

**Comparative finish condition:** demonstrate a consequential advantage on the declared workload against relevant alternatives, within explicit regression limits and with reproducible physical results. Sustained model availability and complete service economics must be measured before related claims or commercial commitments. DEV-02, JOB-06, MESH-01, useful state reuse and ALL-9 remain explicit later capabilities with their own acceptance; they are not a universal feature checklist for every comparison. A selected benchmark win cannot establish broader superiority.

