# Poolday executable-intelligence network plan

Status: selected strategy; connected network completion remains unproved
Strategy unit: Doppler plus Poolday and Reploid  
Network owner: Reploid through Poolday

## Outcome

Build a network that improves problem solving and the organization of its own
computation through participation. Doppler defines and executes valid model
partitions; Reploid places eligible work and learns from observations; Poolday
provides authorized transfers and recovery.

Run one product with three distinct distribution mechanisms: model storage,
model computation and agent work. Whole-job remote execution is one option;
Bayesian learning should improve decisions across these mechanisms. Additional participants must
improve availability or useful capacity after coordination costs. Reviewed
history must improve held-out decisions beyond a competent frozen scheduler.
Free usefulness counts; payment is not a technical acceptance gate.

## Existing whole-job boundary

Generalize `model identity + operation + input + limits + acceptance rule` for
`generate`, `embed`, `rerank`, and `encodeSequence`. Each operation owns input and
output validation, streaming, cancellation, and comparison. Discovery,
assignment, transport, retry, accounting, and evidence remain generic. Adding a
fifth operation requires an adapter, not changes to networking. Unknown
operations fail explicitly. A receipt is completion evidence, not acceptance.

Preserve the existing sequence lane while qualifying additional exact Packs.
Generation stays on one peer for the complete attempt, including streaming and
working state. A retry never splices another peer's unfinished answer into it.
Embeddings and reranking can distribute independent complete batches.

## First collective-improvement demonstration

1. Execute a small model split across two devices through a public Doppler
   partition contract. Compare with the same model unsplit, including numerical
   correctness, full communication costs, cancellation and participant loss.
2. Let agents observe a recurring inefficiency, generate a permitted scheduling
   or problem-solving change and evaluate it on unfamiliar work. Another
   participant receives the candidate, independently evaluates it and benefits
   after adoption under its own grant.
3. Compare the changed machinery enabled and disabled while producing another
   improvement, keeping models, resources, evaluator access and assistance
   comparable. Another patch or posterior update alone is not recursive proof.

These experiments are active development targets. Neither whole-job success,
tool-repair completion nor a new UI is a prerequisite to starting the bounded
partition implementation. The interface preserves the causal connection between
agents, models, shared execution, contributions, weaknesses, changes and outcomes.

## Existing application workload

Run a free local document/research assistant continuously: acquire models,
embed a corpus, rerank retrieved passages, and generate referenced answers.
It works without a room. Joining optionally adds model delivery and explicitly
delegated public-collection jobs. Private inputs stay local by default.
ESM-2 is a second, different workload and remains the existing physical-execution
control. It is not the organizing principle for model admission.

## Authority split

| Authority | Owner |
| --- | --- |
| Model semantics, valid partitions, tensor contracts, numerical requirements, state ownership and execution | Doppler |
| Peer discovery, authorized artifact/activation transfer, job delivery and recovery | Poolday |
| Eligible placement, agent coordination, Bayesian beliefs, budgets and candidate improvement mechanisms | Reploid library |
| Credentials, disclosure grants, evaluator isolation and bounded adoption policy | Application/operator |
| Optional source-to-hardware execution implementation | Doe, only after separate qualification |
| Application or requester acceptance | The requester |

Doppler's application adoption does not prove network demand. Poolday activity
does not prove reusable intelligence. A Doe receipt does not prove Doe adoption
or honest peer execution.

## Current boundary

Poolday currently assigns complete Doppler workloads to selected declared
provider identities, transports job payloads and receipts over WebRTC, compares
signed results, and records requester acceptance. Reploid can retain immutable
evidence and project policy-admissible decision memory. Adapter artifact
delivery exists through governed cache, peer, and origin paths.

The retained [single-machine ESM-2 episode](../status/esm2-peer-pack-2026-09-05/README.md)
establishes actual signed Pack reconstruction and physical-browser execution
over RTCDataChannels with corruption and departure. It has one internal
operator and isolated browser contexts. It does not establish independent
machines, a production persistent cache, or a delegated remote-job network.

The following remain unproved:

- peer reconstruction and execution on independently operated machines;
- a deployed discovery and seeder network for those Packs;
- origin-loss recovery using multiple remote artifact sources;
- physical independence or honest execution behind provider identities;
- model-layer, attention, expert, or KV partitioning across peers;
- a causal evidence-to-routing improvement on later work;
- distributed model training.

### Inspected implementation gaps (2026-09-20)

At Reploid `ac20aba5`, installed `doppler-gpu` 0.6.1 exposes whole-model scoped
sessions. No public partition-execution API was found in its client contracts.
Doppler's distributed-plan parser/validator and internal GPU buffer partitions
do not establish execution of model partitions. Peer expert-identity metadata
likewise establishes no such capability. Reploid must consume an executable
public contract rather than import private model kernels or invent the math.

At that revision, `self/pool/peer-planning.js` rejected historical observations;
`packages/reploid/src/mesh/index.js` used configured whole-request placement.
The existing evolution owner
evaluates bounded tool candidates; its manual recipient approval path does not
implement a general preauthorized adoption policy. Continuing correctness/latency
objectives are covered by development tests, but successful actual-model
cross-device improvement remains unproved; see the
[continuing-improvement report](../../artifacts/continuing-improvement-2026-09-20/report.json).

### First Bayesian placement implementation

`packages/reploid/src/mesh/placement-beliefs.js` now owns a pure categorical
likelihood/Dirichlet posterior projection. The complete-job planner consumes it
only when its host policy enables history. Outcomes carry declared completion,
latency and total-cost estimates; expected utility subtracts total cost and the
declared time charge from completion value. It reports posterior probabilities
and variance, expected completion, latency, cost and utility. These outcome
estimates require calibration; they are not raw hardware measurements.

Observation context binds the workload cohort, exact model/adapter/operation,
limits and reported GPU environment. Environment labels are not attestation.
The host owns classification, admission, revocation and persistence of observations.
Replay rebuilds beliefs from the supplied admissible window, so removed evidence
does not remain in a hidden accumulated score. Identical evidence is counted once;
copies sharing a dependency count once. Conflicting dependent reports require a
joint model and are rejected. Expired, unrelated and censored observations do not
update counts. Censoring is not modeled as failure; informative cancellation can
bias the remaining sample and must be assessed before making performance claims.

Compatibility, permission and resource checks precede ranking. Policy, observations,
contexts and the posterior projection are bound to the signed assignment and
replayed by its verifier. No CI call or promotion result gates that computation.
This is opt-in whole-job Bayesian selection, not yet automatic observation
collection, partition placement, a failure-cause model or an information-gain
controller. The existing diagnostic planner remains a distinct finite hypothesis
model. Synthetic tests verify these contracts, not real-world calibration or gains.
The [Bayesian placement report](../../artifacts/bayesian-placement-2026-09-20/report.json)
retains source identities, signed browser replay, Verification Worker results and
installed-package checks for this implementation.

## Partition and learning implementation contracts

The following are required contracts, not names of available APIs.

### Doppler executable partition boundary

- Bind exact model artifacts, execution-plan identity, valid partition IDs and
  dependencies. Specify typed tensor shapes, byte bounds, numerical tolerances,
  state ownership and legal continuation points.
- Execute only partitions admitted by Doppler. Define initialization, input
  upload, execution, output readback, cancellation settlement and owned-resource
  close. Logical cancellation must not imply immediate termination of borrowed
  JavaScript or GPU work.
- Choose a small model and partition shape Doppler can actually execute. Layer
  groups need not wait for an expert boundary. Preserve learned expert choices,
  attention/KV semantics and unsplit numerical behavior.

### Reploid placement and Poolday delivery

- Place only eligible, contract-matching partitions within operator budgets.
  Bind sender, recipient, plan, partition, dependency, attempt, deadline and
  input/output identity. A retry cannot silently reuse stale attempt outputs.
- Carry activations as bounded opaque bytes under explicit input-derived
  disclosure grants. Artifact possession and room discovery grant neither
  execution nor disclosure. Current public-sequence catalog admission is not
  broadened by adding a partition experiment.
- Reuse bounded at-least-once transfer and backpressure. Deduplicate effects by
  attempt/output identity; receipt acknowledgement is not execution acceptance.
  Recover only from a Doppler-defined continuation point or restart the affected
  computation. Settle owned work on cancellation, expiry or participant loss.
- Record compute, readback, serialization, network, relay, upload, queue and
  recovery costs separately. Preserve actual transferred bytes and failures.
  Replaceable signaling and relay services do not own execution semantics.

### Inspectable Bayesian controller

- Begin with explicit completion and latency models conditioned on operation,
  model, environment and workload size. Bind priors, likelihood/update versions,
  posterior state and observed/censored outcomes to decision records.
- Deduplicate shared observation identities and preserve dependency cohorts.
  Retransmitted receipts and repeated reports of the same run are not independent
  trials. Reject evidence outside its policy or conditioning scope.
- Compare eligible actions using expected task value after complete costs.
  Treat information gain as a separately evaluated objective; uncertainty about
  an irrelevant variable need not justify an experiment. Beliefs and preferences
  remain distinct from observed facts.
- Updating the posterior follows the current granted algorithm. Replacing the
  updater, scheduler, planner or decomposition method requires a candidate,
  protected evaluation and separately authorized adoption.

### Runtime adoption policy

- Operators may grant bounded reversible adoption for named targets/objectives,
  fixed evaluator identity, resource limits, expiry and rollback conditions.
  Bind each decision to that policy, candidate, baseline and evaluation result.
- Candidates cannot edit the policy, protected evaluation or prior failure
  records. New permissions/disclosures require new authorization. Changed
  baselines invalidate stale evaluation; recovery retains prior active versions.
- Reasoning, networking, local evaluation and adoption within valid grants must
  work with CI unavailable. A service outage cannot become a runtime gate.
  Repository checks verify this implementation; passing them is not an adoption
  authority. Specific scientific or release workflows keep their separate gates.

### Required execution evidence

Compare split and unsplit execution on identified hardware with exact artifacts
and inputs. Exercise malformed tensors, rejected disclosure, duplicate delivery,
interruption, cancellation and participant loss. Retain all attempts and total
costs, including GPU transfers. A browser simulation is a contract test, not
two-device evidence. Independent recipient evaluation and unfamiliar workloads
are required for transferable improvement claims; the causal enabled/disabled
comparison is additionally required for recursion. Do not assume partitioning
will be faster: retain slower and inconclusive outcomes.

## Existing custody and whole-job comparison

N0-N7 below define a separate bounded experiment. Its frozen history comparison
tests a benefit claim; it does not gate authorized runtime belief updates,
participation, partition experiments or adoption under an existing operator grant.

Retain ESM-2 as a bounded systems control while adding the assistant operations. It
does not establish biological truth or the separate Research Room scientific
success gate.

| Gate | Required work | Exit evidence | Does not prove |
| --- | --- | --- | --- |
| N0: freeze | Pin the Doppler Pack, application contract, public inputs, provider policy, baseline routing policy, later-job cohort, corruption cases, source topology, and comparison metrics. | Signed or content-addressed experiment manifest fixed before execution. | Network behavior. |
| N1: artifact source contract | Let Poolday advertise and select authorized Pack sources while Doppler remains authority for Pack and shard verification. | Exact Pack root, shard hashes, source identities, authorization policy, and source-selection receipts. | Multi-peer recovery. |
| N2: origin-loss reconstruction | Three independently operated machines supply complementary model pieces to a clean fourth machine. Disable origin and mirrors, reject corruption, recover from a disappearing supplier, and execute the reconstructed Pack. | Complete Pack verification, source ledger, independent-operation evidence, failure records, unchanged acceptance result, and no origin or mirror access. | Honest hardware or useful inference demand. |
| N3: revision reuse | Publish a second authorized Pack or adapter revision with shared content. | Exact accounting of reused and newly transferred bytes without weakening identity or revocation. | A network effect. |
| N4: complete-job execution | Assign bounded generation, embedding, reranking, and ESM-2 jobs. Exercise streaming, cancellation, deadlines, retry attempts, deduplication, backpressure, resource limits, and participant loss. Compare with a conventional centralized queue on the same computers. | Assignment, transport, provider, result, comparison, full cost, failure, and requester acceptance records. | Model partitioning, honest hardware, or scientific correctness. |
| N5: governed memory | Admit only independently reviewed, active evidence; preserve rejected, disputed, corrected, and revoked records outside reusable decision memory. | Deterministic archive and decision-memory projections with review identities. | Improved later work. |
| N6a: participation test | Run the frozen later-job cohort with the baseline provider set and with an expanded eligible-provider set under the same memory and routing policy. | Paired results showing a predeclared improvement attributable to added eligible providers. | Evidence-driven learning. |
| N6b: memory test | Freeze 1,000 historical jobs, then evaluate unseen jobs with random no-history, competent reliability/load, and admitted-history schedulers at fixed capacity and correctness. | A predeclared meaningful improvement against both controls, with uncertainty and all resource costs. | General network value. |
| N7: external reliance | An unrelated requester and separately operated declared providers repeat the bounded workflow and return for another job. | External identities, authorization, retained outcomes, and repeat demand. | Physical or organizational independence unless separately established. |

## Feedback experiment

N6a and N6b must isolate the two claimed network effects.

- For N6a, freeze memory, routing policy, job order, workload identities,
  failure injection, retry limits, and resource budget. Change only the
  eligible provider set.
- For N6b, freeze the available provider set, job order, workload identities,
  failure injection, retry limits, and resource budget. Change only whether
  the routing policy may consume N5 memory.
- The random no-history control uses current compatibility, availability, load,
  locality, and declared costs to establish eligibility. The competent
  reliability/load control additionally uses measured completion, latency,
  failures, and workload/environment conditioning. Both are frozen before the
  unseen cohort. Only the history arm consumes reviewed explanations,
  corrections, and scoped admitted knowledge from N5.
- Candidate routing may use only evidence admitted under the named policy.
- Select the primary outcome before execution: completion, accepted-result
  rate, recovery cost, bytes transferred, time to accepted result, or another
  requester-valued measure.
- Retain regressions and inconclusive outcomes. Do not select a different metric
  after observing results.
- Trace every changed assignment to the exact admitted records that influenced
  it.

If memory changes no assignment, investigation, replication decision, or
outcome, the intelligence-sharing claim fails even when the archive grows.

## Implementation workstreams

### Base-Pack exchange

- Extend Poolday advertisements with exact Pack availability and authorized
  shard-source capability.
- Reuse Doppler's Pack and shard verification through a narrow interface. Do
  not create a second Pack identity authority.
- Add Node seeder and browser serving roles with bounded resources, revocation,
  request authorization, backpressure, cancellation, and failure receipts.
- Route cache, peer, and origin sources without requiring a privileged origin.
- Use persistent content-addressed storage, resumable downloads, real WebRTC,
  authorized inventory discovery, parallel multi-peer acquisition, and
  cross-version chunk reuse. Order: local cache, authorized peers, mirrors,
  origin. The failure proof disables both final fallbacks.

### Execution coordination

- Preserve exact model, manifest, runtime, backend, workload, and adapter
  matching.
- Preserve whole-model execution while implementing the separate Doppler
  partition boundary above. Neither artifact shards nor whole-job tests qualify it.
- Separate artifact-serving identities from inference-provider identities even
  when one participant performs both roles.

### Governed learning

- Preserve the complete immutable archive separately from policy-admissible
  memory.
- Require review, correction, revocation propagation, and contextual admission
  for cross-room reuse.
- Add routing-decision receipts that bind candidate providers, admitted memory,
  selected provider identities, rejected alternatives, and observed outcome.
- Keep operational learning separate from gradient training and model
  promotion.

## Measures

- Pack reconstruction success with the origin unavailable.
- Corrupt, stale, unauthorized, and revoked chunk rejection.
- Peer-sourced and reused bytes by exact revision.
- Complete-job success, retries, cancellations, divergent results, and accepted
  agreements.
- Assignment changes attributable to admitted evidence.
- Improvement on the frozen later-job outcome.
- Peer-byte percentage, time-to-runnable, duplicate bytes, recovery time, memory,
  failed assignments, retries, latency, and total resource cost. Charge failed
  transfers, replicas, verification, relay traffic, and review as well as useful
  execution. Retain quantities before any explicit monetary conversion.
- Returning requesters and providers.

## Stop conditions

Stop or narrow the network strategy when:

- authorized peer delivery is less reliable or economical than ordinary
  mirrors and supplies no distinct availability value;
- more providers improve neither capacity, recovery, economics, result
  comparison, nor later selection;
- retained evidence does not change or improve later work;
- useful workloads cannot tolerate duplicated whole-model execution;
- participants will not contribute lawful artifact custody or bounded compute;
- the network requires claims of physical independence or honest hardware that
  its evidence cannot establish.

## Existing custody and whole-job work queue

1. Generalize Pack invocation, admission, receipts, and operation adapters.
   Preserve the existing public catalog and all separate research functionality.
2. Qualify real text Packs and connect the local assistant lifecycle.
3. Finish persistent, resumable, parallel custody and independent-machine N2.
4. Connect heterogeneous jobs to authorized provider execution and implement the
   complete N4 failure and conventional-queue comparison.
5. Project admitted memory into the existing router, retaining snapshot,
   policy, provenance, corrections, revocations, and reproducible reasons.
6. Freeze the 1,000-job history and unseen cohort; run N6a/N6b with all controls.
7. Establish independent repeat use without broadening unsupported claims.

This queue scopes the custody and whole-job comparison, not the complete product.
The active partition/learning/adoption contracts above may proceed alongside it.
Tokens, payments, global reputation, Doe integration and social features remain
outside these demonstrations. No allocation here authorizes recruitment,
deployment or publication.

Mutable support and deployment status remain owned by the surface claim index,
Poolday configuration, runtime contracts, tests, and retained evidence.

---

*Last updated: September 2026*
