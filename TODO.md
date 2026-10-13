# Reploid, Doppler, and Doe implementation checklist

**Goal: a clear, usable Reploid conversation interface backed by a shared mesh serving many conversations through ordered N-stage Doppler execution and eligible replicas.** The requester downloads no model weights. Discovery, preparation, permission, streaming, stopping and recovery belong to the same ordinary conversation journey.

This is the single cross-project implementation queue; evidence stays in its owning repository. Checked means the stated scope is complete, including a completed rejection. Partial acceptance stays unchecked. “Retained” means inspected existing evidence, not a new hardware run. Each open item names the next delta and its completion condition. The [canonical topology contract](#canonical-topology-contract-rd-canon1) below owns RD-CANON/1 requirements and inherited fixtures; requirements are separate from the acceptance status above them.

For outcome-based acceptance navigation, see [critical user journeys](docs/critical-user-journeys.md). The catalogue includes useful-answer criteria, uncertain tool outcomes, cancellation/endings coverage and application composition (DEV-01). `npm run verify:journeys` checks catalogue IDs, fields, links and scenario references; this integrity check does not complete runtime acceptance.

**Shared-mesh product target:** many computers serve many independent conversations, sharing resident weights while admitting separate inference states only within memory, compute and permission budgets. Two contributors are the current qualification boundary, not the product limit. The user's twelve-computer/three-stage/four-replica example, twenty active questions with five admitted states per computer, and hundred-computer/multiple-model example are intended operating cases, not supported configurations. Under [DR-6](#dr-6), design a versioned multistage extension to existing placement, route reservations and execution owners: arbitrary stage identities/adjacency, all-stage authorization and acknowledgment, bounded fair conversation scheduling, demand-driven prepared replicas, shared-device accounting, and failure/settlement across the whole route. Qualify these three operating cases, overload, revocation, stage loss, replacement and unrelated-conversation survival with exact artifacts before claiming additional capacity. RD-CANON/1's two-stage scope remains authoritative for its current qualification; the extension must explicitly resolve that scope rather than silently interpreting it as multistage support. Implement this extension alongside the signed ordinary-chat handoff; do not defer N-stage implementation until a two-stage release is finished.

**Live interruption repair:** [public code-answer investigation](artifacts/public-code-answer-20261012/README.md) binds a native runner closure to a discovery advertisement expiring during generation. Preserve active execution ownership while its channel remains open; discovery expiration alone must not cancel the answer or transfer approved recipients. Focused regressions pass for input and output owners. The repair is deployed with served-byte verification; after all four contributors were updated, a [fresh public requester](artifacts/public-code-answer-20261012/final-public-journey.json) completed a question and follow-up through Suby native → x native with zero requester weights and settled cleanup. This is short ordinary-chat acceptance, not signed or simultaneous-long acceptance.

**Active priority (user clarified 2026-10-13): dependable N-stage streaming chat across a shared mesh.** Generalize the existing ordered route, placement, reservations and runtime boundaries now; two-stage execution is a compatibility/regression case, not the architecture ceiling. Preserve the completed UI, browser/native participation, custody and recovery mechanisms. Ordinary N-stage capacity does not wait for speculative fork/replay or document experiments. Keep the prepared two-stage signed delivery immutable as an interim candidate and regression baseline; its acceptance does not close the larger mesh goal.

**Release scope:** ordinary chat models running across physical contributors are the primary deliverable. Complete streaming replies, history-aware follow-ups, independent conversations, cancellation/recovery and return after reload must work through the real UI. Attachment interpretation, contractor comparisons, document calculations, citations and document tool experiments are secondary: retain their failures, but do not make them prerequisites for basic-chat deployment. No further document experiment is active. Numerical accuracy, signed execution, permissions, exact package identity and resource settlement remain required.

**Public deployment:** [active-route repair deployment](artifacts/public-code-answer-20261012/deployment/receipt.json) verifies all 1,921 files at `https://replo.id` against revision `38c04a5f` and bundle `88b4f6bb…`, with 86 focused tests and seven browser fixture checks. It retains accepted Doppler 0.6.27; this is not promotion of the 0.6.28 candidate. The [four-contributor rollout](artifacts/public-code-answer-20261012/followup-rollout.json) and short native/native question/follow-up are now recorded separately. [Returning-requester control](artifacts/public-code-answer-20261012/returning-requester-corrected.json) preserves completed history and a UI-entered draft without redispatch; the earlier wrong-shape draft fixture is retained as a harness failure.

**Signed preparation repair:** [native metadata delivery](artifacts/native-signed-metadata-20261012/README.md) fixes the reproduced flat-filename rejection of nested Capsule metadata and bundles its pinned closure for offline native opening. The `0fadac51…` signed candidate verifies all 54 artifacts and four genuine physical reports. Physical application opening remains open. The user approved a separate persistent 4 GiB allowance for isolated candidate pieces; restarts reuse that ledger without renewing it or touching the public supplier ledger. The latest isolated native artifact `888c3bd1…` verifies 123 application files and 1,976 runtime files. The [first physical failure](artifacts/public-code-answer-20261012/signed-native-first-failure.json) correctly rejects a tokenizer symlink outside its approved model directory. After verified regular-file materialization, the [next physical boundary](artifacts/public-code-answer-20261012/signed-native-opening-failure.json) rejects missing `device` and `programFactory` ports at `openCapsule()`. Reploid `d9e80304` [repairs the native import](artifacts/signed-host-opener-20261012/summary.json) to use `doppler-gpu/host`; 84 focused tests, types and Verification Worker pass. Browser composition was already correct. The [repaired native artifact](artifacts/signed-host-opener-20261012/physical/result.json) `a1659225…` now physically opens the signed Capsule and reaches ready with zero active/unsettled attempts; its 123 application and 1,976 runtime files are verified. This closes native input opening only. The Mac output first failed a metadata offer timeout. Its controlled retry acquired metadata and many pieces, then failed on shard 11: the retained [chunk receipt](artifacts/public-code-answer-20261012/signed-mac-custody-receipts.json.gz) records two verified chunks followed by a 30-second supplier timeout and cancellation of the adjacent chunk. The [fresh requester](artifacts/public-code-answer-20261012/signed-requester-capacity-failure.json) consequently never reached ready and sent no question. Transport remained connected afterward. The [native drain repair](artifacts/signed-host-opener-20261012/native-drain-readonly-close/summary.json) addresses an installed WebRTC provider that lacks the awaited low-water event; native artifact `19dbecf5…` [physically opens the signed input](artifacts/signed-host-opener-20261012/native-drain-readonly-close/physical-ready/summary.json) with the same persistent allowance. Mac acquisition then verified the previously stalled piece, but subsequently failed a metadata file-offer deadline. The [new fresh requester](artifacts/signed-host-opener-20261012/mac-drain-retry/summary.json) sent zero questions and downloaded zero weights because output capacity never became ready. Metadata delivery was the boundary at that historical checkpoint; later corrected delivery and graph evidence below supersede that pending status. This did not establish a model execution failure. Complete signed conversation, both placements and final cleanup remain open.



1. **N-stage execution and basic chat — [DOP-6](#dop-6), [REP-7](#rep-7), [DR-3](#dr-3), [DR-5](#dr-5), [DR-6](#dr-6).** Generalize existing plans, resident stages, route placement, authorization, activation delivery and cleanup. Preserve two-stage numerical acceptance as a regression boundary; establish three-stage physical execution before claiming larger supported routes. Run the same implementation through 2/3/4/5/6/7-stage controls, replica choices and generated larger cases. Qualify the implemented host wiring through installed authenticated execution and signed package support; source tests and injected numerical kernels are not physical proof. The ordinary UI must receive streamed replies and history-aware follow-ups with zero requester weights.
2. **Shared concurrent conversations — [REP-4](#rep-4), [REP-6](#rep-6), [DR-5](#dr-5), [DR-6](#dr-6).** Admit distinct per-conversation state while sharing resident weights. Exercise many requesters, nodes both requesting and executing, bounded fair service, overload, cancellation at every stage, replacement, renewed approval and failed-cleanup retry. Extend host-wide and shared physical-device accounting; neither logical-node count nor per-GPUDevice limits establish physical capacity. Preserve the existing 1,420,000,000-byte per-executor ceiling and serial long controls; qualify concurrent long use on the selected exact package.
3. **One qualified mesh release — [DR-1](#dr-1), [ALL-3](#all-3), [ALL-6](#all-6).** Freeze browser/native/runtime/model bytes and verify supported placements and route sizes, signed selective acquisition, useful basic chat, lifecycle and returning users before deployment. The prepared signed two-stage delivery is an interim candidate/regression baseline, not completion of the N-stage mesh. Do not require document experiments or speculative replay to release otherwise qualified ordinary execution. Simulated phone/user checks remain labeled until physical observation is available.

**Current source and frozen-delivery boundary (2026-10-13):** the corrected two-stage graph passes all 55 prefixes in both physical browser/native placements ([982b7aee](artifacts/signed-closure-qualification-20261013/README.md)). The rebuilt Capsule binds 57 verified artifacts and the [frozen browser/native delivery](artifacts/basic-signed-candidate-20261013/final/README.md), `48b8d291`, verifies 2,020 browser files, 133 native files and 1,976 runtime files on unchanged archive `0fadac51…`. Its actual signed chat remains unrun. In parallel, ordinary N-stage plans/residents, full-route identity/selection and runner traversal are now source-tested (DR-6 below); real signatures additionally bind explicit coordinator-mediated disclosure in `567ec157`. The new runtime source is not that frozen archive and does not inherit its numerical or physical qualification. Public deployment remains unchanged. No active document campaign or new numerical-reference investigation is authorized by these checkpoints.

**Secondary attachments:** experiments are paused. Their rejected results remain under [DR-5](#dr-5); they are not on the basic-chat release path.

**Sole delivery owner — this thread (`/root`), user-directed 2026-10-12.** This thread now owns the entire ordinary distributed conversation release and RD-CANON/1 integration through qualification. The former independent topology stream is absorbed into this queue; there is no second coordinator or competing roadmap. Repository/component authority remains unchanged. Subagents execute bounded assignments, report exact evidence and changed files, and do not independently select package promotion, deployment, priorities or GPU windows. Root integrates their work and updates this TODO. A declaration here does not stop an unrelated process: verify actual controllers before touching shared files or hardware.

**Next milestones (existing IDs; N-stage source work and the frozen signed handoff proceed in parallel):**

| Order | Next work | Completion condition |
| --- | --- | --- |
| 0 | N-stage route and runtime integration ([DR-6](#dr-6)) | Extend existing plan, placement, reservation and streaming owners to ordered stages and compatible replicas; support entry/intermediate/final execution, all-stage authorization and settlement. First exercise three stages, then 2/4/5/6/7 and larger simulated meshes. Source controls do not establish physical scale. |
| 1 | Signed Capsule and selective acquisition ([REP-7](#rep-7), [DR-3](#dr-3), [DR-5](#dr-5)) | Native signed input opening passes on verified `a1659225…` and updated `19dbecf5…`, both with `0fadac51…`. Mac output opening also passes; the corrected graph now passes both placements ([982b7aee evidence](artifacts/signed-closure-qualification-20261013/README.md)) and the final signed browser/native delivery is verified ([48b8d291 evidence](artifacts/basic-signed-candidate-20261013/final/README.md)); actual conversation and reverse placement remain open; require assigned verified pieces, zero requester weights and rejected-opening cleanup. |
| 2 | Requester-owned durable conversation/UI ([DR-5](#dr-5)) | Wire the existing entry channel to the requester's transaction owner, use one authoritative history writer, and deliver UI output from committed records. Preserve legacy histories. Browser product/UI opt-in wiring is source-qualified in `f9d90a08`, including actual IndexedDB and real stage signatures with injected numerical steps. Native opt-in, durable epochs and retryable cleanup are source-qualified in `054ff994` (3,368 tests pass). Installed/physical canonical execution remains open. |
| 3 | Complete ordinary chat ([DR-5](#dr-5)) | Through the actual composer, receive complete streamed replies and history-aware follow-ups with the qualified model. Preserve exact prompts and outputs; verify ordinary model behavior separately from distribution. No document extraction, calculator or citation experiment is required for this gate. |
| 4 | Demanding lifecycle ([REP-4](#rep-4), [REP-6](#rep-6), [DR-5](#dr-5)) | Resolve the retained [1,588-token operation deadline](artifacts/concurrent-memory-observation-20261012/bounded-0fad/freeze.json), then qualify simultaneous long conversations, unaffected survivor, cancellation, replacement, fresh approval/retry and failed cleanup on the signed package within 1,420,000,000 bytes per executor. |
| 5 | Exact ordinary-chat release ([DR-1](#dr-1), [ALL-3](#all-3), [ALL-6](#all-6)) | Freeze one browser/native/runtime combination, pass its applicable gates, deploy exact bytes, and verify fresh/returning users. The current public 0.6.27 repair is deployed; 0.6.28 replacement promotion remains open. |
| 6A | Local fork, then fixed replay ([DR-5](#dr-5), [canonical contract](#canonical-topology-contract-rd-canon1)) | Qualify a real authorized composite fork, then two-stage replay lifecycle, reservations, grants/epochs, shared hardware budgets, unknown ownership and fixed-block performance. Keep speculation disabled until these separate gates pass; do not make it an ordinary-chat release prerequisite. |
| 6B | Shared-mesh capacity acceptance ([DR-6](#dr-6), implementation starts at row 0) | Qualify larger routes, replica demand and bounded scheduling against the stated 12/20/100 operating cases, with many simultaneous requesters and contributor/requester roles on the same nodes. Two stages remain only the current physical qualification boundary. Multistage ordinary execution does not depend on speculative fork/replay acceptance. |

Independent CPU/source preparation may proceed in parallel; acceptance follows these dependencies. Ordinary multistage inference is a capacity extension; local fork/replay is a separate efficiency extension. They share execution, authorization, route reservation and settlement prerequisites, but neither successful speculation nor its performance gate is a prerequisite for DR-6 mesh capacity. Conversely, larger routes do not qualify fork/replay. Keep the existing conversation components, public contracts and prepared-capacity behavior. No new navigation, scheduler, publication framework or transport platform. Preserve the approved F64 target, `0.001`, approved paired precision, weights, F16 caches and `1,420,000,000` allocated bytes per executor. Broader shared physical-device accounting is a separate required topology admission boundary, not established by this per-executor number.

**Current evidence and machine ownership:** candidate `0fadac51…` passes all 55 prefixes in both native/browser placements with maximum error `9.520044947919359e-7`, settled cleanup and allocations below the ceiling. [Physical result](artifacts/resident-readiness-qualification-20261012/results/summary.json) and [genuine resident reports](https://github.com/clocksmith/doppler/tree/2128b6de/artifacts/resident-pipeline-preparation-20261012/native-qualification) bind its exact bytes. Required compilation finished before resident readiness; cold preparation still took 815.081 seconds. This proves the resident boundary, not ordinary application readiness or signed acceptance. The [previous AMD/Mac reservation](artifacts/resident-readiness-qualification-20261012/reservation.json) is released; it is not a standing claim on either GPU. Root assigns the next window only after live process/controller checks. Use x@128 for heavy work, Suby only for configurations it actually supports, and Mac through its coordinated controller. Do not overlap qualification with topology GPU work. Each owned server, tunnel and browser needs a recorded purpose and stop/settlement disposition; preserve public contributors and unknown ownership. At user request, [obsolete local test processes](artifacts/development-process-cleanup-20261013/receipt.json) were stopped: old delivery servers, tunnels, empty requester browser and file-only test contributor. Target ports were cleared; public contributors, profiles, caches and persistent sharing allowances were preserved.

**Current integration boundary (2026-10-13):** the explicit canonical resident/peer/runner branch uses genuine signed stage evidence and awaits transactional publication before output. `085c987c` and `0008803d` add requester-owned transactional history and an optional async host session; [host evidence](artifacts/canonical-host-history-20261013/README.md) covers real signatures, failed/unknown writes, writer fencing, draft persistence and IndexedDB reopening. Numerical steps are injected. The [automatic application composition](artifacts/canonical-application-composition-20261013/README.md), `f9d90a08`, now connects actual composer admission, automatic placement, authenticated entry publication, IndexedDB and committed UI output. Six GPU-disabled browser checks pass; model arithmetic is injected. The default remains legacy. The [native canonical host](artifacts/native-canonical-composition-20261013/README.md), `054ff994`, now adds explicit opt-in, durable process epochs, settlement markers and retryable cleanup; its full source suite passes 3,368 tests. Next qualify the required runtime exports outside the checkout, then physical canonical execution. Input contributor A still does not own requester history. Do not create a second history writer on A or independently save canonical deltas to localStorage. Preserve legacy history and unsupported-profile rejection.

**Next physical assignment:** root coordinates the repaired isolated native artifact and signed AMD/Mac application retry after live controller checks. The earlier bounded 1,588-token run is complete as a retained deadline failure; it is not an outstanding assigned run. Document source processes are settled. Public native/browser contributors and normal Mac applications may remain, so functional runs do not establish exclusive performance measurements. Each new run records actual reservation, start, interference and settlement; old assignments grant no current GPU ownership.

**RD-CANON/1 source implementation (user-authorized concurrent topology work):** the [canonical topology contract](#canonical-topology-contract-rd-canon1) below consolidates the former topology drafts and their inherited fixtures under RD-CANON/1. Doppler source through `a8ec8778` adds bounded canonical identities/cursors, Philox CPU sampling, accepted decoder state, ordinary canonical controller transitions, numerical-state copy primitives and exact route-cardinality publication validation. CPU and simulated GPU checks are component evidence only. Reploid `39e8e8d4` fixes failed-write output leakage. The new conversation publication reducer and existing browser storage owner's strict IndexedDB transactions have source-integration and real-browser storage tests for cancellation, duplicates, takeover and unknown commits. Those initial storage fixtures mocked stage authentication. Later checkpoints `df7b1068`, `8753775e` and `7d340a95` use real WebCrypto stage signatures and source canonical transitions for peer, durable evidence/restart and runner integration; four actual IndexedDB browser checks pass. Computation remains injected in these source controls; later `f9d90a08` closes browser requester/UI source composition, not physical acceptance. The accepted application archive remains `9280ead5…`; no topology runtime is promoted or enabled. Native source composition follows in `054ff994`; it does not qualify installed numerical execution. Remaining: qualify installed/physical requester publication; admit and execute one local composite fork; implement fixed two-stage retained-row replay and complete phase/resource/grant settlement; then exact-package physical and frozen performance qualification. Standalone reducers, copy primitives and storage tests do not close those integration gates. Keep all-55 numerical and application-quality evidence under their existing owners.

**Historical archive9 qualification:** standard archive `8cae56b0748a5c66add985122d8bbf72b7492e2e0828f713f1b0d7425a59a4e5`, frozen from Doppler `bddea7ef`, freshly passes all 55 prefixes separately on AMD and Mac at unchanged 0.001. Each provider has maximum error 9.520045e-7 across 13,657,600 logits. [Archive9 receipts and independent comparisons](https://github.com/clocksmith/doppler/blob/ae467ebc/artifacts/paired-intermediates-20261012/resident-load-order/README.md) retain the earlier resident-opening failure and its load-order correction. All 57 outputs match the preceding archive on the same provider; this is new execution, not transferred acceptance. Peaks are 1,132,260,560 bytes on AMD and 1,129,107,472 on Mac. This is two-provider unsplit numerical acceptance, not distributed or release qualification. The [archive9 CPU sweep](https://github.com/clocksmith/doppler/blob/6feff94c/artifacts/paired-intermediates-20261012/archive9-unit-sweep/README.md) completes all 962 selected files after one documented synthetic-provider environment rerun; 46 files contain optional skips. All 10,395 tracked source files remain unchanged. The first actual Mac-input/AMD-output split opens both residents and passes four short steps, then fails during the 184-token request with an observed AMD GPU timeout/reset. [Failed capture and kernel evidence](https://github.com/clocksmith/doppler/blob/7d341335/artifacts/paired-intermediates-20261012/archive9-split-reset/README.md) remain retained; full split accuracy and cleanup are unqualified. Both placements, signed opening, simultaneous long requests and useful document answers remain open. The accepted application dependency and public deployment remain unchanged.

**Bounded split repair passes:** Doppler `eba47897` repairs the resident path's failure to honor the existing ordinary prefill submission policy and keeps buffers charged/unavailable when completion is unknown. [Archive10 physical evidence](https://github.com/clocksmith/doppler/tree/6d6f8021/artifacts/paired-intermediates-20261012/resident-submission-policy) binds archive `85ee2795186061a1af8a513d1ddaaf307dea2acd8766357cf8222f5bfd6c378b`. The original 184-token request now completes all 51 steps and EOS across Mac input / AMD output, with zero failing prefixes and maximum error 9.520045e-7. A separate raw-capture comparison checked all 12,664,320 logits, token/stop identities and final text against the approved F64 fixture. Both resident closes and queue barriers succeeded, with zero active buffers and retained reusable pool buffers; peaks were 756,061,984 / 392,195,664 bytes. No device loss or cleanup error occurred, and both owned controllers released the GPUs. This qualifies one request and placement, not signed admission, all 55 prefixes, native execution or release. Source `5c2b3188` freezes ordinary version `0.6.28` for the next exact-package checks; the accepted application pin remains unchanged.

**Frozen 0.6.28 candidate:** archive `102fd0c4900c6744fb7d103a4b3609365b57e8538657bd47b8dfd8e7ac3469e7` has 1,976 exact exported files. Its [CPU sweep](https://github.com/clocksmith/doppler/tree/9990a0d2/artifacts/paired-intermediates-20261012/release-0.6.28-unit-sweep) passes all 963 selected files after one retained synthetic-provider environment rerun, with 46 optional-skip files. All 10,476 tracked source files remain unchanged. [Matching browser/native delivery preparation](artifacts/paired-candidate-delivery-20261012/release-0.6.28/README.md) passes public-contract and browser-manifest checks, plus six consumer controls. The ordinary native catalog must come from canonical synchronization; a manually updated diagnostic artifact retained an old catalog version and cannot qualify that application boundary. These isolated candidates are not deployed or adopted. Exact-package physical checks remain open.

**Final-package browser split passes:** Doppler `67c22971` retains [both physical placements and four resident qualification reports](https://github.com/clocksmith/doppler/tree/67c22971/artifacts/paired-intermediates-20261012/release-0.6.28/browser-split). Exact archive `102fd0c4…` passes all 55 prefixes in each placement against the approved independent F64 target, maximum error `9.520044947919359e-7` at unchanged `0.001`. Both closes and queue barriers succeed with zero active ownership; maximum allocated buffers are 765,059,392 bytes. Reports were independently re-evaluated after two explicitly reviewed producer corrections (graph hash domains and actual device-observer schema); original expectations, failed conversions and raw captures remain intact. These are verified-manifest fixture executions, not signed opening or application acceptance. The [original-source short-token control](https://github.com/clocksmith/doppler/tree/9433f4d1/artifacts/qwen35-08b-capsule-intake-20261012) separately matches the exact 19-token input and two generated tokens through natural EOS; document quality remains open. Next: sign the actual ModelIR v2 artifact, exercise selective opening, and run simultaneous long requests. The accepted public pin is unchanged.

**Signed opening preparation and native readiness:** Doppler `257b9ee2` retains the [real signed v2/v3 candidate and exact-runtime metadata verification](https://github.com/clocksmith/doppler/tree/257b9ee2/artifacts/qwen35-08b-capsule-intake-20261012/signed-candidate): all 54 artifact hashes pass, with local eligibility only. Actual selective opening then exposed the frozen reader’s SHA256-only shard guard against the qualified BLAKE3 manifest. The [runtime repair](https://github.com/clocksmith/doppler/tree/257b9ee2/artifacts/signed-blake3-reader-20261012) and [shared browser/native source repair](artifacts/signed-blake3-source-20261012/README.md) preserve both whole-file identities and verify selected SHA256 pieces; CPU integrity/admission controls pass. Physical signed execution remains open. The [private-cache native diagnostic](artifacts/native-partition-0.6.28-20261012/private-cache/) passes both short prefixes but records 917.963 seconds to first output, including 746.423 seconds inside recurrent pipeline preparation after readiness. Doppler `0ac64fa2` moves the required paired preparation before readiness and forwards cancellation through both opening factories. A clean replacement archive combines only these bounded repairs with frozen `5c2b3188`; its changed bytes require fresh qualification. The public pin remains unchanged.

**Deferred until this journey works:** durable indexing (REP-2/3), scoring expansion (DR-2), W8A8 measurements/candidates (DOP-4/7), Doe/compiler/provider research (DOE/DD/ER), learned placement (ALL-8), new models and new architecture. Existing embedding/scoring functionality stays intact. These are not prerequisites for distributed chat. After this milestone, DR-6 evaluates a larger model that benefits from combined capacity through the same interface.

**Evidence history:** the initial audit at Reploid `dd4e1275`, Doppler `b7b94713` and Doe `50f118901` covered source and retained receipts, with offline projection and archive checks. Later physical/source results are linked under DOP-6 and DR-4/5. Completed experiments remain recorded even when they rejected the capability.

**Latest execution (2026-10-12):** the [ordinary conversation run](artifacts/live-conversation-20261012/README.md) now completes browser/browser and browser/native (Suby + actual Node/Dawn on x@128) requests with no requester weight downloads. Both pairs pass isolated cancellation; native replacement, a separately approved retry, 15-second permission review, actual RTC reconnection, and a successful follow-up have physical receipts. The [native participant](artifacts/native-participant-20261012/README.md) owns selective verified reads, resident reuse and provider settlement. UI repairs preserve drafts and history, keep attachment serialization out of titles, show both partition recipients, and distinguish observed remote preparation from unavailable capacity. A fresh empty-cache Node host acquired all 75 assigned pieces over signed browser custody and completed the ordinary $36/$48 conversation with retained weights; browser↔Node file supply is separately verified. This is not frozen release acceptance: numerical and document-quality failures, signed physical Capsule opening, long-prompt revalidation and deployment remain open. Recheck live process ownership before scheduling GPUs; the cold native host has settled all four requests and exited after unload/device destruction, releasing AMD. Browser participants remain available. The [native application delivery](artifacts/native-delivery-20261012/README.md) now installs outside the checkout with declared RTC/GPU dependencies; its 85-file artifact preserves canonical source and the accepted runtime. Named-package discovery authenticates four peers and stops with exit zero, without loading a GPU or weights. Its packaging-tool Worker rejection remains explicit, separate from the passing host scan. A browser output replacement required fresh approval and correctly continued the saved ticket conversation ($60), preserving all prior messages. Twelve final browser interaction/layout checks pass; their initial fixture failures are retained. The later [phone-sized physical attachment flow](artifacts/live-conversation-20261012/README.md#phone-sized-attachments-and-revoked-sharing) passes revoked-grant reapproval, decline, Copy and draft/history restoration, but both attached-ticket answers fail their requested arithmetic/citation. The [standalone attribution](artifacts/attachment-standalone-20261012/README.md) found and repaired unused RoPE/KV allocations and compatible buffer reuse in canonical Doppler. Earlier diagnostic runs also misplaced prefill chunk settings; they remain retained, but do not establish parity with the application policy. The [corrected replay](artifacts/attachment-standalone-20261012/allocation-v3-README.md) checks the public resolved session and completes both requests with a 1,221,939,272-byte peak; both outputs exactly reproduce the wrong mesh answer. This short diagnostic does not replace the frozen 1,588-token lifecycle gate. No budget or accepted archive changed.

**Installed-native execution closed (2026-10-12):** the [outside-checkout run](artifacts/native-installed-execution-20261012/README.md) verifies all 85 application files and 1,897 runtime files, cold acquisition of 75 assigned pieces (307,887,776 bytes), ordinary UI $36/$48 follow-up, two actually executing conversations with isolated cancellation and a surviving $60 answer, then a $72 request with resident weights. All 13 reservation records settled, and SIGTERM unloaded the model, destroyed its owned device and exited zero. Existing histories/drafts and zero requester weight downloads were verified. Three controller failures remain retained with their narrower corrections. This completes real execution from the installed artifact; signed opening, both native placements, document quality and simultaneous long-prompt acceptance remain open. AMD was released to numerical qualification; do not restart participants without checking current ownership.

**Latest bounded checks:** [multiline attached questions](artifacts/multiline-attachments-20261012/README.md) now remain complete in the transcript and exports without changing serialized inference inputs. The actual local requester retained all 17 conversations and drafts after the new bundle loaded. The x@128 full suite passes 3,160 tests (29 skipped); all 1,905 locally served assets match the manifest. These are not public deployment or new model acceptance. The [original-weight attachment control](https://github.com/clocksmith/doppler/blob/main/artifacts/qwen35-08b-attachment-source-20261012/README.md) answers $36/$48 but fails citation formatting; independent CPU execution of the exact deployed Q4 model repeats the application's wrong unit-price answers. That narrows this quality failure to the deployed model configuration, not lost conversation history or mesh transport. Numerical and conversion controls remain separate; neither has earned promotion.

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
- [x] **DOP-6 — Resolve distributed numerical accuracy for the declared AMD/Mac candidates.** Archive `102fd0c4…` passes both browser placements; replacement `0fadac51…` passes both native/browser placements, all 55 prefixes at unchanged 0.001. See DR-4 for exact evidence. Signed application, long-concurrency, other hardware and changed archives require their own gates. The chronological checkpoints below retain earlier failures and next actions as historical context, not a second active queue.

  **Historical investigation:** The historical [complete 55-prefix comparison][dop-numerical] rejected its candidates at unchanged 0.001; the corrected paired archive now passes the unsplit checks described below. Local F16 projection accuracy improved, but the Q4 addition worsened maximum full-model error; neither qualifies. Physical cache readback, attention, recurrence, normalization, and projection investigations already exist—do not rerun them without a new question.

  **Paired integration checkpoint:** Doppler `909b49a7` includes both Mac and AMD full-attention interpreter controls: prefill/decode, exact F16 cache bits and settled ownership, with maximum output errors 5.97e-16 and 5.14e-16. [Attention evidence](https://github.com/clocksmith/doppler/blob/909b49a7/artifacts/paired-attention-20261012/README.md) remains bounded layer proof. `f52cfe93` repairs actual decode failure ownership; uncertain GPU settlement keeps allocations charged and buffers unavailable. The retained [unit sweep and focused repairs](https://github.com/clocksmith/doppler/blob/b33dcc4b/artifacts/paired-generation-sweep-20261012/README.md) record 943/946 initial passing files and corrections for all three failures, not an immutable full-suite pass. Standard model loading next exposed declared-operation and Q4 materialization defects before numerical execution; retained failures remain under Doppler's first-model-boundary artifacts. [Installed codec replay](artifacts/paired-activation-boundary-20261012/README.md#installed-candidate-codec-replay) passes 16 synthetic controls without changing Reploid's accepted archive. Whole-model all-55, signed distributed, memory/lifecycle and useful-answer acceptance remain open.

  **First full-model boundary:** the [paired prefill diagnosis](https://github.com/clocksmith/doppler/blob/main/artifacts/paired-intermediates-20261012/first-prefill-norm-boundary/README.md) retains the rejected first execution (maximum logit error 9.38442666). Exact raw paired captures and the unchanged independent evaluator locate the first introduced error in the linear core. Applying the erroneous `w+1` normalization to the captured inputs reproduces that core within 3.51e-14; source semantics require direct `w`. Doppler `1cb70cf9` corrects the initializer and adds a failing-before regression. This changes no weights, reference, tolerance or cache policy. The corrected ordinary archive requires fresh physical qualification; earlier layer controls do not close it.

  **AMD and Mac numerical pass:** the exact corrected archive above completes all 55 prefixes and two identical reuse controls on each provider. Maximum tracked device-buffer allocation is 1,132,260,560 bytes, below 1,420,000,000; active, deferred and retained-model pool ownership settle to zero. Reusable pool buffers remain allocated, so this is not a zero-memory claim. The independent comparisons and raw physical captures are retained under `7ab7c393` and `417d8d26`. Mac peak is 1,129,107,472 bytes. Cross-provider outputs are not all byte-identical, but both independently pass the approved target. Physical partition acceptance remains required; DOP-6 stays open.

  **Resident opening and exact-package requalification:** archive8's first physical split preparation rejected before inference because lifecycle admission ran before `resolvedRuntimeSession` existed. Doppler `bddea7ef` moves the existing validation after immutable session creation and before weight loading; its real-validator regression preserves scalar/paired mismatch rejection. Archive9 above freshly passes both providers with unchanged outputs and budgets. The first real split then crosses resident opening but hits an AMD GPU timeout/reset on its long request; retain the original execution error separately from observation/cleanup failures. Next isolate that submitted computation with the exact archive before retrying the complete comparison. [Suby's Intel preparation controls](https://github.com/clocksmith/doppler/blob/da6bb6d9/artifacts/paired-intermediates-20261012/suby-portability/README.md) fail with device loss before logits, including a weight-free Chromium145 paired-RoPE preparation. These are portability failures, not numerical comparisons; no Suby acceptance is implied by AMD/Mac passes.

  Fresh [target-compatibility check](https://github.com/clocksmith/doppler/blob/main/artifacts/reference-target-compatibility-20261011/README.md): 174 logits across three frozen prefixes place the historical and independent F64 targets more than 0.002 apart. At the worst coordinate, no value can be within 0.001 of both (minimum possible worst error 0.00161574). This proves incompatible simultaneous targets, not a passing implementation or automatic reference authority. The user subsequently approved the unchanged independent F64-equation contract under ALL-4; this does not qualify a failing implementation.

  Numerical handoff: the user approved the exact existing [F64 proposal and three contracts](https://github.com/clocksmith/doppler/blob/main/artifacts/whole-model-f64-complete-20261011/approval.json). Reploid now assembles all 55 hash-bound independent vectors without rounding them to F32. Historical captures still supply the unchanged workload/continuations and remain regression evidence. The accepted numerical target uses exact deployed weights, independently evolved state and nearest-even F16 KV stores. The numerical target and 0.001 remain unchanged; the later explicit two-F32 state exception is recorded below. Historical candidates remain rejected; the approved paired candidate now passes unsplit AMD/Mac. Run both actual placements next.

  The [attention and recurrent-storage interventions](https://github.com/clocksmith/doppler/blob/main/artifacts/source-prefix-correction-20261012/README.md#attention-intervention-and-recurrent-storage) narrow the remaining error without qualifying a correction. Independently improved attention reduces the selected failure only from 0.00145859 to 0.00145084. Rounding only updated recurrent state to F32 within the independent evaluator produces 7/51 prefix failures in request 2 (prefill plus 50 decode steps). Its signed errors correlate 0.626 with the tested runtime, but 89 of 160 runtime failing logits do not overlap its failures; residual disagreement still exceeds 0.001. Independent review verifies the store location, rounding and forced-token binding. This establishes partial storage contribution, not an accuracy floor or impossibility. The subsequent decode-step-3 investigation is recorded below; this retained diagnostic used the original precision.

  The subsequent causal cache control reduces the state-rounding control's maximum error from 0.0014604 to 0.00000299154 by retaining independently evolved F16 K/V values: cache threshold switches amplify the upstream error. That injection is inadmissible as a runtime correction. An independent two-F32 state-storage control instead reproduces all six cache-pair identities and reaches 1.04e-13 maximum error over the same 51 prefixes without cache injection. The [inactive implementation proposal](https://github.com/clocksmith/doppler/blob/main/artifacts/source-prefix-correction-20261012/inactive-recurrent-state-precision-proposal.json) costs 9,437,184 additional bytes per contributor per attempt; it is not a GPU implementation or all-55 pass. The user explicitly approved implementing and qualifying this bounded proposal on 2026-10-12: “Yes—implement and qualify the bounded proposal.” This authorizes effective recurrent-state precision expansion, not package promotion or unrelated precision changes. Keep the approved reference, tolerance, weights, F16 cache and allocation budget unchanged. Document quality and current-precision memory checks continue independently.

  The [implemented two-F32 candidate](https://github.com/clocksmith/doppler/blob/main/artifacts/recurrent-two-f32-20261012/README.md), source `5e36f36f`, passes independent pair/core controls on Mac and AMD but fails full-model qualification. Exact probe archive `d0d53e8f…` fails 17/55 on Mac (maximum 0.00230737) and 18/55 on AMD (0.00287862), improved from same-archive F32 controls of 29/55 and 27/55. Some individual prefixes worsen. Its full-model diagnostic budget is not contributor memory acceptance. A later one-file diagnostic Q4-prefill substitution gives byte-identical outputs across devices but still fails 17/55 (maximum 0.00235314935), worsening Mac maximum/RMS; it is not promoted. Reused RoPE and single-step decode-projection interventions also fail their bounded comparisons. The independently reviewed [ideal global-materialization diagnostic](https://github.com/clocksmith/doppler/blob/main/artifacts/recurrent-two-f32-20261012/ideal-materialization-summary.json) preserves the exact approved reference in its inactive control, then fails 2/8 prefixes (maximum 0.001502511656) with ideal arithmetic between the specified stored buffers. This is not a new acceptance reference, an attainable GPU oracle, or proof of impossibility. Next isolate which actual materialization boundary drives remaining error using the retained controls; do not silently broaden precision or repeat reference-cache injection.

  **2026-10-12 selective-boundary continuation:** the [extended CPU audit](https://github.com/clocksmith/doppler/blob/main/artifacts/selective-materialization-20261012/README.md) now selects materialization by operation, layer and prefill/decode, separately tests scalar rounding, and records changed F16 cache coordinates. The old eight-prefix control reproduces exactly. Promising short-prefix controls fail when extended to the retained 51-prefix history; that extension is diagnostic map extrapolation, not physical qualification. With all non-state F32 stores suppressed, preserving source recurrent RMS epsilon removes two layer-3 key differences and reaches 5.3924e-11 maximum error across 51 prefixes. Preserving epsilon with ordinary stores still fails (maximum 0.00351327): an epsilon-only patch is insufficient. All failed controls remain retained. The [inactive intermediate-precision proposal](https://github.com/clocksmith/doppler/blob/main/artifacts/selective-materialization-20261012/inactive-precision-proposal.json) requires explicit approval; no production precision, reference, package or release gate changed.

  **2026-10-12 approval:** the user explicitly approved implementation and qualification of the broader paired-intermediate proposal after reviewing its [memory inventory](https://github.com/clocksmith/doppler/blob/main/artifacts/selective-materialization-20261012/memory-review.md). The conditional two-attempt expansion is 81,069,056 active bytes or 245,171,200 including inventoried idle buffers; the additional 1,588-token activation payload is 6,504,448 host/network bytes. These are calculations, not observed fit or numerical qualification. Approval includes the existing cross-partition representation, source epsilon and direct F16 rounding; the reference, 0.001, weights, F16 caches and 1.42-billion-byte cap remain unchanged.

  The [Reploid paired-frame boundary](artifacts/paired-activation-boundary-20261012/README.md), `7a3ff73c`, now consumes provider-declared layout and validates exact high/low bytes without changing its accepted pin. Synthetic RPC/allowance/malformed-header controls, 3,200 full-suite tests (29 skipped), types and the actual Worker pass. This source integration is not deployed paired inference or numerical qualification.

  **Paired source checkpoint:** [logits implementation and Mac operator receipts](https://github.com/clocksmith/doppler/blob/main/artifacts/paired-logits-20261012/README.md), `0365d512` / `d6abca90`, preserve explicit paired intermediates and final scalar output. [FFN orchestration](https://github.com/clocksmith/doppler/commit/7eb47eae) declares split gate/up projections, paired SiLU and down projection, with ownership/representation regressions. These are component checks, not whole-model qualification; subsequent physical FFN and layer-plan receipts are being retained by their owner. All-55 numerical, signed long-conversation, allocation and model-quality gates remain open.

  Current next action: consume the passing exact-package evidence under DR-4 for signed opening and memory/lifecycle gates; do not rerun completed numerical investigations without changed bytes or a new failure. The approved paired producer/consumer chain and activation contract are implemented; preserve the independent operator controls and failed whole-model receipts. A passing ideal-arithmetic control alone cannot qualify WGSL execution. Continue Reploid capacity and accepted-pin lifecycle work independently. Mac/directional acceptance belongs to DR-4.

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
- [ ] **REP-4 — Complete contribution lifecycle integration. Partial.** Both the existing operation owner and shared automatic partition owner now coalesce overlapping stops, block replacement until settlement, and retain failed cleanup for explicit retry. [New failing-before regressions and physical stop/retry](artifacts/live-conversation-20261012/README.md#contribution-settlement-and-explicit-recovery) pass 74 focused tests and 12 browser checks. The physical Mac output contributor stopped during a Suby/Mac answer; a separately approved retry completed and preserved earlier partial output. Immediate retry first exposed a stale-ready/prepared-path failure. The [repair and physical repeat](artifacts/live-conversation-20261012/README.md#readiness-after-a-physical-restart) now withdraw the rejected offer, preserve explicit retry, and complete after new readiness; the initial failure stays retained. Native piece cancellation preserves verified completed pieces and retries unfinished acquisition. Full exact-package long-prompt and signed release acceptance remain open; the [physical idle cleanup-failure control](artifacts/cleanup-failure-20261012/README.md) now passes: failed close retains ownership and blocks reuse, Retry stopping closes the old resident, and a replacement prepares/stops independently. The subsequent [active streaming cleanup/retry](artifacts/cleanup-failure-20261012/README.md#active-conversation-follow-up) also passes: two real approvals, interrupted partial retained, replacement retry produces exactly 1–100, and 27 prior histories remain unchanged. Measured retained-model/active/deferred pool resources reach zero, with 9,411,328 reusable bytes and 10,776 cached uniform bytes remaining. Peak device allocation is 504,255,752. This is output-owner evidence, not zero GPU allocation or the combined long/signed candidate journey. Subsequent input-side observer cleanup and debugger-resume bugs terminated that contributor after the test; both diagnostic failures and final uninstrumented same-profile restoration are retained. Input reservation settlement was not captured and remains open. The [shared signed-opening repair](artifacts/native-signed-opening-20261012/README.md) preserves failed preparation owners across both hosts and adds durable native release checkpoints; the final canonical sweep passes 3,156 tests (29 skipped) and twelve browser checks. An updated native/browser physical two-turn control completes and observes settled unload/device destruction; physical signed opening remains unqualified.

  Fresh [ordinary physical checks](artifacts/live-conversation-20261012/README.md): browser/browser and browser/native concurrent cancellation preserve the other answer and the stopped partial. Mac contribution stopped before Node replaced its partition; new recipient approval and a fresh attempt succeed. Native receipts show settled attempts and retained weights. The additional [input-owner loss](artifacts/live-conversation-20261012/input-owner-loss.json) and [replacement retry](artifacts/live-conversation-20261012/input-owner-retry.json) terminate Suby mid-stream, preserve the 306-character partial and prior attempt exactly, and complete a separately approved new attempt after restart with a new identity. The generated checklist still has quality defects. A [GPU-free physical native acquisition control](artifacts/native-files-20261012/README.md#physical-acquisition-cancellation-and-retry) now interrupts a second piece after 1,835,008 bytes, settles overlapping source/host closes, preserves the first verified 4 MiB and retries only the incomplete piece. Failed cleanup injection and the complete long-prompt sequence are not newly closed.

<a id="rep-5"></a>
- [ ] **REP-5 — Verify integrated acquisition and introductions. Scoped mechanisms complete; ordinary journey open.** [ICE teardown reproduction and repair](artifacts/ice-acquisition-20261011/README.md) closes a reproduced acquisition defect. The earlier uninstrumented missing-piece trigger remains unknown. [Signaling independence](artifacts/signaling-independence-20261011/README.md) and [introduced embedding across Mac/Linux](artifacts/peer-introductions-20261010/embedding-20261011/README.md) pass their recorded controls; the latter used diagnostic archive `414f61c3…`.

  The ordinary journey exposed terminal RTC loss that never retried while signaling stayed healthy. `c34ba38d` reuses bounded discovery rejoin; focused regression fails before repair. [Physical requester connection close](artifacts/live-conversation-20261012/rtc-recovery.json) re-establishes a route while all three unrelated connections remain connected; [a follow-up then completes](artifacts/live-conversation-20261012/after-rtc-recovery.json), with no page reload. This controlled close is not an arbitrary-NAT or cable-outage claim.

  The [public capacity-loss controls](artifacts/capacity-failover-20261012/README.md) now pass input-owner withdrawal with supplier retained, automatic Suby native replacement, actual public $36/$48 conversations, and separate supplier withdrawal with prepared inference preserved. Cold supplier loss exposed falsely retained settled preparation ownership; browser/native hosts now release that registration only after successful cleanup. The patched local browser recovers by explicit retry, acquires assigned pieces and stops under 497,336,720 tracked bytes. Inventory refresh no longer resets the same custody owner’s transfer allowance. Reploid repair `76ec3d3a` is deployed and all 1,909 browser files verify; both updated outside-checkout native artifacts match 86 source and 1,897 runtime files. Public native/native $36/$48 and short concurrent cancellation/exact 1–20 survivor pass, with saved-thread draft/history restoration. This is not the simultaneous long/signed candidate acceptance. The [peer recovery regression](artifacts/peer-recovery-20261012/README.md) fixes host errors that survived reconnection: only the affected peer clears its transport warning; contribution cleanup and discovery errors remain separate. Repair `6c573a70` is deployed with all 1,909 files verified. Fresh public browser/browser and native/native chats pass before/during rolling browser replacement; both refreshed browsers and both natives finish ready, with empty browser errors and zero native active/unsettled reservations. The [tokenizer-source guard](artifacts/preparation-errors-20261012/README.md), repair `98e18a02`, preserves authoritative acquisition failures through runtime fallback in both hosts and rejects false fallback readiness. Seventy-three focused tests and the actual Verification Worker pass. A fresh physical browser on the public network with only the changed host modules overridden displays the missing-piece error, then explicitly retries to Ready after authorized supply returns; file sharing stays off. This is source-override preparation evidence, not deployment or signed inference. Independent-network coverage, sustained availability and final signed/long acceptance remain open.

  **2026-10-12 durable supply and deployed preparation:** [persistent allowance repair](artifacts/supply-budget-persistence-20261012/README.md) passes native process/Chromium tab/reload/abort controls. The user approved one fresh persistent 4 GiB x allowance; legacy cache is retained and Suby file sharing stays off. Both installed native artifacts match 89 source and 1,897 runtime files. Actual x transfer charges of 637,534,208 bytes survive contributor restart unchanged. Steady public browser/browser and restarted native/native $36/$48 conversations pass with zero requester weights. Bundle `ba1ca4e2` / `68b3997b…` is deployed with 1,912 files verified. The retained placement-change rejection and old browser launcher exit during rolling preparation keep uninterrupted availability open.

  Next: reuse these mechanisms in the accepted-pin journey with authenticated introductions, configured bootstrap alternatives, supplier replacement and reconnect. Preserve manifest/grant binding, separate introduction/file/compute permissions, and bounded error categories. Record the missing piece, advertisements, verified retention, grants, cancellation and replacement if acquisition fails. A healthy data channel must survive signaling loss; bootstrap availability is not execution readiness. No claim of arbitrary NAT traversal or public discovery follows from configured fixture routes.

<a id="rep-6"></a>
- [x] **REP-6 — Preserve honest recovery contracts.** [Contract controls](artifacts/partition-contracts-20261010/README.md) and [bounded failure categories](artifacts/partition-failure-categories-20261011/README.md) retain canonical attempt identities, paired requester/placement fields, explicit readiness, and unavailable replay/checkpoint capabilities. Changed bindings reject; authorized restart creates a new attempt and keeps prior partial text separately. Transport loss never proves remote GPU cleanup. This checked contract does not close physical recovery/quality acceptance in DR-5.

<a id="rep-7"></a>
- [ ] **REP-7 — Complete ordinary chat on the accepted pin. Partial evidence retained.** Exercise signed-Capsule opening, selective acquisition, zero requester weight downloads, automatic configured discovery, streamed replies, follow-ups, concurrent conversations, repeated long prompts and copying. Attachment/document reuse and citations remain secondary, outside the basic-chat release gate. [Signed resident integration](artifacts/partition-contracts-20261010/signed-pieces-20261011/README.md) is implemented but its proof is synthetic. [Focused physical recovery](artifacts/focused-recovery-20261011/README.md) passes several interruption/replacement boundaries but retains incomplete counting and inaccurate document answers. [Source quality attribution](artifacts/chat-task-quality-20261011/README.md) separates model failures from coordination defects.

  **Candidate delivery preparation:** [isolated archive9 delivery](artifacts/paired-candidate-delivery-20261012/README.md) uses clean Reploid `37c7bc9f`, the unchanged frozen candidate archive, existing browser/native packaging and an outside-checkout x@128 installation. All 95 native delivery entries and 1,974 installed runtime files match their declared bytes; the 1,977-file hosting package verifies. CLI help opens no GPU. This prepares real native qualification and does not establish inference, signed acquisition or deployment. The public pin remains unchanged.

  **Optional context checkpoint:** [compact context controls and evidence](artifacts/chat-context-20261013/README.md) add an opt-in per-thread 16/32/64-word application context, defaulting to 16 when enabled. Preview shows exact words; only identity-bound catalog metadata is included, with no guessed execution mode. Existing user-authored purpose stays separate and uncapped. Signed/disclosure messages contain the exact system text, and retries retain the original attempt snapshot. Fifty-eight focused tests, desktop/phone Chromium controls, type/delivery/CSS checks and the actual Verification Worker pass. This source/UI change does not qualify model answers or alter the accepted Doppler archive; deployment and the complete physical journey remain open. The subsequent [rail-material repair](artifacts/chat-rail-materials-20261013/README.md) keeps both glyph pairs stationary, separates raised hover from pressed/open states and preserves keyboard focus. Both themes and phone/desktop controls pass; panel shadows now have padding and edge gutters. UI-only revision `07907105` is deployed at https://replo.id as bundle `55978b55…`, with all 1,914 served files verified and the accepted runtime unchanged. Fresh and saved-state browser controls pass without inference; full physical upgrade and distributed release gates remain open.

  The actual signed producer exposed a packaged-path mismatch before piece acquisition: `artifacts/model/weights.bin` versus original `weights.bin`. [Browser/native repair](artifacts/signed-resident-paths-20261012/README.md), `342f0760`, resolves paths against the selected signed manifest directory and checks exact source identity; no basename fallback. Twenty-five focused tests and the Verification Worker pass. Doppler `92df53c4` supplies resident qualification/piece-index producer closure; physical signed inference still requires real qualifying evidence, not synthetic passing reports.

  **Next: preserve the deployed conversation UI and use it for the remaining signed physical journey.** Keep DR-1 identities fixed. Chat attachments use the existing supported passage path; durable indexing REP-2/3 is not a dependency. Cover these acceptance conditions in the existing components and journey tests:

  - Empty/unavailable/preparing: composer and draft remain accessible; status reflects actual model capacity; one relevant next action; no forced local download or silent deferred sending.
  - Permission: readable content, recipient and scope, clear Approve/Decline; denial or revocation remains scoped to the affected request.
  - Streaming/completed: stable message nodes, readable prose/code, working source links and Copy, preserved selection/scroll, visible composer and keyboard focus.
  - Threads/settings/network: preserve draft, reading position and execution while navigating; optional details and contribution do not displace the main task. Keep the current compact status design.
  - Stop/interrupted/retry: distinguish stopping from settled, preserve partial text, start a visibly separate authorized attempt, leave unrelated work intact.
  - Desktop/phone: both themes, long histories, attachments, repeated panels, narrow widths and simulated keyboard viewports; no clipped guidance or inaccessible controls. Preserve the completed phone fix.

  Basic-chat acceptance: a fresh requester can discover, approve, ask, read/copy a complete streamed reply, follow up, switch, stop, retry and return through the actual application with zero requester weights. Attachment interpretation is a separate later acceptance scope. Use fixtures for interaction regressions and physical peers for distributed claims. Keep factual answer failures even when output reaches EOS. Deploy only under ALL-6.

  Fresh [conversation journey evidence](artifacts/chat-journey-20261011/README.md): 22 desktop/phone interaction checks pass. Real Mac/Suby selective acquisition, zero requester weight requests and idle contributor restart followed by complete YES answers pass. Chromium 136 lacked required Ed25519 verification; selecting installed Chromium 145 restores authenticated discovery. The runner now checks crypto before participation. The extended run completes concurrent short answers but fails after isolated cancellation: the survivor continues incorrect repetitive output and times out. Its final history and cancelled partial answer are retained in the same handoff. The entire 12,269-character survivor prefix matches the retained standalone control without cancellation, narrowing this output defect to shared runtime/model behavior. Active contribution interruption, long documents and signed Capsule opening remain open.

  **2026-10-12 public capacity repair:** [live capacity and conversation evidence](artifacts/public-capacity-20261012/README.md) identifies why two connected Suby contributors were unavailable: tokenizer/piece acquisition had no authorized file supplier. Following explicit user consent, x@128's native host now supplies the pinned model within the existing 4 GiB allowance. Suby's native host acquired 75 verified pieces (307,887,776 bytes), prepared automatically, and served two ordinary public requests across physical x@128/Suby native executors ($36 then history-dependent $48). Both hosts retain two settled reservation records, zero active reservations and zero unsettled owners. The fresh requester downloaded no weights. Removing the idle x@128 browser forced automatic replacement with prepared Suby capacity; no request selected peers manually. This is verified-manifest opening on the existing 0.6.27 pin, not signed-Capsule, numerical, document-quality, simultaneous-long-prompt or arbitrary-NAT acceptance. Browser restoration and the diagnostic-controller failure are recorded with the same evidence.

  **2026-10-12 shared public/local network:** [discovery and authentication repair](artifacts/unified-network-20261012/README.md) makes public localhost origins on arbitrary ports use the same rendezvous and authenticated RTC service as hosted clients. Discovery service deployed; fresh hosted and two loopback browsers see the same ready browser/native nodes with zero weight requests. Private networks and disclosure grants stay separate. This is connectivity evidence, not new inference qualification.

  **2026-10-12 interface repair:** [chat rails and readable permissions](artifacts/chat-rails-20261012/README.md) implements independent left/right rails, a single transcript scroller, shared icons, readable attachment review and per-answer observed execution activity. 73 focused unit tests, 17 Chromium cases, CSS, browser identity and the Verification Worker pass. Aggregate timing currently arrives at completion; no live per-token telemetry or physical inference claim. The interface is deployed through `c13cd97e`, with all 1,909 served assets verified; integrated runtime release acceptance remains open.

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
- [x] **DR-1 — Keep accepted and candidate identities separate.** The accepted archive is 0.6.27; the current unpromoted generation candidate is 0.6.28 `0fadac51…`. Historical candidates remain identified separately. [Reploid pin](self/config/doppler-package.json) still selects the standard archive. This audit freshly hashed that archive and compared every installed archive member without mismatches. Candidate installed identity is retained in [DOP-8][dop-package], not freshly installed on this Mac. Candidate testing is not an upgrade.

  | Identity | SHA-256 / location |
  | --- | --- |
  | Accepted archive | `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`; `deploy/artifacts/doppler-gpu-0.6.27.tgz` |
  | Accepted package member inventory | `45754d29df6b280431fae0806a1872cf694841dbdffe05acab38e4864aa82572`; sorted UTF-8 `path TAB sha256 LF` over regular archive members; all matched `node_modules/doppler-gpu/` |
  | Historical 0.6.27 candidate archive | `7c240dad4d1ae98e204e9727e687b9bc4379abd758b16af0fd857a99d7adac8d`; retained Linux installed receipt/inventory in DOP-8 |
  | Current 0.6.28 generation candidate | `0fadac5113d2cc154f65d9d40de50722a16454995e927c7d22bedc5f1a4925cd`; [native/browser evidence](artifacts/resident-readiness-qualification-20261012/results/summary.json), unpromoted |
  | Projection archive | `128bbc084593483c2f4e4c532f8b118e2c25b68d7f7f1b0dd3ee73adec8911af`; DOP-5 |

<a id="dr-2"></a>
- [ ] **DR-2 — Replay embedding and scoring through Reploid. Partial.** [Candidate public-library controls][dop-core] pass eighteen complete-text embeddings, ordering/subdivision/repetition/cancellation/reuse, twenty-four choice logits and twelve selections. Independent jobs and introduced embedding have their own scoped Reploid evidence (REP-1/REP-5). These do not establish ordinary application acceptance with `7c240dad…`.

  Next: bind the exact tested installation to existing signed operation adapters, replay all outputs against independent references, and test UI/host reuse/cancellation. Preserve operation-specific tolerances and uncalibrated score semantics; neither 0.02 embedding nor 0.05 scoring changes chat's 0.001. Reject model/application identity or eligibility mismatches before work.

<a id="dr-3"></a>
- [ ] **DR-3 — Verify permissions in the distributed conversation. Active; no indexing dependency.** Bind operation, complete input scope, model identity and placement in each signed request. Test disclosure denial, changed input, wrong operation, expiration and revocation in generation and attachment flows before execution. Durable-output checks resume with REP-2/3. Embedding permission does not authorize generation, reranking or extra disclosure. Reuse current signed-job and permission controls rather than a new grant system.

  `5a1f6e27` repairs stale readiness after human review, freezes the reviewed input, retains consent expiry and rejects changed recipients/model/plan before sending. [Fifteen-second physical review](artifacts/live-conversation-20261012/delayed-approval.json) succeeds with the same approved browser/native pair. Regression controls cover expiry, replacement during review and payload mutation. `17dbfed0` exposes both recipients and disclosure roles in the existing permission card. The [physical reuse/revoke sequence](artifacts/live-conversation-20261012/permission-revocation.json) uncovered and repaired the input/output recipient mismatch in reusable grants. Grants bind both actual contributors; replacement requires fresh approval. Revocation cancels its active follow-up, and subsequent declined input is not dispatched or mislabeled as an execution failure.

<a id="dr-4"></a>
- [x] **DR-4 — Coordinated distributed numerical acceptance for the declared browser/native routes.** Archive `102fd0c4…` passes all 55 prefixes in both browser placements. Archive `0fadac51…` adds the readiness and signed-reader repairs and independently passes all 55 in both Node/Dawn AMD + Mac browser placements at unchanged 0.001. [Results and cleanup](artifacts/resident-readiness-qualification-20261012/results/summary.json), [released reservation](artifacts/resident-readiness-qualification-20261012/reservation.json), and [four actual resident reports](https://github.com/clocksmith/doppler/tree/2128b6de/artifacts/resident-pipeline-preparation-20261012/native-qualification) are retained. This does not qualify Suby, signed opening, canonical forks/replay, simultaneous long conversations, quality or release. Changed package bytes require applicable requalification. Historical controls below retain their original failed or partial disposition.

  **2026-10-12 final-package short native controls:** exact unpromoted 0.6.28 archive `102fd0c4…` passes [two prefixes in both native/browser placements](artifacts/native-partition-0.6.28-20261012/README.md), each maximum error below `8.40e-7` against the approved F64 target. Both owned Node providers close and exit naturally; allocated GPU buffers stay below 1.42 billion bytes. At that checkpoint full native qualification was still open; the later `0fadac51…` result above closes the declared numerical scope. The first native direction also exposes a [cold execution latency blocker](artifacts/native-deadline-review-20261012/README.md): at least 807.2 seconds from an in-step submission to output exceeds the ordinary 300-second stage timeout. The faster reverse run does not identify the cause because compilation/cache state was uncontrolled. Keep deadlines unchanged; attribute and repair that preparation/execution owner before claiming dependable cold native chat. The application pin and public contributors remain unchanged.

  Fresh Mac/Intel execution: [both directional comparisons](artifacts/mac-intel-numerical-20261011/README.md) complete but fail 28/55 and 23/55 frozen steps at unchanged 0.001. All tokens agree; allocation and settled cleanup observations pass their scoped checks. This does not qualify the runtime or application. The user subsequently approved the independent F64 contract under ALL-4; these historical capture failures remain retained. The [approved-target Mac/AMD comparison](artifacts/chat-journey-20261011/approved-reference/summary.json) now completes all 55 prefixes in both placements: each fails 22/55, maximum 0.002666609627555161. The implementation remains unqualified; archive and tolerance are unchanged.

<a id="dr-5"></a>
- [ ] **DR-5 — Exact integrated chat journey and lifecycle revalidation. Integration active; release waits for applicable gates.** Use one immutable candidate archive, signed physical opening and real selective acquisition. Test both placements, complete useful answers, concurrent conversations, isolated cancellation, contributor stop/loss/replacement, explicit authorized retry, and settlement. Repeat the previously passed successive 1,588-token workload, allocation rejection and reuse within 1,420,000,000 allocated bytes without reopening weights. Keep earlier partial answers separate and distinguish model counting/grounding defects from distribution. REP-7 accepted-provider work continues independently.

  **Canonical peer checkpoint:** [Reploid `df7b1068`](artifacts/canonical-peer-integration-20261012/README.md) connects the existing peer to actual canonical source transitions, authenticated stage signatures and publication acknowledgments under explicit opt-in. CPU/in-memory-channel controls and 114 legacy/transport/charter tests pass; computation and durable transaction receipts are injected. This does not close physical or durable-publication acceptance. Next persist exact stage evidence with the transaction, then connect the existing runner and UI to the durable owner.

  Current integration checklist (all owned by this thread; requirements remain in the canonical topology contract):
  - [x] **Public interruption repair and short journey:** [four-contributor rollout](artifacts/public-code-answer-20261012/followup-rollout.json), [question/follow-up](artifacts/public-code-answer-20261012/final-public-journey.json) with no requester weights and settled cleanup, and [history/draft restoration without redispatch](artifacts/public-code-answer-20261012/returning-requester-corrected.json). Served bundle `88b4f6bb…` reverified across all 1,921 files on 2026-10-13; accepted runtime unchanged. This does not qualify candidate signed/long use.
  - [x] **Physical signed native input opening:** [artifact `a1659225…` with runtime `0fadac51…`](artifacts/signed-host-opener-20261012/physical/result.json) reaches ready through public host composition with signed piece verification and zero unsettled attempts. This is opening evidence, not inference, counterpart acquisition, both placements or final shutdown.
  - [x] **Physical signed Mac output opening:** [same-runtime preparation receipt](artifacts/signed-host-opener-20261012/compact-model-advertisement/mac-opening-summary.json), model layers 12–23, 312,813,888-byte peak. This is opening after retained acquisition retries, not a completed requester conversation.
  - [x] **Native signed opener source repair:** `d9e80304`, [84 controls/types/Worker](artifacts/signed-host-opener-20261012/summary.json); physical replacement artifact retry remains below.
  - [x] **Authenticated canonical peer source integration:** `df7b1068`, [real signatures/transitions and bounded channel controls](artifacts/canonical-peer-integration-20261012/README.md); injected computation is not physical acceptance.
  - [x] **Durable signed evidence and restart verification:** `8753775e`, [atomic publication/evidence/receipt and four IndexedDB browser tests](artifacts/canonical-publication-evidence-20261012/README.md).
  - [x] **Canonical runner publication ordering:** `7d340a95`, [durable publication before output, cancellation and independent-thread source controls](artifacts/canonical-runner-integration-20261012/README.md); 114 legacy tests, types and Worker pass.
  - [x] **Latest source-ledger experiment concluded as rejected:** [flat treatment](artifacts/cited-calculation-experiment-20261012/source-ledger/flat-experiment/RESULTS.md), zero accepted of two attempted; five unrun. This checks completion of the experiment, not answer quality.
  - [x] **Canonical requester/history/UI source composition:** `085c987c`, `0008803d`, `f9d90a08`; [automatic application evidence](artifacts/canonical-application-composition-20261013/README.md) exercises the actual composer, authenticated entry, real signatures and IndexedDB publication before visible output. Failed admission retains drafts; newer typed text survives delayed admission. Unknown writes and rejected cleanup remain failures. Numerical steps are injected; default activation, installed-runtime and physical canonical acceptance are not established.
  - [x] **Native canonical host source composition:** `054ff994`, [native evidence](artifacts/native-canonical-composition-20261013/README.md). Explicit opt-in, durable epochs, exact-owner settlement reconciliation and retryable participant/discovery cleanup pass source controls; startup contention and spent-budget persistence are covered. Full suite: 3,368 passed, 30 skipped; actual Worker passes. Accepted installed archive correctly refuses unsupported canonical activation. No installed canonical numerical or physical claim.
  - [ ] Package required canonical public runtime exports and qualify requester-owned durable publication through installed and physical signed execution. Preserve the passing browser/native source boundaries and default-off activation.
  - [ ] Qualify signed Capsule opening and rejected-opening cleanup using genuine qualification for the same runtime archive, real selective pieces and exact disclosure recipients.
  - [ ] Complete bounded long-concurrency runtime checks and the ordinary signed conversation journey in both browser/native placements; retain partials, surviving output and resource ownership through replacement, explicit retry and failed cleanup.
  - [ ] **Secondary; paused, not a basic-chat release gate:** document factual/citation treatment and converted/runtime application checks. Preserve rejected experiments without repairing outputs into fixture answers; resume only after core chat or explicit user direction.
  - [ ] Implement and qualify a registered, authorized composite local fork from a published cursor, including independent numerical/decoder state, real ring restoration and alias-free settlement.
  - [ ] Complete fixed two-stage replay evaluation, preparation, commit, durable publication and retry retention; enforce complete route reservations, shared device budgets, grants, epochs and unknown ownership.
  - [ ] Qualify exact-package canonical ordinary/fork/replay behavior and fixed-block performance before enabling speculation. Existing all-55 evidence proves numerical accuracy only for its declared profiles and routes.

  **Secondary attachment evidence — retained, experiments paused:** [fresh matched source-role control](artifacts/cited-calculation-experiment-20261012/source-ledger/price-relation-diagnostic/context-ablation/result/review.json) is rejected (5/9 for both arms); no calculator/final answer executed. These results do not block basic chat.

  **Historical document quality disposition:** [direct original-source document controls](https://github.com/clocksmith/doppler/tree/5a4f7362/artifacts/qwen3-direct-bathroom-20261012) all completed naturally but passed zero of four complete factual reviews. The [source-ledger freeze](artifacts/cited-calculation-experiment-20261012/source-ledger/experiment/freeze.json), Reploid `3d681060`, binds the same authorized source model, original histories, strict tool selection, deterministic calculator and primary evidence report. That nested-schema experiment is now rejected after its first structurally invalid response. The separately frozen [flat source-role treatment](artifacts/cited-calculation-experiment-20261012/source-ledger/flat-experiment/RESULTS.md) completed two source calls within budget: the first omitted substantive facts; the second failed duplicate-base, operand and provenance checks. Zero tasks accepted, five unrun; processes are settled. No production policy changed and no model output was repaired.

  The [allocation-only physical controls](https://github.com/clocksmith/doppler/blob/main/artifacts/rope-session-extent-20261012/hybrid-kv-physical/README.md) pass on x@128: three split/unsplit full-vocabulary steps agree exactly, seven failure/cancellation controls pass, and accepted-API resident tests preserve interleaved attempts and isolated cleanup. The subsequent [original long-prompt control](artifacts/allocation-memory-20261012/README.md) passes on physical Mac and AMD browsers using exact allocation-only archive `7449618b…`. Serial 494/1,588/1,588-token attempts complete with retained weights; reverse placement cancels during prefill, rejects an oversized allocation on both executors, and completes the same 1,588-token request without reopening weights. All three complete long attempts produce identical text and reach EOS after 1,627 steps. Maximum allocated bytes are 809,459,080, below the unchanged 1,420,000,000 cap; resident owners and weights settle to zero on close. Both GPUs and all isolated test processes were released. This is two-browser runtime lifecycle through Node tensor forwarding, not simultaneous long conversations, signed mesh opening, native execution, factual quality or final replacement acceptance. The application pin remains unchanged; changed runtime bytes must rerun the applicable checks.

  Fresh [original-weight contractor control](https://github.com/clocksmith/doppler/blob/main/artifacts/contractor-source-quality-20261011/README.md) is complete with rejection. Both seed-17 responses naturally terminate within unchanged budgets, but fail frozen factual review: wrong price rankings/removal costs and a correction pass that endorses the historical false answer. Original weights used F32 source equations and F16 K/V; this is not native BF16 or GPU acceptance. The two seed-53 cases did not complete after a deliberate stop and count as neither failures nor passes. The ordered-message evaluator and atomic-report regression are implemented; exact executed code and all outputs are retained. Prior fourteen-task source success does not qualify this conversation. If secondary document work resumes, it needs a specific cause and separately identified control on an already authorized model; do not repeat seeds merely to seek a passing answer. Converted Q4 remains rejected, and no new model authorization follows.

  Retained secondary document work (paused): the [0.8B attachment-layout controls](https://github.com/clocksmith/doppler/blob/main/artifacts/qwen35-08b-attachment-layout-20261012/README.md) and both [original 2B nonthinking document controls](https://github.com/clocksmith/doppler/blob/main/artifacts/qwen35-2b-nonthinking-documents-20261012/README.md) are complete and rejected. Repetition 1.1 and 1.0 each completed all four cases within budgets but passed zero complete factual/citation contracts; processes are settled. Do not describe these runs as pending or convert their weights hoping distribution fixes the answers. Reploid's prompt serialization and production policy remain unchanged. The earlier bounded application proposal used source-cited model fact extraction followed by a new bounded deterministic arithmetic/date tool through the existing tool runner, retaining unchanged requirements and fresh cases. It must validate actual extracted facts and source support, not insert expected answers or fixture-specific extraction rules. A passing treatment still needs converted-weight, installed-runtime and actual follow-up acceptance. The [official tool-protocol control](artifacts/cited-calculation-experiment-20261012/official-tool-protocol/review.json) is now complete and rejected: its first case emits malformed calculation arguments, then repeats that tool call rather than answering. No calculator invocation or hidden retry executes; six remaining cases are unrun. Exact prompts, raw outputs and the minor identifier-uniqueness schema ambiguity are retained. This source process is stopped, not pending.

  **Earlier document experiment closed:** the [available-family typed tool experiment](artifacts/cited-calculation-experiment-20261012/available-typed/review.json), Reploid `9dfa013f`, is rejected. Original Qwen3-1.7B selects valid deposit arithmetic for the first source but omits required budget headroom; the next source emits invalid operand types/fields twice. No final answer exists, later cases and holdouts remain unrun, and no output was repaired. Removing unavailable tool families fixed that interface boundary without establishing factual quality. The source process is settled; do not rerun this configuration unchanged or describe document results as pending.

<a id="dr-6"></a>
- [ ] **DR-6 — Useful combined capacity. Unqualified.** Compare cooperative execution with constrained standalone controls using fixed per-contributor budgets, precision, context and useful-answer requirements. Retained recovery allocations are below budget but do not establish successful larger-model capacity. Multiple participants/routing alone is insufficient. Implement through the same interface in parallel with DR-5; physical capacity claims require the applicable ordinary execution and lifecycle gates, without increasing budgets or trimming prompts.

  **N-stage implementation checkpoint (2026-10-13):** source work is active, not deferred. Doppler `76a9d4fe` adds versioned ordered layer plans and `81a5a345` adds generic entry/middle/final resident execution with final-only sampling and provider-owned generation hashing. Reploid `cefbd715` adds immutable full-route identities, explicitly versioned discovery offers and bounded replica matching. The [ordered ordinary runner](artifacts/ordered-route-runner-20261013/README.md) traverses every stage, admits the complete route before input disclosure and retains uncertain cleanup until retry settles it; source tests exercise 2–7 and 16 logical stages and twenty requesters. [Actual source composition](artifacts/ordered-route-integration-20261013/README.md) joins real resident admission/sampling/decoding to the runner with injected numerical kernels; it retains the initial digest mismatch and passing correction. This is source/component acceptance, not signed remote execution, physical capacity or deployment. Coordinator-mediated intermediate disclosure is explicit; direct adjacent delivery, installed/physical authenticated host acceptance, shared-device admission and N-stage signed qualification remain open; explicit host/transport wiring now has scoped source acceptance below.

  - [x] **Ordered resident/peer source boundary:** `b784c91a` maps immutable route identity through the actual resident lifecycle; `369c324f` adds authenticated ordered binary peer execution with full transfer grants, duplicate protection and cleanup ownership. Focused CPU/source controls pass; no physical-network or GPU claim. Real facade/v4-grant composition is retained in [source integration](artifacts/ordered-route-integration-20261013/README.md).
  - [x] **Per-stage conversation pipeline controls:** the existing ordered runner leases each stage independently, allowing another conversation onto an earlier stage while a later stage is occupied. Same-stage execution remains serialized; queued cancellation/revocation and unrelated-conversation survival pass. [Runner evidence](artifacts/ordered-route-runner-20261013/README.md) records 48 focused controls and actual Verification Worker acceptance. This does not establish cross-route fairness, physical-device accounting or hardware speedup.
  - [x] **Explicit browser/native stage preparation:** [host controls](artifacts/ordered-host-preparation-20261013/README.md) snapshot the assigned stage, require public ordered provider capability before acquisition/native GPU initialization, validate the actual plan index, and await resident preparation. Ninety focused tests and actual Verification Worker pass. Automatic host identity composition and physical N-stage opening remain open.
  - [x] **Ordinary ordered chat/entry source path:** `33fa5b90` connects full-route chat, v4 grants, authenticated entry streaming and route-preserving summaries; public requester retries bind fresh attempts to exact approved routes. Ninety-four focused tests and actual Verification Worker pass. Independent [actual source integration](artifacts/ordered-route-integration-20261013/README.md) uses real peer/facade/runtime lifecycle with injected numerical kernels; physical chat and installed delivery remain open.
  - [x] **Inventory versus complete entry readiness:** [discovery controls](artifacts/ordered-discovery-20261013/README.md) retain ready stage inventory without exposing incomplete routes as usable chat models. Full coordinator/transport/resident/execution/plan/model/layout bindings are required for ordered entry hints; legacy requesters exclude ordered routes. Thirty-one focused controls and actual Verification Worker pass.
  - [x] **Full-route activity projection:** [source and Chromium controls](artifacts/ordered-chat-activity-20261013/README.md) display every assigned stage, retain labels after discovery loss, and use bounded measured stage timings for one time-share bar and token rates. Missing timings remain pending; current requester streaming does not forward live stage timing. This is presentation/measurement plumbing, not hardware speed or physical N-stage acceptance.
  - [x] **Explicit ordered automatic source composition:** [ownership and in-process network controls](artifacts/automatic-ordered-participation-20261013/README.md) connect declared stage preparation, full-route discovery, authenticated route-keyed peers and ordinary chat/entry. Local stage zero can request its own route without RTC-to-self; weightless requesters load no model. Exact recipients/input/deadline remain bound through approval, healthy channels survive discovery loss, and unknown cleanup stays owned through retry. Seventy-four focused tests, library types, charters and actual Verification Worker pass (warnings retained). Certificate verification and numerical stage ports in the four-logical-participant control are injected; host composition, autonomous cold stage assignment and physical/installed/signed qualification remain open.
  - [x] **Automatic cross-size source composition:** the same [actual network-owner controls](artifacts/automatic-ordered-participation-20261013/README.md) pass 2–7 stages, each with two concurrent local/remote requesters, zero weightless-requester loads, exactly N−1 execution channels, signaling-enumeration loss and settled per-stage attempts. Certificate verification and numerical stage ports are injected; these are 3–8 logical participants in one process. Physical scale, overload, replicas and the broader cross-size failure matrix below remain open.
  - [x] **Browser/native ordered host composition and retry ownership:** `9f55a5f1` forwards an explicit ordered configuration from product-session/native CLI through actual participant/transport binding; failed connection, contribution and network owners remain retryable and block replacement until settled. `d29cdec8` retains the native provider through the owned device loss barrier, including bounded timeout and confirmed-loss retry. [Combined source checkpoint](artifacts/ordered-source-checkpoint-20261013/README.md) passes 511 tests with one existing skip. Installed/physical host teardown, generated candidate delivery and signed N-stage execution remain open; no public default or pin changed.
  - [ ] **Ordinary ordered application wiring:** bind immutable routes over the existing authenticated peer network and compose automatic preparation/discovery with the completed ordered chat/entry source path. Permit multiple active route bindings per participant without retiring unrelated work. Preserve exact route identity and existing requester-owned history. Doppler's ordered capture path and a new standard archive are being prepared independently; do not reuse two-stage physical receipts as N-stage evidence.

  - [ ] **Multistage contract extension:** specify route cardinality and ordered stage/model/layout identities, per-stage signed permissions/acknowledgments, route-wide reservation and rollback, shared hardware budgets, per-conversation state/queue isolation and settled cancellation. Route length follows the model’s partition requirements and measured compute/transfer costs, not connected-peer count. Bind the entire admitted route and each boundary layout before disclosure; replica replacement requires a fresh authorized attempt when model state is lost. Reuse existing owners; version beyond RD-CANON/1's two-stage acceptance without weakening it.
  **Existing owners and concrete gaps:** `partition-placement.js` selects legacy pairs or bounded full ordered routes; `partition-runner.js` retains the legacy token lease and adds explicit ordered per-stage leases and route-wide settlement. `resident-partition.js` maps declared stages through Doppler; `partition-reservations.js` keeps uncertain attempts charged. Explicit ordered `automatic-partitions.js` composes known host stages and prepared route entries. Automatic host composition, autonomous cold complementary-stage assignment, demand-driven replica preparation and cross-process physical-device budgeting remain open; preserve these owners and Doppler's declared interfaces rather than starting a separate scheduler. Current browser policy admits at most two concurrent attempts per owner; five states per computer is an acceptance target, not a configuration change justified by arithmetic alone. Admission across browser and native processes sharing one physical GPU must account for their combined commitments, with unknown ownership remaining charged. The existing whole-request `chat/scheduler.js` is a separate scheduling surface and does not establish fair multistage token execution.

  - [ ] **Cross-size and multi-requester coverage:** use the same ordered-route implementation for 2, 3, 4, 5, 6 and 7 stages, plus larger generated cases within declared bounds. Cover uneven contiguous layer ranges, absent/mismatched middle stages, replica alternatives, heterogeneous browser/native capabilities, nodes both requesting and contributing, queue saturation, cancellation at every stage, expired grants, disconnects, duplicate/out-of-order deliveries and unknown settlement. Test interactions with generated/replayable schedules instead of claiming exhaustive coverage of an unbounded network. Label logical-node simulation separately from independent physical machines.
  - [ ] **Efficiency mechanisms with separate acceptance:** retain verified weight-piece custody and resident reuse; measure route costs and stage bottlenecks before introducing adaptive ranking or demand-driven replicas. Layer pipelines, weight storage, tensor parallelism, speculative token drafting/replay and replicated computation are distinct mechanisms. Inventory their existing contracts before implementation. Predictive tokens require target-model acceptance and safe publication; peer agreement or majority voting cannot replace numerical correctness, authorize disclosure, or silently change the requested model. Any tensor-parallel or consensus extension needs explicit semantics, resource ownership and measured end-to-end benefit, not merely more participating nodes.

  - [ ] **Replica and scheduling acceptance:** test the intended 12-node/3-stage/4-replica arrangement, 20 questions/60 stage states with five-state per-node limits where measured memory permits, and a 100-node/multiple-model mix. Share immutable resident weights while charging each admitted conversation’s private state and temporary buffers. Bound admission and queued work by memory, compute allowances and permissions; measure fairness and starvation under overload. Replicate stages from observed demand and preparation/transfer cost within explicit supply and compute grants. Include storage-only and mixed suppliers with separate consent, cold preparation, competing requests, constrained compute, stage failure, explicit retry and useful-work/latency/cost comparisons. These are targets, not current support or claims of simultaneous GPU execution.

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
- [x] **ALL-1 — One canonical queue and sole driver.** This thread (`/root`) directs all ordinary release and RD-CANON/1 work, delegates bounded tasks, coordinates shared machines, integrates evidence and controls applicable promotion. The former independent topology roadmap is consolidated below. The original audit reorganizes the existing TODO into the seven requested sections with all 46 stable IDs. Doppler's TODO and the checklist pointers in Doe's status front door have been removed. Repo-local evidence remains with its owner. No duplicate active roadmap was created.

  The [previous checklist at dd4e1275](https://github.com/clocksmith/reploid/blob/dd4e12759128e9a38f63f16a3c02c132835eeab5/TODO.md) preserves the complete earlier chronology, rejected candidates and reference-activation reversal. It is historical, not a second work queue. Migration: W1/W2 → DOP-1/2; W3 → DOP-3/4/7/8; old 1 → DR-1; 2–5 → REP-6/REP-1; 6 → DOP-2/DR-5; 7–8 → DOP-6/ALL-4; 9 → REP-7/DR-5; 10–12 → REP-5/REP-6; 13–15 → REP-7/DR-5; 16 → DR-6; 17–18 → DOP-8/ALL-6; 19–22 → REP-1/2/3/DR-2; 23 → REP-1/DD-4; 24 → REP-5; 25 → ALL-7. Earlier completed diagnosis remains complete even where broader acceptance is open.

<a id="all-2"></a>
- [ ] **ALL-2 — Assign physical windows. Required for each new run.** Use the authorized heavy Linux host for expensive diagnostics, Suby for another compatible physical executor, and Mac through the agreed controller. Before each run, check live owners and record the controlling session, host/GPU, browser/profile, workload, other GPU consumers and release/settlement. The previous owned CPU/browser runs are closed; that is not a standing reservation or proof of present availability. Preserve the existing public contributor and retain any measurement interference. UI/source work can proceed without a GPU reservation.

<a id="all-3"></a>
- [ ] **ALL-3 — Freeze and verify each handoff. Ongoing.** Record application bundle, archive and installed files, model, tokenizer, shader, independent reference, provider library, GPU and driver. Verify actual served/loaded bytes and execution path, not just advertised hashes. DR-1 and DOP-5 are audited starting points; native and physical candidate handoffs remain open. Refresh generated artifacts from their source, never patch browser copies independently.

<a id="all-4"></a>
- [ ] **ALL-4 — Preserve reference authority. Approved target passes the declared browser and native/browser splits; remaining acceptance is scoped above.** Separate F64 mathematics, explicitly specified F32 evaluation, source-model checks and historical runtime captures. Retain the historical reference correction/reversal in [reference disposition](artifacts/reference-correction-20261011/README.md). A replacement requires independent justification and explicit approval. Never activate captured results merely because they match. Keep frozen inputs and tolerances unchanged. The user separately approved the bounded recurrent-state and broader paired-intermediate proposals under DOP-6; these do not change reference authority or authorize unrelated precision changes.

<a id="all-5"></a>
- [ ] **ALL-5 — Commit owned deltas and report identity. Ongoing.** Work directly on each owning main branch; preserve concurrent edits; stage only this task, check relevant links/anchors and diffs, then commit/push without force. Existing source sweeps remain retained; focused checks accompany subsequent tooling changes. This audit changes tracking only, not runtime or generated delivery. Each implementing agent reports evidence and pushed revisions to root; root updates canonical acceptance status rather than creating another queue.

<a id="all-6"></a>
- [ ] **ALL-6 — Promote and deploy only applicable qualified configurations. Not ready for candidate chat.** After applicable package/numerical/lifecycle/basic-chat application gates and deployment authorization, verify served app/package identities, fresh-browser use, saved history/drafts and successful requests after interruption. Contribution remains optional. Document/attachment quality, speculation, Doe performance, optional mesh capacity and external adoption are not gates for an otherwise qualified basic-chat release. Do not deploy failed Gemma W8A8 or silently replace the standard archive.

<a id="all-7"></a>
- [ ] **ALL-7 — Maintain scope. Ongoing.** Defer Metal/D3D12 campaigns, browser replacement, portable checkpoints, language rewrites, new schedulers, transport platforms and publication frameworks. Preserve completed strategy synchronization/evaluation publication; do not reopen them. Keep hygiene findings separate from runtime acceptance. No new dashboard, model catalog or unrelated architecture campaign is needed. The explicitly authorized canonical ordinary/fork/replay contract below remains in scope through existing owners; it does not authorize portable checkpoints or another scheduler.

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

---

<a id="canonical-topology-contract-rd-canon1"></a>

## Canonical topology contract: RD-CANON/1

Implementation contract, 12 October 2026. This section consolidates the former
`docs/topology1.md`, `docs/topology2.md`, and `docs/topology3.md` under the user's
RD-CANON/1 specification. It is a design and acceptance contract, not evidence of
passing tests or permission to promote a runtime. MUST means required; MAY means
an explicitly negotiated option. Implementation status remains in the checklist
above; source components do not close integration or physical qualification gates.

Build ordinary sampling consistency, then one local same-policy fork, then fixed
two-stage target-replay blocks. The delivery gates below belong to this existing
queue, not a separate campaign. RD-CANON/1 resolves earlier draft conflicts,
including bootstrap, C/L limits, route-cardinality publication, and the stronger
performance gate. Earlier drafts remain available through Git history.

### 1. Scope and ownership

Doppler owns model computation, valid partitions, sampling, decoding, inference
state, and local transitions. Reploid owns membership, placement, grants,
reservations, transport coordination, and durable conversation publication.
Extend these owners; do not introduce another runtime, cache, receiver, or scheduler.

A piece is verified model data. A partition is a valid computation segment. A
stage is a prepared partition on a particular resident/process/device. A route
is either one whole-request stage or exactly two sequential layer stages.
Independent jobs have their own complete-operation lifecycle. They are not
speculative tokens.

The initial block protocol uses two stages: A owns input layers and the existing
coordinator; B owns output layers and authoritative sampling. The conversation
workspace owns publication. One-stage ordinary requests require only their own
stage acknowledgment. Additional stages, portable checkpoints, cross-policy
forks, rejection sampling, and transparent failover are excluded.

### 2. Minimal immutable contracts

Execution identity MUST bind model, tokenizer, adapters, execution/partition
plans, numerical policy, state/activation/decoder layouts, and exact runtime
archive. Generation identity additionally binds every sampling, stopping,
decoding, output-limit, and seed choice. An attempt binds requester, input digest,
authorization scope, route, generation identity, coordinator/publisher epochs,
and each stage's participant/device epochs and resident identity. None changes
in place.

Generation policy MUST contain: sampler/arithmetic profile; 64-bit seed;
temperature; top-K/top-P; repetition/presence penalties and explicit history
windows; suppressed/pad/EOS/stop token IDs; ordered stop strings; tool-boundary
policy; maximum generated tokens N; materialized-input capacity C; total accepted
prompt-plus-output limit L; raw/visible UTF-16 limits; decoder identity. C and L
have different meanings. Model transforms, including softcap, belong to execution
identity and run exactly once.

Counts and byte sizes MUST be bounded nonnegative safe integers; token IDs MUST
be valid vocabulary indices. Every array and payload needs an admitted bound.
Reject unknown fields/versions, unsupported policies, invalid UTF-8, nonfinite
numbers, overflow, and inconsistent lengths before allocation. Privately copy
or freeze admitted data.

New metadata uses
`SHA256(UTF8(schema) || 0x00 || UTF8(RFC8785-JCS(body)))`, excluding its own digest.
Token arrays use
`SHA256(UTF8("doppler.tokens/v1") || 0x00 || uint64LE(length) || uint32LE(each token))`.
Hash complete logical token sequences independently of block boundaries. Binary
payloads contribute exact byte length and digest. Preserve existing signed-format
canonicalization.

An activation frame binds attempt, sequence, base cursor, proposal,
source/destination stages, absolute row positions, token-context digest, layout,
and payload digest. Bytes MUST equal rows × hidden size × element stride.
Scalar F16/F32 use one component and 2/4 bytes; paired two-F32 uses two components
and 8 bytes. No inferred components, casts, or trailing bytes.

### 3. One versioned sampling contract

Explicitly select topology3's `philox4x32-10/cpu-categorical-v1` profile:
Philox4x32-10, with exact unsigned multiplication and modulo-2^32 arithmetic.
Seed hexadecimal is high-word followed by low-word; zero is valid. Generate an
omitted seed cryptographically once and persist it before execution. Legacy
numeric seeds retain their legacy identity.

For semantic output index t, purpose s, and draw j:

```text
counter = [low32(t), high32(t), s, floor(j/4)]
word = Philox(counter, [seedLow, seedHigh])[j mod 4]
u = word / 2^32, evaluated in binary64, so 0 <= u < 1.
```

Target selection uses purpose 0, draw 0. Independent drafting is the default and
uses purpose 1; shared-target drafting MAY use purpose 0 explicitly. Purposes 2/3
remain reserved. First output uses t=0; after g accepted tokens, t=g. Block sizes,
retries, routes, attempts, and scheduling MUST NOT alter target draws. Greedy
acceptance advances t without requiring randomness.

Use one pinned final-stage CPU sampler and host arithmetic profile:

1. Validate post-model logits; reject NaN/+infinity; -infinity is a mask. Copy
   working logits to F32.
2. Apply repetition penalty once per distinct history token, positive scores
   divided and nonpositive multiplied; round each change to F32. Subtract
   presence penalty once per distinct token, rounded to F32. Windows include
   prompt history; zero means all history.
3. Mask pad/suppressed IDs. At temperature zero select the largest finite score,
   breaking ties by smallest ID.
4. Otherwise sort descending score, then ascending ID; retain top-K unless K=0.
   Compute exp((score-maxScore)/temperature) and ordered sums in the pinned
   binary64 profile.
5. Keep the smallest nonempty top-P prefix, renormalize in retained order, and
   select the first cumulative probability strictly greater than u. Rounding-only
   overrun selects the last candidate.

All-masked, invalid, or zero-total distributions fail; there is no uniform
fallback. GPU selection and cross-engine equality require separate qualification.
Matching random words alone establishes neither numerical accuracy nor matching
probability arithmetic. Target replay reproduces qualified ordinary draws;
probability-preserving rejection sampling is a different, excluded algorithm.

### 4. Bootstrap and exact cursor

After prefill, H is materialized history, m=|H|, P is prompt length, g is accepted
generated-token count, and p is the optional accepted pending token. A cursor
records these counts, pending ID, next target index, materialized/accepted token
digests, generation identity, revision, and terminal reason. The invariant is:

```text
m = P + g - indicator(p exists); next target index = g.
```

Admission validates the tokenizer's effective prompt and requires P<=C and P<=L.
Empty input follows the declared tokenizer/BOS rule; unsupported empty input
rejects. N=0, or P=L, yields a durable admission-only empty terminal result,
without model work or a reusable inference cursor. This explicitly tagged result
has no execution acknowledgments or cursor; its reason is max-tokens for N=0,
otherwise context-limit.

Otherwise ordinary prefill materializes the prompt on every route stage. B, or
the sole whole-request stage, selects the first token at index 0. The stages
settle and acknowledge the same successor: H=prompt, m=P, g=1, p=first token.
Publish through section 7 before beginning a block. Failure before this barrier
exposes no candidate output. Bootstrap uses ordinary execution, not speculative
scratch. Sequence 0 identifies bootstrap; subsequent ordinary advances/blocks
use consecutive sequences. The accepted token range begins at zero, or at the
inherited count for a fork.

If P=C<L, last-prefill logits may produce that first token; it remains pending
and the cursor becomes terminal for context capacity unless a higher-priority
stop applies. C bounds consumed input positions; L bounds accepted history,
including pending output. Preserve these meanings explicitly in the qualified
ordinary policy.

At live block entry p MUST exist. Let R=N-g. Admit only:

```text
0 <= k <= min(4, R-1)
m+k+1 <= C
P+g+k+1 <= L
```

plus worst-case resources and output bounds. Terminal cursors and R=0 cannot
start. Inputs are [p,d1,...,dk]. Row j predicts the next token at target index g+j
using history H,p,d1...dj. Never resample or republish p.

If r<k proposals match before correction c:

```text
H'=H+p+d1...dr; new output O=d1...dr+c; p'=c.
```

If all k match:

```text
H'=H+p+d1...dk; O=d1...dk+bonus; p'=bonus.
```

For n=|O|: m'=m+n, g'=g+n. Increment revision once. A terminating accepted token
remains pending; materialize only its predecessors and select no bonus. Reaching
N, L, or exhausted input capacity makes the successor terminal.

Examples from P=5, g=2, m=6, pending p:

- k=0 or first rejection: H'=H,p; O=x; m'=7, g'=3.
- Draft a,b,c; match a then correction x: H'=H,p,a; O=a,x; m'=8, g'=4.
- All match, bonus x: H'=H,p,a,b,c; O=a,b,c,x; m'=10, g'=6.
- Match a then terminating EOS: H'=H,p,a; O=a,EOS; m'=8, g'=4, pending EOS,
  terminal. The same predecessor rule covers terminal correction and bonus.

### 5. Composite state and target replay

Capture a prefix only at a settled, published cursor with no unresolved operation.
One admitted local child preserves exact execution/generation identities, seed,
token history, pending token, decoder state, and target index. Reference inherited
publication; do not republish it. Handles are opaque, locally registered,
authorization-checked, and epoch-bound.

Only B owns mutable sampling-policy/decoder successors in the split route; A
mirrors the bound logical decision/cursor and owns its own numerical state. The
sole whole-request stage owns both. Preserve attention-cache contents/geometry,
overwritten ring slots and indices, recurrent high/low components, convolution
history, policy history, decoder partial bytes/control state, withheld stop suffix,
counters, and all other future-affecting state. Share immutable weights through
charged references. Missing clone/restore support rejects; mutable-parent aliasing
is forbidden.

For k>0 use one immutable parent and one admitted scratch branch:

- `beginBlock`: validate cursor/reservation, pin parent, copy scratch, await copies.
- `evaluateBlock`: run hypothetical inputs sequentially, modifying scratch only.
  A retains token rows and original boundary rows; B retains received rows,
  positions/layout, and token context. B may keep bounded provisional target
  choices rather than full-vocabulary matrices.
- `verifyBlock`: bind one immutable matching-prefix/correction/bonus decision
  and accepted-only decoder successor. No permanent sampling advancement or
  publication.
- `prepareBlockCommit`: if scratch extends beyond the successor, restore from
  parent and replay exactly n accepted input rows. A replays tokens; B replays
  original received activations, never tokens alone. A MUST byte-compare
  regenerated accepted boundary rows against originals and reject
  `REPLAY_DIVERGENCE`. No resampling, repeated decoding acceptance, or tools.
  Await submitted work.
- `commitBlock`: under the resident lock, compare expected parent cursor/revision,
  install once, retain immutable acknowledgment.
- `discardBlock`: settle provisional ownership. After commit return
  `ALREADY_COMMITTED`; cleanup cannot pretend rollback.

Full-acceptance reconstruction MAY be skipped only if scratch already equals the
required state. Prepared means exact successor exists separately; committed means
installed locally; published means durably recorded. These are distinct.

Ordinary k=0 advances in place with no speculative copy, proposal evaluation, or
prepare RPC. Its ordinary result carries the successor acknowledgment needed for
the same publication barrier. Failure after in-place mutation interrupts the
attempt rather than claiming restoration.

### 6. Protocol and failure handling

One unresolved block per attempt spans evaluation, decision, all preparations,
all commits, publication acknowledgment, and required cleanup. Prepared and
committed records MUST agree on attempt, sequence, base cursor, decision, and
successor; layer-specific state bytes need not match.

Receiver key is `(coordinator epoch, participant epoch, attempt ID, sequence, phase)`,
inside the fixed stage namespace. Store the behavioral request digest separately.
Identical pending calls join; completed calls replay their original result after
current authorization. Changed fingerprints collide. Old/evicted results return
`RESULT_EXPIRED` and never reexecute.

Initial limits: k<=4, 64-KiB control messages, two completed block-result sets
retained for at most 60 seconds, 1-MiB retained control data per attempt.
Frames/host memory have separately enforced route bounds. Unresolved records
cannot be evicted. Maintain monotonic retirement boundaries and bounded attempt
tombstones; when full, drain/reject admission rather than forget identities.
Deadlines and retry windows MUST be finite and admitted before execution.

Before commit, cancellation stops future work and settles/discards scratch. Once
any stage commits, retry only the identical operation within retention/deadline;
unresolved partial commitment interrupts and retires the attempt. Unknown
publication is reconciled through storage, never regeneration. Disconnect,
coordinator loss, stale epochs, or cleanup failure cannot revive output or release
uncertain allocations.

Restart changes process/device epochs. Healthy independently admitted capacity
MAY run a fresh authorized attempt while old resources remain charged. Persisted
text, a warm model replica, or a cursor is not a recoverable GPU checkpoint.
No coordinator election or transparent GPU recovery is promised.

### 7. Publication decoding and cancellation

An execution publication contains attempt/sequence, expected revision, previous
publication digest, exact accepted IDs and contiguous token range, successor
cursor, decoder/output delta, stopping outcome, and authenticated commit
acknowledgments. Its acknowledgment set MUST equal the route's stage IDs exactly:
one for whole-request, two for split execution. Reject missing, extra, duplicate,
or mismatched acknowledgments. Admission-only empty results are the explicit
no-execution case in section 4.

The existing conversation owner MUST atomically validate writer epoch,
cancellation/retirement state, revisions, matching commits and contiguous ranges;
append the immutable record; and advance its durable head. The publication key is
`(coordinator epoch, attempt ID, sequence)`. An identical publication key returns
the original receipt; changed content collides. Only after transaction completion
install projections and notify UI. Use one authorized writer and a genuinely
transactional adapter; independent load/save writes are insufficient.

Cancellation competes through that same durable transition. Cancellation first
suppresses unpublished output; publication first preserves it and cancellation
stops later advancement. Unknown/write-failed storage fences execution and
delivery until reconciled. Writer takeover creates a new epoch and interrupts
active attempts. Delivery deduplicates saved events and rechecks read/disclosure
permission; replay never regenerates.

Decode only accepted IDs on provisional decoder state. Count invisible/control
tokens. Buffer incomplete bytes and the longest suffix that could become a stop
string. Detect completed matches anywhere in each new chunk; earliest completion
wins, then earliest start and configured order. Hide the stop string and later
text. Priority is EOS/stop-token/tool boundary, text stop, generated-token limit,
then context limit. On normal finalization flush nonmatching suffix according to
the decoder contract; never newly flush it on failure/cancel.

Raw and visible UTF-16 limits are separate hard guards: violation fails the
unpublished transition, without partial-token acceptance or silent truncation.
Tool execution consumes only durably published, deduplicated intents after
separate permission checks; uncertain external effects require the tool's own
idempotency contract.

### 8. Admission privacy and placement

Reserve the complete route in deterministic authority/participant order;
activate only after every stage accepts. Charge disjoint actual allocations:
resident weights once, live attempt/retained-parent state, scratch, replay inputs,
workspace, staging, and unsettled resources. Host retention has a separate budget.
A temporary third copy must be admitted. Copies remain charged until observed
completion; expiry prevents new work but never proves release.

Enforce the frozen route/device allocation cap. Preserve the 1,420,000,000-byte
GPU-buffer ceiling for the currently qualified campaign/device configuration;
it is not a universal cap for future models or hardware. Shared browser/native
hardware requires an actual shared admission authority or enforced exclusive/static
allocations. A shared-device label is not enforcement. Unknown bounds make
speculation ineligible.

Custody, compute, prompt disclosure, prefix reuse, drafting, and output replay are
separate grants. A colocated drafter is still a disclosure recipient. Keep private
prefix handles/hashes out of global discovery. Signatures prove identity/integrity,
not honest target computation.

Prepare missing coverage in the slow loop; select eligible prepared routes in the
request loop. Never migrate an active attempt. Optional ranking extends existing
placement using measured complete-route preparation, queue, prefill, directed
transfers/relays, decode, and risk costs without double counting. Fixed-route
correctness comes first.

### 9. Existing implementation owners

Doppler: `generation-contract.json` and its generator own declarations;
`token-sampling`/`generation-step` own the versioned sampler; ordinary/resident
callers share semantic indices. Extend `partition-attempt`, `resident-partition`,
`partition-execution`, KV/recurrent/convolution owners, and bundled
`incremental-decoder`; add narrowly scoped resident-state/block contracts.
Export Doppler types through `doppler-gpu/partitions`; Reploid imports them.

Reploid: extend `partition-contract`, runner, peer, entry, step-receiver, grants,
reservations, discovery, placement, and automatic-partitions. Extend
`packages/reploid/src/chat/workspace.js` and `self/host/chat-session.js` with one
publication reducer/transactional history adapter under existing chat/artifact
ownership. Reuse custody, browser host, `server/native-participant.js`, and tool
runner. JSON declares policy; JavaScript orchestrates; WGSL owns GPU
computation/copies. Preserve legacy identities/history, negotiate new capabilities
explicitly, and regenerate generated files. Version expanded wire policies,
including C/L and zero-output outcomes; do not reinterpret older schemas.

### 10. Delivery and release gates

Deliver in order: contract/cursor fixtures; ordinary sampler consistency; one
real local fork; fixed two-stage replay plus transactional publication;
exact-package application qualification. Measured placement is optional afterward.

Required tests cover malformed contracts and Philox vectors;
transforms/ties/uniform endpoints; bootstrap/N=0/context edges; every
rejection/terminal position; nonzero-temperature whole/split/block equivalence
under retries/interleaving; real ring/recurrent/convolution/decoder restoration;
replay divergence; copy/dispatch/readback cancellation and third-copy peaks;
duplicate phases/expired results; partial commit/disconnect/stale epochs;
publication failures/cancellation races/UI replay; cross-block stops/tools;
shared-device overcommit; grants/revocation; and scratch-free ordinary execution.

Numerical accuracy, distribution parity, same-seed replay, lifecycle safety,
answer quality, and performance are separate gates. Preserve existing tolerances,
including 0.001 where required. The current paired full-model 55-prefix package
qualification remains required before promotion. Bind evidence to source commits,
exact archive/installed files, browser/native bundles, model/configuration,
provider, and reference. Version strings alone are insufficient.

Freeze workload, seeds, route, cache/warmup policy, resource limits, and measurement
method. Compare ordinary execution with fixed k=1,2,4; no adaptive block sizing
before a fixed configuration qualifies. Include drafting, copying, computation,
transfer, rejected work, reconstruction, commit, durable publication, and required
cleanup. Denominator: newly published accepted raw tokens. Preserve
failed/interrupted measurements; report loading separately and end-to-end.

Enable speculation only with at least 30 matched measured pairs, at least 10%
median committed-token-cost improvement, and a paired 95% confidence interval
excluding no improvement. Additional p95 first-irrevocable-output delay MUST be
<=25 ms; additional p95 visible publication gap MUST be <=50 ms. Report longest
visible pause, transferred/discarded work, memory peaks, and cancellation
settlement. No correctness, numerical, lifecycle, authorization, or quality
regression is permitted. Inconclusive cohorts remain disabled.

Remaining work is qualification of concrete package/model, arithmetic profiles,
state geometries, hosts, storage durability, budgets, drafter, and measured
cohorts. None permits weakening this architecture or its gates.

### Inherited normative fixtures and provenance

Pinned source commit: `clocksmith/reploid`
`81c355e2a56b75ca488a7cc6911e288ec4354458`.

The following retained details come from topology3 sections 3.1, 4.1, 6.2, 10,
and 11. They remain normative where sections 1–10 above do not override them.
Former requirement/test IDs remain for traceability; they do not identify a
second active specification. The original [topology3 source](https://github.com/clocksmith/reploid/blob/81c355e2a56b75ca488a7cc6911e288ec4354458/docs/topology3.md)
and [topology2 source](https://github.com/clocksmith/reploid/blob/81c355e2a56b75ca488a7cc6911e288ec4354458/docs/topology2.md)
retain historical context. Topology2 section 11.3 supplies the stronger
performance gate in section 10 above. Conflicting topology3 section 12.3
thresholds do not apply. Topology1's earlier proposal is superseded and retained
in Git history, not as another work queue.

#### Canonical representation fixtures

**RDI-03 — Encoding and validation.**

```ts
type UInt32 = number; // Integer: 0 .. 4_294_967_295
type Count = number; // Nonnegative safe integer, further bounded by policy (section 2)
type Revision = number; // Integer: 0 .. Number.MAX_SAFE_INTEGER
type Bytes = number; // Nonnegative safe integer; units: bytes
type Milliseconds = number; // Finite, nonnegative
type TokenId = number; // Integer: 0 <= id < vocabularySize; no sentinel
type Id = string; // 1..256 ASCII characters: [A-Za-z0-9._:-]
type Epoch = string; // Exactly 32 lowercase hexadecimal characters
type Hash = `sha256:${string}`; // Exactly 64 lowercase hex digits after prefix

interface Range {
  start: Count; // Inclusive
  end: Count; // Exclusive; end >= start
}
```

All public records MUST reject unknown fields unless their schema explicitly defines an extension point. Required nullable fields MUST use `null`, not omission. Arrays MUST have declared length limits. Numeric overflow, nonfinite values, malformed UTF-8, and inconsistent lengths MUST reject before GPU allocation.

New metadata digests MUST use a domain-separated SHA-256 over canonical JSON. The canonicalization is RFC 8785 JCS; binary arrays travel separately and contribute their byte length and digest to the metadata. Existing signed formats retain their original canonicalization and signatures. [RFC Editor](https://www.rfc-editor.org/rfc/rfc8785)

```text
digest(schema, body) =
  SHA256(UTF8(schema) || 0x00 || UTF8(JCS(body)))

tokenDigest(ids) =
  SHA256(UTF8("doppler.tokens/v1") || 0x00 ||
         uint64LE(ids.length) || uint32LE(ids[0]) || ...)
```

A record’s own digest field is excluded from its digest input. Transport request IDs, signatures, mutable timings, and local handles are not semantic identity unless explicitly listed.

#### Philox algorithm and known-answer fixtures

**RDI-05 — Random words.** The new generator is **Philox4x32-10**, with the constants and round function below, matching Random123 v1.14.0. This is a sampling generator, not an authentication primitive. The specified algorithm and published vectors are reference requirements; conformance evidence is recorded separately in the checklist above. [GitHub](https://raw.githubusercontent.com/DEShawResearch/random123/v1.14.0/include/Random123/philox.h)

```text
M0 = 0xD2511F53
M1 = 0xCD9E8D57
W0 = 0x9E3779B9
W1 = 0xBB67AE85

repeat 10 rounds:
    (hi0, lo0) = unsigned_32x32_product(M0, c0)
    (hi1, lo1) = unsigned_32x32_product(M1, c2)
    (c0,c1,c2,c3) =
        (hi1 XOR c1 XOR k0, lo1, hi0 XOR c3 XOR k1, lo0)
    before the next round:
        k0 = (k0 + W0) modulo 2^32
        k1 = (k1 + W1) modulo 2^32
```

Every multiply MUST preserve its full 64-bit unsigned product. JavaScript implementations MUST NOT obtain its high word from a rounded 53-bit `Number` product.

Seed encoding is conventional 64-bit hexadecimal. The last eight hex digits are `k0`; the first eight are `k1`. All-zero seed is valid. Legacy numeric seeds MUST NOT be silently coerced into this format.

For generated-token index \(t\), purpose \(s\), and draw index \(j\):

```text
counter = [low32(t), high32(t), s, floor(j / 4)]
word    = Philox(counter, key)[j mod 4]
```

Purpose IDs are fixed:

| Purpose                             |  ID |
| ----------------------------------- | --: |
| Target selection                    |   0 |
| Independent draft selection         |   1 |
| Reserved future acceptance test     |   2 |
| Reserved future residual correction |   3 |

Published primitive known-answer vectors:

| Counter words                         | Key words           | Output words                          |
| ------------------------------------- | ------------------- | ------------------------------------- |
| `00000000 00000000 00000000 00000000` | `00000000 00000000` | `6627e8d5 e169c58d bc57ac4c 9b00dbd8` |
| `ffffffff ffffffff ffffffff ffffffff` | `ffffffff ffffffff` | `408f276d 41c83b0e a20bc7c6 6d5451fd` |

Implementations MUST also test counter packing, lane selection, seed endianness, and values above the 32-bit token-index boundary.

#### Retained-row replay fixtures

**RDI-11 — Replay-input retention.**

`evaluateBlock()` MUST retain exact inputs until commit or discard settles:

- Stage 0: token IDs, absolute positions, and execution identity.
- Stage 1: received activation rows, layout, absolute positions, payload identity, and required token context.

For partial acceptance of `a` from `a,b,c`, both stages materialize `p,a`. Stage 1 therefore replays the **first two activation rows**, not one row and not token IDs alone.

The first implementation MUST restore scratch from the parent and replay the accepted materialized prefix whenever tentative state extends beyond the successor. It MUST NOT use counter-only truncation.

Stage 0 MUST compare regenerated accepted boundary rows with its retained original rows under the exact replay contract. A mismatch is `REPLAY_DIVERGENCE`; it MUST NOT silently substitute the new rows. Stage 1 replays the original received rows.

Reconstruction installs the bound decision without repeating authoritative sampling, decoder acceptance, publication, or tool execution.

#### Implementation map and migration rules

**RDI-26 — Extend owners and migrate explicitly.**

`Changed` below means the specification requires extending an existing owner. `Proposed addition` means a new narrowly scoped module, not another runtime or framework.

| Requirement group                | Existing modules to extend                                                                                                                                                         | Proposed additions and dependencies                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sampling identity and validation | Doppler `src/config/generation-contract.json`, `tools/sync-generation-contract.js`, generated `generation-contract.*`                                                              | Add the versioned policy schema; regenerate declarations rather than hand-editing generated types                     |
| Random words                     | Doppler `src/inference/token-sampling.*`                                                                                                                                           | `src/inference/sampling-rng.*`; Philox vectors and counter packing                                                    |
| Selection consistency            | `generation-step.js`, `src/client/runtime/session-controller.js`, `pipelines/text/resident-partition.js`, `generator*`, `generator/decode-runtime.js`, `src/gpu/kernels/sample.js` | One admitted CPU selection profile; GPU support remains separately qualified                                          |
| Plan inspection                  | Doppler `layer-partition-contract.*`, `partition-execution.js`, `src/client/resident-partitions.*`, `src/partitions.*`                                                             | `partition-plan-inspection.*` under the existing text pipeline ownership                                              |
| Composite state                  | `partition-attempt.js`, `resident-partition.*`, `linear-attention.js`, `linear-attention/state-layout.js`, `src/inference/kv-cache/`                                               | `resident-state.*`; complete local state ownership and restoration                                                    |
| Decoder snapshot/restore         | Doppler `src/inference/tokenizers/bundled/incremental-decoder.*` and existing generation-output owners                                                                             | Add local snapshot/restore methods to those owners, not a parallel decoder                                            |
| Block computation                | Doppler `src/inference/speculative.js`, `partition-execution.js`, existing logits owners                                                                                           | `resident-block-contract.*`; bounded target-replay operations                                                         |
| Discovery and ranking            | Reploid `partition-discovery.js`, `partition-placement.js`, `automatic-partitions.js`, existing `placement-beliefs.js`                                                             | Optional complete-route observations; fixed-route blocks do not depend on them                                        |
| Block transport                  | Reploid `partition-runner.js`, `partition-peer.js`, `partition-entry.js`, `partition-step-receiver.js`, `partition-contract.js`                                                    | Versioned block envelopes within existing transport                                                                   |
| Grants and budgets               | `partition-grants.js`, `partition-reservations.js`, `resident-partition.js`, `self/config/partition-policy.json`                                                                   | Explicit branch/frame/control allowances and local authority bindings                                                 |
| Publication semantics            | `packages/reploid/src/chat/workspace.js`, `self/host/chat-session.js`, `chat-execution.js`, `product-session.js`                                                                   | A focused publication reducer under `src/chat/` and transactional conversation-history adapter under `src/artifacts/` |
| Piece acquisition                | `self/host/work-partitions.js`, `work-model-files.js`, `packages/reploid/src/artifacts/custody/`                                                                                   | Reuse existing custody; no checkpoint transport in this increment                                                     |
| Browser/native composition       | Existing browser host and `server/native-participant.js`                                                                                                                           | Capability negotiation and exact installed-identity checks only                                                       |
| UI                               | Existing conversation workspace and message rendering                                                                                                                              | Consume durable events; no new scheduler or governance dashboard                                                      |

The generation declarations explicitly identify `generation-contract.json` as their source. The owner map defines required extension points; the checklist above records implementation and qualification status.

##### Migration rules

1. Legacy sampler and generation identities MUST remain interpretable without changing their transcripts.
2. The new generation policy MUST require explicit selection; old numeric seeds are not silently remapped.
3. Block capability MUST be separately advertised. Existing checkpoint/replay flags MUST remain false unless those distinct capabilities are implemented.
4. Paired activation layouts MUST use the existing Doppler layout/schema owner; old receivers reject unsupported schemas rather than inferring them.
5. Existing text-only conversation records remain valid display history. They MUST be marked as lacking authoritative generated-token history and excluded from new prefix/state claims.
6. The transactional history adapter MUST migrate or reference legacy history without two competing authoritative writers. Failed migration preserves the legacy store.
7. Source, package, and served browser changes require new identities and applicable conformance checks. Generated delivery files MUST be regenerated from canonical source.
8. JSON declares policies and limits; JavaScript owns orchestration and state lifecycle; WGSL implements GPU arithmetic. Random-word and CPU selection code are appropriate JavaScript computation, not network policy.

---

#### Acceptance matrix and exhaustive test catalogue

**RDI-28 — Separate gates and evidence.**

Every test below is required acceptance work. This contract alone does not report any as passed; consult the scoped evidence in the checklist above.

| Gate                               | Required evidence                                                                                           | Does not establish                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Distribution parity**            | Split versus whole execution under the same admitted policy, including selected tokens and stopping         | Independent mathematical accuracy              |
| **Independent numerical accuracy** | Applicable approved reference and unchanged tolerance; retain the existing 0.001 requirement where mandated | Same-seed transcript across different samplers |
| **Random-word conformance**        | Published Philox vectors, seed encoding, counters, purposes, lanes                                          | Equal probability arithmetic                   |
| **Same-seed target replay**        | Identical accepted token IDs, stopping, and continuation to ordinary execution in the declared profile      | Universal cross-device equality                |
| **State/lifecycle safety**         | Real state restoration, cancellation, isolation, settlement, and memory accounting                          | Useful answers                                 |
| **Answer quality**                 | Scope-matched basic chat/follow-ups; document factual/citation tasks apply only to secondary attachment acceptance                                                      | Runtime numerical conformance                  |
| **Performance**                    | Complete operation cost and visible pauses against ordinary execution                                       | Safety or quality                              |

The current repository’s qualification boundaries remain separate. This specification neither weakens independent accuracy requirements nor treats their failure as proof of a distribution defect.

##### Test catalogue

| Test ID                             | Test surface and required cases                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **T01 Contract validation**         | New schema tests: malformed IDs, nonfinite values, unknown fields, overflow, wrong layout/stride, payload mismatch, unsupported versions      |
| **T02 RNG vectors**                 | New RNG unit tests plus existing seeded-generation tests; published vectors, seed endian, purpose and index isolation                         |
| **T03 Selection**                   | Identical logits, greedy ties, top-K/top-P boundaries, penalty windows, masks, uniform endpoints, CPU/GPU distinction                         |
| **T04 Cursor**                      | All cursor examples in section 4 above; R=0/R=1; terminal entry; pending-token invariants; invisible accepted tokens                                                 |
| **T05 Fork isolation**              | Real full/ring attention, recurrence, convolution, decoder state, parent continuation after child discard                                     |
| **T06 Replay**                      | Ring overwrite and restore; exact stage-1 activation replay; partial and full acceptance; replay divergence rejection                         |
| **T07 Allocation**                  | Failure before/during copies, transient third copy, cancellation during submitted work, cleanup failure, peak accounting                      |
| **T08 Local blocks**                | Every rejection position, k=0, zero/full acceptance, terminal proposal/correction/bonus, repeated prepare/commit                              |
| **T09 Receiver**                    | Extend existing receiver suite: pending join, changed digest, duplicate commits, result eviction, retirement boundary, stale epochs           |
| **T10 Distributed failures**        | Lost messages/acks, failure at every phase, one-stage commit, disconnect, replacement on independent capacity                                 |
| **T11 Publication**                 | Durable append failure and unknown outcome, duplicate event, crash before/after append, delivery replay                                       |
| **T12 Cancellation/stops/tools**    | Cancellation/publication races, stop strings across blocks, partial decoded bytes, invisible controls, no speculative side effects            |
| **T13 Routes/resources**            | Complementary capacity, stale offers, provisional admission, directed costs, shared-device overcommit rejection                               |
| **T14 Privacy**                     | Drafter grants, private prefix scope, revoked output reads, changed recipients, unauthenticated handles                                       |
| **T15 Delivery migration**          | Legacy history preservation, writer epochs, exact installed package/browser identities, unsupported capability rejection                      |
| **T16 Physical parity/performance** | Existing physical partition tests extended with nonzero-temperature interleaving, ordinary/block comparison, both placements, complete timing |
| **T17 Application quality**         | Frozen and fresh basic-chat tasks, follow-ups, uninterrupted versus recovered journeys; citations/source navigation only for secondary attachment scope               |

Existing seeded and physical tests SHOULD be extended. New composite-state and block tests MUST use actual state owners rather than mocks for restoration claims. The existing receiver test suite already exercises identity collisions and is the appropriate place for the new bounded-replay cases.

---

*Last updated: October 2026*
