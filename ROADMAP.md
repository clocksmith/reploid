# Reploid roadmap

**The prize: useful large open models through shared prepared capacity, without assembling clusters or downloading full models.** Start with one model community. Consumer chat leads; developer APIs use the same capacity. People may request and contribute simultaneously. Contribution is optional.

Qwen3.8-Flash-Next is the flagship engineering target, not Reploid's identity. Reusable model support leads toward persistent permissioned work and independently evaluated improvement. Those later capabilities are not additional launch prerequisites.

## Current milestone

| Field | Current recorded evidence and action |
| --- | --- |
| Milestone | Launch 1: Qwen 3.5 0.8B Q4K (`qwen-3-5-0-8b-q4k-ehaf16`) through configured prepared capacity, selected automatically for the requester; complete conversations and bounded independent requests. |
| Blocker | Numerical qualification of candidate `2df37d88…` is closed: the [second rerun](artifacts/completion-qualification-2-20261013/README.md) passes all 55 prefixes within `0.001`, with cleanup and reports accepted. Signed delivery [`final-5`](artifacts/signed-completion-candidate-20261013/README.md) (Reploid `95641fe7`, test signing authority) is installed on both native hosts. On that candidate the [installed three-stage journey](artifacts/signed-completion-journey-20261013/README.md) passes every automated check: requester journey 13/13 (run 5), contributor loss 7/7 (run 6) and Launch 2 contribution 7/7 (run 5). Still open: independent review of answer usefulness (two answers state wrong example outputs), production signing and public promotion (only the test authority signed), and contexts longer than short follow-ups, which are unqualified at about 3.5 s per token on this Intel-bound route. Historical archive `9264d265…` remains failed. |
| Accountable owner | Reploid release integration owns Launch 1 delivery; Doppler owns runtime repair and numerical qualification. GPU ownership comes from fresh recorded process checks and the scoped campaign reservation. |
| Next action | Review the run-5 and run-6 answers for usefulness. Sign the release with the production authority, then qualify preview → limited opt-in → public promotion. Publish the [measured limits](artifacts/signed-completion-journey-20261013/README.md#results-launch-1-journey-and-launch-2-contribution-pass-automated-acceptance-runs-5-and-6) with the release. Qualifying longer contexts waits for stage-2 decode throughput; Flash-Next reference and operator preparation continue independently. |
| Completion condition | Unchanged approved independent reference, all 55 required prefixes and `0.001` tolerance (met); installed signed conversation and lifecycle acceptance (automated checks met on `final-5`); independent answer review; production-signed promotion. Preserve approved precision, weights, F16 caches and the `1,420,000,000` allocated-byte per-executor ceiling. |
| Historical migration snapshot | Reploid [`229a6e601adbd970de38c3315d069de4ba707cce`](https://github.com/clocksmith/reploid/tree/229a6e601adbd970de38c3315d069de4ba707cce), migration base as read 2026-10-13; newer [storage evidence](artifacts/storage-contribution-20261013/README.md) through `92642382` is preserved. This migration adds no hardware evidence. |
| Accepted package | Doppler `0.6.27`; [unchanged pin](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/self/config/doppler-package.json). The accepted public runtime remains available while the replacement qualifies. |
| Historical qualified boundary | Archives `102fd0c4…` and `0fadac51…` retain their declared two-stage numerical acceptance. Frozen signed delivery `48b8d291` uses `0fadac51…`; its recorded actual signed chat remains unrun. Changed bytes do not inherit acceptance. |

Status comes from the snapshot and linked receipts. Historical reviews are not evidence of a later run. Package archive prefixes above are not Git commits. See [DR-6](docs/roadmap/requirements.md#dr-6) for current candidate qualification and source integration, [DR-4](docs/roadmap/requirements.md#dr-4) for historical numerical qualification, and [DR-1](docs/roadmap/requirements.md#dr-1) for package boundaries.

## Cumulative launches

Each launch delivers a complete usable capability. Keep the accepted site live while candidates qualify separately; development can overlap without one shared deployment date.

| Launch | Usable capability and acceptance |
| --- | --- |
| **1. Dependable distributed chat** | Qwen 3.5 0.8B Q4K on configured prepared capacity; automatic eligible-route selection without requester stage assignment. Signed selective acquisition, answers/follow-ups, durable history/reload, permissions, bounded independent conversations, isolated cancellation, contributor-loss reporting, explicit retry and settlement. Publish proven device/context/concurrency limits. Flash-Next is not a dependency. |
| **2. Useful optional contribution** | Cached-only, bounded acquisition and explicit seeding through the public app; persistent allowances across tabs/reloads, resumed transfers and conversations preserved when contribution stops. May precede Flash-Next on a compatible accepted release. |
| **3. Concurrent prepared service** | Add autonomous cold stage assignment, demand-driven preparation, useful replicas, cross-route fairness and greater measured concurrency. Preserve Launch 1 cancellation, departure and retry behavior; expose bounded queues and unavailable capacity. |
| **4. Flash-Next access** | Exact conversion/runtime, reference accuracy, useful answers, distributed execution and the same conversation/lifecycle gates. Keep the existing model available; expand proven hardware/context limits separately. |
| **5. Larger and more efficient service** | Qualify each additional model, device combination and capacity increase. Speculation, transferable state and finer expert placement require preserved correctness and measured benefit; none gates earlier launches. |

**Launch boundary:** operators may configure supported prepared stage capacity for Launch 1; requesters choose a model and approve actual recipients, never assign stages. The fixed numerical harness does not prove this application behavior. Launch 2 owns optional storage contribution; testing it alongside chat establishes compatibility without making that feature a Launch 1 dependency. Autonomous cold preparation remains a Launch 3 gate.

**Separate diagnostic:** the [projection outlier](https://github.com/clocksmith/doppler/blob/175ec7a4/artifacts/kernel-completion-repair-20261013/projection-outlier-simulation.json) remains above its original synthetic `2e-12` threshold (`2.27e-12` against exact operands). CPU reduction reproduces the GPU pair; no threshold is weakened. This diagnostic and the full-model `0.001` gate retain distinct outcomes.

**Every launch:** freeze website, browser/native runtime, model artifact and supported configuration together. Qualify preview → limited opt-in → public promotion. Retain a known-good rollback package and compatible history migrations. Unsupported combinations remain unavailable with a clear explanation. UI-only improvements may deploy independently after testing against the accepted runtime.

**Release unit:** a working user capability plus its supported model configuration. Source completion alone never enables it publicly. Existing IDs and their scoped evidence remain the acceptance authority below.

## Execution order and ownership

Finish correct installed execution and complete conversations together, exercising acquisition, permissions, cancellation and recovery through that same application. Prepare Flash-Next's reference and missing operators during repair. Extend placement and progressive contribution through existing owners. Begin measurement collection now; comparative economic conclusions require dependable execution.

Doppler owns computation, sampling and inference state. Reploid owns discovery, placement, permissions, reservations, contribution and conversations. Doe remains an optional execution provider; unrelated compiler campaigns cannot gate release.

The ten outcomes below describe one product, not ten sequential projects or ten new tracking systems. Each existing stable ID has one canonical entry in the linked [task register](docs/roadmap/requirements.md), including nested requirements, original checkboxes and source/installed/physical evidence. The front page selects work; it does not duplicate acceptance checkboxes.

## 1. Correct execution

Repair numerical failures and qualify installed execution across supported physical devices against unchanged approved references and tolerances. Keep operator correctness, complete-model accuracy, answer usefulness and distribution parity separate. Completed rejected experiments remain completed; rejected configurations remain rejected.

Canonical IDs: [DOP-1](docs/roadmap/requirements.md#dop-1), [DOP-2](docs/roadmap/requirements.md#dop-2), [DOP-3](docs/roadmap/requirements.md#dop-3), [DOP-5](docs/roadmap/requirements.md#dop-5), [DOP-6](docs/roadmap/requirements.md#dop-6), [DOP-8](docs/roadmap/requirements.md#dop-8), [DR-4](docs/roadmap/requirements.md#dr-4), [ALL-4](docs/roadmap/requirements.md#all-4). Changed-package repair is recorded once under [DR-6](docs/roadmap/requirements.md#dr-6).

## 2. Complete conversations

Deliver useful streamed answers, history-aware follow-ups, durable saved history and restoration after reload through the actual application. Qualify the requester-owned transactional writer using real installed signed execution. Consumer chat remains the release experience; document workflows and expanded scoring are retained later work.

Canonical IDs: [REP-7](docs/roadmap/requirements.md#rep-7), [DR-5](docs/roadmap/requirements.md#dr-5), [DR-2](docs/roadmap/requirements.md#dr-2), [REP-2](docs/roadmap/requirements.md#rep-2), [REP-3](docs/roadmap/requirements.md#rep-3). CHAT-01, DEV-02 and JOB-06 stay within REP-7; ordinary release and later capabilities retain separate acceptance.

## 3. Independent concurrency

Share immutable resident weights while isolating each conversation's inference state, temporary buffers, grants and history. Enforce per-executor and shared-device budgets, admit fairly and bound queues. Cancel one request without corrupting its neighbor; retain unknown cleanup ownership until explicitly settled.

Canonical ID: [REP-4](docs/roadmap/requirements.md#rep-4). Its exact-package long-conversation dependency remains in DR-5; cross-route fairness and physical-device coverage remain in DR-6. Logical participants and injected computation do not establish physical concurrency.

## 4. Flagship support

Prepare Flash-Next's checkpoint, tokenizer, license, independent reference, conversion checks and operator fixtures during repair. Then qualify its architecture and distributed execution. Model support remains reusable. Older-model ports are optional diagnostics; speculation and trillion-scale targets do not become prerequisites for this flagship.

Canonical ID: [ALL-7](docs/roadmap/requirements.md#all-7). Checkpoint-specific sparse attention, gated residuals, n-grams, experts, memory tiers and platform acceptance stay in DR-6's selected-model entry. No model compatibility is inferred from similar operator names.

## 5. Efficient acquisition

Discover verified pieces, acquire only missing authorized dependencies, resume transfers and retain data across sessions. Measure cold network acquisition separately from local loading, required compilation, prefill and decode. Prefer assignments whose preparation can produce useful service within the contributor's availability and allowances.

Canonical ID: [REP-5](docs/roadmap/requirements.md#rep-5). The progressive storage modes below extend this existing custody/accounting acceptance. Existing storage, acquisition and introduction evidence retains its original scope.

## 6. Automatic prepared placement

Assign complete compatible routes using measured links, memory, residency, demand and permissions. Keep complete experts within resident layer groups across slower links; finer expert placement remains experimental. Replicate only when it completes a missing route, removes a bottleneck, protects independent replacement capacity or serves another useful request.

Canonical ID: [DR-6](docs/roadmap/requirements.md#dr-6), including MESH-01 and the retained 12/20/100 targets. Configured 2–7-stage source composition is complete in its declared scope; autonomous cold assignment, wider physical capacity and fair shared-device admission remain unqualified. Preparation stays separate from requesting.

## 7. Progressive contribution

A participant may offer bounded introductions, bandwidth, small verified caches, compatible short jobs or prepared stages while also requesting service. Use existing owners. No minimum model download or mandatory compute contribution applies. Do not acquire or execute merely to display activity when no useful assignment fits.

Canonical foundation: [REP-1](docs/roadmap/requirements.md#rep-1). Integration acceptance belongs to REP-4, REP-5 and DR-6; their historical completed foundations and newer [storage controls](artifacts/storage-contribution-20261013/README.md) retain their separate acceptance scopes.

Storage modes and exact acceptance: [REP-5 progressive storage acceptance](docs/roadmap/requirements.md#rep-5-progressive-storage-acceptance). Cached-only never fetches missing metadata or pieces; bounded acquisition persists and charges allowances across reloads, competing tabs, metadata and retries; full-model seeding requires explicit authorization. Inventory is rebuilt from verified metadata and cached bytes. Source/browser controls and one real bounded model-piece download pass; integrated installed chat and live-mesh acceptance remain open.
Allowances must distinguish download, upload, retained storage, host/GPU memory, execution and expiry where applicable. Stopping contribution must not directly cancel personal conversations. Preserved history is not resumable inference state: loss of indispensable capacity may require waiting or a fresh approved retry.

## 8. Permission and recovery

Bind actual recipients and complete input scope, enforce revocation and handle contributor departures through existing grants and attempt owners. Settle resources or keep unknown ownership charged. Replacements require explicit fresh attempts when valid continuation is unavailable. Discovery loss alone must not terminate healthy owned execution.

Canonical IDs: [REP-6](docs/roadmap/requirements.md#rep-6), [DR-3](docs/roadmap/requirements.md#dr-3). Retained weights, saved text, local state reuse and transferable inference state are distinct capabilities. Signatures establish record identity, not honest or secret remote computation.

## 9. Physical release

Qualify matching browser/native/runtime/model artifacts through the actual application on supported physical devices. Require useful complete answers, follow-ups, isolated concurrency, permission enforcement, settled cancellation and returning histories. Accept limited models/devices, bounded concurrency, visible queues and explicit retries; disclose limitations and unfamiliar-user evidence gaps.

Canonical IDs: [DR-1](docs/roadmap/requirements.md#dr-1), [ALL-1](docs/roadmap/requirements.md#all-1), [ALL-2](docs/roadmap/requirements.md#all-2), [ALL-3](docs/roadmap/requirements.md#all-3), [ALL-5](docs/roadmap/requirements.md#all-5), [ALL-6](docs/roadmap/requirements.md#all-6). Existing history, controls and immutable receipts stay attached to their exact configurations.

## 10. Demonstrated advantage

Collect preparation time, retained memory, network transfers, idle power where measurable, failures and human intervention during engineering runs now. Later compare useful availability, throughput and complete cost against feasible rentals/APIs, hybrid-memory execution and conventional coordination on identical machines. Include Flash-Next's conventional host-memory offload baseline.

Count donated resources, compensation, replication, recovery and rejected demand; report unknown costs. Freeze workload, useful-answer criteria, concurrency, latency requirements, advantage margin and regression limits before comparison. Affordable persistent access remains a hypothesis. A workload win does not imply universal superiority.

Comparison acceptance stays in DR-6. The following canonical IDs remain explicitly optional or later, without becoming community-release dependencies:

- Quantization: [DOP-4](docs/roadmap/requirements.md#dop-4), [DOP-7](docs/roadmap/requirements.md#dop-7).
- Optional compiler/provider work: [DOE-1](docs/roadmap/requirements.md#doe-1), [DOE-2](docs/roadmap/requirements.md#doe-2), [DOE-3](docs/roadmap/requirements.md#doe-3), [DOE-4](docs/roadmap/requirements.md#doe-4), [DOE-5](docs/roadmap/requirements.md#doe-5), [DOE-6](docs/roadmap/requirements.md#doe-6).
- Optional integration comparisons: [DD-1](docs/roadmap/requirements.md#dd-1), [DD-2](docs/roadmap/requirements.md#dd-2), [DD-3](docs/roadmap/requirements.md#dd-3), [DD-4](docs/roadmap/requirements.md#dd-4), [DD-5](docs/roadmap/requirements.md#dd-5), [DD-6](docs/roadmap/requirements.md#dd-6).
- Optional native provider: [ER-1](docs/roadmap/requirements.md#er-1), [ER-2](docs/roadmap/requirements.md#er-2), [ER-3](docs/roadmap/requirements.md#er-3), [ER-4](docs/roadmap/requirements.md#er-4), [ER-5](docs/roadmap/requirements.md#er-5).
- Later independently evaluated improvement: [ALL-8](docs/roadmap/requirements.md#all-8), [ALL-9](docs/roadmap/requirements.md#all-9). Persistent permissioned work and evaluated improvement remain the progression, not launch gates.

## Experimental boundaries and maintenance

Speculation, transferable inference state, finer expert placement, learned scheduling and power-price routing require separately demonstrated complete benefit. Ordinary multistage service does not wait for them. Existing fork/replay and target-sampling requirements remain in [RD-CANON/1](docs/roadmap/rd-canon-1.md); this migration does not weaken its performance, correctness or authorization gates.

Keep one canonical task entry per stable ID in the register, with its owner, applicable source/installed/physical status, next action, dependencies and acceptance. Update only supported evidence. Keep chronology in [history](docs/roadmap/history.md), immutable receipts with their owners, and design contracts separate from status.

*Last updated: October 2026*
