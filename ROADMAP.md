# Reploid roadmap

## Product specification

**Reploid Product Economics Contract v1.0.** Adopted product requirements, merged
into the seven-section definition below. MUST denotes a requirement, not a claim
of implementation. Installed behavior and physical qualification remain separately
recorded. Unresolved policies and their interim behavior are explicit.

**Earn on your computer. Use AI anywhere.**

### 1. Product

Reploid lets people contribute useful computer resources, accumulate nonexpiring
credits, and redeem AI services from any device. Requesting and contributing are
independent activities available to the same person. Users may contribute storage,
computation or both, purchase top-ups, or use Community Access. No subscription is
required. The network is the product; requesters should eventually access models
larger than their devices can store or execute.

Reploid owns discovery, acquisition, placement, permissions, reservations,
accounting and conversations. Doppler owns computation, sampling and inference
state. Compute reservations and resource settlement are not financial accounting.

Every inference quote and receipt MUST identify the model, checkpoint, deployed
representation, runtime, operation, context allowance, output limits and
quality-policy version; permitted recipient policy and disclosure scope; queue
class, deadline, execution limits and accounting version. Receipts additionally
record actual execution recipients and the accepted quote/attempt identity.

Acceptance: [REP-7](docs/roadmap/requirements.md#rep-7),
[REP-10](docs/roadmap/requirements.md#rep-10),
[DR-1](docs/roadmap/requirements.md#dr-1), [DR-3](docs/roadmap/requirements.md#dr-3).

### 2. Community Access

Community Access is an ongoing free service funded by donors, participating
operators and reserved community resources, not a signup trial or promotional
credit allocation. It MUST have fair queues, usage limits, abuse controls and
visible availability. Registration MUST NOT automatically issue transferable credits.

An operator-funded guaranteed basic-service minimum remains an open decision.
Until funding and supply are committed, disclose queuing or explicit retry without
a guaranteed completion time. A positive credit balance likewise does not guarantee
immediate capacity. Requesting, earning and purchasing remain independently available.

Acceptance: [REP-9](docs/roadmap/requirements.md#rep-9).

### 3. Credits and marketplace

Earned and purchased credits MUST NOT expire. Track issuance provenance separately
from donated funding. Credit quantity, acquisition price, contribution reward,
inference price and marketplace exchange value are distinct. Neither fixed
purchasing power nor cash redemption is promised.

Before acceptance, an inference quote MUST disclose pricing basis, maximum charge,
validity window, reservation period, expected queue behavior, execution limits and
cancellation/refund terms. Accepted terms bind the attempt. Reserve the authorized
maximum before execution. Every billable event MUST have exactly one economic
effect across delivery retries, reloads and crashes; release unused reservations.
A separately authorized replacement attempt may incur its own charge, but MUST NOT
silently exceed authorized spending or duplicate an earlier event's charge.

Before enabling charges, define full/reduced settlement, cancellation, timeout,
partial delivery, provider failure, failed-quality outcomes, refunds, compensation
and disputes. Quality-refund eligibility MUST have an operational review procedure;
experimental grading is not automatic production adjudication. Prevent fabricated
work, replay, duplicate rewards, collusion, double spending and incorrect settlement.

Design transferable balances from the start. Initial account transfers and
marketplace trading are disabled. Direct transfers may precede a marketplace once
their controls qualify and activation is approved. Marketplace activation requires
credible supply, demand, settlement evidence, fraud controls and applicable legal
review; it is not required for the first product.

Track outstanding balances, expected redemption demand, admitted supply,
reliability reserves, Community Access funding and operator subsidy. Reward
issuance MUST account for future service demand and available capacity. Issuing
credits does not create capacity.

Acceptance: [REP-10](docs/roadmap/requirements.md#rep-10),
[REP-11](docs/roadmap/requirements.md#rep-11), [REP-14](docs/roadmap/requirements.md#rep-14).

### 4. Consumer utility

The complete initial consumer product MUST provide everyday questions,
explanations, summaries and retrieval-backed answers with supporting citations,
plus persistent conversations and follow-ups. Consumer chat leads; developer APIs
later use the same capacity and accounting. Coding and specialized vertical
workflows follow proven general utility. The current dependable-chat technical
foundation may qualify independently before the complete consumer launch.

Questions, summaries and retrieval-backed answers MUST have distinct frozen
quality policies. Assess factual correctness and completeness, summary fidelity
to supplied material, and search claims supported by valid citations. Independent
whole-answer review MUST include false additions and identify its review method.
In economic experiments, only answers that pass the applicable quality policy
and arrive within their declared deadline count as successful. Failed attempts,
retries and duplicate work stay in total costs. Numerical parity alone does not
establish satisfactory answers.

Acceptance: [REP-8](docs/roadmap/requirements.md#rep-8),
[REP-13](docs/roadmap/requirements.md#rep-13), [REP-7](docs/roadmap/requirements.md#rep-7).

### 5. Contribution and execution

Reward demanded, validated computation, useful verified delivery, or explicitly
contracted storage or prepared availability. Each reward category needs its own
qualification. A contribution offer MUST state requested work, reward basis,
validation conditions, resource bounds, duration and failure compensation.
Contracted readiness requires evidence that promised capacity was maintained;
contracted storage requires evidence of agreed custody and service obligations.
Mere online presence earns nothing. Small useful contributions remain welcome;
unnecessary machines should sleep.

Native contribution targets macOS, Windows and Linux; releases MUST list only
qualified combinations. Enforce schedules, memory, bandwidth, supported power and
temperature controls, and foreground responsiveness. Reduce admission when the
owner needs the machine and settle active work safely. Disclose unsupported
controls. Require equipment and network authorization, including workplace use.

Reuse prepared weights, batch compatible requests and minimize unnecessary
transfers. Support both whole-model execution on a participant and qualified
partitioned execution. Whole-model remote inference is a useful service and
control, but does not prove the distributed-model objective. That demonstration
requires complementary model partitions across physical execution participants,
none retaining the complete weight set, and a requester without weights. Verify
per-executor inventories and selective acquisition. Separately authorized storage
suppliers may retain a complete model; preserve full-model seeding under REP-5.

Remote executors are disclosure recipients; P2P does not provide automatic
confidentiality. Recipient authorization MUST be explicit and revocable through
the explained, one-time permission. Renew approval only outside the granted
recipient policy/disclosure scope or when other authorized terms are exceeded,
not whenever an eligible computer changes between requests. Record actual
recipients and never silently switch an active attempt's route. Revocation stops
new disclosures; it cannot erase information already delivered.

Arbitrary-peer eligibility versus approved operators for sensitive work remains
an open policy decision. Until resolved, reject execution without an explicitly
authorized recipient policy; this does not silently select either policy.
Stopping contribution MUST preserve history and MUST NOT directly cancel
unrelated requests. Loss of indispensable capacity may require waiting or explicit
retry. Saved history MUST NOT be represented as recovered inference state.

Acceptance: [REP-11](docs/roadmap/requirements.md#rep-11),
[REP-12](docs/roadmap/requirements.md#rep-12), [REP-4](docs/roadmap/requirements.md#rep-4),
[REP-5](docs/roadmap/requirements.md#rep-5), [DR-3](docs/roadmap/requirements.md#dr-3),
[DR-5](docs/roadmap/requirements.md#dr-5), [DR-6](docs/roadmap/requirements.md#dr-6).

### 6. Required economic advantage

Demonstrate lower complete dollars and/or joules per satisfactory, on-time answer
against feasible alternatives at comparable quality, latency, availability and
permissions. Investigate achievable efficiency before selecting thresholds, then
freeze the confirmatory evaluation and regression limits.

Include acquisition, preparation, idle residency, execution, transfers, validation,
failures, cooling, hardware allocation/depreciation and operating costs. Show
requester charges, contributor costs/rewards and operator accounts separately.
Consolidated costs MUST NOT double-count payments between those parties.

Measure whole-system gross energy and incremental energy against a stated
no-Reploid baseline. Record tariffs, subsidies, delays, quality decisions and
failed work. API prices do not establish provider energy consumption. Subsidies
can improve user prices but do not establish underlying economic efficiency.
Report quality, reliability, latency and successful completion alongside costs.

Acceptance: [REP-14](docs/roadmap/requirements.md#rep-14),
[DR-6](docs/roadmap/requirements.md#dr-6).

### 7. Bootstrap and proof

First investigate representative AMD and Apple Silicon machines. Record exact
hardware, connections and operating costs; this is not a purchasing commitment.
Founder-operated machines at one location count as one failure domain. Expand
participation against measured demand and economics; independently situated
providers and measured failover must precede resilience claims.

**First proof:** contribute overnight under declared limits, receive settled
credits for useful service, then redeem them for satisfactory, on-time inference
from another device the next day. Measure the complete transaction against a
comparable alternative, including energy, costs and failures.

Canonical receipt: "A device contributed under declared limits for one night,
consumed X incremental kWh costing $Y, completed Z accepted work or reserved
readiness, earned C credits, and redeemed them for N satisfactory, on-time answers."
Bind the receipt to measurement, work/availability, ledger, redemption and quality
evidence; quantify each accepted work category in declared units.

After reliability, pursue independent adoption and possible OpenRouter distribution.
Neither marketplace launch nor external platform listing is required for this loop.

Acceptance: [REP-13](docs/roadmap/requirements.md#rep-13),
[REP-14](docs/roadmap/requirements.md#rep-14), [REP-7](docs/roadmap/requirements.md#rep-7).

### Decisions and execution boundary

| Decision | State and owner |
| --- | --- |
| Community Access guarantee | Open, user: whether to commit operator-funded basic capacity. Interim behavior is disclosed queue/retry without a guaranteed completion time. REP-9 owns the gate. |
| Reward eligibility | Adopted: demanded computation, useful verified delivery, explicitly contracted storage and prepared readiness. REP-11 qualifies each category; no reward for unrequested presence. |
| Account transfers | Adopted: design transferability now; transfers and marketplace are off initially. REP-10 qualifies later activation; direct transfers need not wait for marketplace launch. |
| Recipient eligibility | Open, user: arbitrary participating computers versus approved operators for sensitive work. DR-3 rejects execution without an explicitly authorized policy; existing revocable permission is preserved. |
| First distributed proof | Partitioned execution with no execution participant retaining the complete weights and no requester weights. DR-5/DR-6 require exact-run inventory and execution evidence. Separate REP-5 storage seeds may hold the complete model. |

Existing receipts retain their exact model/runtime/package/placement scope. This
specification starts no replacement numerical campaign and declares no new acceptance.

## Delivery priorities

Qwen3.8-Flash-Next is the flagship engineering target, not Reploid's identity. Reusable model support leads toward persistent permissioned work and independently evaluated improvement. Those later capabilities are not additional launch prerequisites.

**Product priority:** useful answers at interactive latency, available repeatedly through automatically selected capacity. More participating computers, larger model names and stronger contracts are not substitutes for that experience. Ordinary performance work proceeds alongside installed correctness and lifecycle acceptance; it does not wait for speculative execution.

**Immediate performance question:** where does existing standalone Doppler speed go in the installed partition path? The [retained 0.8B browser receipt](https://github.com/clocksmith/doppler/blob/229e8b897d74fd09521f244050e36a75f9427b07/benchmarks/vendors/results/compare_20260707T153509.json) records 68.11 decode tokens/s in parity mode and 69.07 in throughput mode; the [installed placement-B journey](artifacts/signed-completion-journey-20261013/README.md) records about 2.5 seconds per token. These differ in hardware, runtime, arithmetic and workload and establish no slowdown ratio or engine ranking. First isolate ordinary execution → resident execution → local partitions → remote partitions on matched inputs and hardware. Recover lost batching, dispatch efficiency or placement where demonstrated before treating new acceleration features as the remedy. Preserve every numerical and lifecycle gate.

## Current milestone

Finish the faster correct installed-chat candidate below. In parallel, define and implement the product gates under [REP-8 through REP-14](docs/roadmap/requirements.md#rep-8) (everyday utility, access, accounting, owner controls, earning and economics), integrating the existing REP-4/REP-5/DR-6 owners. Existing compute reservations and resource settlement do not implement credit balances or payments. The accepted public package remains live while candidates qualify.

| Field | Current recorded evidence and action |
| --- | --- |
| Milestone | Launch 1: Qwen 3.5 0.8B Q4K (`qwen-3-5-0-8b-q4k-ehaf16`) through configured prepared capacity, selected automatically for the requester; complete conversations and bounded independent requests. |
| Blocker | Numerical qualification of candidate `2df37d88…` is closed: the [second rerun](artifacts/completion-qualification-2-20261013/README.md) passes all 55 prefixes within `0.001`, with cleanup and reports accepted, and the [16-token chunk requalification](artifacts/completion-qualification-3-20261014/README.md) passes all 55 prefixes in both placements. The [installed three-stage journey](artifacts/signed-completion-journey-20261013/README.md) now passes on both placements with test signing: placement A on [`final-5`](artifacts/signed-completion-candidate-20261013/README.md) (requester 13/13, contributor loss 7/7, Launch 2 contribution 7/7; runs 5 and 6) and placement B (output head on AMD) in run 7 on `final-7` (Reploid `c44ec852`: requester 13/13 with the one-time remote-contributor permission and installed transactional history, contributor loss 7/7), `final-8` (`76296a53`: contribution 7/7) and `final-9` (`1473eda7`, Capsule release sequence 5: requester 13/13 with installed transactional history, contributor loss 7/7, contribution 7/7 and explicit full-model seeding 7/7, where another computer acquired the whole model from a browser seed through signed custody). Run 7 fixed three application defects: a route that never re-formed after a stage's coordinator channel was lost (`c44ec852`), custody rejecting the signed catalog's relative program paths (`76296a53`) and one stalled supplier ending a whole-model acquisition (`1473eda7`). No i915 event occurred. In contribution attempt j, Intel native 16 exited on SIGSEGV mid-answer; the [crash investigation](artifacts/native-crash-20261014/README.md) reproduces a node crash on that host in Mesa's shader-cache NIR reload during pipeline creation and keeps the exit open as a reliability item. Still open: two wrong example outputs, attributed by the [answer cause](artifacts/answer-cause-20261014/README.md) comparison to the deployed Q4_K weights (turn 1) and to the source model (turn 2), retained as failed answers pending the quality decision and independent answer review; speed, a product limitation (about 2.5 s per generated token on placement B and 3.3 s on placement A, Intel-bound); a context bound (Intel prefill measured at about 1.0 to 1.1 s per prompt token, so prompts much past 270 tokens exceed the 300 s stage bound used in the journeys, and the 1,588-token workload is unrun); recurring 10 to 30 s `mac-host` network stalls in the test environment; and production signing, which blocks public promotion only. Historical archive `9264d265…` remains failed. |
| Accountable owner | Reploid release integration owns Launch 1 delivery; Doppler owns runtime repair and numerical qualification. GPU ownership comes from fresh recorded process checks and the scoped campaign reservation. |
| Next action | The 0.8B configuration remains the engineering vehicle; useful-answer acceptance decides release suitability. On the [useful-answer set](artifacts/useful-answer-set-20261014/README.md), mechanical checks pass 32/38 for Q4_K and 35/38 for bf16, but whole-answer assessment, which covers every factual claim, instruction and example and never counts unverified claims as correct, finds both weight variants whole-answer correct on only 17 of 40 items. This remains an unresolved product-quality gap. Higher precision fixes three scored failures, not the model's underlying mistakes. The [standalone-to-partition isolation](artifacts/speed-isolation-20261014/README.md) on `amd-host` (the 68 tokens/s receipt's GPU; same weights, prompts and Node/Dawn stack) finds the loss in the paired execution profile: ordinary execution decodes in 28.4 ms per token (22.4 ms batched) and processes a 56-token prompt in 0.29 s; the paired whole model takes 600 ms and 17.3 s; three local stages add 4%; placement B takes about 2.5 s, mostly the Intel stage (1.66 s for layers that take 182 ms on AMD). The paired step is GPU-bound (454 of 577 ms); attention, RMSNorm and the recurrent gated delta are 70-330x their ordinary kernels, beyond the paired matmul's arithmetic cost ([paired matmul cost](https://github.com/clocksmith/doppler/blob/52b4e31d/artifacts/paired-matmul-prefill-cost-20261014/README.md)). The correctness standard, not an arithmetic implementation, is the requirement: the [plain profile check](artifacts/plain-profile-reference-20261014/README.md) against the same F64 reference fails the unchanged 0.001 tolerance on the 184-token request (28 of 55 steps within; maximum 3.50e-3; all 55 tokens equal), and a two-F32 recurrent state alone reaches 37 of 55. The [divergence localization](artifacts/plain-profile-reference-20261014/README.md#first-divergence-and-controlled-substitutions-2026-10-14-later) finds the cause: the F16 K/V cache store of the full-attention layers. Plain F32 rounding (first difference at the layer-0 norm, about 5e-7) moves 0.35% of the layer-3 K/V values to a different F16 step than the reference, and attention amplifies it; substituting only the reference K/V makes plain pass at plain speed (2.26e-5, a diagnostic). Every tested correction confined to the plain path failed; cheaper ways to produce sufficiently accurate K/V are not ruled out. The cheapest passing configuration tested, paired layers 0-15 with plain layers 16-23 and head, passes at 6.6e-4 and 356 ms per token; it needs mixed-precision execution support and physical qualification and is kept as an alternative. Next: optimize the paired kernels (attention, recurrent gated delta, linear-attention prepare, RMSNorm, then matmul) under the unchanged reference and tolerance, with the existing kernels as controls, completion waits kept, kernel-level tests that exercise reordered reductions, and bit-identical stored F16 K/V recorded as a separate regression requirement. Report full-model prompt and decode times, preparation cost and memory peaks, then installed conversation latency for one frozen candidate. Avoiding Intel requires prepared replacement capacity for its layers within measured budgets; ranking cannot substitute for it. Retained lead if the kernel work is insufficient: K-only reference substitution passes (9.89e-4), so accurate K production alone is a specific optimization lead; it is not yet an implementable fix. Placement avoids the Intel stage when faster authorized capacity can serve a request and keeps slower devices when their memory supplies otherwise unavailable capacity. Stages advertise readiness only after their required pipelines are prepared (Doppler `9830aaec` for the paired path). Set the published context bound from the fix that follows; then run the 1,588-token workload and allocation reuse. The test release is renewed to sequence 6 (Doppler `9f9cd355`, expires 2026-10-15T19:34Z); the next installed run needs a delivery that carries it, or production signing. Production signing gates public promotion only; Flash-Next preparation continues independently. |
| Completion condition | Unchanged approved independent reference, all 55 required prefixes and `0.001` tolerance (met); installed signed conversation and lifecycle acceptance (automated checks met on `final-5`); independent answer review; production-signed promotion. Preserve approved precision, weights, F16 caches and the `1,420,000,000` allocated-byte per-executor ceiling. |
| Historical migration snapshot | Reploid [`229a6e601adbd970de38c3315d069de4ba707cce`](https://github.com/clocksmith/reploid/tree/229a6e601adbd970de38c3315d069de4ba707cce), migration base as read 2026-10-13; newer [storage evidence](artifacts/storage-contribution-20261013/README.md) through `92642382` is preserved. This migration adds no hardware evidence. |
| Accepted package | Doppler `0.6.27`; [unchanged pin](https://github.com/clocksmith/reploid/blob/229a6e601adbd970de38c3315d069de4ba707cce/self/config/doppler-package.json). The accepted public runtime remains available while the replacement qualifies. |
| Historical qualified boundary | Archives `102fd0c4…` and `0fadac51…` retain their declared two-stage numerical acceptance. Frozen signed delivery `48b8d291` uses `0fadac51…`; its recorded actual signed chat remains unrun. Changed bytes do not inherit acceptance. |

Status comes from the snapshot and linked receipts. Historical reviews are not evidence of a later run. Package archive prefixes above are not Git commits. See [DR-6](docs/roadmap/requirements.md#dr-6) for current candidate qualification and source integration, [DR-4](docs/roadmap/requirements.md#dr-4) for historical numerical qualification, and [DR-1](docs/roadmap/requirements.md#dr-1) for package boundaries.

## Cumulative launches

Two tiers keep the current qualification moving without confusing it with the
complete product:

- **Dependable-chat foundation:** Launch 1's runtime and installed conversation
  qualification continues under unchanged references, tolerances and lifecycle gates.
- **Complete initial consumer product:** everyday utility including retrieval and
  citations, Community Access, earned and purchased access, owner controls and the
  overnight earn/use proof. These new gates attach to Launch 2 and the existing
  service owners. Source completion or storage receipts cannot close them.

Each launch delivers a complete usable capability. Keep the accepted site live while candidates qualify separately; development can overlap without one shared deployment date.

| Launch | Usable capability and acceptance |
| --- | --- |
| **1. Dependable distributed chat** | Finish the current Qwen 3.5 0.8B Q4K engineering configuration: signed selective acquisition, automatic eligible-route selection, useful complete answers/follow-ups, durable history/reload, permissions, bounded independent conversations, isolated cancellation, loss/retry and settlement. Publish proven device/context/concurrency limits. Whole-answer quality determines model suitability. This is the technical foundation; it can qualify before credits and search. Flash-Next is not a dependency. |
| **2. Useful optional contribution and earned access** | Preserve scoped storage acceptance: cached-only, bounded acquisition, explicit seeding, persistent allowances, resumed transfers and stop without directly cancelling chat. Add native overnight owner controls and the earn/use loop: requested validated work or contracted readiness, durable credits, quotes, financial settlement, funded Community Access and optional top-ups. Everyday questions, explanations, summaries and retrieval/citations must pass REP-8 for the complete initial consumer product. Release subcapabilities only with their applicable gates; storage evidence alone does not qualify rewards or paid service. |
| **3. Concurrent prepared service** | Add autonomous cold assignment, demand-driven preparation, useful replicas, cross-route fairness and measured concurrency. Rank complete routes by service outcomes and cost; let unnecessary machines sleep. Preserve cancellation, departure and retry behavior. Bootstrap with a modest AMD/Apple Silicon fleet and recorded basement subsidies; qualify independent failure domains before resilience claims. |
| **4. Flash-Next access** | Qualify the exact converted model/runtime, reference accuracy, useful answers, distributed execution and the same conversation, lifecycle and accounting integration. Keep the existing supported model available. Flash-Next work proceeds independently; the earning loop does not require this particular model. |
| **5. Larger and more efficient service** | Qualify additional models, device combinations and capacity increases individually. Prove dollars and/or joules saved per satisfactory, on-time answer under fixed comparison conditions. Developer APIs share prepared capacity and accounting after dependable consumer access. Coding, specialization, marketplace trading and OpenRouter distribution follow separately; speculation, transferable state and finer expert placement require measured benefit. |

**Launch boundary:** operators may configure supported prepared stage capacity for Launch 1; requesters choose a model and grant a one-time permission to use remote contributors (REP-7), never assign stages; each attempt records its actual recipients. The fixed numerical harness does not prove this application behavior. Launch 2 extends optional contribution into earned access; retained storage/chat checks stay accepted only for their tested scope. Credits, owner controls and retrieval have separate new acceptance, not retroactive passes. The full initial consumer product requires these gates even though the Launch 1 technical foundation may ship independently. Autonomous cold preparation remains a Launch 3 gate.

**Separate diagnostic:** the [projection outlier](https://github.com/clocksmith/doppler/blob/175ec7a4/artifacts/kernel-completion-repair-20261013/projection-outlier-simulation.json) remains above its original synthetic `2e-12` threshold (`2.27e-12` against exact operands). CPU reduction reproduces the GPU pair; no threshold is weakened. This diagnostic and the full-model `0.001` gate retain distinct outcomes.

**Every launch:** freeze website, browser/native runtime, model artifact and supported configuration together. Qualify preview → limited opt-in → public promotion. Retain a known-good rollback package and compatible history migrations. Unsupported combinations remain unavailable with a clear explanation. UI-only improvements may deploy independently after testing against the accepted runtime.

**Release unit:** a working user capability plus its supported model configuration. Source completion alone never enables it publicly. Existing IDs and their scoped evidence remain the acceptance authority below.

## Execution order and ownership

Finish correct installed execution and complete conversations together, exercising acquisition, permissions, cancellation and recovery through that same application. Prepare Flash-Next's reference and missing operators during repair. Extend placement and progressive contribution through existing owners. Begin measurement collection now; comparative economic conclusions require dependable execution.

Within those launches, prioritize these outcomes through the existing task entries. These owners hold one next action per entry; the table maps product gaps, not a second checklist:

| Outcome | Next implementation and proof |
| --- | --- |
| Fast ordinary answers | DR-5 / DR-6: first isolate the standalone-to-partition gap using the controls below. Separate queueing, prefill, decode, output head, transfers and durable publication. Doppler repairs the dominant compute/dispatch boundary; Reploid repairs the dominant placement/transport boundary. Restore existing optimizations where the path lost them before adding new ones, under unchanged correctness gates. |
| Helpful placement | DR-6: compare eligible whole-request and uneven multistage routes, including the output head's device. Include preparation and queue costs; adding a slower device must not displace a faster feasible route without a recorded capacity, fairness or availability benefit. Never migrate an active attempt. |
| Everyday utility | REP-8 / REP-7 / ALL-7: freeze questions, explanations, summaries and retrieval-backed search tasks with whole-answer quality, latency and cost criteria. Verify cited sources support claims. Runtime parity alone cannot pass answer quality; coding and specialization stay later. |
| Earn and spend | REP-9 / REP-10 / REP-11 / REP-13: implement funded Community Access, nonexpiring earned/purchased balances, accepted quotes, reservations, exactly-once settlement, refunds and abuse controls. First reconcile one bounded overnight contribution with next-day phone redemption. No financial acceptance is inferred from resource receipts. |
| Respect the owner | REP-12 / REP-4: extend existing contribution with native schedules, power/temperature/memory/bandwidth limits and foreground admission reduction; verify safe settlement, device/network authorization and measured impact. Reward demanded validated work or contracted readiness, not online time. |
| Sustained shared service | REP-4 / DR-6: keep weights resident, isolate conversations, bound waiting and prepare replicas for measured bottlenecks. Demonstrate that another user can arrive or cancel without breaking existing work, and measure availability through contributor churn. |

This table summarizes the canonical requirements, not additional checklists or passed gates. Preserve cumulative launches and their separate activation boundaries.

Doppler owns computation, sampling and inference state. Reploid owns discovery, placement, permissions, reservations, contribution, service accounting and conversations. Financial settlement and execution cleanup have distinct records and acceptance. Doe remains an optional execution provider; unrelated compiler campaigns cannot gate release.

The ten execution outcomes below support one product. New service requirements REP-8 through REP-14 are tracked once in the same register; they extend, rather than reopen, these foundations. Each existing stable ID has one canonical entry in the linked [task register](docs/roadmap/requirements.md), including nested requirements, original checkboxes and source/installed/physical evidence. The front page selects work; it does not duplicate acceptance checkboxes.

## 1. Correct execution

Repair numerical failures and qualify installed execution across supported physical devices against unchanged approved references and tolerances. Keep operator correctness, complete-model accuracy, answer usefulness and distribution parity separate. Completed rejected experiments remain completed; rejected configurations remain rejected.

Canonical IDs: [DOP-1](docs/roadmap/requirements.md#dop-1), [DOP-2](docs/roadmap/requirements.md#dop-2), [DOP-3](docs/roadmap/requirements.md#dop-3), [DOP-5](docs/roadmap/requirements.md#dop-5), [DOP-6](docs/roadmap/requirements.md#dop-6), [DOP-8](docs/roadmap/requirements.md#dop-8), [DR-4](docs/roadmap/requirements.md#dr-4), [ALL-4](docs/roadmap/requirements.md#all-4). Changed-package repair is recorded once under [DR-6](docs/roadmap/requirements.md#dr-6).

## 2. Complete conversations

Deliver useful streamed answers, history-aware follow-ups, durable saved history and restoration after reload through the actual application. Qualify the requester-owned transactional writer using real installed signed execution. Consumer chat remains primary. Everyday summaries and retrieval-backed answers with supporting citations belong to the initial product under REP-8, integrated with REP-7. Specialized document calculations and durable indexing retain their separate scope; they do not substitute for ordinary search retrieval or block the technical chat foundation.

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

Optimize time to useful published output and complete-request cost, not peer count or equal layer counts. A slow device contributes compute when its capacity is needed or it improves the admitted workload; otherwise leave it idle or use separately authorized storage. Freeze placement for each attempt and reassess between attempts.

Canonical ID: [DR-6](docs/roadmap/requirements.md#dr-6), including MESH-01 and the retained 12/20/100 targets. Configured 2–7-stage source composition is complete in its declared scope; autonomous cold assignment, wider physical capacity and fair shared-device admission remain unqualified. Preparation stays separate from requesting.

## 7. Progressive contribution

A participant may offer bounded introductions, bandwidth, small verified caches, compatible short jobs or prepared stages while also requesting service. Use existing owners. No minimum model download or mandatory compute contribution applies. Reward only requested, validated work or explicitly contracted readiness under REP-10/REP-11 accounting. Native schedules, power/temperature/memory/bandwidth limits and foreground responsiveness belong to REP-12 through REP-4. Require device/network authorization and let unnecessary machines sleep.

Canonical foundation: [REP-1](docs/roadmap/requirements.md#rep-1). Integration acceptance belongs to REP-4, REP-5 and DR-6; their historical completed foundations and newer [storage controls](artifacts/storage-contribution-20261013/README.md) retain their separate acceptance scopes.

Storage modes and exact acceptance: [REP-5 progressive storage acceptance](docs/roadmap/requirements.md#rep-5-progressive-storage-acceptance). Cached-only never fetches missing metadata or pieces; bounded acquisition persists and charges allowances across reloads, competing tabs, metadata and retries; full-model seeding requires explicit authorization. Inventory is rebuilt from verified metadata and cached bytes. Source/browser controls and the [final-9 installed contribution and full-seeding checks](artifacts/signed-completion-journey-20261013/README.md) retain their scoped acceptance in REP-4/REP-5. They do not establish credits, rewards, new owner controls or public promotion.
Allowances must distinguish download, upload, retained storage, host/GPU memory, execution and expiry where applicable. Stopping contribution must not directly cancel personal conversations. Preserved history is not resumable inference state: loss of indispensable capacity may require waiting or a fresh approved retry.

## 8. Permission and recovery

Bind actual recipients and complete input scope, enforce revocation and handle contributor departures through existing grants and attempt owners. Settle resources or keep unknown ownership charged. Replacements require explicit fresh attempts when valid continuation is unavailable. Discovery loss alone must not terminate healthy owned execution.

Canonical IDs: [REP-6](docs/roadmap/requirements.md#rep-6), [DR-3](docs/roadmap/requirements.md#dr-3). Retained weights, saved text, local state reuse and transferable inference state are distinct capabilities. Signatures establish record identity, not honest or secret remote computation.

## 9. Physical release

Qualify matching browser/native/runtime/model artifacts through the actual application on supported physical devices. Require useful complete answers, follow-ups, isolated concurrency, permission enforcement, settled cancellation and returning histories. Accept limited models/devices, bounded concurrency, visible queues and explicit retries; disclose limitations and unfamiliar-user evidence gaps.

Canonical IDs: [DR-1](docs/roadmap/requirements.md#dr-1), [ALL-1](docs/roadmap/requirements.md#all-1), [ALL-2](docs/roadmap/requirements.md#all-2), [ALL-3](docs/roadmap/requirements.md#all-3), [ALL-5](docs/roadmap/requirements.md#all-5), [ALL-6](docs/roadmap/requirements.md#all-6). Existing history, controls and immutable receipts stay attached to their exact configurations.

## 10. Demonstrated advantage

Collect preparation time, retained memory, network transfers, idle power where measurable, failures and human intervention during engineering runs now. Later compare useful availability, throughput and complete cost against feasible rentals/APIs, hybrid-memory execution and conventional coordination on identical machines. Include Flash-Next's conventional host-memory offload baseline.

Measure complete dollars and wall-plug joules per satisfactory, on-time answer, including preparation, idle residency, networking, cooling, failures, hardware and depreciation. Report requester spending, contributor costs and operator accounts separately; internal rewards/payments are transfers, not additional system resource consumption. Record donations, basement hardware/electricity/operations subsidies and new capital expenditure. Treat the basement as one failure domain. Buy additional hardware against measured missing capacity, not a stranded-capacity claim.

Investigate achievable efficiency on representative AMD/Mac workloads before selecting performance or commercial thresholds. Then freeze workload, quality, concurrency, latency, availability, permissions, advantage margin and regression limits before confirmatory comparison. Expand participation against measured demand and service economics. A gain in dollars does not prove a gain in joules; disclose both, unknown costs, failed answers and rejected demand. Affordable persistent access remains a hypothesis. A workload win does not imply universal superiority.

Keep one scorecard for the declared supported configuration: useful-answer pass rate, p50/p95 time to first durably published output, p95 visible output gap, accepted published tokens per second, completed requests within the latency budget, sustained availability, recovery and complete resource cost. Separate cold acquisition, warm loading and resident service. Compare the same model and machines where possible; separately compare task outcomes within equal resource budgets. Count failures and rejected demand. A claimed advantage needs a predeclared consequential gain with uncertainty reported and no breach of the quality, reliability or latency regression limits.

Comparison acceptance stays in DR-6; [REP-14](docs/roadmap/requirements.md#rep-14) adds service economics and dependable supply. [REP-13](docs/roadmap/requirements.md#rep-13) owns the first overnight earn/use proof. The following canonical IDs remain explicitly optional or later, without becoming community-release dependencies:

- Quantization: [DOP-4](docs/roadmap/requirements.md#dop-4), [DOP-7](docs/roadmap/requirements.md#dop-7).
- Optional compiler/provider work: [DOE-1](docs/roadmap/requirements.md#doe-1), [DOE-2](docs/roadmap/requirements.md#doe-2), [DOE-3](docs/roadmap/requirements.md#doe-3), [DOE-4](docs/roadmap/requirements.md#doe-4), [DOE-5](docs/roadmap/requirements.md#doe-5), [DOE-6](docs/roadmap/requirements.md#doe-6).
- Optional integration comparisons: [DD-1](docs/roadmap/requirements.md#dd-1), [DD-2](docs/roadmap/requirements.md#dd-2), [DD-3](docs/roadmap/requirements.md#dd-3), [DD-4](docs/roadmap/requirements.md#dd-4), [DD-5](docs/roadmap/requirements.md#dd-5), [DD-6](docs/roadmap/requirements.md#dd-6).
- Optional native provider: [ER-1](docs/roadmap/requirements.md#er-1), [ER-2](docs/roadmap/requirements.md#er-2), [ER-3](docs/roadmap/requirements.md#er-3), [ER-4](docs/roadmap/requirements.md#er-4), [ER-5](docs/roadmap/requirements.md#er-5).
- Later independently evaluated improvement: [ALL-8](docs/roadmap/requirements.md#all-8), [ALL-9](docs/roadmap/requirements.md#all-9). Persistent permissioned work and evaluated improvement remain the progression, not launch gates.

## Experimental boundaries and maintenance

Speculation, transferable inference state, finer expert placement, learned scheduling and power-price routing require separately demonstrated complete benefit. Ordinary multistage service does not wait for them. Existing fork/replay and target-sampling requirements remain in [RD-CANON/1](docs/roadmap/rd-canon-1.md); this migration does not weaken its performance, correctness or authorization gates.

Keep one canonical task entry per stable ID in the register, with its owner, applicable source/installed/physical status, next action, dependencies and acceptance. Update only supported evidence. Keep chronology in [history](docs/roadmap/history.md), immutable receipts with their owners, and design contracts separate from status.

*Last updated: October 2026*
