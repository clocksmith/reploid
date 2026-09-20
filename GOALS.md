# reploid goals

## Mission & Thesis

Reploid’s intended product is a distributed intelligence system: a swarm of agents that pools models, memory, and computation across participating computers. Poolday provides peer coordination and WebRTC connections; Doppler executes model computations through WebGPU.

The network shares both model storage and inference. Computers retain different weight shards, avoiding redundant downloads. Execution can assign complete requests to peers or divide a model into compatible layers or experts. Intermediate results move between participating machines, allowing collective resources to support models beyond one device’s capacity. Storage shards and computational partitions remain distinct.

Agents coordinate above that execution layer. They divide objectives, recruit peers, run complementary investigations, and combine results. The system should choose when parallel agents, remote inference, or local execution actually helps rather than multiplying activity indiscriminately.

Bayesian inference guides those choices. Each agent updates probabilistic estimates of peer reliability, execution time, resource availability, and approach effectiveness from observed outcomes. Decisions balance expected benefit, communication costs, and useful uncertainty reduction.

Evolution changes both individual agents and collective behavior: planning, tools, model placement, caching, and collaboration strategies. Peers evaluate and exchange improvements under participant permissions.

The experience is a visible, controllable intelligence network that learns how to use its distributed resources more effectively.

## Intended Beneficiaries

Users need agents that can pursue real goals without making them accept uncontrolled changes. Application developers need a configurable browser library rather than UI-bound infrastructure. Evaluators and adopters need candidate histories, honest comparisons, and reversible decisions that do not disrupt the active system while an experiment is running.

## Desired Outcomes

1. Provide independently useful agents with configurable intelligence, peer coordination, persistence, and improvement boundaries.
2. Keep reusable behavior in packages/reploid and application composition in its owning surfaces.
3. Distinguish artifact distribution, whole-job delegation, Doppler-defined partition execution, and agent subtasks.
4. Partition a small model across two devices and compare correctness, total communication cost, cancellation, and participant loss with unsplit execution.
5. Demonstrate a causal A-to-B-to-C improvement chain: B must improve held-out work, and B's improved machinery must contribute to producing C.

## Operating Loops

Run ordinary work within admitted authority. Maintain inspectable uncertain beliefs about completion, latency, failure causes, and candidate benefit, with identified priors, likelihoods, and evidence provenance. Correlated observations are not independent trials. Separately, propose changes to planners, belief updaters, scheduling, or problem-solving machinery; evaluate protected work and frozen controls; retain failures; and adopt only under an operator grant or bounded preauthorized policy. Count readback, serialization, transfer, upload, failures, and human help.

## Strategic Constraints

Doppler owns model mathematics, executable partitions, tensor contracts, and state ownership; Reploid owns placement and coordination through Poolday. Placement cannot change learned expert selection or model semantics. Intermediate disclosures require authorization. Preauthorized adoption fixes targets, criteria, budgets, expiry, and rollback; candidates cannot change that policy or protected evaluators. Ordinary granted runtime activity does not require CI or a manual release. Ancestry, posterior updates, fixed-model inference, and signed receipts do not alone establish improvement. Preserve alternative scientific and commercial proofs in [GOVERNANCE_DETAILS.md](GOVERNANCE_DETAILS.md).

## Explicit Exclusions

Do not substitute infrastructure health, agent activity, or demonstrations for the user's goal. Do not infer working model partitions from stored shards or whole-job delegation. Do not weaken acceptance to admit a candidate, conflate ordinary Bayesian adaptation with recursive self-modification, or present reproduction alone as improvement.

Related: [INTENT.md](INTENT.md), [CATSCAN.md](CATSCAN.md).

<a id="reploid-goals"></a>
<a id="product-aim"></a>
<a id="the-collaborating-agent-system-is-the-product"></a>
<a id="two-connected-loops"></a>
<a id="distribution-and-learning"></a>
<a id="component-responsibilities"></a>
<a id="recursive-improvement-as-the-primary-milestone"></a>
<a id="separation-of-rsi-and-agi"></a>
<a id="current-supported-boundary"></a>
<a id="falsifiable-first-proofs"></a>
<a id="primary-proof-evolving-problem-solving-agent-and-recursive-improvement"></a>
<a id="supporting-capability-proof-poolday-peer-network-and-doppler-runtime"></a>
<a id="alternative-proof-change-passport"></a>
<a id="scientific-proof-room-1"></a>
<a id="initial-users-and-market-constraints"></a>
<a id="research-room-ux"></a>
<a id="research-room-evidence-before-architecture"></a>
<a id="research-room-evidence-architecture"></a>
<a id="measurement"></a>
<a id="zero-x-and-improvement-authority"></a>
<a id="competitive-baseline-and-compounding-value"></a>
<a id="decision-rule"></a>
<a id="authority-and-supporting-references"></a>

Detailed requirements: [GOVERNANCE_DETAILS.md](GOVERNANCE_DETAILS.md).
