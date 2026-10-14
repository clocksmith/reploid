# Planning migration history

Archived context from 229a6e601adbd970de38c3315d069de4ba707cce. This is a historical snapshot, not a current queue. Current actions are in [ROADMAP](../../ROADMAP.md). Dates, package identities and failures retain their original scopes.

# Reploid, Doppler, and Doe implementation checklist

**Product hypothesis: persistent access to useful large models by pooling already-owned memory and computation.** Consumer chat and developer APIs are access surfaces for the same prepared capacity. Requesters and contributors are overlapping roles; contribution is optional, and requesting requires neither weights nor manual stage assignment. Affordability is a hypothesis to measure against alternatives, not an established advantage. Begin with shared demand for one model within the open, self-organizing mesh; broader cooperation remains the destination.

This is the single cross-project implementation queue; evidence stays in its owning repository. Checked means the stated scope is complete, including a completed rejection. Partial acceptance stays unchecked. “Retained” means inspected existing evidence, not a new hardware run. Each open item names the next delta and its completion condition. The [canonical topology contract](rd-canon-1.md#canonical-topology-contract-rd-canon1) below owns RD-CANON/1 requirements and inherited fixtures; requirements are separate from the acceptance status above them.

**Milestone accounting:** keep one accountable owner and one current next action per existing ID, with only the evidence states applicable to that action. The milestone table summarizes major dependencies; minor tasks do not require five separate reporting exercises. Preserve exact artifact identities and evidence links, including failures. Checked historical acceptance remains checked for its stated package and scope; changed packages remain separately unqualified. Community adoption, possible future commercial commitments and technical release decisions stay distinct. Chronological investigations belong in linked evidence summaries, not another queue.

For outcome-based acceptance navigation, see [critical user journeys](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/docs/critical-user-journeys.md). The catalogue includes useful-answer criteria, uncertain tool outcomes, cancellation/endings coverage and application composition (DEV-01). `npm run verify:journeys` checks catalogue IDs, fields, links and scenario references; this integrity check does not complete runtime acceptance.

**Shared-mesh product target:** many computers serve independent conversations through compatible prepared model stages and replicas. Community means shared demand for one model within the open, self-organizing mesh; it introduces no rooms or manual joining. Discovery stays automatic; contribution and disclosure to actual recipients require permission. Share resident weights while separately admitting history, inference state, compute and disclosure. The twelve-computer/three-stage/four-replica, twenty-question/five-state-per-computer, and hundred-computer/multiple-model cases remain intended targets under [DR-6](requirements.md#dr-6), not advertised capacity. Route length follows model requirements and measured costs, not connected-peer count. RD-CANON/1 retains its two-stage fork/replay scope; ordinary N-stage execution uses an explicitly versioned extension. Contribution is optional and creates no unlimited future service entitlement.

**Live interruption repair:** [public code-answer investigation](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/public-code-answer-20261012/README.md) binds a native runner closure to a discovery advertisement expiring during generation. Preserve active execution ownership while its channel remains open; discovery expiration alone must not cancel the answer or transfer approved recipients. Focused regressions pass for input and output owners. The repair is deployed with served-byte verification; after all four contributors were updated, a [fresh public requester](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/public-code-answer-20261012/final-public-journey.json) completed a question and follow-up through Suby native → x native with zero requester weights and settled cleanup. This is short ordinary-chat acceptance, not signed or simultaneous-long acceptance.

**Active priority (user clarified 2026-10-13): dependable N-stage streaming chat across a shared mesh.** Generalize the existing ordered route, placement, reservations and runtime boundaries now; two-stage execution is a compatibility/regression case, not the architecture ceiling. Preserve the completed UI, browser/native participation, custody and recovery mechanisms. Ordinary N-stage capacity does not wait for speculative fork/replay or document experiments. Keep the prepared two-stage signed delivery immutable as an interim candidate and regression baseline; its acceptance does not close the larger mesh goal.

**Release scope:** ordinary chat models running across physical contributors are the primary deliverable. Complete streaming replies, history-aware follow-ups, independent conversations, cancellation/recovery and return after reload must work through the real UI. Attachment interpretation, contractor comparisons, document calculations, citations and document tool experiments are secondary: retain their failures, but do not make them prerequisites for basic-chat deployment. No further document experiment is active. Numerical accuracy, signed execution, permissions, exact package identity and resource settlement remain required.

**Current UI deployment (2026-10-13):** [single left rail](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/single-chat-rail-20261013/README.md), source `daa928d6`, supersedes the prior two-rail layout at the user’s request. Four centered 44px controls share one expandable threads/network panel; messages and composer retain their common width and recenter together. Both themes, phone widths, keyboard dismissal, New chat, model access, settings restoration and marble switches pass 21 Chromium controls (including the actual Worker) and 51 focused unit controls. The isolated accepted-public-base overlay passes the same browser cases. [Deployment receipt](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/single-chat-rail-20261013/deployment/receipt.json): all 1,921 served files verify at `https://replo.id` as bundle `9fd73d06…`; live four-viewport checks pass. Accepted Doppler 0.6.27 and public library remain unchanged. No inference or broader runtime qualification is claimed. UI work is complete; this thread is stopped for handoff.

Retained evidence: [historical checkpoint 01](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-01). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 02](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-02). Original outcomes, failures and artifact identities are preserved.



1. **N-stage execution and basic chat — [DOP-6](requirements.md#dop-6), [REP-7](requirements.md#rep-7), [DR-3](requirements.md#dr-3), [DR-5](requirements.md#dr-5), [DR-6](requirements.md#dr-6).** Generalize existing plans, resident stages, route placement, authorization, activation delivery and cleanup. Preserve two-stage numerical acceptance as a regression boundary; establish three-stage physical execution before claiming larger supported routes. Run the same implementation through 2/3/4/5/6/7-stage controls, replica choices and generated larger cases. Qualify the implemented host wiring through installed authenticated execution and signed package support; source tests and injected numerical kernels are not physical proof. The ordinary UI must receive streamed replies and history-aware follow-ups with zero requester weights.
2. **Shared concurrent conversations — [REP-4](requirements.md#rep-4), [REP-6](requirements.md#rep-6), [DR-5](requirements.md#dr-5), [DR-6](requirements.md#dr-6).** Admit distinct per-conversation state while sharing resident weights. Exercise many requesters, nodes both requesting and executing, bounded fair service, overload, cancellation at every stage, replacement, renewed approval and failed-cleanup retry. Extend host-wide and shared physical-device accounting; neither logical-node count nor per-GPUDevice limits establish physical capacity. Preserve the existing 1,420,000,000-byte per-executor ceiling and serial long controls; qualify concurrent long use on the selected exact package.
3. **One qualified mesh release — [DR-1](requirements.md#dr-1), [ALL-3](requirements.md#all-3), [ALL-6](requirements.md#all-6).** Freeze browser/native/runtime/model bytes and verify supported placements and route sizes, signed selective acquisition, useful basic chat, lifecycle and returning users before deployment. The prepared signed two-stage delivery is an interim candidate/regression baseline, not completion of the N-stage mesh. Do not require document experiments or speculative replay to release otherwise qualified ordinary execution. Simulated phone/user checks remain labeled until physical observation is available.

**Current source and frozen-delivery boundary (2026-10-13):** the corrected two-stage graph passes all 55 prefixes in both physical browser/native placements ([982b7aee](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/signed-closure-qualification-20261013/README.md)). The rebuilt Capsule binds 57 verified artifacts and the [frozen browser/native delivery](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/basic-signed-candidate-20261013/final/README.md), `48b8d291`, verifies 2,020 browser files, 133 native files and 1,976 runtime files on unchanged archive `0fadac51…`. Its actual signed chat remains unrun. In parallel, ordinary N-stage plans/residents, full-route identity/selection and runner traversal are now source-tested (DR-6 below); real signatures additionally bind explicit coordinator-mediated disclosure in `567ec157`. The new runtime source is not that frozen archive and does not inherit its numerical or physical qualification. Public deployment remains unchanged. No active document campaign or new numerical-reference investigation is authorized by these checkpoints.

**Comparative hypothesis:** demonstrate a consequential advantage on a declared workload, such as persistent access to a useful large model through pooled already-owned resources. Prespecify the advantage margin and explicit regression limits for the workload's quality, latency, availability, resource cost, lifecycle, authorization and user experience. Compare relevant alternatives, including Pooled where applicable; matching every competitor feature is not the roadmap. Measure affordability rather than assuming it. Retain unfavorable results and incompatible cells, and scope any claim to the tested configuration. The axes below guide applicable evaluation; they are not a universal feature or superiority checklist.

| Possible evaluation axis | Existing acceptance owner | Evidence when applicable to the declared workload |
|---|---|---|
| Setup | [REP-7 / CHAT-01](requirements.md#rep-7) | Unfamiliar users on real desktops/phones: steps and elapsed time from opening to a useful answer, cold preparation, unavailable-capacity guidance and recovery without coaching. |
| Inference | [DOP-6](requirements.md#dop-6), [DR-6](requirements.md#dr-6), [ALL-7](requirements.md#all-7) | Supported model/platform matrix; quality, cold/warm latency, first token, tails, throughput, memory, context, offload and contributor cost under matched budgets. |
| Workflows | [REP-7 / DEV-02 and JOB-06](requirements.md#rep-7) | Actual model-backed coding-agent/API sessions, tools, structured output, continuation, file review/apply, previews, console feedback, mobile controls and exports. |
| Distribution | [DR-6 / MESH-01](requirements.md#dr-6) | Automatic joining/placement, useful larger-model capacity, independent simultaneous users, fair bounded service, replicas and isolated contributor/requester failures on physical machines. |
| Reliability | [REP-4](requirements.md#rep-4), [REP-6](requirements.md#rep-6), [DR-5](requirements.md#dr-5) | Cancellation, restart/recovery, durable history, warm follow-ups and admitted state reuse, with measured lost work and confirmed/unknown resource settlement. |
| Trust | [REP-5](requirements.md#rep-5), [DR-3](requirements.md#dr-3), [ALL-4](requirements.md#all-4) | Authenticated model pieces and execution identities, separate permissions, understandable actual data recipients, revocation and adversarial failure controls; no claim of secret or honest remote GPU computation. |
| Experience | [REP-7 / CHAT-01](requirements.md#rep-7) | Simpler usable controls, legible status, physical-phone keyboards, working documentation/examples and a reproducible end-to-end demo tied to the tested release. |

Initial comparison inventory reference: [Pooled `1a31021c63a5c0539101668d7dd5dbc85d0fa226`](https://github.com/Nehanth/pooled/tree/1a31021c63a5c0539101668d7dd5dbc85d0fa226), observed remote HEAD on 2026-10-13. This pins a source reference, not installed behavior or a comparative benchmark. Freeze obtainable artifacts/configurations for actual tests under DR-6; retain later baseline changes explicitly. Reploid's three text adapters already have official-SDK checks with injected computation, as recorded under DEV-02. They do not yet establish physical distributed API, tools or structured-output parity. The distinct learning requirement is [ALL-9](requirements.md#all-9), not an implied achievement of ALL-8.

**Secondary attachments:** experiments are paused. Their rejected results remain under [DR-5](requirements.md#dr-5); they are not on the basic-chat release path.

**Sole delivery owner — this thread (`/root`), user-directed 2026-10-12.** This thread now owns the entire ordinary distributed conversation release and RD-CANON/1 integration through qualification. The former independent topology stream is absorbed into this queue; there is no second coordinator or competing roadmap. Repository/component authority remains unchanged. Subagents execute bounded assignments, report exact evidence and changed files, and do not independently select package promotion, deployment, priorities or GPU windows. Root integrates their work and updates this TODO. A declaration here does not stop an unrelated process: verify actual controllers before touching shared files or hardware.

**Focus: repair → complete installed distributed conversations → qualify the selected flagship → demonstrate sustained availability and economics.** Flash-Next source analysis, reference preparation and operator fixtures can proceed in parallel during repair. Its installed distributed qualification depends on the repaired engine; existing operator support alone establishes no model compatibility. There is no mandatory older-model port or release dependency.

| Milestone / IDs | Applicable evidence and dependency | Accountable owner / next action |
| --- | --- | --- |
| 0. Numerical repair / [DOP-6](requirements.md#dop-6), [DR-6](requirements.md#dr-6) | `9264d265…` verifies 1,984 files but fails long prefill after four passing prefixes; preparation and cleanup pass separately. Original 55 prefixes and 0.001 remain unchanged. | `/root`, Doppler: isolate and repair the first failing boundary before exact-reference qualification. |
| 1. Signed installed conversations / [REP-7](requirements.md#rep-7), [DR-3](requirements.md#dr-3), [DR-6](requirements.md#dr-6) | Browser/native ordered source composition and historical signed deliveries are retained; changed bytes need installed authenticated N-stage streaming and follow-ups with zero requester weights. | `/root`, Reploid: bind the qualified runtime and signed selective acquisition into installed conversation. |
| 2. Durable publication / [DR-5](requirements.md#dr-5) | Browser/IndexedDB `f9d90a08` and native `054ff994` source controls pass; physical writes, cancellation, UI delivery and restored history remain open. | `/root`, Reploid: verify one transactional requester writer with real signed execution. |
| 3. Demanding concurrency / [REP-4](requirements.md#rep-4), [DR-5](requirements.md#dr-5) | Resolve the retained 1,588-token deadline; qualify two useful long conversations, cancellation, survival, replacement and retry within 1,420,000,000 bytes/executor. | `/root`, Doppler/Reploid: run bounded physical lifecycle after ordinary numerical and chat gates. |
| 4. Exact-package release / [DR-1](requirements.md#dr-1), [ALL-3](requirements.md#all-3), [ALL-6](requirements.md#all-6) | Freeze matching browser/native/runtime/model bytes; applicable numerical, lifecycle and fresh/returning-user acceptance must pass. Public 0.6.27 remains accepted. | `/root`: release only the explicitly qualified configuration. |
| 5. Selected flagship / [DOP-6](requirements.md#dop-6), [DR-6](requirements.md#dr-6), [ALL-7](requirements.md#all-7) | Qwen3.8-Flash-Next source/reference/operator preparation may proceed during repair; installed distributed qualification requires the repaired engine and model-specific proof. | `/root`, Doppler: pin source/license and establish reference and operator fixtures. |
| 6. Sustained availability and economics / [REP-4](requirements.md#rep-4), [DR-6](requirements.md#dr-6) | Configured 2–7-stage source composition is checked; autonomous preparation, fairness, device accounting and 12/20/100 capacity targets remain unqualified. Measure repeat access and complete service cost; commercial commitments are deferred. | `/root`, Reploid: define a sustained selected-model workload and its availability/economic comparison against relevant alternatives. |
| 7. Local reuse; forks/replay / [DR-5](requirements.md#dr-5) | Supporting contracts/primitives exist; real composite state, isolation and measured benefit remain open. These do not gate ordinary multistage service or flagship preparation. | `/root`, Doppler/Reploid: qualify local inference-state reuse before a separately gated fork/replay campaign. |
| 8. Developer/cooperating-intelligence capabilities / [REP-7](requirements.md#rep-7), [ALL-8](requirements.md#all-8), [ALL-9](requirements.md#all-9) | Existing adapters and learning foundations are retained; model-backed compatibility and evaluated improvement remain open, with consent, promotion and rollback requirements intact. | `/root`: complete DEV-02 after dependable consumer access; coding and evaluated learning follow under their existing IDs. |

Independent CPU/source preparation may proceed in parallel; acceptance follows these dependencies. Ordinary multistage inference is a capacity extension; local fork/replay is a separate efficiency extension. They share execution, authorization, route reservation and settlement prerequisites, but neither successful speculation nor its performance gate is a prerequisite for DR-6 mesh capacity. Conversely, larger routes do not qualify fork/replay. Keep the existing conversation components, public contracts and prepared-capacity behavior. No new navigation, scheduler, publication framework or transport platform. Preserve the approved F64 target, `0.001`, approved paired precision, weights, F16 caches and `1,420,000,000` allocated bytes per executor. Broader shared physical-device accounting is a separate required topology admission boundary, not established by this per-executor number.

**Current evidence and machine ownership:** candidate `0fadac51…` passes all 55 prefixes in both native/browser placements with maximum error `9.520044947919359e-7`, settled cleanup and allocations below the ceiling. [Physical result](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/resident-readiness-qualification-20261012/results/summary.json) and [genuine resident reports](https://github.com/clocksmith/doppler/tree/2128b6de/artifacts/resident-pipeline-preparation-20261012/native-qualification) bind its exact bytes. Required compilation finished before resident readiness; cold preparation still took 815.081 seconds. This proves the resident boundary, not ordinary application readiness or signed acceptance. The [previous AMD/Mac reservation](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/resident-readiness-qualification-20261012/reservation.json) is released; it is not a standing claim on either GPU. Root assigns the next window only after live process/controller checks. Use x@128 for heavy work, Suby only for configurations it actually supports, and Mac through its coordinated controller. Do not overlap qualification with topology GPU work. Each owned server, tunnel and browser needs a recorded purpose and stop/settlement disposition; preserve public contributors and unknown ownership. At user request, [obsolete local test processes](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/development-process-cleanup-20261013/receipt.json) were stopped: old delivery servers, tunnels, empty requester browser and file-only test contributor. Target ports were cleared; public contributors, profiles, caches and persistent sharing allowances were preserved.

Retained evidence: [historical checkpoint 03](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-03). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 04](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-04). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 05](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-05). Original outcomes, failures and artifact identities are preserved.

**Current integration boundary (2026-10-13):** the explicit canonical resident/peer/runner branch uses genuine signed stage evidence and awaits transactional publication before output. `085c987c` and `0008803d` add requester-owned transactional history and an optional async host session; [host evidence](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/canonical-host-history-20261013/README.md) covers real signatures, failed/unknown writes, writer fencing, draft persistence and IndexedDB reopening. Numerical steps are injected. The [automatic application composition](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/canonical-application-composition-20261013/README.md), `f9d90a08`, now connects actual composer admission, automatic placement, authenticated entry publication, IndexedDB and committed UI output. Six GPU-disabled browser checks pass; model arithmetic is injected. The default remains legacy. The [native canonical host](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/native-canonical-composition-20261013/README.md), `054ff994`, now adds explicit opt-in, durable process epochs, settlement markers and retryable cleanup; its full source suite passes 3,368 tests. Next qualify the required runtime exports outside the checkout, then physical canonical execution. Input contributor A still does not own requester history. Do not create a second history writer on A or independently save canonical deltas to localStorage. Preserve legacy history and unsupported-profile rejection.

**Current three-host numerical result (2026-10-13):** archive `9264d265…` includes the bounded attention and RMSNorm compilation repairs and verifies 1,984 installed files. All three stages prepare and close, but the [frozen Mac → AMD → Suby run](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/cold-compile-native-20261013/three-stage/disposition.json) fails the 184-token request at its first prefix: maximum logit error `14.471379474862829`, premature EOS, against unchanged `0.001`. Four preceding short-request prefixes pass below `8.91e-7`; this is not all-55 acceptance. All three resident and executor closures pass, both native providers exit zero after observed owned-provider release, and peak allocated GPU bytes are 708,011,168 / 199,119,984 / 341,007,632. Host cgroup peaks are 2,265,935,872 on AMD and 6,950,461,440 on Suby with no memory-limit/OOM events. Caches were retained. Owned support is stopped; public contributors remain present. Next: locate the first divergent long-prefill boundary using the unchanged independent F64 evaluator before another full campaign. Signed opening, application chat, concurrency and promotion remain open; public 0.6.27 stays unchanged.

**Next physical assignment:** root owns the bounded output-stage investigation for the changed three-host archive. [F64 boundary attribution](https://github.com/clocksmith/doppler/tree/5b009277/artifacts/ordered-partitions-20261013/long-prefill-boundary) verifies the retained Mac and AMD stage outputs and narrows the failure to Suby execution or final readback. Identify the first divergent operation before another full qualification campaign. Record preparation, numerics and cleanup independently. The earlier 1,588-token deadline remains a failed lifecycle control; signed chat follows applicable numerical acceptance. Check live controllers before each reservation, preserve public contributors, and retain interference and unknown settlement.

**RD-CANON/1 source implementation (user-authorized concurrent topology work):** the [canonical topology contract](rd-canon-1.md#canonical-topology-contract-rd-canon1) below consolidates the former topology drafts and their inherited fixtures under RD-CANON/1. Doppler source through `a8ec8778` adds bounded canonical identities/cursors, Philox CPU sampling, accepted decoder state, ordinary canonical controller transitions, numerical-state copy primitives and exact route-cardinality publication validation. CPU and simulated GPU checks are component evidence only. Reploid `39e8e8d4` fixes failed-write output leakage. The new conversation publication reducer and existing browser storage owner's strict IndexedDB transactions have source-integration and real-browser storage tests for cancellation, duplicates, takeover and unknown commits. Those initial storage fixtures mocked stage authentication. Later checkpoints `df7b1068`, `8753775e` and `7d340a95` use real WebCrypto stage signatures and source canonical transitions for peer, durable evidence/restart and runner integration; four actual IndexedDB browser checks pass. Computation remains injected in these source controls; later `f9d90a08` closes browser requester/UI source composition, not physical acceptance. The accepted application archive remains `9280ead5…`; no topology runtime is promoted or enabled. Native source composition follows in `054ff994`; it does not qualify installed numerical execution. Remaining: qualify installed/physical requester publication; admit and execute one local composite fork; implement fixed two-stage retained-row replay and complete phase/resource/grant settlement; then exact-package physical and frozen performance qualification. Standalone reducers, copy primitives and storage tests do not close those integration gates. Keep all-55 numerical and application-quality evidence under their existing owners.

Retained evidence: [historical checkpoint 06](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-06). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 07](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-07). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 08](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-08). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 09](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-09). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 10](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-10). Original outcomes, failures and artifact identities are preserved.

**Sequencing:** durable indexing (REP-2/3), scoring expansion (DR-2), W8A8 measurements/candidates (DOP-4/7), optional Doe/compiler/provider experiments (DOE/DD/ER), and learned placement (ALL-8) do not gate ordinary chat. Qwen3.8-Flash-Next source analysis, reference preparation and operator fixtures may proceed during the current repair. Installed distributed qualification depends on the repaired engine and model-specific compatibility evidence; no older-model port/release, composite fork or speculation is a prerequisite. Existing embeddings/scoring stay intact. Broader model/architecture work must use the same owned interfaces and explicit acceptance.

**Evidence history:** the initial audit at Reploid `dd4e1275`, Doppler `b7b94713` and Doe `50f118901` covered source and retained receipts, with offline projection and archive checks. Later physical/source results are linked under DOP-6 and DR-4/5. Completed experiments remain recorded even when they rejected the capability.

Retained evidence: [historical checkpoint 11](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-11). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 12](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-12). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 13](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-13). Original outcomes, failures and artifact identities are preserved.


## DOP-6 retained chronology

Retained evidence: [historical checkpoint 14](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-14). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 15](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-15). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 16](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-16). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 17](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-17). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 18](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-18). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 19](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-19). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 20](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-20). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 21](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-21). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 22](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-22). Original outcomes, failures and artifact identities are preserved.

## REP-4 retained chronology

Retained evidence: [historical checkpoint 23](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-23). Original outcomes, failures and artifact identities are preserved.

## REP-5 retained chronology

Retained evidence: [historical checkpoint 24](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-24). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 25](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-25). Original outcomes, failures and artifact identities are preserved.

## REP-7 retained chronology

Retained evidence: [historical checkpoint 26](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-26). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 27](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-27). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 28](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-28). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 29](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-29). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 30](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-30). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 31](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-31). Original outcomes, failures and artifact identities are preserved.

## DR-3 retained chronology

Retained evidence: [historical checkpoint 32](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-32). Original outcomes, failures and artifact identities are preserved.

## DR-4 retained chronology

Retained evidence: [historical checkpoint 33](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-33). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 34](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-34). Original outcomes, failures and artifact identities are preserved.

## DR-5 retained chronology

Retained evidence: [historical checkpoint 35](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-35). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 36](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-36). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 37](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-37). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 38](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-38). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 39](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-39). Original outcomes, failures and artifact identities are preserved.

## DR-6 retained chronology

Retained evidence: [historical checkpoint 40](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-40). Original outcomes, failures and artifact identities are preserved.

Retained evidence: [historical checkpoint 41](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/artifacts/checklist-history-20261013/README.md#history-41). Original outcomes, failures and artifact identities are preserved.

## Original component ownership summaries

## 1. Doppler only: computation, numerical correctness, and packaging

Doppler owns preparation, executable packages, tensor contracts, sampling, and generation state. It remains usable without Doe or Reploid. Active work here is DOP-6 and package correctness needed by DR-5; projection research remains deferred.


## 2. Doe only: compiler completeness and attributable Vulkan improvements

Doe owns general WGSL compilation, native execution, resources, synchronization and diagnostics. Gemma quantization policy stays in Doppler. **DOE-2–6, DD-1–6 and ER-1–5 form an optional execution-improvement track, excluded from the first Reploid community release.** Preserve dependencies and rejected results. Resume only for a measured application bottleneck, and qualify unchanged correctness, lifecycle and complete service cost before accepting gains.


## 3. Reploid only: application integration and dependable participation

Reploid owns conversations, authorized participation, placement, connectivity, and evaluated coordination. It does not implement model mathematics or compiler policy.


## 4. Doppler + Doe: projection handoff, compiler/runtime matrix, and performance

Doppler supplies reproducible computations; Doe provides optional execution. Attribute compiler, runtime and lowering effects separately. **This section is deferred; it does not gate the Reploid conversation.**


## 5. Doppler + Reploid: exact-package integration and distributed acceptance

This boundary owns public operation identities, signed requests, permissions, execution events and recovery, without duplicating either library's internals.


## 6. Doe + Reploid: optional native participation through Doppler

No direct Reploid–Doe dependency or new scheduling protocol. **This section is deferred.** A qualified native provider can be evaluated later; it does not delay the existing Doppler-provider journey.


## 7. All three: canonical tracking, shared machines, releases, and evidence



## Completion candidate update (2026-10-13)

Doppler `a5f3ca4c` produces archive `2df37d88…`, superseding `9264d265…` for current numerical investigation without inheriting historical acceptance. The installed original failing prefix passes at unchanged `0.001`; [exact evidence](https://github.com/clocksmith/doppler/tree/f540465c/artifacts/kernel-completion-repair-20261013). The [fresh three-host campaign](../../artifacts/completion-candidate-20261013/README.md) freezes all 55 prefixes, provider identities, deadlines and allocation limits before execution. Its capture, final report validation and cleanup determine acceptance. The projection diagnostic remains separately failed at `2e-12`; CPU reduction reproduces its outlier. Public 0.6.27 remains unchanged. Earlier “current” descriptions and `/root` ownership labels above identify their historical checkpoints; current delivery ownership and next action are on ROADMAP.md.

The completed `2df37d88…` [capture](../../artifacts/completion-candidate-20261013/summary.json) passes all 55 numerical prefixes and confirms cleanup below the unchanged allocation ceiling. Its unchanged report producer rejected the frozen contract's graph hash domain; the [rejection and repaired freezer](../../artifacts/completion-candidate-20261013/README.md#captured-outcome-and-qualification-boundary) retain the original expectations. Signed eligibility remains open pending correctly bound qualification.

A [correctly bound rerun](../../artifacts/completion-qualification-20261013/README.md) froze expectations that differ from the original only in the execution-graph digest. It compared 39 of 55 prefixes, all within the unchanged `0.001`, before both native supervisors reached their unchanged deadline and terminated their providers. It produced no reports. The Mac resident closed normally; AMD and Intel GPU settlement for this attempt is unknown. The slowdown's cause is not established. Machine addresses were replaced by aliases across tracked files the same day; see the [redaction record](../../artifacts/address-redaction-20261013/README.md).
