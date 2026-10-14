# Reploid product specification

The user's seven-section product definition is preserved below. It supersedes the
six-section draft. This is intended behavior, not implementation or qualification
proof. [ROADMAP](../ROADMAP.md) sequences delivery; the
[canonical requirements](roadmap/requirements.md) retain scoped acceptance.
The open decisions after section 7 are not silently resolved by implementation.

**Earn on your computer. Use AI anywhere.**

## 1. Product

Reploid is a network where people contribute useful computing resources, earn inference credits, and redeem them for AI services from any device.

Users can contribute, purchase credits, or use Community Access independently and at any time. No subscription is required.

The network is the product. A participant can contribute storage, computation, or both. Requesters should eventually access models larger than their own devices can store or execute.

## 2. Community Access

Community Access provides ongoing free AI usage funded by donors, participating operators, and reserved community resources.

It is a permanent service category, not an introductory trial or promotional credit allocation.

Available capacity is distributed through fair queues, usage limits, and abuse controls. If capacity is exhausted, users can queue or retry. A guaranteed minimum requires committed funding and supply.

Community Access does not create transferable credits merely for registering.

## 3. Credits and marketplace

Earned and purchased credits never expire.

Credits represent redeemable service value, with transparent execution quotes and settlement. Credit balances, acquisition prices, redemption prices, and eventual marketplace exchange rates are independent quantities.

The ledger must prevent double spending, duplicate rewards, fabricated contributions, and incorrect settlement. Failed or canceled requests receive appropriate refunds.

Design for transferable balances from the beginning. Introduce account transfers and eventually an optional marketplace where participants buy, sell, and exchange credits at market-determined rates, subject to necessary legal and financial controls.

## 4. Consumer utility

Launch with everyday questions, explanations, summaries, and search-backed answers.

Search-backed answers must use retrieval and cite supporting sources. Consumer chat is the primary interface; developer APIs eventually redeem capacity through the same execution and accounting infrastructure.

Coding workflows and specialized vertical applications follow proven general utility.

A positive credit balance does not guarantee immediate execution. Users receive clear capacity, queue, and failure information.

## 5. Contribution and execution

Reploid coordinates participation, admission, scheduling, accounting, and settlement. Doppler verifies and executes prepared model capabilities.

Contributors control schedules, power consumption, GPU memory, bandwidth, and foreground responsiveness. Small useful contributions remain welcome.

Reward validated, demanded computation or explicitly contracted readiness. Idle machines should sleep when continued availability offers no useful service.

Reuse prepared model weights, batch compatible requests, and minimize unnecessary transfers. Support distributed model storage and progressively qualify inference across participating machines.

Remote executors must be treated as recipients of whatever request information is disclosed to them. Require authorization for workplace computers and networks.

## 6. Required economic advantage

Reploid must demonstrate lower complete cost per satisfactory answer, lower energy per satisfactory answer, or both, against feasible alternatives at comparable quality, latency, availability, and permissions.

Investigate achievable efficiency before selecting performance thresholds.

Measure separately:

- Total cost, including hardware, depreciation, energy, cooling, networking, failures, and contributor compensation.
- Total energy, including preparation, idle residency, execution, and transfers.
- Answer quality, reliability, latency, and successful completion.

Subsidies can improve user prices but cannot establish underlying economic efficiency.

## 7. Bootstrap and proof

Begin with a modest fleet of AMD and Apple Silicon machines. Record actual operating costs and treat the fleet as one failure domain.

Expand participation only when measured demand and service economics justify it.

**First proof:** A contributor offers resources overnight, receives settled credits for useful service, and redeems them for satisfactory inference from another device the following day.

Measure the complete transaction, including cost and energy, against a comparable alternative.

After proving reliability, pursue independent adoption and possible OpenRouter distribution. Neither marketplace launch nor external platform listing is required for the first product.

## Decisions and execution boundary

| Decision | State and owner |
| --- | --- |
| Community Access guarantee | Open, user: queue/retry when donated capacity is exhausted, or reserve operator-funded basic capacity. No guaranteed answer without committed funding and supply. REP-9 owns implementation after the choice. |
| Initial reward eligibility | Open, user: compensate explicitly contracted verified storage/readiness even without inference, or initially pay only for completed inference. REP-11 must not silently enable a reward category. Ordinary unrequested storage/online presence earns nothing. |
| Account transfers | Open, user: direct account transfers at launch or later with the marketplace. REP-10 designs transferable balances and provenance now; activation awaits the choice and applicable controls. Nonexpiration is settled. |
| Recipient eligibility | Open, user: participating computers under informed disclosure, or approved operators for sensitive conversations until stronger protections qualify. DR-3 owns eligibility; existing revocable permission is not a decision on this policy. |
| First distributed proof | Earlier adopted direction requires one model partitioned across multiple machines, not only a complete model on a remote host. DR-5/DR-6 preserve the current three-stage qualification. Each executor serves its assigned portion; the requester downloads no weights. A demonstration that no executor holds the entire model additionally requires inventory/selective-acquisition evidence. Separately authorized full-model storage seeds remain supported under REP-5. |

A complete remote-model request remains a useful control and eligible service path;
it does not establish partitioned inference. Existing receipts retain their exact
model/runtime/package/placement scope. This specification starts no replacement
numerical campaign and declares no new acceptance.

*Last updated: October 2026*
