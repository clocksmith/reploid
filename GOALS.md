# Reploid Goals

## Operating mission

Owner clarification, November 22, 2026: the target is an inference exchange.
Contributors earn credits by serving others, then spend them from the same
account on pooled compute they cannot supply alone.

Pooled-capacity proof, not the bar for every request: from a browser that downloads
zero weights, a developer runs a private coding task on a pinned model that
neither participating machine can complete alone at the required context and
precision, and the output matches a larger single-host reference. Before
dispatch, Reploid discloses the maximum charge, which host runs which stage, who
reads the plaintext prompt, and which intermediates or metadata are visible, and
it refuses routes outside policy. Signed receipts prove the model identity, each
host's work, the requester's debit and the providers' rewards without exposing
the prompt. Across retries, cancellations, late receipts or a split host that
silently disappears, the ledger finalizes by a stated deadline, with no double
charge, double reward or stranded hold, and it reports host cleanup it could not
verify.

Implementation boundary: this is a target, not a qualified capability. No split
route is qualified for public use, the solo-failure and split runs on the pinned
model have not been performed, and earn-then-spend from one account is not yet
verified end to end. "Private" means the requester approved a disclosed route
and Reploid enforced it. The executing hosts read what their stage needs, so do
not describe a request as confidential from them.

Owner clarification, November 10, 2026: participating computers should retain
their identities, earn credit for serving and spend credit for requesting;
negative balances are permitted for now. Pool contribution using hardware limits,
owner-selected models and observed demand.

Implementation boundary: the first fleet exchange uses explicit non-cash service
credits. It does not convert purchased balances, activate cash
payouts or qualify model arithmetic. Existing financial obligations remain intact.

Owner clarification, November 4, 2026: show available shared models first and
let visitors choose and use them before downloading anything. Model selection
prioritizes mesh capacity, with the same presentation on desktop and mobile.
Local downloads and contribution remain separate, secondary choices; selection
does not authorize a download or disclose a message.

Owner clarification, October 30, 2026: replo.id turns participating computers
into shared AI inference capacity, with the goal of exchanging or selling the
tokens they produce. Device contribution shows what this computer can run and
its measured production. Owner clarification, November 6, 2026: contribution
setup and history live under Computers, separate from chat; preferences live in
Settings. Navigation, drawer and transition layout follow the
[Poolday design system](docs/style-guide.md#poolday-design-system). After reviewed
initial setup, sharing stays on while the site is open. Pause is secondary. Resource limits and technical detail stay in
disclosures. Earnings appear only when accounting records support them.
Use the shared UI catalog for every element and clearly separate local UI
simulations from real production. Keep product copy brief.

Reploid coordinates access to exact models through authorized participating
computers. A model has a stable service identity while prepared providers, model
pieces and execution routes may change. Users retain independent conversations;
contributors need not manually operate layers or rooms. This is the intended
service, not a claim that interruption-free execution or product fit is established.
Preserved conversation history is distinct from recovered inference state.

Automatic routing may prefer a qualified whole-model route. An explicitly requested
split may use a qualified split route even when a whole-model host fits. Never
change the recipient set or route type silently. This is a target policy, not a
claim that the chooser already supports it. Independent retrieval jobs, whole-model
requests and partitioned inference have separate acceptance and economic evidence.

Participants control contribution, disclosure, resource limits and stopping.
Model identity, accepted permissions, deadlines and spending bounds constrain
routing. Hosted fallback requires authorization; otherwise unavailable capacity
means explicit waiting or failure. Provider changes cannot silently widen disclosure
or substitute a different model. Independent conversations retain their history,
permissions and attempt ownership.

Qualify complete service behavior: acquisition, preparation, streaming, follow-ups,
cancellation, bounded queues, departure, retry and recovery. Compare useful outcomes
against feasible alternatives, including conventional coordination on equivalent
resources. Count preparation, idle residency, communication, failed work, owner
intervention and complete costs. Infrastructure activity and numerical parity alone
do not establish useful answers, service advantage or customer demand.

The [product specification](docs/product-specification.md) preserves public service
and financial requirements, including nonexpiring balances, owner limits and quoted
terms. Existing accepted obligations remain binding. Requirements for credits,
Community Access, retrieval and accounting do not establish their implementation or
require every experimental service to activate them. Their acceptance stays separate.
The owner's private roadmap selects current work; this document grants no new
campaign, spending or marketplace activation.

Reploid coordinates; Doppler defines and executes model computations. Poolday
supplies participation and authorized data-transfer infrastructure. Zero and X retain
their research scope. Research capabilities below do not select customer workloads.

Poolday turns available consumer hardware into useful inference capacity that
people can exchange or sell. Machines combine when that unlocks capacity, improves
measured economics, or the requester explicitly asks for a split route. Production
is proven before monetization. On a few models
and representative machines, measure output quality, prompt processing, delivered
tokens per second, memory, loading cost and recovery after a contributor leaves.
Compare whole-machine and distributed execution against credible alternatives.
Keep peak capacity, sustained throughput and customer demand separate. Exchange
and payment follow that proof. The interface shows what each machine runs, shares,
produces and earns.

## Intended Beneficiaries

Humans and agents pursuing objectives should gain access to complementary
models, resources, and expertise without surrendering control of their data,
devices, or evolving software. Contributors should understand what they offer,
what it costs, and how to stop. Application developers should compose the
browser library without inheriting a particular interface or credential system.

## Desired Outcomes

1. Enable people and agents to use intelligence beyond one participating device's
   practical capacity. Participation provides an otherwise unavailable capability,
   better results, greater reliability, or lower total resource cost, including
   through parallel investigations by complementary agents.
2. Combine compatible machines to provide otherwise unavailable execution
   capacity, or when a requester explicitly chooses a qualified split route.
   Qualify each advance with identified artifacts, declared numerical tolerances,
   and measured correctness, latency, allocation budgets, and availability.
3. Reuse verified content and reduce repeated acquisition. Retain complementary
   shards and deliberate replicas according to capacity, demand, permissions,
   availability, and observed costs.
4. Present a visible, controllable intelligence network. Objectives, participants,
   execution, results, and evaluated changes should stay connected. Keep default
   screens uncluttered, copy brief, and detailed settings progressively disclosed.
   Use shared components and design tokens, consistent spacing, accessible light
   and dark themes, responsive scrolling, and futuristic optical styling (glass
   surfaces, spectral edges, a dot-grid page) rather than decorative activity or
   obstructive motion.
   The secondary demo's conversations are concurrent and independently owned: each thread retains its
   purpose, history, permissions and execution state. No global objective owns
   the workspace. Participants use models supplied by the mesh without needing
   a complete model on every requesting device. A prepared remote route
   requires no requester weights. A local + peer split loads only the requester's
   own shard, and local solo loads the full model. Contribution preparation happens
   separately.

Model capabilities include generation, retrieval and decision/scoring operations
through Doppler. A semantic score or model judgment cannot grant permission,
qualify execution or authorize adoption; those remain application/operator controls.

## Current implementation sequence

The owner's private roadmap owns the capped validation sequence and exposure
limits. Existing launch numbers and acceptance records are retained references,
not an automatic expansion queue. Marketplaces, payouts, speculative blocks,
broad model support and self-improving placement are paused. Long-term outcomes
and research below do not authorize concurrent work. Existing user obligations
and necessary correctness/security repairs remain separately governed.

## Operating Loops

Problem solving establishes success criteria and grants, plans subtasks, selects
models and collaborators, executes, inspects outcomes, and revises unsuccessful
approaches. Strategies share an execution lifecycle rather than introducing
competing agent loops.

Keep weight-shard storage, whole-request inference, computational partitions,
and agent subtasks as distinct mechanisms, then optimize their cooperation.
Their implementation ownership and interfaces belong in component CATSCANs.

Bayesian coordination estimates workload-specific completion, latency, transfer
costs, and approach effectiveness. Apply permissions and resource constraints
before ranking eligible actions by expected task value after total costs.
Preserve uncertainty and observation provenance; duplicated evidence does not
count as independent experience.
Evaluate information-seeking decisions rather than assuming exploration helps.
Specific distributions and scheduling experiments belong in the technical plan.
This is retained research intent; self-improving placement remains paused under
the current validation boundary.

## Strategic Constraints

Compare network outcomes against the strongest feasible local alternative and,
separately, centralized coordination on equivalent resources. Count communication,
verification, failed attempts, and human intervention. Report inconclusive results.

Custody, execution, intermediate disclosure, and adoption require distinct grants.
Permissions and application-controlled allocation budgets are hard eligibility
constraints. Cancellation requires explicit settlement; it does not promise
immediate GPU termination. Authorized runtime operation does not depend on CI.

## Long-term research

This is a research direction, separate from the operating mission above and not a
product commitment or claim. It does not change the consumer service's acceptance.

Coordinate and evolve distributed intelligence: a peer-to-peer network of agents
combines participating devices' model storage, GPU memory, WebGPU computation, and
problem-solving capabilities to solve useful problems and improve how individual
agents and the swarm operate. Independent operation remains possible. Browser and
native participants use the same library contracts, with host support qualified
separately.

Self-improvement: improve prompts, tools, planning, placement, caching, and the
algorithms governing those decisions. Demonstrate independently evaluated
improvements that transfer to unfamiliar subsequent tasks. Separately demonstrate
causal recursion: B improves on A, and B's changed machinery contributes to producing C.
Improvement proposes a candidate, compares it with an identified baseline under
protected independent evaluation, then adopts or rejects within explicit,
reversible operator grants. Retain failures and rollback paths. Model-weight
changes require their own execution and evaluation contracts.

The research completion question is whether participating agents accomplish more,
or accomplish it better, after accounting for communication, failures, evaluation,
and resource limits.

## Explicit Exclusions

Peer count, signatures, reproduction, adoption, and polished interfaces alone
establish neither correct computation nor intelligence. Whole-job execution does
not establish partitioning. These goals are targets, not claims that the integrated
system works today. Preserve separate scientific and commercial acceptance boundaries.

Execution contracts: [open mesh architecture](docs/open-mesh-architecture.md).
Authority and qualification: [INTENT.md](INTENT.md), [CATSCAN.md](CATSCAN.md),
the [product contract](docs/product-specification.md), and the
[claim index](docs/status/surface-claim-index.json).

*Last updated: November 2026*
