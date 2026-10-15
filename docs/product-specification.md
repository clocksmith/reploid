# Reploid product specification and economics contract

**Reploid Product Economics Contract v1.1**, identity
`reploid.product-economics/1.1.0` (2026-10-15; adds the owner's adopted decisions below; v1.0 is preserved in history at `970c80f7`). Normative product requirements merged into the
seven-section definition below. MUST denotes a requirement, not implementation or
economic proof. Credit quotes, rewards, redemption and solvency remain
unimplemented/unproven unless separately evidenced in the canonical register.
Resource allowances and signed execution do not establish a credit economy.

Version this contract independently of applications, models and Doppler packages.
Every quote and receipt MUST bind its exact version and immutable document revision.
Material changes to accepted rights/obligations require a major version and newly
accepted terms; additive requirements use a minor version, clarifications a patch.
Preserve prior versions and receipts; never apply new policy retroactively.
Explicitly labeled proposed defaults remain recommendations, not adopted policy.
The existing requirements below own execution; this is not another work queue.

This file is the canonical contract. [ROADMAP.md](../ROADMAP.md) selects the
next work and records the current milestone; the
[requirements register](roadmap/requirements.md) holds every acceptance checkbox
and its evidence. The [execution outcome rules](#execution-outcome-rules) moved
here from the roadmap unchanged; they are existing requirements, not additions
to `reploid.product-economics/1.0.0`.

**Earn on your computer. Use AI anywhere.**

## 1. Product

Reploid lets people contribute useful computer resources, accumulate nonexpiring
credits, and redeem AI services from any device. Requesting and contributing are
independent activities available to the same person. Users may contribute storage,
computation or both, purchase top-ups, or use Community Access. No subscription is
required. The network is the product; requesters should eventually access models
larger than their devices can store or execute.

Reploid owns discovery, acquisition, placement, permissions, reservations,
accounting and conversations. Doppler owns computation, sampling and inference
state. Compute reservations and resource settlement are not financial accounting.

Every offered service, accepted quote and receipt MUST bind an immutable service
record: exact model, checkpoint/weights, deployed representation, tokenizer and
applicable adapter identities; separately qualified runtime; operation and
input/output contract; input/history/context and output limits with units and
exceedance behavior; quality-policy version; permitted recipient policy and actual
recipient binding within disclosure scope; queue eligibility, fairness and bounded
waiting; absolute expiry and deadline for satisfactory durable output; resource,
concurrency, duration, retry/output limits and stop/unknown-cleanup behavior; and
accounting units, precision/rounding, metering, reservation, reward and settlement
versions. No silent truncation or substituted service. Bind accepted quote/attempt
identity and actual recipients durably before dispatch. Changed service needs a
new eligible record and authorization when outside existing grants.

Acceptance: [REP-7](roadmap/requirements.md#rep-7),
[REP-10](roadmap/requirements.md#rep-10),
[DR-1](roadmap/requirements.md#dr-1), [DR-3](roadmap/requirements.md#dr-3).

## 2. Community Access

Community Access is an ongoing free service funded by donors, participating
operators and reserved community resources, not a signup trial or promotional
credit allocation. It MUST have fair queues, usage limits, abuse controls and
visible availability. Registration MUST NOT automatically issue transferable credits.

An operator-funded guaranteed basic-service minimum remains an open decision.
**Proposed default:** until funding and supply are committed, disclose queuing or
explicit retry without a guaranteed minimum or completion time; queue access does
not promise an eventual answer. A funded floor requires declared allocation,
funding source, admission limits, reliability coverage and shortfall behavior. A positive credit balance likewise does not guarantee
immediate capacity. Requesting, earning and purchasing remain independently available.

Acceptance: [REP-9](roadmap/requirements.md#rep-9).

## 3. Credits and marketplace

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
Credits reserve funds, not capacity or permission. Capacity admission stays with
the execution owners; expired or unadmitted requests MUST follow declared release
rules rather than hold funds indefinitely. Unknown physical cleanup remains owned
against resource budgets, but MUST NOT extend monetary holds or charges implicitly.

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
reliability/replacement reserves, Community Access funding and operator subsidy.
State valuation assumptions, observation windows and uncertainty; stress synchronized
redemptions, departures, quality failures, refunds and demand spikes before service
commitments. Reward issuance MUST account for future service demand and available
capacity. Issuing credits or observing low redemption does not establish solvency;
nominal balances are not guaranteed dollar-redemption liabilities.

Acceptance: [REP-10](roadmap/requirements.md#rep-10),
[REP-11](roadmap/requirements.md#rep-11), [REP-14](roadmap/requirements.md#rep-14).

## 4. Consumer utility

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
The reviewer must be independent of task/check authoring and candidate tuning;
self-review does not satisfy this gate. Assessment authority must also be
independent of provider reward interests, with declared uncertainty handling and
no retrospective rewriting of evaluation criteria.
In economic experiments, only answers that pass the applicable quality policy
and arrive within their declared deadline count as successful. Failed attempts,
retries and duplicate work stay in total costs. Numerical parity alone does not
establish satisfactory answers.

Acceptance: [REP-8](roadmap/requirements.md#rep-8),
[REP-13](roadmap/requirements.md#rep-13), [REP-7](roadmap/requirements.md#rep-7).

## 5. Contribution and execution

Reward demanded, validated computation, useful verified delivery, or explicitly
contracted storage or prepared availability. Each reward category needs its own
qualification. A contribution offer MUST state requested work, reward basis,
validation conditions, resource bounds, duration, maximum reward or calculation,
payment timing and failure compensation.
Contracted readiness requires evidence that promised capacity was maintained;
contracted storage requires evidence of agreed custody and service obligations.
Verified storage/delivery and contracted readiness can earn without inference
completing during the interval. Bind demanded model/pieces, capacity, interval,
limits, formula and validation before admission; retain failed challenges, missed
intervals and duplicate claims. Value storage, transfer, readiness and computation
separately so incompatible claims cannot reward the same contribution twice.
Storage is not execution readiness. Mere online presence earns nothing. Small
useful contributions remain welcome; unnecessary machines should sleep.

Native contribution targets macOS, Windows and Linux; releases MUST list only
qualified combinations. Enforce schedules, memory, bandwidth, supported power and
temperature controls, and foreground responsiveness, including host/GPU memory,
retained storage and energy limits where enforceable. Reduce admission when the
owner needs the machine and settle active work safely. Disclose unsupported
controls and reject work that requires a limit the host cannot enforce. Require equipment and network authorization, including workplace use.

Reuse prepared weights, batch compatible requests and minimize unnecessary
transfers. Support both whole-model execution on a participant and qualified
partitioned execution. Whole-model remote inference is a useful service and
control, but does not prove the distributed-model objective. That demonstration
requires complementary model partitions across physical execution participants,
none retaining the complete weight set, and a requester without weights. Verify
per-executor inventories and selective acquisition. Separately authorized storage
suppliers may retain a complete model; preserve full-model seeding under REP-5.

Remote executors receive disclosed text, tokens and intermediate representations;
tokens, transport encryption and signatures do not establish confidential execution.
Describe prior turns and attached/retrieved context before relying on a grant.
Model approval alone does not establish trust in arbitrary computers. Recipient authorization MUST be explicit and revocable through
the explained, one-time permission. Renew approval only outside the granted
recipient policy/disclosure scope or when other authorized terms are exceeded,
not whenever an eligible computer changes between requests. The existing one-time
network permission can satisfy recipient-policy authorization when its recorded
scope explicitly covers the selected recipients, model and disclosure. Record actual
recipients and never silently switch an active attempt's route. Revocation stops
new disclosures; it cannot erase information already delivered.

Arbitrary-peer eligibility versus approved operators for sensitive work remains
an open policy decision. **Proposed default:** fail closed when recipient eligibility
or disclosure scope is unspecified; participation, payment and signatures confer
no trusted status. Existing grants remain mandatory regardless. Any approved-operator
class needs defined admission criteria, identity and scope; it does not prove secrecy.
Stopping contribution MUST preserve history and MUST NOT directly cancel
unrelated requests. Loss of indispensable capacity may require waiting or explicit
retry. Saved history MUST NOT be represented as recovered inference state.

Acceptance: [REP-11](roadmap/requirements.md#rep-11),
[REP-12](roadmap/requirements.md#rep-12), [REP-4](roadmap/requirements.md#rep-4),
[REP-5](roadmap/requirements.md#rep-5), [DR-3](roadmap/requirements.md#dr-3),
[DR-5](roadmap/requirements.md#dr-5), [DR-6](roadmap/requirements.md#dr-6).

## 6. Required economic advantage

Demonstrate lower complete dollars and/or joules per satisfactory, on-time answer
against feasible alternatives at comparable quality, latency, availability and
permissions. Investigate achievable efficiency before selecting thresholds, then
freeze the confirmatory evaluation and regression limits.

Include acquisition, preparation, idle residency, execution, transfers, validation,
failures, cooling, hardware allocation/depreciation and operating costs. Show
requester charges, contributor costs/rewards and operator accounts separately.
Consolidated costs MUST NOT double-count payments between those parties.

Measure whole-system gross energy and incremental energy against an observed or
explicitly modeled no-Reploid baseline under comparable foreground/background load.
Record meter boundary/location, instrument, sampling interval, duration and uncertainty;
include wake, idle and preparation effects. Component estimates are not wall power.
Record tariffs, currency, location/time applicability, incremental-kWh cost calculation,
subsidies, delays, quality decisions and failed work; unknown measurements stay unknown. API prices do not establish provider energy consumption. Subsidies
can improve user prices but do not establish underlying economic efficiency.
Report quality, reliability, latency and successful completion alongside costs.
Include every attempt's costs in the numerator and only independently accepted,
on-time answers in the denominator; zero satisfactory answers permits no favorable
unit-cost claim. Compare feasible local, equivalent centralized, hosted/rented and
hybrid-memory alternatives with matched model/hardware where possible and label
task-equivalent comparisons separately. Report both dollars and joules, tradeoffs
and uncertainty even when only one improves.

Acceptance: [REP-14](roadmap/requirements.md#rep-14),
[DR-6](roadmap/requirements.md#dr-6).

## 7. Bootstrap and proof

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
evidence; quantify each accepted work category in declared units and define the
redemption window and accepted task decisions. Show outstanding credits, failed
redemptions and unknown values. Unredeemed rewards do not complete the proof.
The economic loop and partitioned-model demonstration are distinct required results;
a complete-model remote redemption cannot substitute for partitioned inference.

After reliability, pursue independent adoption and possible OpenRouter distribution.
Neither marketplace launch nor external platform listing is required for this loop.

Acceptance: [REP-13](roadmap/requirements.md#rep-13),
[REP-14](roadmap/requirements.md#rep-14), [REP-7](roadmap/requirements.md#rep-7).

## Decisions and execution boundary

| Decision | State and owner |
| --- | --- |
| Community Access guarantee | Open, user: whether to commit operator-funded basic capacity. Proposed default: disclosed queue/retry without a guaranteed minimum or completion time. REP-9 owns the gate; the proposal makes no funding commitment. |
| Reward eligibility | Adopted: demanded computation, useful verified delivery, explicitly contracted storage and prepared readiness. REP-11 qualifies each category; no reward for unrequested presence. |
| Account transfers | Adopted: design transferability now; transfers and marketplace are off initially. REP-10 qualifies later activation; direct transfers need not wait for marketplace launch. |
| Recipient eligibility | Open, user: arbitrary participating computers versus approved operators for sensitive work. Proposed default: reject unspecified eligibility/disclosure, without inferring trust from payment or participation. Existing explicit, revocable grants remain mandatory; DR-3 owns enforcement. |
| First distributed proof | Partitioned execution with no execution participant retaining the complete weights and no requester weights. DR-5/DR-6 require exact-run inventory and execution evidence. Separate REP-5 storage seeds may hold the complete model. |
| Launch 1 model | Adopted 2026-10-15: Qwen 3.5 0.8B is an engineering vehicle and Community Preview, not the default consumer model. Promotion requires independent review reaching at least 80% whole-answer correctness with no critical unsupported claims. REP-7 and REP-8 own the gate. |
| Independent answer review | Adopted 2026-10-15: two blinded human reviewers who did not author the tasks; a third only for disagreements. Publish element-level judgments, not one aggregate score. |
| Search provider | Adopted 2026-10-15: Brave Search API first. The search-provider interface keeps a path to a self-hosted SearXNG JSON endpoint; public SearXNG instances may disable it. REP-8. |
| Citation support | Adopted 2026-10-15: fetch pages, hash retained passages, map each material claim to its cited spans, require deterministic URL and span validity plus blinded human or stronger-model entailment review. The generating model never certifies itself. REP-8. |
| Retrieval permission wording | Adopted 2026-10-15, exact text: "Allow Reploid to send this search query to Brave and share retrieved passages with the listed execution contributors for this answer. Your files and unrelated conversation history are excluded." DR-3 and REP-8. |
| Sign-in and payments | Adopted 2026-10-15: Supabase Auth email magic links initially; Stripe Checkout with verified webhooks for one-time top-ups. Each needs provider-specific acceptance. REP-9 and REP-10. |
| REP-13 pilot values | Adopted 2026-10-15, versioned and revisable: founder-funded Community Access of $100 per week; $10 top-up; first-token deadline 30 s; complete short answer 180 s; at least 80% whole-answer correctness and 95% citation-support accuracy; validated contribution rewarded at measured marginal cost plus a 20% pilot bonus. Rates are published as versioned records and never applied retroactively. |

Existing receipts retain their exact model/runtime/package/placement scope. The
[run-7 native launcher](../artifacts/signed-completion-journey-20261013/run-7/tools/native-launch.sh)
uses pre-existing model directories on both native hosts; it does not establish
partition-only native custody. The installed route proves partitioned computation,
not the stronger no-complete-weight-set demonstration. That requires selective
native acquisition and exact-run inventories; completed execution evidence stays
accepted at its original scope. This specification starts no replacement numerical
campaign and declares no new acceptance.

---

## Execution outcome rules

Detailed rules for the ten execution outcomes that the
[roadmap acceptance conditions](../ROADMAP.md#acceptance-conditions) summarize.
Each canonical ID keeps one entry, with its checkboxes and evidence, in the
[requirements register](roadmap/requirements.md).

### 1. Correct execution

Repair numerical failures and qualify installed execution across supported physical devices against unchanged approved references and tolerances. Keep operator correctness, complete-model accuracy, answer usefulness and distribution parity separate. Completed rejected experiments remain completed; rejected configurations remain rejected.

Canonical IDs: [DOP-1](roadmap/requirements.md#dop-1), [DOP-2](roadmap/requirements.md#dop-2), [DOP-3](roadmap/requirements.md#dop-3), [DOP-5](roadmap/requirements.md#dop-5), [DOP-6](roadmap/requirements.md#dop-6), [DOP-8](roadmap/requirements.md#dop-8), [DR-4](roadmap/requirements.md#dr-4), [ALL-4](roadmap/requirements.md#all-4). Changed-package repair is recorded once under [DR-6](roadmap/requirements.md#dr-6).

### 2. Complete conversations

Deliver useful streamed answers, history-aware follow-ups, durable saved history and restoration after reload through the actual application. Qualify the requester-owned transactional writer using real installed signed execution. Consumer chat remains primary. Everyday summaries and retrieval-backed answers with supporting citations belong to the initial product under REP-8, integrated with REP-7. Specialized document calculations and durable indexing retain their separate scope; they do not substitute for ordinary search retrieval or block the technical chat foundation.

Canonical IDs: [REP-7](roadmap/requirements.md#rep-7), [DR-5](roadmap/requirements.md#dr-5), [DR-2](roadmap/requirements.md#dr-2), [REP-2](roadmap/requirements.md#rep-2), [REP-3](roadmap/requirements.md#rep-3). CHAT-01, DEV-02 and JOB-06 stay within REP-7; ordinary release and later capabilities retain separate acceptance.

### 3. Independent concurrency

Share immutable resident weights while isolating each conversation's inference state, temporary buffers, grants and history. Enforce per-executor and shared-device budgets, admit fairly and bound queues. Cancel one request without corrupting its neighbor; retain unknown cleanup ownership until explicitly settled.

Canonical ID: [REP-4](roadmap/requirements.md#rep-4). Its exact-package long-conversation dependency remains in DR-5; cross-route fairness and physical-device coverage remain in DR-6. Logical participants and injected computation do not establish physical concurrency.

### 4. Flagship support

Prepare Flash-Next's checkpoint, tokenizer, license, independent reference, conversion checks and operator fixtures during repair. Then qualify its architecture and distributed execution. Model support remains reusable. Older-model ports are optional diagnostics; speculation and trillion-scale targets do not become prerequisites for this flagship.

Canonical ID: [ALL-7](roadmap/requirements.md#all-7). Checkpoint-specific sparse attention, gated residuals, n-grams, experts, memory tiers and platform acceptance stay in DR-6's selected-model entry. No model compatibility is inferred from similar operator names.

### 5. Efficient acquisition

Discover verified pieces, acquire only missing authorized dependencies, resume transfers and retain data across sessions. Measure cold network acquisition separately from local loading, required compilation, prefill and decode. Prefer assignments whose preparation can produce useful service within the contributor's availability and allowances.

Canonical ID: [REP-5](roadmap/requirements.md#rep-5). The progressive storage modes below extend this existing custody/accounting acceptance. Existing storage, acquisition and introduction evidence retains its original scope.

### 6. Automatic prepared placement

Assign complete compatible routes using measured links, memory, residency, demand and permissions. Keep complete experts within resident layer groups across slower links; finer expert placement remains experimental. Replicate only when it completes a missing route, removes a bottleneck, protects independent replacement capacity or serves another useful request.

Optimize time to useful published output and complete-request cost, not peer count or equal layer counts. A slow device contributes compute when its capacity is needed or it improves the admitted workload; otherwise leave it idle or use separately authorized storage. Freeze placement for each attempt and reassess between attempts.

Canonical ID: [DR-6](roadmap/requirements.md#dr-6), including MESH-01 and the retained 12/20/100 targets. Configured 2–7-stage source composition is complete in its declared scope; autonomous cold assignment, wider physical capacity and fair shared-device admission remain unqualified. Preparation stays separate from requesting.

### 7. Progressive contribution

A participant may offer bounded introductions, bandwidth, small verified caches, compatible short jobs or prepared stages while also requesting service. Use existing owners. No minimum model download or mandatory compute contribution applies. Reward only requested, validated work or explicitly contracted readiness under REP-10/REP-11 accounting. Native schedules, power/temperature/memory/bandwidth limits and foreground responsiveness belong to REP-12 through REP-4. Require device/network authorization and let unnecessary machines sleep.

Canonical foundation: [REP-1](roadmap/requirements.md#rep-1). Integration acceptance belongs to REP-4, REP-5 and DR-6; their historical completed foundations and newer [storage controls](../artifacts/storage-contribution-20261013/README.md) retain their separate acceptance scopes.

Storage modes and exact acceptance: [REP-5 progressive storage acceptance](roadmap/requirements.md#rep-5-progressive-storage-acceptance). Cached-only never fetches missing metadata or pieces; bounded acquisition persists and charges allowances across reloads, competing tabs, metadata and retries; full-model seeding requires explicit authorization. Inventory is rebuilt from verified metadata and cached bytes. Source/browser controls and the [final-9 installed contribution and full-seeding checks](../artifacts/signed-completion-journey-20261013/README.md) retain their scoped acceptance in REP-4/REP-5. They do not establish credits, rewards, new owner controls or public promotion.
Allowances must distinguish download, upload, retained storage, host/GPU memory, execution and expiry where applicable. Stopping contribution must not directly cancel personal conversations. Preserved history is not resumable inference state: loss of indispensable capacity may require waiting or a fresh approved retry.

### 8. Permission and recovery

Bind actual recipients and complete input scope, enforce revocation and handle contributor departures through existing grants and attempt owners. Settle resources or keep unknown ownership charged. Replacements require explicit fresh attempts when valid continuation is unavailable. Discovery loss alone must not terminate healthy owned execution.

Canonical IDs: [REP-6](roadmap/requirements.md#rep-6), [DR-3](roadmap/requirements.md#dr-3). Retained weights, saved text, local state reuse and transferable inference state are distinct capabilities. Signatures establish record identity, not honest or secret remote computation.

### 9. Physical release

Qualify matching browser/native/runtime/model artifacts through the actual application on supported physical devices. Require useful complete answers, follow-ups, isolated concurrency, permission enforcement, settled cancellation and returning histories. Accept limited models/devices, bounded concurrency, visible queues and explicit retries; disclose limitations and unfamiliar-user evidence gaps.

Canonical IDs: [DR-1](roadmap/requirements.md#dr-1), [ALL-1](roadmap/requirements.md#all-1), [ALL-2](roadmap/requirements.md#all-2), [ALL-3](roadmap/requirements.md#all-3), [ALL-5](roadmap/requirements.md#all-5), [ALL-6](roadmap/requirements.md#all-6). Existing history, controls and immutable receipts stay attached to their exact configurations.

### 10. Demonstrated advantage

Collect preparation time, retained memory, network transfers, idle power where measurable, failures and human intervention during engineering runs now. Later compare useful availability, throughput and complete cost against feasible rentals/APIs, hybrid-memory execution and conventional coordination on identical machines. Include Flash-Next's conventional host-memory offload baseline.

Measure complete dollars and wall-plug joules per satisfactory, on-time answer, including preparation, idle residency, networking, cooling, failures, hardware and depreciation. Report requester spending, contributor costs and operator accounts separately; internal rewards/payments are transfers, not additional system resource consumption. Record donations, basement hardware/electricity/operations subsidies and new capital expenditure. Treat the basement as one failure domain. Buy additional hardware against measured missing capacity, not a stranded-capacity claim.

Investigate achievable efficiency on representative AMD/Mac workloads before selecting performance or commercial thresholds. Then freeze workload, quality, concurrency, latency, availability, permissions, advantage margin and regression limits before confirmatory comparison. Expand participation against measured demand and service economics. A gain in dollars does not prove a gain in joules; disclose both, unknown costs, failed answers and rejected demand. Affordable persistent access remains a hypothesis. A workload win does not imply universal superiority.

Keep one scorecard for the declared supported configuration: useful-answer pass rate, p50/p95 time to first durably published output, p95 visible output gap, accepted published tokens per second, completed requests within the latency budget, sustained availability, recovery and complete resource cost. Separate cold acquisition, warm loading and resident service. Compare the same model and machines where possible; separately compare task outcomes within equal resource budgets. Count failures and rejected demand. A claimed advantage needs a predeclared consequential gain with uncertainty reported and no breach of the quality, reliability or latency regression limits.

Comparison acceptance stays in DR-6; [REP-14](roadmap/requirements.md#rep-14) adds service economics and dependable supply. [REP-13](roadmap/requirements.md#rep-13) owns the first overnight earn/use proof. The following canonical IDs remain explicitly optional or later, without becoming community-release dependencies:

- Quantization: [DOP-4](roadmap/requirements.md#dop-4), [DOP-7](roadmap/requirements.md#dop-7).
- Optional compiler/provider work: [DOE-1](roadmap/requirements.md#doe-1), [DOE-2](roadmap/requirements.md#doe-2), [DOE-3](roadmap/requirements.md#doe-3), [DOE-4](roadmap/requirements.md#doe-4), [DOE-5](roadmap/requirements.md#doe-5), [DOE-6](roadmap/requirements.md#doe-6).
- Optional integration comparisons: [DD-1](roadmap/requirements.md#dd-1), [DD-2](roadmap/requirements.md#dd-2), [DD-3](roadmap/requirements.md#dd-3), [DD-4](roadmap/requirements.md#dd-4), [DD-5](roadmap/requirements.md#dd-5), [DD-6](roadmap/requirements.md#dd-6).
- Optional native provider: [ER-1](roadmap/requirements.md#er-1), [ER-2](roadmap/requirements.md#er-2), [ER-3](roadmap/requirements.md#er-3), [ER-4](roadmap/requirements.md#er-4), [ER-5](roadmap/requirements.md#er-5).
- Later independently evaluated improvement: [ALL-8](roadmap/requirements.md#all-8), [ALL-9](roadmap/requirements.md#all-9). Persistent permissioned work and evaluated improvement remain the progression, not launch gates.

*Last updated: October 2026*
