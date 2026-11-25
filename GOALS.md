# Reploid Goals

Reploid's **long-term product goal (north star)** is **confidential split
inference paid for with earned compute credits**. The unique value is **pooled
capacity without pooled trust**: run a model no participating GPU can fit
alone, across independently operated machines, without giving their operators
the prompt, intermediate state, or answer; pay for it with compute you
contributed; and let an outsider independently reproduce the debit and payouts.
The **ordinary inference exchange** (whole-model and non-confidential split
routes) is the **first launch**, so the broader pilot moves forward rather than
blocking on confidential-compute breakthroughs.

## Operating mission

**One hard bar for the long-term product goal (missing today).** A rented
enclave demo, a slow encrypted toy, and a plaintext split are stepping
stones—none proves the combined capability. Before freezing the test, **settle
the no-signed-Stop policy**. One end-to-end run must establish all four
conditions together in the same request:
1. **Earn by serving someone else.** A participant first earns spendable
   credits by serving another user's request.
2. **Spend on one confidential pooled split that proves usefulness, not just
   fit.** From a browser that downloads zero weights, that same account spends
   its earned credits on one confidential inference request split across
   independently operated GPUs where the **same pinned workload fails solo on
   every participating GPU for a measured memory reason**, and the confidential
   split **beats the best single-host CPU offload baseline** while meeting
   **frozen latency and answer-quality limits** (disqualifying a slow encrypted
   toy).
3. **Named privacy guarantee + independent security review (no silent
   weakening).** Name the privacy mode and its trust assumption explicitly:
   **attested execution** trusts approved hardware and code; **secret sharing**
   trusts peers not to collude. Both are useful milestones, but **neither may
   silently pass as `homomorphic` (computing on encrypted data with a
   requester-held key)**. Require an
   **independent security review** (a visibility trace alone does not establish
   secrecy), with pre-dispatch disclosure and fail-closed refusal on policy or
   privacy failure.
4. **Correct answer + outsider-reproducible settlement (from that same run):**
   - **Correct answer** matching a larger single-host reference at the pinned
     model, context, and precision, within the frozen quality limits.
   - **Outsider-reproducible debit and payouts:** an outsider independently
     reproduces the requester's earned-balance debit within cap and each
     operator's payout from signed records without exposing the prompt.
     **Signatures verify what was signed (terms, acknowledgments, identity,
     and accounting), not that the underlying computation was honest.**
- **Across failures,** including retries, cancellations, late receipts, or a
  split host that silently disappears, the ledger finalizes by a stated
  deadline with no double charge, double reward, or stranded hold, and reports
  any host cleanup it could not verify.

This is the unified bar for the long-term product goal, not the minimum bar for
every route or for the first launch. The
[product contract](docs/product-specification.md#5-contribution-and-execution)
defines the four routes and their qualification: local solo, remote solo, local +
peer split, and remote-only split. Solo failure for a measured memory reason is
required for the larger-than-either-host capacity claim, not for qualifying
every ordinary split route.

**Where it stands.** This is an unmet long-term target, not a qualified
capability.
- No split route—and no confidential split route—is qualified for public use.
- Prior stepping stones (plaintext split earn/spend runs that fit solo on one
  machine, and separate non-colluding secret-sharing prototypes) do not prove
  the combined capability.
- The first fleet exchange uses explicit non-cash service credits. It does not
  convert purchased balances, activate cash payouts, or qualify model
  arithmetic. Existing financial obligations remain intact.

On **plaintext routes**, "private" means only that the requester approved a
disclosed route and Reploid enforced it: executing hosts still read what their
stage needs, so never describe a plaintext request as confidential from them.
Confidentiality from individual GPU operators requires an independently
security-reviewed confidential split backend qualified on that exact route,
with its protection and trust assumption (`attested` hardware/code,
non-colluding `secret-sharing`, or `homomorphic` with a requester-held key)
stated explicitly. Evidence is in the
[claim index](docs/status/surface-claim-index.json).

## The service

- **Accounts.** Participating computers keep their identities, earn credit for
  serving and spend credit for requesting. Negative balances are permitted for now.
  Contribution is pooled within hardware limits, owner-selected models and observed
  demand.
- **Models first.** Visitors see the available shared models first and can use them
  before downloading anything. Model selection prioritizes mesh capacity, with the
  same presentation on desktop and mobile. Local downloads and contribution are
  separate, secondary choices. Selecting a model does not authorize a download or
  disclose a message.
- **Contribution.** A computer's page shows what it can run and what it has
  produced.
  - Setup and history live under Computers, separate from chat, and preferences
    live in Settings.
  - After reviewed initial setup, sharing stays on while the site is open, and Pause
    is secondary.
  - Resource limits and technical detail stay in disclosures.
  - Earnings appear only when accounting records support them.
- **Interface.** It follows the [Poolday design system](docs/style-guide.md#poolday-design-system):
  - Use the shared UI catalog for every element.
  - Keep copy brief.
  - Separate local UI simulations clearly from real production.
- **Exact models at a stable identity.** A model keeps its service identity while
  prepared providers, model pieces and execution routes change.
  - Users keep independent conversations.
  - Contributors need not operate layers or rooms.
  - Preserved conversation history is distinct from recovered inference state.
  - This describes the intended service, not a claim that interruption-free
    execution or product fit is established.
- **Routing and control.**
  - Routing follows the policy in [INTENT](INTENT.md#invariants).
  - Participants control contribution, disclosure, resource limits and stopping.
  - Model identity, accepted permissions, deadlines and spending bounds constrain
    routing.
  - Hosted fallback requires authorization; otherwise unavailable capacity means
    explicit waiting or failure.
  - A provider change cannot silently widen disclosure or substitute a different
    model.
- **Production before payment.** Machines combine when that unlocks capacity,
  improves measured economics, or the requester asks for a split route.
  - On a few models and representative machines, measure output quality, prompt
    processing, delivered tokens per second, memory, loading cost and recovery after
    a contributor leaves.
  - Compare whole-machine and distributed execution against credible alternatives.
  - Keep peak capacity, sustained throughput and customer demand separate.
  - Exchange and payment follow that proof.
- **Qualify the whole service.** That covers acquisition, preparation, streaming,
  follow-ups, cancellation, bounded queues, departure, retry and recovery.
  - Count preparation, idle residency, communication, failed work, owner
    intervention and complete costs.
  - Infrastructure activity and numerical parity alone do not establish useful
    answers, service advantage or customer demand.

The [product specification](docs/product-specification.md) keeps the public service
and financial requirements, including nonexpiring balances, owner limits and quoted
terms. Accepted obligations remain binding. Those requirements do not establish
their implementation or require every experimental service to activate them. The
owner's private roadmap selects current work. This document grants no campaign,
spending or marketplace activation.

**Who owns what.** Doppler defines and executes model computations. Reploid
coordinates discovery, permissions, placement, custody and accounting. Poolday is
the internal name for Reploid's product code; see the
[glossary](docs/glossary.md). Zero and X are separate research workspaces.

## Intended beneficiaries

People and agents gain access to complementary models, resources and expertise
without surrendering control of their data, devices or evolving software.
Contributors understand what they offer, what it costs and how to stop. Application
developers can compose the browser library without inheriting a particular
interface or credential system.

## Desired outcomes

1. **Capacity beyond one device.** Participation provides an otherwise unavailable
   capability, better results, greater reliability, or lower total resource cost.
2. **Combined machines.** Compatible machines combine to provide otherwise
   unavailable execution capacity, or when a requester explicitly chooses a qualified
   split route. Each advance is qualified with identified artifacts, declared
   numerical tolerances, and measured correctness, latency, allocation budgets and
   availability.
3. **Reused content.** Verified content is reused rather than acquired again.
   Complementary shards and deliberate replicas are kept according to capacity,
   demand, permissions, availability and observed costs.
4. **A visible, controllable network.** Objectives, participants, execution and
   results stay connected.
   - Default screens stay uncluttered, and detail is progressively disclosed.
   - Conversations are concurrent and independently owned, each with its own purpose,
     history, permissions and execution state.
   - A prepared remote route requires no requester weights. A local + peer split
     loads only the requester's own shard. Local solo loads the full model.
     Contribution preparation happens separately.

Model capabilities include generation, retrieval and scoring through Doppler. A
score or model judgment cannot grant permission, qualify execution or authorize
adoption; those remain application and operator controls.

## Current sequence

The owner's private roadmap owns the capped validation sequence and exposure
limits. Marketplaces, payouts, speculative blocks, broad model support and
self-improving placement are paused. Nothing in the research track below
authorizes concurrent work. User obligations and necessary correctness and security
repairs are governed separately.

## Strategic constraints

- Compare network outcomes against the strongest feasible local alternative and,
  separately, against centralized coordination on equivalent resources.
- Count communication, verification, failed attempts and human intervention.
- Report inconclusive results.
- Custody, execution, intermediate disclosure and adoption require distinct grants.
- Permissions and application-controlled allocation budgets are hard eligibility
  constraints.
- Cancellation requires explicit settlement; it does not promise immediate GPU
  termination.
- Authorized runtime operation does not depend on CI.

## Separate research track: Zero and X

This research is not part of the exchange's goal, not a product commitment, and
paused under the current validation boundary.
- **Distributed intelligence.** Agents across participating devices combine model
  storage, GPU memory, WebGPU computation and problem solving, and improve how
  individual agents and the swarm work. Independent operation remains possible.
  Browser and native participants use the same library contracts, with host support
  qualified separately.
- **One execution lifecycle.** Problem solving sets success criteria and grants,
  plans subtasks, selects models and collaborators, executes, inspects outcomes and
  revises. Weight-shard storage, whole-request inference, computational partitions
  and agent subtasks stay distinct mechanisms; their interfaces belong in component
  CATSCANs.
- **Coordination.** Bayesian estimates of completion, latency, transfer cost and
  approach effectiveness. Permissions and resource constraints apply before ranking.
  Uncertainty and provenance are kept, and duplicated evidence does not count as
  independent experience.
- **Self-improvement.** Improve prompts, tools, planning, placement, caching and the
  algorithms behind them.
  - Improvements must be independently evaluated and transfer to unfamiliar
    tasks.
  - Causal recursion is shown separately: B improves on A, and B's changed machinery
    helps produce C.
  - Candidates are compared with an identified baseline under protected evaluation,
    then adopted or rejected within explicit, reversible operator grants.
  - Model-weight changes need their own execution and evaluation contracts.

The research question is whether participating agents accomplish more, or better,
after accounting for communication, failures, evaluation and resource limits.

## Exclusions

Peer count, signatures, reproduction, adoption and polished interfaces alone
establish neither correct computation nor intelligence. Whole-job execution does
not establish partitioning. These goals are targets, not claims that the integrated
system works today.

Execution contracts: [open mesh architecture](docs/open-mesh-architecture.md).
Authority and qualification: [INTENT.md](INTENT.md), [CATSCAN.md](CATSCAN.md), the
[product contract](docs/product-specification.md) and the
[claim index](docs/status/surface-claim-index.json).

*Last updated: November 2026. Folds in the owner's clarifications of 30 October,
4, 6, 10 and 22 November 2026; earlier wording is in git history.*
