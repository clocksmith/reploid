# Source-scoped operation selection: rejected

The frozen Qwen3.5-2B source experiment stopped at the first declared structural
boundary: `fresh-bathroom-comparison`, extraction for document D1. It consumed
512 generated tokens without natural completion or a closed tool call. No
calculator ran and no final answer was produced. The other two source calls,
six remaining original cases, and two locked holdouts were not run.

The process completed successfully as a harness operation (exit 0), not as a
qualified application result. Observed CPU elapsed time was 172 seconds. It
charged 1,124 prompt tokens plus 512 generated tokens, totaling 1,636 tokens,
and 1,019 raw UTF-16 units. Aggregate limits were respected; the frozen
per-source extraction cap was exhausted. These are observed counts, not a
controlled performance comparison.

## First broken boundary

The executed prompt contained the complete selected source passages and a
catalog with explicit alias, kind, source passage ID, and literal value. These
were not opaque identifiers without context. In particular:

| Alias | Kind | Value | Source |
| --- | --- | --- | --- |
| f000 | money | $10,000 | user constraints |
| f001 | date | September 25 | user constraints |
| f002 | money | $8,400 | D1:P1 |
| f003 | date | September 18 | D1:P3 |
| f004 | percent | 25% | D1:P3 |
| f005 | money | $8,400 | D1:P3 |

The first generated operation subtracts f000 money from f001 date. The schema
explicitly requires matching numeric kinds for subtraction. Later operations
mix money, dates and percentages and refer to nonexistent/self-referential
aliases. Sixteen complete operation objects appear before the unfinished
remainder. One budget-minus-price operation is locally appropriate, but an
isolated valid calculation inside an incomplete invalid plan is not an answer.

Result IDs also collide with fact aliases. The instruction requires unique
result IDs but does not explicitly state uniqueness across existing fact IDs;
that is a contract-clarity gap. The strict handler rejects such collisions. It
does not explain the independently visible type errors or nontermination, and
this receipt does not authorize a repaired output or another model candidate.

The admitted prompt IDs matched the executed input IDs; selected source text,
typed catalog and unchanged instructions were present. No serialization defect
was established. The planned final answer would preserve the entire original
ordered history, but that phase was never reached.

## Evidence and disposition

- [Run binding](run-binding.json) records the exact command, model and host
  identities, start/end, and exit status.
- [Executing-host identity](executing-host-identity.json) verifies the frozen
  files and reused sources independently of the checkout revision.
- [Full review](review.json) retains unchanged factual/citation criteria and
  distinguishes missing final evidence from generated factual claims.
- `result.json.gz`, `result-fresh-bathroom-comparison-extract-D1.json.gz`, and
  `run.log.gz` preserve complete raw evidence. [Raw identities](raw-identities.json)
  bind both compressed and original bytes. Originals remain on x128 at the
  directory recorded in the run binding.

No model, precision, sampling policy, budget, acceptance criterion or production
integration changed. No retry or output repair occurred. This source document
and tool configuration remains unqualified; the result does not grade basic
chat or distributed runtime correctness.
