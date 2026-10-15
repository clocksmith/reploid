# Reploid product contract

**Ask, explore and figure things out. Earn access on your computer, or pay as you go.**

**Reploid Product Economics Contract v1.3**, identity `reploid.product-economics/1.3.0`
(2026-10-15). These are the public terms that every quote and receipt binds: the
service record, Community Access, credits and settlement, answer quality, and
contribution and disclosure. Version 1.3 keeps the user-facing rights and
obligations of v1.2.1 unchanged and moves the business plan, funding decisions,
economic tests and roadmap into the owner's private planning documents; earlier
versions remain in Git history. [GOALS.md](../GOALS.md) and [INTENT.md](../INTENT.md)
hold Reploid's direction and invariants, and the [architecture](open-mesh-architecture.md)
describes the mechanisms.

MUST denotes a requirement, not implementation or economic proof. Credit quotes,
rewards, redemption and solvency remain unimplemented or unproven unless separately
evidenced. Resource allowances and signed execution do not establish a credit economy.

Version this contract independently of applications, models and Doppler packages.
Every quote and receipt MUST bind its exact version and immutable document revision.
Material changes to accepted rights/obligations require a major version and newly
accepted terms; additive requirements use a minor version, clarifications a patch.
Preserve prior versions and receipts; never apply new policy retroactively.
Explicitly labeled proposed defaults remain recommendations, not adopted policy.

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

Nominal credit balances are not guaranteed dollar-redemption liabilities.

## 4. Consumer utility

The complete initial consumer product MUST support asking questions, comparing
options, connecting information, developing ideas, explanations, supplied-material
summaries and retrieval-backed investigations with supporting citations,
plus persistent conversations and follow-ups.

Questions, summaries and retrieval-backed answers MUST have distinct frozen
quality policies. Assess factual correctness and completeness, summary fidelity
to supplied material, and search claims supported by valid citations. Independent
whole-answer review MUST include false additions and identify its review method.
The reviewer must be independent of task/check authoring and candidate tuning;
self-review does not satisfy this gate. Assessment authority must also be
independent of provider reward interests, with declared uncertainty handling and
no retrospective rewriting of evaluation criteria.
Only answers that pass the applicable quality policy
and arrive within their declared deadline count as successful. Failed attempts,
retries and duplicate work stay in total costs. Numerical parity alone does not
establish satisfactory answers.

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

**Retrieval permission.** The current search grant reads exactly: "Allow Reploid to
send this search query to Brave and share retrieved passages with the listed
execution contributors for this answer. Your files and unrelated conversation
history are excluded." This Brave-specific grant does not authorize other providers
or broader context; route-specific disclosure must identify the actual fetch
operator and approved synthesis context.

*Last updated: October 2026*
