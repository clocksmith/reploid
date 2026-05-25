# Blueprint 0x000112: RGR

**Name:** Recursive GEPA Ring (`RGR`).

**Objective:** Define a bounded whole-system recursive self-improvement architecture using rotating candidate rings, GEPA-style trace reflection, Pareto archives, quarantined validators, audit anchors, validation gates, and fallback healing.

**Target Upgrade:** Meta-knowledge and future `RGRController`.

**Prerequisites:** `0x000008` Agent Cognitive Cycle, `0x000012` Structured Self-Evaluation, `0x00003C` Genesis Snapshot, `0x000040` Verification Manager, `0x000049` HITL Controller, `0x000067` GEPA Prompt Evolution.

**Affected Artifacts:** `/self/capabilities/cognition/rgr.js`, `/self/core/agent-loop.js`, `/self/core/promotion-gate.js`, `/self/core/validator-quarantine.js`, `/self/infrastructure/audit-logger.js`, `/self/infrastructure/replay-ledger.js`, `/self/config/genesis-levels.json`, `/tests/unit/rgr.test.js`, `/tests/unit/validator-quarantine.test.js`, `/tests/unit/audit-anchor.test.js`.

**Category:** RSI / Meta-Cognition / Audited Agent Evolution.

**Status:** Formal concept blueprint and experiment plan.

**Empirical Measurements:** TBD.

**Core Claim:** Conditional structural optimality under the stated requirements. This blueprint does not claim universal optimality.

---

## 1. Core Update

The original ring-GEPA design was:

```text
outer lifecycle ring
+ rotating inner rings of whole-system mutants
+ GEPA-style reflection
+ Pareto archive
+ validation gate
+ fallback healing
```

The revised architecture is:

```text
outer lifecycle ring
+ rotating inner rings of whole-system mutants
+ GEPA-style reflection
+ Pareto archive
+ quarantined validators
+ immutable or independently governed audit anchors
+ validation gate
+ fallback healing
```

Validator quarantine and external audit anchors move from future work to hard preconditions.

Reward-hacking theory makes this change necessary. The finite-evaluation result argues that finite evaluation and effective optimization create systematic under-investment in unmeasured quality dimensions, and that coverage gets worse as tool counts increase because quality dimensions expand combinatorially while evaluation costs grow more slowly. See [Reward Hacking as Equilibrium under Finite Evaluation](https://arxiv.org/abs/2603.28063).

Revised claim:

```text
RGR is structurally promising only if the validator
and audit anchor are not freely mutable by the same loop they judge.
```

RGR means Recursive GEPA Ring. It keeps the original ring topology and adds a non-self-approving verification layer.

Updated architecture:

```text
deployed lifecycle ring
+ stage-local rotating candidate rings
+ whole-system mutant candidates R_theta
+ GEPA-style reflective mutation
+ Pareto archive
+ verifier-backed audit layer
+ validator quarantine
+ gated promotion
+ fallback healing
```

GEPA supplies the closest algorithmic primitive: trace sampling, natural-language reflection over reasoning/tool-call/tool-output trajectories, prompt mutation, and Pareto frontier combination. RGR generalizes that loop from prompts to whole-system configurations and adds anchored validation. See [GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457).

---

## 2. Formal Object

Let the deployed system at epoch `t` be:

```text
R_Theta_t
```

where `Theta_t` is the full system configuration.

The original configuration was:

```text
Theta_t = (P, C, T, G, M, E, V, U, D, B)
```

Where:

| Symbol | Meaning |
|--------|---------|
| P | Prompts |
| C | Code |
| T | Tool definitions and tool-use policy |
| G | Agent graph and routing topology |
| M | Memory policy |
| E | Evaluator configuration |
| V | Validation suite |
| U | Mutation and reflection policy |
| D | Deployment gate |
| B | Rollback and fallback policy |

The audited architecture splits this into mutable and anchored components:

```text
Theta_t = (mu_t, alpha_t)
```

Mutable system state:

```text
mu_t = (P_t, C_t, T_t, G_t, M_t, E_t, V_int_t, U_strat_t, D_t, B_t)
```

Audited anchor layer:

```text
alpha_t = (V_ext_t, R_anchor_t, U_meta_t)
```

Where:

| Symbol | Meaning |
|--------|---------|
| P | Prompts |
| C | Code |
| T | Tool definitions and tool-use policy |
| G | Agent graph and routing topology |
| M | Memory policy |
| E | Mutable evaluator or scorer used for fast internal selection |
| V_int | Mutable internal validators, tests, and heuristics proposed by candidates |
| U_strat | Mutable mutation, reflection, and search strategy |
| D | Deployment gate proposal and rollout policy |
| B | Rollback and fallback policy |
| V_ext | Frozen external or quarantined verifier used for promotion authority |
| R_anchor | Replay/audit anchor: evidence checker, lineage ledger, and anchor observation store |
| U_meta | Meta-validator for mutations to `U_strat` and validator governance itself |

Normal mutation may update `mu`:

```text
Mutate(mu_t, rho_t) -> mu_t_plus_1
```

Normal mutation may not update the anchor layer:

```text
Mutate(mu_t, rho_t) !-> alpha_t_plus_1
```

In normal operation:

```text
alpha_t_plus_1 = alpha_t
```

Anchor-layer changes require a separate governance path.

This is the core safety primitive. Candidates may propose anchor changes, but those proposals cannot be judged by the candidate, its mutated validator, or its ordinary deployment gate.

`V_int` may evolve, but any mutation to `V_int` must be judged by `V_ext` using a model family disjoint from the mutator family. `U_strat` may evolve, but any mutation to `U_strat` must be judged by `U_meta`, not by the mutated strategy itself.

---

## 3. Recursive Structure

The outer ring has `N` lifecycle nodes:

```text
A_0, A_1, ..., A_N_minus_1
```

with directed edges:

```text
A_i -> A_(i + 1 mod N)
```

Recommended first implementation:

```text
N = 8
```

Stages:

| Node | Stage | Responsibility |
|------|-------|----------------|
| A0 | Input | Intake and route request |
| A1 | Execute | Run deployed system |
| A2 | Observe | Capture trace and state |
| A3 | Score | Compare outputs, costs, and evidence |
| A4 | Reflect | Diagnose failures and opportunities |
| A5 | Mutate | Generate whole-system candidates |
| A6 | Validate | Run anchored tests, safety checks, and regressions |
| A7 | Select | Deploy, preserve, route fallback, or roll back |

A full lap is one improvement epoch:

```text
input -> action -> trace -> score -> reflection -> mutation
-> anchored validation -> audited deployment or rollback
```

Each outer node contains an inner rotating candidate ring:

```text
A_i(t) = [
  R_theta_i_0_t,
  R_theta_i_1_t,
  ...,
  R_theta_i_k_minus_1_t
]
```

Recommended first implementation:

```text
k = 7
```

Each inner candidate is a complete whole-system mutant:

```text
R_theta_i_j_t = R_(mu_i_j_t, alpha_t)
```

All candidates share the same quarantined anchor layer during ordinary evolution:

```text
alpha_t is shared, versioned, and not self-approved by candidates.
```

The recursive structure is:

```text
R_Theta_t =
  C_N(
    C_k(R_(mu_0_0_t, alpha_t), ..., R_(mu_0_k_minus_1_t, alpha_t)),
    ...,
    C_k(R_(mu_N_minus_1_0_t, alpha_t), ..., R_(mu_N_minus_1_k_minus_1_t, alpha_t))
  )
```

This preserves whole-system mutation while preventing candidates from silently rewriting their own judge.

---

## 4. Inner Candidate Roles

For `k = 7`, default roles are:

| Slot | Role | Purpose |
|------|------|---------|
| 0 | Current elite | Best validated incumbent |
| 1 | Performance mutant | Higher task score or lower latency |
| 2 | Robustness mutant | Better distribution shift behavior |
| 3 | Repair mutant | Fixes a known failure trace |
| 4 | Low-cost mutant | Reduces tokens, tool calls, or compute |
| 5 | Safety mutant | Stricter risk controls and adversarial handling |
| 6 | Conservative fallback | Stable rollback and healing candidate |

Roles are labels, not hard restrictions. A candidate may satisfy multiple niches.

Candidate survival should not be plain `ParetoPrune(...).slice(0, cap)`. If the Pareto frontier exceeds the cap, selection must preserve:

- at least one conservative fallback when valid
- at least one safety candidate when valid
- role coverage where possible
- lineage diversity
- crowding or behavioral distance
- strongest anchored audit evidence

---

## 5. GEPA Component

GEPA-style reflection supplies targeted semantic mutation. RGR applies the loop to whole-system candidates, not only prompts.

Core update:

```text
tau_i_j_t = Run(R_(mu_i_j_t, alpha_t), e_t)
rho_i_j_t = Reflect(tau_i_j_t)
mu_prime_i_j_t = Mutate(mu_i_j_t, rho_i_j_t)

A_i(t + 1) =
  Rotate(
    ParetoPrune(A_i(t) union { R_(mu_prime_i_j_t, alpha_t) })
  )

Theta_(t + 1) =
  RGRGate(
    (mu_t, alpha_t),
    Select(union_i A_i(t + 1))
  )
```

Reflection input should include:

- task input and output
- tool calls and tool outputs
- model provider and model ID
- prompt template version
- evaluator scores
- anchored validation failures
- audit evidence diffs
- regression diffs
- risk flags
- cost and latency metrics
- recovery traces from fallback candidates

GEPA gives the reflective Pareto mutation pattern. RGR adds lifecycle staging, candidate rotation, whole-system mutation, fallback healing, duplicate-safe archive merging, and anchored promotion.

---

## 6. Audited Score Vector

Recursive improvement is multi-objective. The original score vector was:

```text
S(theta) = (
  Q,
  H,
  -Risk,
  -Latency,
  -Cost,
  Robustness,
  Novelty,
  Maintainability
)
```

The audited score vector adds anchor-read quality:

```text
S_A(theta) = (
  Q,
  H,
  Q_anchor,
  -Risk,
  -Latency,
  -Cost,
  Robustness,
  Novelty,
  Maintainability
)
```

| Component | Meaning |
|-----------|---------|
| Q | Task quality |
| H | Healing and recovery score |
| Q_anchor | Anchor-read quality from replayable external evidence |
| Risk | Safety, policy, or tampering risk |
| Latency | Runtime delay |
| Cost | Tokens, compute, dollars, or energy |
| Robustness | Performance under distribution shift |
| Novelty | Useful behavioral diversity |
| Maintainability | Clarity and stability of code, prompts, and tools |

The anchor-read score is computed by:

```text
Q_anchor(theta) = R_anchor(Evidence(theta), V_ext)
```

`Q_anchor` is not emitted by the candidate. It is computed by the replay/audit anchor from evidence checked against `V_ext`.

ASG-SI contributes the audit pattern: candidate improvements are promoted only after verifier-backed replay and contract checks, and rewards are decomposed into reconstructible evidence. RGR should import that pattern into its anchor layer. See [Audited Skill-Graph Self-Improvement for Agentic LLMs](https://arxiv.org/abs/2512.23760).

Scalar selection may be used only at the final deployment gate. Archive survival must remain Pareto-based and role-aware.

---

## 7. Pareto Archive

Candidate `a` dominates candidate `b` when:

```text
S_A(a) >= S_A(b) componentwise
and
S_A(a) > S_A(b) in at least one component
```

Because `Q_anchor` is a component of `S_A`, a candidate cannot dominate another candidate unless its anchor-read evidence score is at least as strong. Fast-loop quality, internal validation, or cost gains cannot dominate away anchor evidence.

Pareto update:

```text
P_(t + 1) = ParetoPrune(P_t union C_t)
```

This preserves useful tradeoffs. A conservative fallback can survive even when it is slower than the elite, because it may dominate on recovery, risk, auditability, or rollback readiness.

Archive entries must include:

- candidate hash
- `mu` hash
- `alpha` version
- parent hashes
- lineage metadata
- score vector
- validation receipt
- audit receipt
- anchor observation count
- anchor history
- replay evidence pointer
- rollback pointer
- quarantine status for any proposed anchor changes

Cross-ring behavioral diversity must be tracked to detect archive collapse:

```text
D_cross(P_t) =
  mean_distance(behavior(R_a), behavior(R_b))
  for candidates a, b drawn from different outer-stage rings
```

Low `D_cross` means stage-local rings are converging to the same behavior, even if their role labels differ. Archive pruning must preserve candidates that maintain cross-ring behavioral diversity when their anchored validity holds.

---

## 8. Duplicate-Safe Cyclic Merge

Cyclic propagation can reintroduce the same candidate more than once. The archive reducer must be duplicate-safe.

Define:

```text
A merge B = ParetoPrune(A union B)
```

The merge is:

```text
commutative: A merge B = B merge A
associative: (A merge B) merge C = A merge (B merge C)
idempotent: A merge A = A
```

The archive behaves like a semilattice-style replicated set. Merge order and duplicate circulation cannot corrupt the frontier.

Candidate identity must be content-addressed:

```text
candidateId = hash(muHash, alphaVersion, parentHashes, mutationReceipt)
```

Two entries with equal `candidateId` merge their metadata and keep the stronger anchored evidence receipt.

Distributed workers must also union anchor histories:

```text
history(A merge B, candidateId) =
  history(A, candidateId) union history(B, candidateId)
```

Anchor-history merge is also commutative, associative, and idempotent. Workers may receive anchor observations out of order, but replay scoring must converge on the same lineage evidence set once all observations arrive.

---

## 9. Rotation

The inner ring rotates by stride `r`:

```text
j -> j + r mod k
```

The orbit length is:

```text
L = k / gcd(k, r)
```

Full slot coverage occurs when:

```text
gcd(k, r) = 1
```

For `k = 7`, every nonzero stride covers all slots because `7` is prime. A useful default is:

```text
r = 2
```

Which visits:

```text
0 -> 2 -> 4 -> 6 -> 1 -> 3 -> 5 -> 0
```

Optional outer context rotation:

```text
i -> i + omega mod N
```

For `N = 8`, default:

```text
omega = 3
```

Rotation acts like moving cross-validation. A candidate that survives multiple contexts is less likely to be overfit to one fixed stage.

---

## 10. Validator Quarantine

Validator quarantine is a structural precondition.

Ordinary mutation is allowed over:

```text
mu_t = (P_t, C_t, T_t, G_t, M_t, E_t, V_int_t, U_strat_t, D_t, B_t)
```

Mutation operator:

```text
mu_prime_i_j_t = Mutate(mu_i_j_t, rho_i_j_t)
```

Anchor mutation is quarantined:

```text
alpha_prime = MutateAnchor(alpha_t, rho_t)
```

It does not pass through the ordinary deployment gate. It enters:

```text
alpha_t_plus_1 = GovernedAnchorUpdate(alpha_t, alpha_prime)
```

Governed anchor updates may require:

- separate model family
- external verifier
- human review
- replayable evidence
- contract checks
- canary period
- rollback test
- multi-party approval

Hard constraints:

```text
alpha cannot be modified by the ordinary mutation loop.
V_ext is frozen during ordinary candidate runs.
V_int mutations enter the quarantine path.
V_int mutations are judged by a model family disjoint from the mutator family.
U_strat mutations are judged by U_meta, not by U_strat itself.
Promotion requires verifier-backed evidence.
Audit logs must be replayable.
No candidate can self-approve changes to V_ext, R_anchor, or U_meta.
```

High-risk mutation classes:

| Mutation class | Default path |
|----------------|--------------|
| Prompt rewrite | Ordinary mutation, anchored validation |
| Tool policy change | Ordinary mutation, anchored validation |
| Retrieval policy change | Ordinary mutation, anchored validation |
| Graph route change | Ordinary mutation, anchored validation |
| Fallback trigger change | Ordinary mutation, anchored validation |
| Internal evaluator threshold change | Validator quarantine when promotion-relevant |
| `V_int` validation suite change | Validator quarantine |
| `U_strat` search-policy change | `U_meta` quarantine |
| `V_ext` external verifier change | Anchor governance |
| `R_anchor` audit or ledger change | Anchor governance |
| `U_meta` governance-policy change | Anchor governance |

---

## 11. Audited Promotion Gate

The old promotion rule was:

```text
if Valid(theta_star)
and J_valid(theta_star) > J_valid(Theta_t) + epsilon:
  Theta_(t + 1) = theta_star
else:
  Theta_(t + 1) = Theta_t
```

The audited promotion rule is:

```text
if Valid_star(mu_star, alpha_t) = 1
and Audit_star(mu_star, alpha_t) = 1
and TamperRisk_star(mu_star) <= tau
and AnchorObservations(lineage(mu_star)) >= m
and J_valid_star(mu_star, alpha_t) > J_valid_star(mu_t, alpha_t) + epsilon:
  Theta_(t + 1) = (mu_star, alpha_t)
else:
  Theta_(t + 1) = (mu_t, alpha_t)
```

This gives monotonic improvement only with respect to the frozen or independently governed validator:

```text
J_valid_star(Theta_(t + 1)) >= J_valid_star(Theta_t)
```

It still does not prove real-world monotonicity unless:

```text
J_valid_star models J_deployment
```

It prevents the self-approval loop:

```text
candidate weakens validator
-> candidate passes easier validator
-> candidate promotes itself
```

Promotion is blocked past `Select` until `m` anchor observations have landed in the candidate lineage:

```text
Select may nominate mu_star.
Promote may not deploy mu_star until AnchorObservations(lineage(mu_star)) >= m.
```

Anchor observations are slow-clock evidence. The fast ring may produce provisional champions before anchors arrive, but those champions remain pending. When anchor observations arrive, the system replay-scores the full lineage:

```text
S_A_replay(lineage(mu_star)) =
  ReplayScore(R_anchor, V_ext, lineageEvidence(mu_star))
```

Replay scoring may dethrone a fast-loop champion after it has won local Pareto selection:

```text
if S_A_replay(mu_pending) no longer lies on the anchored frontier:
  demote mu_pending
  reselect from P(t) using updated anchor history
```

The gate must verify:

- candidate validity
- audit receipt exists
- replay evidence is complete
- at least `m` anchor observations landed in lineage
- regression suite passes
- safety checks pass
- rollback checkpoint exists
- tamper risk is below threshold
- candidate improves `J_valid_star` by at least `epsilon`
- candidate does not weaken required validators
- any proposed anchor change is quarantined, not promoted

---

## 12. Self-Healing

Self-healing is archive coverage plus safe routing through anchored validation.

When deployed candidate `Theta_t` fails on input `e`:

```text
Fail(R_Theta_t, e) = 1
```

Fast healing selects:

```text
theta_h =
  argmax_theta_in_P_t [
    H(theta, e)
    + lambda * Q_anchor(theta, e)
    - beta * TamperRisk_star(theta)
  ]
```

subject to:

```text
Valid_star(theta_h) = 1
Audit_star(theta_h) = 1
RollbackReady(theta_h) = 1
TamperRisk_star(theta_h) <= tau
```

Fast healing flow:

```text
deployed system fails
-> choose archived fallback
-> verify fallback evidence
-> route through fallback
-> log recovery trace
-> produce repair mutation
-> validate repair through anchor
```

Slow healing uses failure and recovery traces:

```text
tau_fail = Trace(R_Theta_t, e, failure)
tau_heal = Trace(R_theta_h, e, recovery)
rho_repair = Reflect(tau_fail, tau_heal)
mu_repair = Mutate(mu_t, rho_repair)
Theta_(t + 1) = RGRGate((mu_t, alpha_t), (mu_repair, alpha_t))
```

The archive is not automatically an immune system. It becomes one only when fallback candidates remain independently auditable.

---

## 13. Complete Algorithm

```text
Algorithm: RGR

Inputs:
  R_Theta_0: initial deployed system
  Theta_0: (mu_0, alpha_0)
  N: outer lifecycle ring size
  k: inner candidate ring size
  r: inner rotation stride
  omega: optional outer context stride
  S_A: audited multi-objective score function
  J_valid_star: anchored validation objective
  epsilon: promotion threshold
  tau: maximum tamper-risk threshold
  m: minimum anchor observations required before promotion
  B: evaluation budget

Hard constraints:
  alpha cannot be modified by the ordinary mutation loop.
  V_ext is frozen during ordinary candidate runs.
  V_int mutations enter Validator Quarantine.
  V_int mutations are judged by a model family disjoint from the mutator family.
  U_strat mutations are judged by U_meta, not by U_strat itself.
  Promotion is blocked past Select until m anchor observations land in lineage.
  Promotion requires verifier-backed evidence.
  Audit logs must be replayable.
  No candidate can self-approve changes to V_ext, R_anchor, or U_meta.

Initialize:
  For each outer stage A_i:
    A_i(0) = [
      R_(mu_i_0_0, alpha_0),
      R_(mu_i_1_0, alpha_0),
      ...,
      R_(mu_i_k_minus_1_0, alpha_0)
    ]

For each epoch t:
  1. Receive environmental input e_t.
  2. Run deployed system: y_t = R_(mu_t, alpha_t)(e_t).
  3. Trace deployed execution: tau_t = Trace(R_(mu_t, alpha_t), e_t, y_t).
  4. Rotate inner rings: j -> j + r mod k.
  5. Select active candidates: C_i(t) subset A_i(t).
  6. Run candidates in sandbox or shadow mode: tau_i_j_t = Run(R_(mu_i_j_t, alpha_t), e_t).
  7. Score candidates using S_A.
  8. Reflect on traces: rho_i_j_t = Reflect(tau_i_j_t).
  9. Mutate mutable system components only: mu_prime_i_j_t = Mutate(mu_i_j_t, rho_i_j_t).
  10. If mutation proposes V_int changes, send proposal to Validator Quarantine.
      If mutation proposes U_strat changes, send proposal to U_meta quarantine.
      If mutation proposes V_ext, R_anchor, or U_meta changes, send proposal to anchor governance.
  11. Validate new candidates with Valid_star, Audit_star, TamperRisk_star, and Q_anchor.
  12. Pareto-prune each inner ring:
      A_i(t + 1) = Rotate(ParetoPrune(A_i(t) union { R_(mu_prime_i_j_t, alpha_t) })).
  13. Merge local archives idempotently and union anchor histories:
      P(t + 1) = merge_i A_i(t + 1).
  14. Select promotion candidate: mu_star = Select(P(t + 1)).
  15. Promote through audited gate:
      if Valid_star(mu_star, alpha_t) = 1
      and Audit_star(mu_star, alpha_t) = 1
      and TamperRisk_star(mu_star) <= tau
      and AnchorObservations(lineage(mu_star)) >= m
      and J_valid_star(mu_star, alpha_t) > J_valid_star(mu_t, alpha_t) + epsilon:
        Theta_(t + 1) = (mu_star, alpha_t)
      else:
        Theta_(t + 1) = (mu_t, alpha_t)
  16. On anchor arrival:
      replay-score affected lineages with R_anchor and V_ext
      update Q_anchor and S_A
      demote fast-loop champions that leave the anchored frontier
      reselect pending promotions if needed
  17. If deployed failure occurs:
      choose theta_heal from archive using H + Q_anchor - TamperRisk
      route through theta_heal only if Valid_star and Audit_star pass
      create repair mutation from failure and healing traces

Outputs:
  Updated deployed system R_Theta_(t + 1)
  Updated archive P(t + 1)
  Replay/audit ledger in R_anchor
```

---

## 14. Reference Data Model

```javascript
class Candidate {
  constructor({ mu, alphaVersion, role, parents = [] }) {
    this.mu = mu;
    this.alphaVersion = alphaVersion;
    this.role = role;
    this.scores = null;
    this.valid = false;
    this.audit = null;
    this.tamperRisk = null;
    this.trace = null;
    this.parents = parents;
    this.lineage = [];
    this.anchorHistory = [];
    this.anchorObservationCount = 0;
    this.quarantine = null;
  }
}

class AnchorLayer {
  constructor({ vExt, rAnchor, uMeta }) {
    this.vExt = vExt;
    this.rAnchor = rAnchor;
    this.uMeta = uMeta;
    this.version = rAnchor.currentAnchorVersion();
  }
}

class InnerRing {
  constructor(candidates, { stride = 2, cap = 7 } = {}) {
    this.candidates = candidates;
    this.stride = stride;
    this.cap = cap;
    this.pointer = 0;
  }

  active(count = 1) {
    const idxs = [];
    for (let m = 0; m < count; m += 1) {
      idxs.push((this.pointer + m * this.stride) % this.candidates.length);
    }
    return idxs.map((idx) => this.candidates[idx]);
  }

  rotate() {
    this.pointer = (this.pointer + this.stride) % this.candidates.length;
  }

  update(newCandidates) {
    const merged = this.candidates.concat(newCandidates);
    this.candidates = capFrontier(paretoPrune(merged), this.cap);
    this.rotate();
  }
}

function paretoDominates(a, b) {
  const geAll = a.scores.every((score, idx) => score >= b.scores[idx]);
  const gtOne = a.scores.some((score, idx) => score > b.scores[idx]);
  return geAll && gtOne;
}

function paretoPrune(candidates) {
  return candidates.filter((candidate) => {
    return !candidates.some((other) => {
      return other !== candidate && paretoDominates(other, candidate);
    });
  });
}

function capFrontier(frontier, cap) {
  const rolePriority = [
    'current_elite',
    'conservative_fallback',
    'safety_mutant',
    'repair_mutant',
    'robustness_mutant',
    'performance_mutant',
    'low_cost_mutant'
  ];
  const selected = [];
  for (const role of rolePriority) {
    const candidate = frontier.find((item) => item.role === role && !selected.includes(item));
    if (candidate) selected.push(candidate);
    if (selected.length >= cap) return selected;
  }
  for (const candidate of frontier) {
    if (!selected.includes(candidate)) selected.push(candidate);
    if (selected.length >= cap) break;
  }
  return selected;
}

function auditedGate(current, candidate, anchor, options = {}) {
  const epsilon = options.epsilon ?? 0;
  const tau = options.tamperRiskThreshold ?? 0;
  const minAnchorObservations = options.minAnchorObservations ?? 0;
  if (
    anchor.vExt.valid(candidate, anchor) &&
    anchor.rAnchor.audit(candidate, anchor) &&
    anchor.rAnchor.tamperRisk(candidate.mu) <= tau &&
    candidate.anchorObservationCount >= minAnchorObservations &&
    anchor.rAnchor.validationScore(candidate.mu, anchor.vExt) >
      anchor.rAnchor.validationScore(current.mu, anchor.vExt) + epsilon
  ) {
    return { mu: candidate.mu, alpha: current.alpha };
  }
  return current;
}
```

---

## 15. Implementation Pathway

### 15.1 Candidate Representation

Create a serializable `mu` schema that can represent:

- prompts
- code patch references
- tool policies
- routing tables
- memory policies
- mutation and reflection policies
- deployment gate settings
- rollback policy

The schema must support hashing, diffing, lineage tracking, replay, and rollback.

### 15.2 Anchor Representation

Create a versioned `alpha` schema that can represent:

- frozen external verifier `V_ext`
- replay and audit anchor `R_anchor`
- meta-validator `U_meta`
- anchor observation history
- lineage and rollback ledger inside `R_anchor`

The schema must support immutable version IDs and governed update proposals.

### 15.3 Trace Capture

Extend the agent loop trace so every candidate run can record:

- selected tools
- tool arguments and outputs
- model provider and model ID
- prompt template version
- memory reads and writes
- validation results
- audit receipts
- cost metrics
- risk flags
- final output

### 15.4 Ring Controller

Implement an `RGRController` with:

- outer lifecycle stage registry
- per-stage inner ring archive
- rotation state
- active candidate sampler
- Pareto reducer
- role-aware frontier capper
- duplicate-safe merge reducer
- anchored promotion gate
- fallback selector
- validator quarantine handoff

### 15.5 Hard Modules

Required modules:

| Module | Responsibility |
|--------|----------------|
| `ValidatorQuarantine` | Holds proposed evaluator, validator, audit, ledger, and promotion-policy mutations outside ordinary promotion |
| `AuditAnchor` | Verifies replayable evidence and computes audit-anchor score |
| `ReplayLedger` | Stores candidate lineage, evidence receipts, anchor versions, and rollback pointers |
| `TamperRiskScorer` | Scores evaluator, validator, gate, and ledger interference risk |
| `FallbackVerifier` | Revalidates archived fallback candidates before healing routes |
| `AnchoredPromotionGate` | Applies audited promotion rule |
| `AnchorObservationGate` | Blocks promotion until `m` lineage anchor observations arrive |
| `BehavioralDiversityMonitor` | Tracks cross-ring behavioral diversity and archive collapse |

### 15.6 Mutation Operators

Initial ordinary mutation operators:

- prompt rewrite from trace reflection
- tool policy change
- retrieval policy change
- graph route change
- fallback trigger change
- rollback policy refinement

Quarantined mutation operators:

- evaluator threshold change
- `V_int` validation suite expansion or contraction
- `U_strat` mutation strategy change
- `V_ext` verifier change
- `R_anchor` audit or ledger change
- `U_meta` meta-validator change

Validator changes require stricter approval than prompt, tool, route, or fallback changes.

### 15.7 Sandbox and Shadow Mode

Candidate systems must run in shadow mode or sandbox mode before promotion. They may observe production inputs but cannot mutate the deployed substrate until gated.

Anchor-layer code must not run from candidate-owned mutable paths unless the anchor governance path has promoted a new anchor version.

---

## 16. Safety and Governance

Required controls:

- sandboxed execution
- shadow-mode candidate runs
- validation gates
- validator quarantine
- immutable or independently governed audit anchors
- rate-limited promotion
- rollback checkpoints
- canary deployment
- replayable audit logs
- external validation data
- adversarial tests
- human review for high-risk changes
- separation between mutator and validator
- periodic fallback revalidation

High-risk failure modes:

- evaluator gaming
- validation overfitting
- archive collapse
- loss of diversity
- unsafe self-modification
- brittle candidate promotion
- stale fallback candidates
- shared hidden flaw across all candidates
- recursive work explosion
- self-generated traces becoming self-confirming
- validator mutation weakening safety gates
- reward tampering against the promotion mechanism
- ledger or audit-evidence manipulation

Hard rule:

```text
Candidates may propose evaluator or validator changes.
Validator changes require quarantine.
Anchor changes require governed update.
No candidate can approve its own judge.
```

---

## 17. Theorems

### Theorem 12: Finite-Evaluation Pressure

Let true system quality be multi-dimensional:

```text
Q_star(theta) = sum_l w_l * q_l(theta), for l in 1..d
```

Let the evaluator measure only subset `M`:

```text
J_eval(theta) = sum_l_in_M w_hat_l * q_l(theta)
```

If the optimizer is effective, evaluation is finite, and unmeasured dimensions interact with measured dimensions, then optimization pressure tends to increase measured dimensions while neglecting or degrading unmeasured dimensions.

This is the RGR version of the finite-evaluation reward-hacking result. The consequence is that a Pareto vector with nine dimensions is better than a scalar reward, but it is still finite.

Therefore RGR requires:

- external anchors
- auditable evidence
- quarantined validator mutation
- periodic adversarial validation
- human or independent oversight for high-risk changes

### Theorem 13: Validator Quarantine Necessity

If a candidate can modify the validator that decides its own promotion, then the promotion gate is not stable under recursive optimization.

Proof sketch:

```text
promotion condition: V(mu_c) = 1
```

If candidate `c` can mutate `V`, it can search over:

```text
(mu_c, V_prime)
```

instead of only:

```text
mu_c
```

The optimization target becomes:

```text
max_(mu_c, V_prime) indicator[V_prime(mu_c) = 1]
```

not:

```text
max_mu_c Q_star(mu_c)
```

A sufficiently capable optimizer can improve promotion probability by weakening or exploiting `V_prime`, even if true quality declines.

Therefore:

```text
Mutate(mu_t) !-> V_ext
```

and changes to `V_ext` must use a separate governed process.

### Theorem 14: Anchored Monotonic Promotion

Let `J_valid_star` be computed by an anchored validator that the candidate cannot modify during ordinary mutation.

If promotion uses:

```text
if Valid_star(mu_star, alpha_t) = 1
and Audit_star(mu_star, alpha_t) = 1
and J_valid_star(mu_star, alpha_t) > J_valid_star(mu_t, alpha_t) + epsilon:
  Theta_(t + 1) = (mu_star, alpha_t)
else:
  Theta_(t + 1) = (mu_t, alpha_t)
```

then:

```text
J_valid_star(Theta_(t + 1)) >= J_valid_star(Theta_t)
```

with respect to the anchored validator.

Proof:

If promotion occurs:

```text
J_valid_star(Theta_(t + 1))
= J_valid_star(mu_star, alpha_t)
> J_valid_star(mu_t, alpha_t) + epsilon
```

If promotion does not occur:

```text
Theta_(t + 1) = Theta_t
```

Therefore:

```text
J_valid_star(Theta_(t + 1)) >= J_valid_star(Theta_t)
```

This theorem is stronger than the original monotonic promotion theorem because the candidate cannot rewrite the validator used to prove monotonicity.

### Theorem 15: Audited Fallback Self-Healing

Let the deployed system fail on input `e`:

```text
Fail(R_Theta_t, e) = 1
```

Let the archive contain candidate `theta_h = (mu_h, alpha_t)` such that:

```text
Fail(R_theta_h, e) = 0
```

Fast healing is valid only if:

```text
Valid_star(theta_h) = 1
Audit_star(theta_h) = 1
TamperRisk_star(theta_h) <= tau
```

Then routing through `theta_h` restores operation for `e` under the anchored validator.

Consequence:

```text
The archive is not automatically an immune system.
It becomes one only when archived candidates remain independently auditable.
```

---

## 18. Relationship to Reploid Levels

| RSI Level | Relationship |
|-----------|--------------|
| L0 | Candidates may add ordinary tools or workflows |
| L1 | Candidates may improve meta-tooling and ordinary evaluators |
| L2 | Candidates may propose substrate changes, gated by rollback |
| L3 | RGR is primarily an L3 bounded self-improvement loop |
| L4 | RGR can frame broader autonomy experiments, but does not prove AGI |

Anchor updates are never ordinary L3 self-approval. They require the governed anchor path.

---

## 19. Source Integration

| Source | RGR inherits | RGR extends | RGR must add |
|--------|----------------|---------------|----------------|
| GEPA | Reflective mutation and Pareto frontier | Whole-system `R_theta`, lifecycle ring, fallback archive | Empirical ablations |
| AlphaEvolve | Population search, whole-program mutation, automated scoring | Online fallback healing and stage-indexed rings | Objective verifier discipline |
| ADAS / Meta Agent Search | Archive-driven whole-agent invention | Bounded rings, rotation, Pareto pruning | External validation comparable to held-out task evals |
| Reward-hacking theory | Warning about finite evaluators | Multi-objective score vector | Validator quarantine as hard precondition |
| Weng reward-hacking survey | Reward tampering taxonomy | Evaluator-tamper risk metric | Separation of mutator and judge |
| ASG-SI | Verifier-backed replay and audit logs | Rotating whole-system archive | Integration as anchor layer |
| RSI workshop | Systems, evals, and governance framing | Formal ring topology | Experiments and benchmarks |
| Godel Agent | Self-referential mutation | Bounded archive and gated promotion | Stronger anti-drift evaluator design |

Positioning:

```text
GEPA = reflective Pareto prompt evolution.
RGR = Recursive GEPA Ring: reflective Pareto whole-system evolution with audited anchors.
```

AlphaEvolve validates whole-program evolutionary search under strong external evaluators. ADAS validates candidate-as-agent search. Godel Agent validates self-referential mutation. ASG-SI supplies the audit primitive. Reward-hacking theory supplies the warning that finite evaluators create structural blind spots.

---

## 20. Revised Claim and Novelty

Pre-quarantine claim:

```text
The ring-GEPA topology is a bounded, self-healing, system-level
training/evaluation architecture for agentic AI.
```

Revised claim:

```text
Recursive GEPA Ring is a bounded, self-healing, system-level
recursive self-improvement architecture in which rotating rings of
whole-system mutants are evolved by GEPA-style reflection and Pareto
pruning, but promoted only through quarantined, verifier-backed,
independently auditable validation gates.
```

Revised requirements:

| ID | Requirement |
|----|-------------|
| A1 | Whole-system self-reference |
| A2 | Whole-system mutation |
| A3 | Bounded candidate population |
| A4 | Repeated exposure to diverse contexts |
| A5 | Multi-objective evaluation |
| A6 | Duplicate-safe cyclic reduction |
| A7 | Validated promotion |
| A8 | Fallback and self-healing archive |
| A9 | Finite runtime and non-explosive recursion |
| A10 | Validator quarantine |
| A11 | Verifier-backed audit evidence |
| A12 | Separation between mutator and judge |
| A13 | Non-self-approved anchor updates |

Revised theorem:

```text
Among architectures satisfying A1-A13, RGR
is a minimal Pareto-preserving topology for bounded recursive
self-improvement with fallback healing and governed deployment.
```

Novelty statement:

```text
RGR appears novel as a bounded recursive
self-improvement architecture that places rotating per-stage rings of
full-system mutant candidates inside a deployed lifecycle ring, uses
GEPA-style trace reflection and Pareto pruning to evolve candidates,
and promotes candidates only through quarantined, verifier-backed
audit gates.
```

Avoid unsupported claims:

```text
first recursive self-improving AI
first genetic algorithm for agents
first agent optimizer
first self-healing AI
```

Defensible positioning:

```text
RGR is a synthesis architecture combining GEPA-style reflective
Pareto search, ADAS-style whole-agent design, AlphaEvolve-style
verifier-backed evolutionary programming, ASG-SI-style audit evidence,
and a ring-structured recursive topology.
```

---

## 21. Baselines and Ablations

Baselines:

| ID | Baseline |
|----|----------|
| B0 | No optimization |
| B1 | GEPA prompt-only |
| B2 | ADAS / Meta Agent Search style archive |
| B3 | AlphaEvolve-style population search with external verifier |
| B4 | Vanilla GA over prompts and configs |
| B5 | Island-model GA without ring rotation |
| B6 | RRG without validator quarantine |
| B7 | RRG without external anchor |
| B8 | RRG without Pareto |
| B9 | RRG without fallback archive |
| B10 | Full RGR |

Ablations:

| Ablation | Purpose |
|----------|---------|
| Allow candidates to mutate validator | Measure reward-hacking rate |
| Same model as mutator and judge | Test judge/generator coupling risk |
| Separate model family for judge | Test model-family separation |
| Frozen anchor reader | Test stable validation |
| ASG-SI-style replay contracts | Test audit-backed promotion |
| No audit logging | Test reproducibility failure |
| No validator quarantine | Test self-approval failure |
| No external benchmark holdout | Test overfitting |
| No adversarial validation | Test exploit discovery |
| No role-aware frontier cap | Test fallback and safety candidate loss |

---

## 22. Primary Metrics

| Metric | Definition |
|--------|------------|
| Task success | Solved tasks divided by total tasks |
| Validation gain | `J_valid_star(Theta_(t + 1)) - J_valid_star(Theta_t)` |
| Reward-hacking gap | Validator score minus external audit score |
| Evaluator drift | Change in validator behavior over epochs |
| Validator-tamper attempts | Candidate proposals that modify evaluator, gate, or ledger |
| Anchor disagreement | Disagreement between mutable evaluator and frozen anchor |
| Anchor observation lag | Pending candidates waiting for `m` lineage anchor observations |
| Slow-clock dethronement rate | Pending or selected champions demoted after anchor replay scoring |
| Audit pass rate | Fraction of candidates with replayable evidence |
| Self-approval rate | Fraction of candidate improvements approved by modified validators |
| Fallback validity | Percent of fallback candidates still passing frozen verifier |
| Recovery success | Recovered failures divided by total failures |
| Recovery latency | Detection-to-routing delay |
| Regression after promotion | Live regressions after audited promotion |
| Unmeasured-dimension failure | Failures outside current score vector |
| Candidate diversity | Entropy or pairwise behavioral distance |
| Cross-ring behavioral diversity | Behavioral distance between candidates from different outer-stage rings |
| Archive collapse rate | Epochs where cross-ring diversity falls below the collapse threshold |
| Pareto frontier size | Number of non-dominated candidates |
| Cost per improvement | Cost divided by validated promotion |
| Rollout efficiency | Improvement divided by rollout count |
| Archive half-life | How long a fallback remains useful |
| Safety violation rate | Safety failures divided by epochs |
| Evaluator disagreement | Variance among judges, tests, and humans |

---

## 23. Limitations

RGR does not guarantee universal optimality. No optimizer can be best over all objective distributions without assumptions about the environment.

The system depends on anchor quality. If anchored validators are wrong, narrow, stale, or gameable, candidate selection can still drift.

The audit score expands coverage but does not eliminate reward hacking. It makes promotion evidence more reconstructible and harder to self-approve.

Whole-system candidates cost more than local patches. Sparse evaluation and periodic full sweeps are required.

The architecture improves system behavior. It does not necessarily create new latent model capability unless mutation includes model replacement, fine-tuning, tool creation, or training-pipeline changes.

Self-healing only works if the archive contains a validated, audited candidate that handles the failure.

Anchored validation monotonicity is not deployment monotonicity unless the anchor models deployment reality.

---

## 24. Conditional Minimality

RGR is minimal under these requirements:

| Requirement | Needed component |
|-------------|------------------|
| Whole-system self-reference | `R_theta` candidates |
| Whole-system mutation | Full `mu` schema |
| Bounded candidate population | Inner ring cap `k` |
| Repeated exposure to diverse contexts | Rotation |
| Multi-objective evaluation | Score vector |
| Duplicate-safe cyclic reduction | Idempotent Pareto merge |
| Validated promotion | Deployment gate |
| Fallback and self-healing archive | Pareto archive |
| Finite runtime | Population cap and evaluation budget |
| Validator quarantine | Anchor mutation split |
| Verifier-backed audit evidence | `R_anchor` and replay ledger |
| Separation between mutator and judge | Independent or governed anchor layer |
| Non-self-approved anchor updates | `GovernedAnchorUpdate` |

Removing any component breaks at least one requirement.

---

## 25. Evolution Opportunities

- Add crowding distance to preserve behavioral diversity.
- Add lineage-aware recombination between candidates with complementary strengths.
- Add per-stage mutation operators tuned to the outer lifecycle stage.
- Add live archive decay for stale fallback candidates.
- Add human review queues for validator, tool, and deployment policy changes.
- Add process-level agent evaluation with trace-based scoring.
- Add swarm archive synchronization using the idempotent merge reducer.
- Add ASG-SI-style skill graph receipts for promoted improvements.
- Add adversarial evaluator probes that search for validator tampering.
- Add anchor-family separation for judge and mutator model providers.

---

## 26. Condensed Definition

RGR, Recursive GEPA Ring, is:

```text
a bounded recursive self-improvement architecture in which a deployed
cyclic agent lifecycle maintains, at each stage, a rotating inner ring
of complete whole-system mutant candidates R_theta. Each candidate is
run, traced, reflected on, mutated, validated, Pareto-pruned, retained
as fallback memory, and promoted only through a quarantined
verifier-backed audit gate that the candidate cannot self-modify.
```

Formal structure:

```text
R_Theta_t =
  C_N(
    C_k(R_(mu_0_0_t, alpha_t), ..., R_(mu_0_k_minus_1_t, alpha_t)),
    ...,
    C_k(R_(mu_N_minus_1_0_t, alpha_t), ..., R_(mu_N_minus_1_k_minus_1_t, alpha_t))
  )
```

Normal mutation:

```text
mu_prime_i_j_t = Mutate(mu_i_j_t, rho_i_j_t)
```

Anchor constraint:

```text
alpha_t_plus_1 = alpha_t
```

unless:

```text
alpha_t_plus_1 = GovernedAnchorUpdate(alpha_t, alpha_prime)
```

Archive update:

```text
A_i(t + 1) =
  Rotate(
    ParetoPrune(
      A_i(t) union { R_(mu_prime_i_j_t, alpha_t) }
    )
  )
```

Audited promotion:

```text
if Valid_star(mu_star, alpha_t) = 1
and Audit_star(mu_star, alpha_t) = 1
and TamperRisk_star(mu_star) <= tau
and AnchorObservations(lineage(mu_star)) >= m
and J_valid_star(mu_star, alpha_t) > J_valid_star(mu_t, alpha_t) + epsilon:
  Theta_(t + 1) = (mu_star, alpha_t)
else:
  Theta_(t + 1) = (mu_t, alpha_t)
```

Recommended first implementation:

```text
N = 8
k = 7
r = 2
omega = 3
56 total archive candidates
1 or 2 active candidates per node per epoch
about 4 Pareto survivors per inner ring
about 3 new mutations per inner ring
at most 1 promoted candidate per epoch
rollback archive always preserved
validator mutation quarantined
audit anchor version-frozen
promotion blocked until m lineage anchor observations land
anchor histories unioned during worker archive merge
```

---

## 27. Verdict

The original ring-GEPA idea is structurally strong but incomplete.

The central failure mode is:

```text
A mutable validator inside a recursive optimizer is not a minor risk.
It is the central failure mode.
```

Without validator quarantine and external audit anchors:

```text
RRG risks becoming a reward-hacking amplifier.
```

With validator quarantine and external audit anchors:

```text
RGR becomes a coherent research architecture for bounded recursive
self-improvement, whole-system mutation, Pareto-preserved diversity,
and self-healing deployment.
```

---

## References

- [Reward Hacking as Equilibrium under Finite Evaluation](https://arxiv.org/abs/2603.28063)
- [GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457)
- [Audited Skill-Graph Self-Improvement for Agentic LLMs via Verifiable Rewards, Experience Synthesis, and Continual Memory](https://arxiv.org/abs/2512.23760)
- [AlphaEvolve: A Gemini-powered coding agent for designing advanced algorithms](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)
- [Automated Design of Agentic Systems](https://arxiv.org/abs/2408.08435)
- [Reward Hacking in Reinforcement Learning](https://lilianweng.github.io/posts/2024-11-28-reward-hacking/)
- [ICLR 2026 Workshop on Recursive Self-Improvement](https://recursive-workshop.github.io/)
- [Godel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement](https://arxiv.org/abs/2410.04444)

---

*Last updated: May 2026*
