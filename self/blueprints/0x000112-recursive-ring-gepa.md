# Blueprint 0x000112: Recursive Ring-GEPA

**Objective:** Define a bounded whole-system recursive self-improvement architecture that uses rotating candidate rings, GEPA-style trace reflection, Pareto archives, validation gates, and fallback healing.

**Target Upgrade:** Meta-knowledge and future `RecursiveRingGEPA` controller.

**Prerequisites:** `0x000008` Agent Cognitive Cycle, `0x000012` Structured Self-Evaluation, `0x00003C` Genesis Snapshot, `0x000040` Verification Manager, `0x000049` HITL Controller, `0x000067` GEPA Prompt Evolution.

**Affected Artifacts:** `/self/capabilities/cognition/recursive-ring-gepa.js`, `/self/core/agent-loop.js`, `/self/infrastructure/audit-logger.js`, `/self/config/genesis-levels.json`, `/tests/unit/recursive-ring-gepa.test.js`.

**Category:** RSI/Meta-Cognition.

**Status:** Formal concept blueprint and experiment plan.

**Empirical Measurements:** TBD.

**Core Claim:** Conditional structural optimality under the stated requirements. This blueprint does not claim universal optimality.

---

## 1. Strategic Imperative

A deployed agent is not only a model. It is a compound runtime containing prompts, tools, routing, memory, validators, evaluators, rollback logic, graph topology, and deployment policy.

Recursive self-improvement requires the system to improve not only outputs, but also the process that improves the system. That means candidate mutations must be allowed to modify:

- how the agent acts
- how it observes
- how it evaluates
- how it reflects
- how it mutates
- how it validates
- how it deploys
- how it rolls back
- how it heals from failure

Prompt-only mutation cannot cover that surface. Recursive Ring-GEPA treats each candidate as a complete system configuration:

```text
R_theta = deployed agent system built from theta
```

The architecture sits above base-model training and post-training. It optimizes the Reploid system around one or more models.

---

## 2. Architecture Summary

Recursive Ring-GEPA has two explicit levels:

```text
outer lifecycle ring:
A0 -> A1 -> A2 -> A3 -> A4 -> A5 -> A6 -> A7 -> A0

inner candidate ring per outer node:
R_theta_i_0 -> R_theta_i_1 -> ... -> R_theta_i_k_minus_1 -> R_theta_i_0
```

The key rule:

```text
Each inner node is a full candidate version of the whole deployed system.
It is not a local subnode.
```

Recommended first configuration:

```text
N = 8 outer lifecycle stages
k = 7 candidate slots per stage
N * k = 56 archived whole-system candidates
```

This creates bounded diversity without recursive candidate explosion.

---

## 3. Outer Lifecycle Ring

The outer ring is a directed cycle:

```text
A_i -> A_(i + 1 mod N)
```

Recommended stages:

| Node | Stage | Responsibility |
|------|-------|----------------|
| A0 | Input | Intake and route request |
| A1 | Execute | Run deployed system |
| A2 | Observe | Capture trace and state |
| A3 | Score | Compare outputs and costs |
| A4 | Reflect | Diagnose failures and opportunities |
| A5 | Mutate | Generate whole-system candidates |
| A6 | Validate | Run tests, safety checks, and regressions |
| A7 | Select | Deploy, preserve, or roll back |

A full lap is one improvement epoch:

```text
input -> action -> trace -> score -> reflection -> mutation -> validation -> deployment or rollback
```

The ring closes because deployment changes the next execution.

---

## 4. Inner Candidate Rings

Each outer node owns a bounded candidate ring:

```text
A_i(t) = [
  R_theta_i_0_t,
  R_theta_i_1_t,
  ...,
  R_theta_i_k_minus_1_t
]
```

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

---

## 5. System Configuration

The genotype is:

```text
theta = (P, C, T, G, M, E, V, U, D, B)
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

The phenotype is:

```text
R_theta(e) -> output, trace, state transition
```

Whole-system mutation means any field may change, subject to validation and governance.

---

## 6. GEPA Component

GEPA-style reflection supplies targeted semantic mutation. Recursive Ring-GEPA applies that loop to full system candidates, not only prompts.

Core update:

```text
tau_i_j_t = Run(R_theta_i_j_t, e_t)
rho_i_j_t = Reflect(tau_i_j_t)
theta_prime_i_j_t = Mutate(theta_i_j_t, rho_i_j_t)

A_i(t + 1) =
  Rotate(
    ParetoPrune(A_i(t) union { theta_prime_i_j_t })
  )

Theta_(t + 1) =
  Gate(
    Theta_t,
    Select(union_i A_i(t + 1))
  )
```

Reflection input should include:

- task input and output
- tool calls and tool outputs
- evaluator scores
- validation failures
- regression diffs
- risk flags
- cost and latency metrics
- recovery traces from fallback candidates

---

## 7. Score Vector

Recursive improvement is multi-objective. Candidates receive a vector score:

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

| Component | Meaning |
|-----------|---------|
| Q | Task quality |
| H | Healing and recovery score |
| Risk | Safety, policy, or failure risk |
| Latency | Runtime delay |
| Cost | Tokens, compute, dollars, or energy |
| Robustness | Performance under distribution shift |
| Novelty | Useful behavioral diversity |
| Maintainability | Clarity and stability of code, prompts, and tools |

Scalar selection may be used only at the final deployment gate. Archive survival should remain Pareto-based.

---

## 8. Pareto Archive

Candidate `a` dominates candidate `b` when:

```text
S(a) >= S(b) componentwise
and
S(a) > S(b) in at least one component
```

Pareto update:

```text
P_(t + 1) = ParetoPrune(P_t union C_t)
```

This preserves useful tradeoffs. A conservative fallback can survive even when it is slower than the elite, because it may dominate on recovery or risk.

---

## 9. Duplicate-Safe Cyclic Merge

Cyclic propagation can reintroduce the same candidate more than once. The archive reducer must therefore be duplicate-safe.

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

---

## 10. Rotation

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

For `k = 7`, every nonzero stride covers all slots because 7 is prime. A useful default is:

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

## 11. Promotion Gate

The deployed system must not accept every mutation.

Promotion rule:

```text
if Valid(theta_star)
and J_valid(theta_star) > J_valid(Theta_t) + epsilon:
  Theta_(t + 1) = theta_star
else:
  Theta_(t + 1) = Theta_t
```

This guarantees monotonic validation performance:

```text
J_valid(Theta_(t + 1)) >= J_valid(Theta_t)
```

It does not guarantee live-world monotonic improvement unless validation faithfully models deployment.

---

## 12. Self-Healing

Self-healing is archive coverage plus safe routing.

When deployed candidate `Theta_t` fails on input `e`:

```text
Fail(R_Theta_t, e) = 1
```

The healing selector chooses:

```text
theta_h = argmax_theta_in_P_t H(theta, e)
```

If:

```text
Valid(theta_h) = 1
Fail(R_theta_h, e) = 0
```

Then the system routes through:

```text
R_Theta_t -> R_theta_h
```

The failure and healing traces then become mutation input:

```text
rho_repair = Reflect(tau_fail, tau_heal)
theta_repair = Mutate(Theta_t, rho_repair)
```

There are two healing paths:

- Fast healing: switch to a validated fallback candidate.
- Repair healing: generate, validate, and promote a repair mutation.

---

## 13. Complete Algorithm

```text
Algorithm: Recursive Ring-GEPA

Inputs:
  R_Theta_0: initial deployed whole-system ring
  N: outer lifecycle ring size
  k: inner candidate ring size
  r: inner rotation stride
  omega: optional outer context stride
  S: multi-objective score function
  J_valid: validation objective
  epsilon: promotion threshold
  B: evaluation budget
  P_0: initial candidate archive

Recommended defaults:
  N = 8
  k = 7
  r = 2
  omega = 3
  active candidates per outer node per epoch = 1 or 2
  promotion limit = at most 1 candidate per epoch

For each epoch t:
  1. Receive environmental input e_t.
  2. Run deployed system: y_t = R_Theta_t(e_t).
  3. Trace deployed execution.
  4. Rotate inner rings.
  5. Select active candidates.
  6. Run candidates in sandbox or shadow mode.
  7. Score candidates with vector S(theta).
  8. Reflect on execution traces.
  9. Mutate whole-system candidates.
  10. Optionally recombine candidates.
  11. Validate new candidates.
  12. Pareto-prune each inner ring.
  13. Merge local archives.
  14. Select deployment candidate.
  15. Promote only if gated.
  16. If deployed failure occurs, route through validated fallback and create repair mutation.

Outputs:
  Updated deployed system R_Theta_(t + 1)
  Updated archive P_(t + 1)
```

---

## 14. Reference Data Model

```javascript
class Candidate {
  constructor(theta, role) {
    this.theta = theta;
    this.role = role;
    this.scores = null;
    this.valid = false;
    this.trace = null;
    this.parents = [];
    this.lineage = [];
  }
}

class InnerRing {
  constructor(candidates, stride = 2, cap = 7) {
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
    this.candidates = paretoPrune(merged).slice(0, this.cap);
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

function gate(currentTheta, candidate, validationScore, epsilon) {
  if (
    candidate.valid &&
    validationScore(candidate.theta) > validationScore(currentTheta) + epsilon
  ) {
    return candidate.theta;
  }
  return currentTheta;
}
```

---

## 15. Implementation Pathway

### 15.1 Candidate Representation

Create a serializable `theta` schema that can represent:

- prompts
- tool policies
- routing tables
- memory policies
- evaluator configuration
- validation suite references
- mutation rules
- deployment gate settings
- rollback policy

The schema must support hashing, diffing, lineage tracking, and rollback.

### 15.2 Trace Capture

Extend the agent loop trace so every candidate run can record:

- selected tools
- tool arguments and outputs
- model provider and model ID
- prompt template version
- memory reads and writes
- validation results
- cost metrics
- risk flags
- final output

### 15.3 Ring Controller

Implement a `RecursiveRingGEPA` controller with:

- outer lifecycle stage registry
- per-stage inner ring archive
- rotation state
- active candidate sampler
- Pareto reducer
- merge reducer
- promotion gate
- fallback selector

### 15.4 Mutation Operators

Initial mutation operators:

- prompt rewrite from trace reflection
- tool policy change
- retrieval policy change
- evaluator threshold change
- graph route change
- fallback trigger change
- validation suite expansion

Validator changes require stricter approval than ordinary prompt or routing changes.

### 15.5 Sandbox and Shadow Mode

Candidate systems must run in shadow mode or sandbox mode before promotion. They may observe production inputs but cannot mutate the deployed substrate until gated.

### 15.6 Deployment Gate

The gate must verify:

- candidate validity
- regression suite pass
- safety checks pass
- rollback checkpoint exists
- candidate improves `J_valid` by at least `epsilon`
- candidate does not weaken required validators

---

## 16. Safety and Governance

Required controls:

- sandboxed execution
- shadow-mode candidate runs
- validation gates
- rate-limited promotion
- rollback checkpoints
- canary deployment
- audit logs
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

Hard rule:

```text
Candidates may propose evaluator or validator changes.
Validator changes require stricter approval than ordinary prompt, tool, or route changes.
```

---

## 17. Relationship to Reploid Levels

| RSI Level | Relationship |
|-----------|--------------|
| L0 | Candidates may add ordinary tools or workflows |
| L1 | Candidates may improve meta-tooling and evaluators |
| L2 | Candidates may propose substrate changes, gated by rollback |
| L3 | Recursive Ring-GEPA is primarily an L3 bounded self-improvement loop |
| L4 | Ring-GEPA can frame broader autonomy experiments, but does not prove AGI |

---

## 18. Baselines and Ablations

Baselines:

| ID | Baseline |
|----|----------|
| B0 | No optimization |
| B1 | Prompt-only GEPA |
| B2 | DSPy or MIPRO-style optimizer |
| B3 | TextGrad-style optimizer |
| B4 | Vanilla GA over prompts and configs |
| B5 | Island-model GA without whole-system candidates |
| B6 | Archive/tree self-improvement without rings |
| B7 | Agent graph optimizer |
| B8 | Recursive Ring-GEPA without rotation |
| B9 | Recursive Ring-GEPA without Pareto |
| B10 | Recursive Ring-GEPA without fallback archive |
| B11 | Recursive Ring-GEPA with scalar fitness |
| B12 | Full Recursive Ring-GEPA |

Ablations:

| Ablation | What it tests |
|----------|---------------|
| Remove rotation | Fixed-context overfitting |
| Scalar fitness | Loss of multi-objective fallback candidates |
| No fallback archive | Healing dependence on retained alternatives |
| Local-only mutation | Necessity of whole-system candidates |
| Change `k` | Population size and diversity |
| Change `N` | Lifecycle phase separation |
| Random stride | Coprime rotation coverage |
| No validation gate | Regression containment |
| No idempotent merge | Cyclic duplicate safety |
| No shadow mode | Safety of candidate testing |

---

## 19. Primary Metrics

| Metric | Definition |
|--------|------------|
| Task success | Solved tasks divided by total tasks |
| Validation gain | `J_valid(Theta_(t + 1)) - J_valid(Theta_t)` |
| Live regression rate | Regressions divided by promotions |
| Recovery success | Recovered failures divided by total failures |
| Recovery latency | Detection-to-routing delay |
| Candidate diversity | Entropy or pairwise behavioral distance |
| Pareto frontier size | Number of non-dominated candidates |
| Cost per improvement | Cost divided by validated promotion |
| Rollout efficiency | Improvement divided by rollout count |
| Archive half-life | How long a fallback remains useful |
| Safety violation rate | Safety failures divided by epochs |
| Evaluator disagreement | Variance among judges, tests, and humans |

---

## 20. Limitations

Recursive Ring-GEPA does not guarantee universal optimality. No optimizer can be best over all objective distributions without assumptions about the environment.

The system depends on validator quality. If validators are wrong, narrow, stale, or gameable, candidate selection can drift.

Whole-system candidates cost more than local patches. Sparse evaluation and periodic full sweeps are required.

The architecture improves system behavior. It does not necessarily create new latent model capability unless mutation includes model replacement, fine-tuning, tool creation, or training-pipeline changes.

Self-healing only works if the archive contains a validated candidate that handles the failure.

Validation monotonicity is not deployment monotonicity unless validation accurately models deployment.

---

## 21. Conditional Minimality

Recursive Ring-GEPA is minimal under these requirements:

| Requirement | Needed component |
|-------------|------------------|
| Whole-system self-reference | `R_theta` candidates |
| Whole-system mutation | Full `theta` schema |
| Bounded candidate population | Inner ring cap `k` |
| Repeated exposure to diverse contexts | Rotation |
| Multi-objective evaluation | Score vector |
| Duplicate-safe cyclic reduction | Idempotent Pareto merge |
| Validated promotion | Deployment gate |
| Fallback and self-healing archive | Pareto archive |
| Finite runtime | Population cap and evaluation budget |

Removing any component breaks at least one requirement.

---

## 22. Evolution Opportunities

- Add crowding distance to preserve behavioral diversity.
- Add lineage-aware recombination between candidates with complementary strengths.
- Add validator mutation quarantine so evaluator changes cannot self-approve.
- Add per-stage mutation operators tuned to the outer lifecycle stage.
- Add live archive decay for stale fallback candidates.
- Add human review queues for validator, tool, and deployment policy changes.
- Add process-level agent evaluation with trace-based scoring.
- Add swarm archive synchronization using the idempotent merge reducer.

---

## 23. Condensed Definition

Recursive Ring-GEPA is a bounded recursive self-improvement architecture in which a deployed cyclic agent lifecycle maintains, at each stage, a rotating inner ring of complete whole-system mutant candidates `R_theta`. Each candidate is run, traced, reflected on, mutated, validated, Pareto-pruned, retained as fallback memory, and promoted only through a deployment gate.

Formal structure:

```text
R_Theta_t =
  C_N(
    C_k(R_theta_0_0_t, ..., R_theta_0_k_minus_1_t),
    ...,
    C_k(R_theta_N_minus_1_0_t, ..., R_theta_N_minus_1_k_minus_1_t)
  )
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
```

---

*Last updated: May 2026*
