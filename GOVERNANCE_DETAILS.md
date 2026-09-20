# reploid governance details

These supporting requirements were retained when the root triad was condensed. They remain applicable constraints, not a second mission document. Dated implementation statements below retain their original scope and are not fresh verification. The root [GOALS.md](GOALS.md), [INTENT.md](INTENT.md), and [CATSCAN.md](CATSCAN.md) summarize direction and authority.

## Retained GOALS.md requirements

# Reploid Goals

## Product aim

Reploid is a peer-to-peer network of agents that runs and distributes model computation, coordinates problem solving, and improves individual agents and collective efficiency through Bayesian learning and evaluated experiments. Each agent remains useful independently, and each participant controls what it shares and contributes. This is the intended system; supported capabilities require their own execution evidence.

Its purpose is:
**Reploid pursues goals for humans and agents while learning to solve problems and organize shared computation more effectively.**

### The collaborating agent system is the product

A person gives Reploid an outcome: investigate a failure, answer a question, improve an application, or examine a scientific hypothesis. Another agent can submit the same kind of request programmatically.

Reploid determines what information, models, tools, and assistance it needs. Doppler supplies local generation, embeddings, reranking, adapters, and specialized model execution. Participating peers contribute missing capabilities, computation, observations, and tested improvements.

One Reploid is useful alone. Connected Reploids accomplish more or learn something they would otherwise miss. Neither Doppler inference nor Reploid's basic operation depends on joining the network.

Chat is an interface. Coding, document investigation, and scientific research are application domains. Poolday owns peer infrastructure; collaboration is a first-class part of the product. Independent operation provides resilience, not a reason to hide the network.

### Two connected loops

Reploid operates through two distinct, connected loops:

1. **The problem-solving loop:**
   ```text
   receive goal
   -> establish success criteria and permissions
   -> gather context and plan
   -> use models, tools, and authorized peers
   -> inspect actual outcomes
   -> revise the approach
   -> deliver a result and preserve useful experience
   ```
   The agent acts through authorized tools, not only returning model-generated text. A repair needs execution and tests; a research investigation needs evidence and explicit uncertainty.

2. **The improvement loop (RSI):**
   ```text
   identify recurring weakness
   -> propose and implement a candidate change to Reploid itself
   -> test the candidate version in isolation
   -> compare against the frozen current baseline
   -> satisfy an operator grant or bounded preauthorized adoption policy
   -> adopt or reject
   -> let the accepted version produce subsequent improvements
   ```
   This separation matters operationally. Users receive work from a stable, identified version while candidate versions undergo bounded experiments. Failed experiments cannot corrupt active goals or silently alter their permissions.

### Distribution and learning

Three mechanisms are first-class: authorized model storage and artifact reuse;
execution of Doppler-defined computational partitions across devices; and agent
work divided into subtasks. Whole-job delegation remains one execution option.
Storing shards or advertising experts does not establish partitioned computation.

Doppler defines valid partitions, tensor contracts, numerical requirements and
state ownership. Reploid places eligible partitions and coordinates budgets,
transfers and recovery through Poolday. Placement cannot change learned expert
selection or model semantics. Intermediate representations require input-derived
disclosure authorization. Measurements include GPU readback, serialization,
network transfer and receiving-device upload. Signaling and relay remain
replaceable connection infrastructure.

The controller should maintain inspectable uncertain beliefs over completion,
latency, failure causes and candidate benefit. Version priors, likelihoods and
evidence provenance; correlated or copied observations must not count as
independent trials. Select actions for expected task value after total costs.
Evaluate whether an information-seeking objective improves useful outcomes.
LLM confidence and signed receipts are not calibrated likelihoods by themselves.

Updating a posterior is ordinary adaptation. Replacing its updater, planner or
scheduler is a candidate change requiring protected evaluation. Agent evolution
changes context selection, planning, diagnosis and improvement generation;
system evolution changes placement, batching, caching, replication, decomposition
and collaborator selection. Both belong to Reploid's mission.

Operators may preauthorize bounded, reversible adoption with fixed targets,
evaluation criteria, budgets, expiry and rollback. Candidates cannot alter that
policy; new permissions or disclosure scopes require new authorization. Runtime
reasoning, collaboration, evaluation and adoption within existing grants do not
depend on CI, a repository release or a manual button press for every change.
Development checks verify implementations; they do not govern a running agent.

### Component responsibilities

The reusable browser library lives in `packages/reploid/`. It owns agent
execution, configurable peer transports and intelligence coordination,
persistence, and governed improvement services. The existing `self/`
application consumes public library APIs and owns composition, credentials,
catalog selection, product workflows and persistence choices. Its UI requests
actions and renders outcomes; it does not acquire scheduling or approval authority.
Server and deployment tooling remain outside the publishable browser package.
This is an executable extraction, not an iframe wrapper or a Simulatte integration.

- **Reploid's browser library (`packages/reploid/`):** Owns reusable goals, planning, tool execution, persistence, peer mechanics, coordination and improvement services. Legacy application modules forward to extracted owners during migration; application seed content and policies stay in `self/`.
- **Poolday network (`self/pool/`):** Serves the agent: discovers peers over WebRTC, exchanges authorized artifacts, assigns bounded work, moves messages, recovers interrupted delivery, and retains outcomes.
- **Doppler runtime:** Owns model mathematics, valid computational partitions and execution. Reploid consumes public contracts and owns placement, not another model implementation. Changes to Doppler itself follow its own acceptance process; running approved computations does not require a software release.
- **Evaluation and authorization:** Outside candidate control. A proposed improvement cannot rewrite hidden acceptance tests, escalate its own permissions, erase failures, or declare itself approved.
- **Policy and budgets:** Reside in checked configuration. JavaScript implements agent behavior and peer coordination; Doppler owns model computation.

### Recursive improvement as the primary milestone

The next demonstration connects distributed computation with collective improvement.
First partition a small model across two devices and compare with unsplit execution:
correctness, complete communication costs, cancellation and participant loss.
Then let agents identify an inefficiency, generate a permitted scheduling or
problem-solving change, evaluate it on unfamiliar work and exchange it. Another
participant independently evaluates it and benefits after adoption. Finally test
whether the changed machinery contributes to producing a subsequent improvement.
Compare with competent standalone and centralized coordination baselines on
comparable resources, counting failures, transfers, evaluation and human help.
Tool repair is one bounded fixture, not the definition of evolution. Injected
inference or handwritten candidates do not establish model-generated improvement.

Self-modifying agents have prior art: the Darwin Gödel Machine modifies its own code and evaluates descendants on coding tasks. Reploid's distinctive demonstration combines recursive self-improvement with peer collaboration and independently reusable improvements:

1. **Version A** encounters a recurring problem in its own work (such as repeatedly selecting irrelevant context, unhandled tool errors, or looping plans). It proposes and implements a general improvement. Independent tests establish that **Version B** solves previously unseen tasks better.
2. **Version B**, using its improved machinery, identifies and implements another improvement that produces **Version C**.
3. Other Reploids independently test and optionally adopt those changes.

Task success, time, computation, and human intervention are measured against the frozen original agent. The underlying model and resource budgets remain comparable. External assistance is recorded rather than attributed to autonomous improvement.

The recursive claim requires the improved agent to participate in producing its next improvement. Compare B's changed improvement machinery enabled and disabled under comparable models, tools, budgets, evaluator access, and attempt counts. Ancestry, repeated human patches, downloading a stronger model, or accumulating logs do not establish this experiment. Peer transfer demonstrates an additional benefit; a local planning or tool-recovery improvement does not require peer participation.

### Separation of RSI and AGI

Recursive self-improvement concerns how the system improves itself. General intelligence concerns the breadth and level of capabilities it demonstrates. Reploid pursues bounded, reproducible recursive self-improvement first, then tests whether improvements transfer across unfamiliar coding, information-analysis, planning, and scientific tasks.

Bounded model decomposition is an active implementation track alongside agent
and system evolution. It need not wait for interface polish or tool-repair
completion. Start with the smallest partition contract Doppler can execute and
verify; expert partitioning is not a mandatory precursor to layer groups.

## Current supported boundary

The repository now supports a local external-facing Change Passport contract,
append-only hosted service, persistent store, scoped bearer authentication,
GitHub App client and required-check projection, CI action, TypeScript SDK,
browser review surface, explicit deployment and rollback adapters, standard
reopening triggers, offline export verification, and a separate adapter from
`rsi.improvement-episode/v1`. These claims are bounded to repository tests and
the local browser journey. A GitHub App is installed only on
`clocksmith/reploid`, its webhook is deployed, and a dedicated dogfood branch
requires the App-bound check. One internally operated passport-dogfood check
moved from blocked to eligible and reopened while an independent GitHub test
remained failed. The retained observation proves App-bound check projection
and evidence preservation for that exact internal candidate only. A complete
Visual Change Passport dogfood path also
binds the development Bridge's complaint and reversible patch receipts to an
independent physical-Chromium evaluation, attributed acceptance, local CI
activation, post-activation render outcome, exact source reversal, and
automatic reopening. External installability, operator comparison, commercial
value, qualification, adoption, deployment authority, and rollback success
remain unproved and have no claim permission.

The currently supported Poolday execution network is narrower than the long-term aim.
The D4DA integration extends the reusable complete-job contracts to an explicitly
pinned forecasting workload. D4DA owns room consent, source cutoffs and forecast
review; the existing Poolday message, assignment, receipt and acceptance records
retain their identities. This adapter is not public catalog admission or evidence
of external provider adoption. Its execution and comparison claims require its
own retained checks.

The catalog's ESM-2 identity is a model contract, not yet an enabled signed
executable Pack. The new `executablePack` boundary requires public `openPack`,
exact envelope and artifact closure, accepted TargetPlans, and execution receipts.
It does not self-admit a catalog override. Publishing a qualified Pack, pinning
its released Doppler API, and enabling that exact catalog row remain release
gates, not claims established by these contract tests.

Current enabled scientific peer execution:

- Public protein sequences only.
- The enabled ESM-2 35M exact model contract.
- Receipt-backed, audit-backed, reputation-backed, policy-controlled browser
  inference.
- Signed room-scoped submissions, results, reviews, corrections, replication
  requests, and deterministic projections.
- Exact-contract similarity and evidence views without biological diagnosis,
  mutation-fitness claims, laboratory validation, or scientific closure.

A provider receipt proves that a provider key signed an assignment-bound
artifact. Multiple matching executions establish declared execution agreement.
They do not prove honest browser execution, distinct devices or organizations,
independent model evidence, biological correctness, or scientific replication.

Reploid's main interface presents agents, models, shared activity, device
contribution, results, and tested improvements together. Work, Network, and
Improve describe connected activities, not mandatory separate destinations.
A task remains connected to its executing agents, actual model identities,
peer jobs, result, and any resulting candidate changes. Participation is
voluntary; discovery never grants disclosure or execution permission.
Detailed configuration and evidence remain expandable. Existing routes remain
available for focused inspection. Poolday is an internal implementation name.
Protein analysis and document
search are examples. Ask, Records, History, and Research Room-1 remain accessible
secondary routes. Recent jobs expose execution receipts, comparison evidence,
peer identities, retries, and recovery without inheriting scientific authority.
An available route, configured model, retained checkpoint, or user-accepted
outcome does not establish physical inference, peer execution, or improvement.

## Falsifiable first proofs

### Primary proof: Evolving problem-solving agent and recursive improvement

The primary proof demonstrates a network that improves useful problem solving
and organization of computation through participation. Independent operation
remains a control and resilience requirement. The recursive part requires:

1. **Self-improvement chain ($A \to B \to C$):**
   - **Version A** encounters a recurring problem in its problem-solving loop (such as selecting irrelevant context, unhandled tool failures, or looping plans). It proposes and implements a general improvement. Independent, isolated sandbox tests establish that **Version B** solves previously unseen tasks better.
   - **Version B**, using its improved problem-solving machinery, identifies and implements another improvement that produces **Version C**.
   - Independent Reploid peers over WebRTC re-evaluate the candidate in their local sandboxes and optionally adopt the change.
2. **Experimental controls:**
   - The underlying Doppler model and resource budgets remain strictly comparable across $A$, $B$, and $C$.
   - The candidate version cannot modify its own acceptance tests, escalate permissions, erase failure records, or self-approve.
   - Improvements are measured against the frozen original Version A baseline.

### Supporting capability proof: Poolday peer network and Doppler runtime

Poolday and Doppler support artifact distribution, partitioned computation and
agent coordination. The existing complete-job execution contract binds exact
model identity, operation, input, limits, and acceptance rules (`generate`,
`embed`, `rerank`, `encodeSequence`). Operation adapters own validation,
streaming, cancellation, and comparison; shared networking owns discovery,
assignment, transport, retries, accounting, and evidence. The following custody
and whole-job experiment has its own scope; it is not a partition-execution proof.

Document search, protein sequence investigation, and code modification serve as application domains exercising the agent's problem-solving loop; they are not blocking prerequisites for the recursive improvement proof.

Separate operators repeatedly execute an exact signed Doppler Pack under a
frozen correctness and acceptance policy. The episode must demonstrate authorized
artifact reconstruction with origin disabled, corrupt contribution rejection,
peer disappearance and recovery on independent machines, independent review,
and voluntary return usage. ESM-2 must produce useful oracle-valid outputs from
actual signed Pack bytes and weights through public openPack/encodeSequence.
The same retained episode binds Pack identity, assignments, and recovery receipts.
Three independently operated supplier machines must enable a clean fourth
machine to reconstruct and execute despite one corrupt and one disappearing
peer, with origin and mirrors disabled. Browser contexts on one computer do not
satisfy this gate. The acquisition order is persistent local cache, authorized
peers, mirrors, then origin. Resume, parallel sources, authorized inventory, and
cross-version chunk reuse retain integrity and full byte accounting.
Compare remote execution with the same computers behind a conventional queue.

A versioned route-decision projection cites exact compatibility, custody,
availability, prior outcomes, latency, failures, cost, and reputation evidence.
Freeze 1,000 historical jobs, then replay unseen jobs through a random no-history
control, competent reliability/load
scheduler, and evidence-informed policies with identical jobs, capacity, oracle,
resource budget, and starting conditions. History precedes held-out jobs and
tuning ends before evaluation. Require a predeclared meaningful benefit against
both controls with uncertainty and unchanged correctness; account for all
attempts, transfers, verification, replication, retries, and review. Revocation,
staleness, duplicates, and insufficient history have negative tests.
Keep scientific evidence and
operational routing evidence separate. Signed receipts and local browser tabs
alone do not establish external adoption, physical independence, or learning.
Hosting comparisons inform economics, not technical completion. If retained
history does not improve later work, its acceptance gate stays unproved even
when artifact sharing and execution capacity work.
Predeclare peer-byte percentage, time-to-runnable, duplicate bytes, recovery,
memory, completion, retries, latency, and total resource cost where applicable.
Keep payments, tokens, global reputation, Doe and social features outside this
custody and whole-job comparison. Partition execution and autonomous improvement
have their separate contracts and controls in the active demonstration above.

The September execution specification adds exact LoRA artifact sets and an
explicitly configured remote MoE expert boundary to implementation scope.
JSON owns operation, capability, acquisition, persistence and routing policy;
Reploid coordinates immutable requests and failures; Doppler owns model math.
LoRA never duplicates the base model. Adapter combinations require declared
order and combination semantics. Remote experts remain disabled until an
explicit policy admits exact model/layer/expert identities, bounded activation
disclosure, failure handling and qualified Doppler execution. Layer groups or
other partitions likewise require Doppler's explicit executable contracts;
neither is an implicit fallback. Current planning rejects historical observations.
Implement authorized Bayesian adaptation without relaxing compatibility or
disclosure gates. Operational evidence stays distinct from scientific evidence.
The frozen comparison establishes a benefit claim, not permission for an
already-authorized agent to reason or conduct a bounded experiment.

### Alternative proof: Change Passport

If this alternative is selected later, its commercial proof remains:

> Reploid governs an agent tool, MCP server, permission policy, or
> production-agent configuration release in a real GitHub and CI workflow. It binds the exact
> candidate, frozen baseline, evaluator, evidence, disagreement, approval,
> activation, outcome, rollback, and reopening conditions. Reploid succeeds
> only when the team can approve or reject the change with less reconstruction
> cost or fewer escaped regressions than its frozen existing workflow without
> an unacceptable increase in false blocks.

This claim is supported only when a real workflow demonstrates all of the
following:

1. A version-pinned passport controls a required merge or promotion check.
2. Proposer, evaluator, reviewer, and activation authority remain explicit.
3. Included and excluded evidence, dissent, failed checks, and unresolved
   conditions remain inspectable.
4. The deployed effect is recorded separately from the approval decision.
5. A predeclared trigger reopens an active decision and requests the authorized
   next action without implying that rollback already occurred.
6. An external operator can verify the exported record and asks to use the
   workflow for another real change.

Change Passport remains an inactive alternative, whether or not its local
implementation passes. The internal improvement episode is implementation evidence, not
proof that the external workflow works or that a buyer needs it.

### Scientific proof: Room-1

The first scientific proof remains narrower than a general protein-model
network:

> Reploid helps curators of public protein catalogs adjudicate disputed family
> or domain annotations. It combines version-pinned external evidence,
> qualified model evidence, accountable review, preserved disagreement, and
> reusable prior decisions. Reploid succeeds only when it improves adjudication
> quality at comparable effort or reduces curator effort without reducing
> quality.

This claim is supported only when a real workflow demonstrates all of the
following:

1. The result changes, narrows, or explicitly blocks a real annotation
   decision.
2. The Research Room performs better than the frozen existing workflow, such
   as UniProt, InterPro, local analysis, and a notebook or spreadsheet.
3. Prior room evidence prevents repeated work or exposes a relevant previous
   failure.
4. Browser-peer redundancy adds measured value beyond a local or hosted rerun.
5. The complete evidence needed to reproduce the decision remains inspectable.

Until this proof exists, Research Room-1 remains an optional scientific
hypothesis, not the primary Poolday win condition. The broader network, laboratory path, evidence graph, and
continuously improving decision-policy loop remain target capabilities.

## Initial users and market constraints

The primary user is a human or another agent with useful work to complete and
explicit success criteria and permissions. Local tasks and recurring weaknesses
in planning, context use, or tool recovery can establish the agent's value.

For the supporting network proof, the participants are a requester with repeated,
independently demanded exact work and a separately operated peer provider.
Freeze the ordinary hosted or mirror-backed baseline, costs, correctness oracle, and reason to return before
claiming that a network is preferable.

The alternative Change Passport user is an AI platform, developer infrastructure,
reliability, or security operator promoting agent tools, MCP servers,
permission policies, or production-agent configuration through GitHub and CI. The first workflow
must name the repository, controlled change type, current required checks,
evaluator, approval authority, activation system, rollback owner, and business
condition that makes Reploid preferable.

The initial scientific user is a curator of a public protein catalog confronting
a disputed family or domain annotation. "Researchers, curators, public-data
projects, biotechnology partners, and AI platform teams" is not one market.
Those groups have different buyers, workflows, privacy requirements, incentives,
and success criteria.

The first adjudication experiment must still name:

- the exact catalog and curator role;
- the recurring family or domain decision;
- the disputed evidence pattern;
- the current tools and handoffs;
- the output that the user can act on;
- the party that adopts or pays;
- the condition that makes the room measurably preferable.

Poorly characterized proteins describe an object class, not a market. Public
protein annotation adjudication is the first bounded workflow to test. Early
biotechnology use conflicts with the current public-only sequence policy unless
the work concerns explicitly public data. Private or consortium rooms require
a separate privacy, access-control, custody, deployment, and audit contract
before they become a product claim.

Change Passport must not send private source, prompts, credentials, or
configuration to Poolday peers. The first hosted workflow stores content hashes,
policy records, attestations, and explicitly admitted evidence by default.
Handling private payload contents requires a separately tested custody and
access-control contract.

## Research Room UX

The Research Room should lead the researcher through:

```text
public sequence and bounded question
-> declared context, exclusions, and consent
-> governed evidence acquisition
-> inspectable result and provenance
-> agreement, disagreement, and missing evidence
-> review, correction, or reproduction request
-> bounded next decision
```

The room should expose the question, decision context, exact input identity,
evidence state, unresolved issues, reviewer decisions, and next action first.
Receipts, transport, reputation, provider identity, and diagnostic records are
supporting evidence disclosed when needed.

The room must not absorb every operational interface. Contributors need clear
resource, permission, model, network, failure, and stop controls. Policy and
security operators need separate queues and incident evidence. These surfaces
serve the room without competing with it as researcher-facing products.

## Research Room evidence before architecture

Browser peers are one governed execution source, not the scientific product.
The Research Room should be able to reference evidence produced by qualified
local browser execution, peer execution, controlled hosted execution, imported
external analysis, and eventually laboratory work. Each source retains its own
identity, policy, and claim boundary.

Requiring browser peers is justified only when measured evidence shows that
they reduce cost, improve reproduction, expose execution disagreement, or add
availability relative to a simpler execution path.

The enabled embedding result is not automatically a useful scientific answer.
Its decision value depends on compatible reference data, external annotations,
condition-aware comparison, and a question-specific interpretation boundary.
Governance around an output does not substitute for proving that the output
helps the user decide.

## Research Room evidence architecture

The Research Room needs two projections over one immutable archive:

- The complete evidence archive retains accepted, provisional, disputed,
  rejected, failed, corrected, revoked, and superseded material with its state
  and provenance.
- Decision memory contains only evidence admissible for one decision under one
  named policy.

"Accepted" means admissible for a declared decision under a declared policy.
It must never mean globally or biologically true.

A network flywheel exists only when later users can find and validly reuse
prior evidence. Signed room records alone do not create it. Cross-room reuse
requires cross-room sequence identity, source versions, ontology and coordinate
normalization, licensing, consent, deduplication, supersession, global
retrieval, contextual relevance, and incentives to publish negative or failed
work.

## Measurement

The primary governing objective is successful pursuit of useful goals and
demonstrated improvement in agent methods and collective computation. Measure task
success, quality, resource cost, and human intervention against declared
baselines under comparable conditions. Recursive-improvement claims additionally
require the causal A -> B -> C comparison above; adoption alone is insufficient.

The supporting network objective is useful, authorized peer assistance. Claims
that networking improves capability, reliability, cost, or later decisions
require appropriate declared baselines under comparable conditions. Ordinary
participation, artifact exchange, and exploration do not require a completed
network-benefit experiment. Candidate routing algorithms require protected local
evaluation and authorized adoption; ordinary belief updates follow the granted
policy. Claims of better routing require improvement against frozen controls.
Independently operated repeat use is adoption evidence;
signatures alone establish neither operator independence nor honest execution.
Report accepted jobs, providers, peer-served bytes, rejected contributions,
reproduced outputs, and route changes separately.

The alternative Change Passport objective is:

```text
verified cost of safely approving, activating, and reconstructing
a consequential agent-generated change
relative to a frozen existing change-control workflow
```

It becomes executable only after one workflow freezes the change class,
baseline checks, evaluator, false-block tolerance, activation authority,
outcome observation, reopening triggers, rollback policy, cohort, and cost
units.

The scientific governing objective remains:

```text
verified cost of resolving a bounded protein uncertainty
relative to a frozen baseline policy
```

It becomes executable only after one workflow freezes:

- the decision to be resolved;
- resolution, rejection, and reopening criteria;
- the baseline process;
- the cost components and units;
- evidence independence requirements;
- the evaluator and adjudication authority;
- the comparison cohort and observation period.

Supporting measures must not become unexamined proxies. Review latency can
reward rushed review. Conclusion stability can reward failure to reopen.
Duplicate work avoided is counterfactual. Information gain requires a declared
uncertainty model. Each measure needs a definition, validity conditions, and a
known failure mode.

Jobs, tokens, receipts, peers, records, and total compute remain operational
metrics. They are not product success.

## Zero, X, and improvement authority

Zero and X are configurations of the same agent foundation and share Reploid's
problem-solving and recursive-improvement mission:

- **Zero** is the minimal starting configuration. It begins with CreateTool and
  grows the reader, writer, loader, and other authorized tools and procedures
  needed to pursue objectives. It provides the minimal starting point for
  experiments that propose and implement improvements. Its current profile uses
  server-proxy inference by default, with optional local Doppler execution.
- **X** extends Zero with explicitly selected, preassembled executable
  capabilities and supporting blueprints, including memory, experimentation,
  workers, peer collaboration, and verification. It may also propose and
  implement improvements. These extensions do not grant evaluation, approval,
  or activation authority.
- **Poolday** supplies optional discovery, authorized artifact exchange, bounded
  computation, recovery, and reusable experience. It can carry signed improvement
  episodes for independently authorized evaluation and adoption; signed records
  do not replace correctness checks.

Proposer, evaluator, approver, and activator are separately assigned roles with
explicit permissions and isolation requirements. A route or profile never
establishes evaluator independence. Candidates cannot control protected tests,
their evaluator, permission ceilings, approval, or activation.

The named [scientific-policy promotion workflow](docs/poolday/product-intent.md#scientific-policy-promotion-boundary)
assigns a Zero proposer, a distinct X evaluator, a human approver, and a Poolday
policy owner. Those are that protocol's role assignments, not definitions of
Zero and X. Its frozen cohorts, protected evaluation, review, revocation and
rollback requirements remain intact.

Change Passport retains separate generic change-control authority. An external producer or evaluator can use it independently. A passport may deterministically reopen a decision when a verified trigger matches its frozen rule. Blocking a merge, activating a deployment, revoking authority, or requesting rollback remains a separately authorized effect. Approval state, evidence validity, and deployed effect state must never be collapsed.

Internally, every claimed improvement must be represented by one signed, append-only `rsi.improvement-episode/v1` projection. The episode binds the objective, immutable baseline generation, declared metric semantics, protected evaluator and suite identities, hypothesis, candidate patch, isolated execution, raw paired observations, comparison, promotion or rollback, and structured reflection. Mutation, tool success, arena pass rate, telemetry, fitness, or saved reflection alone never establishes improvement. Rejected, inconclusive, superseded, and rolled-back candidates remain in the episode archive with explicit ancestry.

This authority split is a safety and development rule, ensuring that experimental candidate modifications never compromise the stable agent currently pursuing active goals for users. Zero and X remain discoverable through the homepage's Experiments footer, providing inspectable evidence for recursive self-improvement without confusing the active problem-solving interface.

## Competitive baseline and compounding value

Reploid does not enter an empty evidence market. UniProt already combines
curated and computational protein information with evidence attribution.
InterPro integrates multiple protein family, domain, and site methods. Existing
laboratory platforms provide structured records, collaboration, permissions,
and audit trails.

Code review, CI, observability, model evaluation, and identity systems already
cover parts of the commercial workflow. Reploid must own the governed
transition from observed activity to active decision state, not merely produce
another trace or approval document.

Exact contracts and signatures are reproducible features, not an enduring
advantage by themselves. Compounding value requires a uniquely useful, governed
corpus of objections that predicted failures, evidence that predicted success,
reversed approvals, reopenings, corrections, reproductions, and rollback
outcomes that operators and researchers repeatedly consult.

The long-term execution network becomes credible only after Poolday's external
execution and improved-decision loop passes its frozen hosting comparison.
Scientific adjudication earns a separate claim through its own comparison. Until then, the Research
Room is an organizing hypothesis, not the product moat.

## Decision rule

Every proposed subsystem should answer at least one of these questions:

- Does it help the agent complete useful goals or improve its methods under
  independent evaluation, including when no peers participate?
- Does it shorten the path from uncertainty to a justified next decision?
- Does it make the evidence behind that decision more inspectable or reusable?
- Does it expose a disagreement, failure, or missing dependency that the
  baseline workflow hides?
- Does it safely control activation, reopening, revocation, or rollback under
  explicitly named authority?
- Does prospective evidence show that it reduces a declared cost component?

If not, it is infrastructure, experimentation, or project history rather than
the product.

## Authority and supporting references

This document is the repository-level authority for mission, value, and
strategic goals. Narrower product contracts, scientific non-claims, target
object design, current status, and executable policy live in:

- [`docs/poolday/product-intent.md`](docs/poolday/product-intent.md)
- [`docs/poolday/claims-and-nonclaims.md`](docs/poolday/claims-and-nonclaims.md)
- [`docs/poolday/discovery-contract.md`](docs/poolday/discovery-contract.md)
- [`docs/change-passport/product-intent.md`](docs/change-passport/product-intent.md)
- [`docs/change-passport/implementation-plan.md`](docs/change-passport/implementation-plan.md)
- [`docs/rsi-improvement-episodes.md`](docs/rsi-improvement-episodes.md)
- [`docs/status/surface-claim-index.json`](docs/status/surface-claim-index.json)
- [`self/pool/pool-config.json`](self/pool/pool-config.json)
- [`self/pool/TODO.md`](self/pool/TODO.md)

External baseline references:

- [UniProtKB](https://www.uniprot.org/help/uniprotkb)
- [UniProt evidence attribution](https://www.uniprot.org/help/evidences)
- [InterPro](https://www.ebi.ac.uk/training/online/courses/interpro-quick-tour/what-is-interpro/)
- [InterProScan](https://www.ebi.ac.uk/interpro/search/)

---

*Last updated: September 2026*


## Retained INTENT.md requirements

# INTENT: Reploid

Parent: none

## Need

Humans and agents need cooperating systems that solve problems, share model storage and computation, and learn to use their collective resources better within explicit contribution and disclosure limits.

## Target

Reploid is a peer-to-peer network of agents that runs and distributes model computation, coordinates problem solving, and improves individual agents and collective efficiency through Bayesian learning and evaluated experiments. Each agent remains useful independently, and each participant controls what it shares and contributes. This target is not a claim of completed implementation.

## Invariants

- Candidate execution, protected evaluation, and active user work have explicit isolation and lifecycle boundaries. Separate machines are required where a particular proof demands them.
- Candidate improvements cannot modify hidden acceptance tests, escalate permissions, erase failure histories, or self-approve.
- The reusable browser agent library in `packages/reploid/` remains completely independent of specific UI frameworks.
- Doppler owns model mathematics and valid executable partitions; Reploid owns eligible placement and Poolday peer transfer and recovery. Placement preserves model semantics. Activations require input-derived disclosure grants.
- Model storage, partitioned computation and agent work are distinct distribution mechanisms. GPU readback, transfer and upload costs count alongside computation.
- Bayesian beliefs retain uncertainty and observation dependencies. Posterior updates are adaptation; replacing the updater or scheduler is an evaluated candidate change.
- Operators may preauthorize bounded reversible adoption; candidates cannot change those policies or gain permissions. Runtime reasoning, collaboration and evolution within grants do not depend on CI or software release.
- One connected interface exposes actual agents, model locations, shared work, contribution controls, and improvement states. It never fabricates activity or merges evaluation with adoption authority.
- Zero is the minimal starting configuration; X extends it with explicit capabilities. Proposer, evaluator, approver, and activator are separately authorized roles, not route identities.
- Free adoption counts as adoption evidence; commercial outcomes do not gate technical completion. Capability claims still require their stated acceptance evidence.

## Development checks

These checks verify repository changes. They are not runtime prerequisites for
authorized reasoning, collaboration, evaluation or adoption.

- Run CATSCAN charter verification via `npx vitest run tests/unit/catscan.test.js`.
- Run applicable unit, integration, browser, and peer protocol checks in `tests/`.
- Validate claim references with `npm run verify:surface-claims`.

## Recorded evidence

The [surface claim index](docs/status/surface-claim-index.json) bounds claims by
their evidence and blockers. The versioned
[architecture convergence report](artifacts/architecture-convergence-2026-09-19/report.json)
records shared-engine, contract, browser, and installed-package checks for its
identified sources. It does not demonstrate the full recursive-improvement
mission or physical GPU qualification. Each capability or improvement claim
requires its own versioned observations and declared comparison; passing the
development checks alone is not evidence that the mission has been achieved.

## Non-goals

- Monolithic cloud chatbot services or centralized agent swarms.
- Unconstrained autonomous code execution without human or sandbox verification.
- Conflating peer activity volume or token generation counts with problem-solving success.

## Truth

Independently evaluated test suites and frozen benchmark populations govern all capability and improvement claims. Self-reported agent confidence does not constitute evidence.

---

Links:
- Root strategy: [GOALS.md](GOALS.md)
- Technical charter: [CATSCAN.md](CATSCAN.md)
