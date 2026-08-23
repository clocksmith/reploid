# RSI Improvement Episodes

Reploid treats mutation, successful execution, and a higher aggregate score as
insufficient evidence of self-improvement. The canonical internal proof object
is `rsi.improvement-episode/v1`, implemented by
[`self/core/improvement-episode.js`](../self/core/improvement-episode.js).

This contract belongs to the internal Zero and X research surfaces. It does not
authorize Poolday policy or create a Research Room product claim.

## Causal loop

One episode binds one candidate to this sequence:

```text
objective
-> frozen baseline generation
-> declared metrics and evaluator
-> diagnosis and falsifiable hypothesis
-> candidate patch and semantic scope
-> isolated execution
-> verification
-> paired evaluation under the same contract
-> tradeoff comparison
-> promotion request, rejection, or rollback
-> hypothesis-driven reflection
```

An optimization run with three candidates creates three episodes. Rejected,
unselected, failed, promoted, and rolled-back alternatives remain separately
inspectable.

## Durable records

Each event uses `rsi.improvement-episode-event/v1`. Events are canonicalized,
SHA-256 linked to their predecessor, and signed by the browser Reploid identity.
The deterministic projection uses `rsi.improvement-episode/v1`.

The event signature proves which local Reploid identity recorded the event. It
does not by itself prove that a named external evaluator or reviewer endorsed
the payload. Evaluator authority is separately bound by its version, digest,
protected paths, raw receipt evidence, and promotion policy. A human or remote
evaluator needs its own detached attestation before that stronger claim is made.

```text
/artifacts/rsi/improvement-episodes/index.json
/artifacts/rsi/improvement-episodes/<episode-id>/events.jsonl
/artifacts/rsi/improvement-episodes/<episode-id>/projection.json
/artifacts/rsi/algorithm-registry/index.json
```

The projection binds:

- episode, parent, group, surface, and generation identities;
- objective and exact primary success metric;
- baseline code, configuration, model, prompt, artifact, and contract hashes;
- candidate hash, patch hash, changed files, semantic scope, invariants, and
  falsifier;
- evaluator version, suite digest, protected paths, and authority identity;
- environment, corpus and split identities, and resource budget;
- raw paired observations, derived metrics, uncertainty, and regressions;
- verification, reviews, promotion, rollback, and reflection.

The algorithm registry rejects different contents under an existing algorithm
name and version. A manifest declares source modules, inputs, outputs,
invariants, complexity, resource assumptions, failure modes, evaluation suites,
dependencies, and status.

## Metric semantics

Each metric declares:

- stable metric ID and unit;
- maximize or minimize direction;
- measurement source and aggregation rule;
- validity conditions and noise model;
- minimum sample size;
- promotion threshold;
- whether it is operational-only.

The primary objective cannot use an operational-only metric. Jobs, calls,
tokens, and elapsed time may remain in the tradeoff vector, but they do not
become capability evidence merely because they improved.

## Promotion authority

Promotion fails closed unless all of these are true:

1. Every event hash and signature verifies.
2. Proposer and evaluator authorities are distinct, and the evaluator and task
   set were frozen before the candidate.
3. The candidate does not overlap evaluator, promotion, audit, ledger, or
   rollback code.
4. Execution is isolated under the declared runtime contract.
5. Verification passes.
6. Baseline and candidate use the frozen contract hash.
7. Raw paired observations meet the metric's minimum sample size.
8. The primary result is valid and passes its predeclared threshold.
9. The comparison conclusion is `improved`.
10. The episode is explicitly awaiting promotion.

The Promote tool reloads the raw event ledger and recomputes its signatures,
hash chain, deterministic projection, and readiness. It does not trust the
evidence wrapper's claimed projection head.

Protected improvement authority is quarantined if proposed through the normal
promotion tool. This includes the episode ledger, promotion policy, Promote
tool, Doppler optimizer, audit logger, reflection store, and Genesis rollback.

## Current end-to-end lane

The implemented lane is Doppler runtime-profile search in X:

- one signed episode is created before each candidate evaluation;
- the frozen Doppler contract supplies paired evaluation and parity checks;
- accepted but unselected candidates end as rejected with retained evidence;
- selected candidates require an episode-bound promotion replay;
- canary failure restores the prior active generation and records rollback;
- terminal outcomes create structured reflections with alternatives and a
  falsifier;
- the X Improvement Episodes tab renders the five required views: objective,
  comparison, algorithm impact, raw evidence, and history.

This demonstrates a governed internal improvement episode for a bounded
runtime-profile objective. It does not demonstrate general self-improvement,
held-out workload generalization, scientific-policy improvement, or lower
protein-adjudication cost. Poolday may
admit a capability only through its own frozen policy and prospective Research
Room evidence.

## Federated strategy projection

Ouroboros `strategy.episode/v1` is a reference projection over project-owned
evidence. It does not replace this ledger. A Reploid adapter may bind an
immutable episode projection, event head, candidate, evaluator, outcome, and
negative evidence into an Ouroboros episode. Ouroboros may then propose a
human-reviewed strategy consequence, but it cannot promote a Reploid artifact,
rewrite this ledger, change a Reploid claim, or close a Reploid blocker.

The first reference carrier is a Visual Change Passport dogfood policy
revision. Its candidate may change only the dedicated policy artifact. The
episode protects the evaluator, ledger, verifier, promotion adapter, rollback
path, and general product policy from candidate mutation. Passing establishes
internal causal closure only, never customer value or product qualification.

## Acceptance evidence

- [`tests/unit/improvement-episode.test.js`](../tests/unit/improvement-episode.test.js)
- [`tests/unit/doppler-optimizer.test.js`](../tests/unit/doppler-optimizer.test.js)
- [`tests/unit/doppler-optimization-ui.test.js`](../tests/unit/doppler-optimization-ui.test.js)
- [`tests/security/validator-quarantine.test.js`](../tests/security/validator-quarantine.test.js)
