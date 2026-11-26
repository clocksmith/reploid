# Blueprint 0x00003E: Meta-Cognitive Coordination Layer

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** `/capabilities/cognition/meta-cognitive-layer.js`

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00003E-meta-cognitive-coordination.md`
**Objective:** Let the agent notice inefficiencies in its own behavior and turn them into improvement proposals that go through the same evaluation and operator adoption as any other change.

**Prerequisites:** [0x000015](0x000015-dynamic-tool-creation.md) (tool creation), [0x000032](0x000032-reflection-store-architecture.md) (reflections), [0x000067](0x000067-gepa-prompt-evolution.md) (prompt evolution)

This blueprint also holds the self-analysis ideas of the retired [0x000012](0x000012-structured-self-evaluation.md) (structured self-evaluation), [0x00003D](0x00003D-deja-vu-pattern-detection.md) (repeated-pattern detection) and [0x00005A](0x00005A-meta-cognitive-evaluator.md) (reasoning-quality scoring).

---

### 1. What exists

- `self/capabilities/reflection/reflection-store.js` stores tool and cycle outcomes; `self/capabilities/reflection/reflection-analyzer.js` exposes `detectFailurePatterns` ([0x000032](0x000032-reflection-store-architecture.md)).
- `self/core/improvement-episode.js` implements the `rsi.improvement-episode/v1` record that binds a candidate to a frozen baseline, a protected evaluator, paired evaluation and a terminal decision ([docs/rsi-improvement-episodes.md](../../docs/rsi-improvement-episodes.md)).
- GEPA prompt evolution is [0x000067](0x000067-gepa-prompt-evolution.md); promotion rules are `self/core/promotion-policy.js` ([0x000080](0x000080-core-promotion-policy.md)).

`meta-cognitive-layer.js` does not exist. Nothing watches the agent's behavior across runs and proposes improvements to it.

### 2. Proposed design

The layer runs between runs, or on request, and does three things:

1. **Detect.** Read reflections and run traces and find repeated action sequences, repeated failures and slow steps. A finding records its evidence (the trace and reflection entries it was drawn from) and counts duplicated evidence once.
2. **Propose.** Turn a finding into a candidate: a new tool through CreateTool, a prompt change through GEPA, or a source patch under `/shadow`. Each candidate opens an improvement episode with a declared metric and a frozen baseline.
3. **Report.** Show the operator the finding, the candidate, the paired evaluation result and the rollback pointer.

### 3. Authority

- The layer never applies a change. There is no auto-apply setting.
- Confidence in a pattern, a model's self-evaluation, an evaluator score or an Arena ranking decides whether a candidate is worth showing. None of them adopts it. Adoption is the operator's, within an explicit and reversible grant ([INTENT.md](../../INTENT.md)).
- The layer cannot change its own evaluator, metric or thresholds; those belong to the episode contract.
- A per-session cap limits how many candidates it opens.

### 4. Verification conditions

- With the layer enabled, no file outside `/shadow` and `/artifacts` changes until the operator adopts a candidate.
- Every candidate has an improvement episode with a frozen baseline and a terminal decision (adopted, rejected or rolled back).
- A finding drawn from the same evidence twice counts once.
