# Single monetary relation: prepared diagnostic

The grammar-constrained whole-ledger attempt (`4ce6f175`) produced valid syntax
but assigned mutually incompatible roles to the same source facts. This
preparation isolates one local decision: one monetary occurrence, one primary
relation. No model has run this diagnostic.

`input.json` selects the **first document monetary occurrence in the first
original case**, using retained source row order: `$8,400` in `D1:P1`. The model
receives the complete exact passage, its source ID, the value's exact occurrence
and offsets, and original question context. It receives no expected label.
The original full ordered history and factual rubric are retained separately
for review. This reused case is not a fresh holdout.

The frozen definitions distinguish the role of an occurrence from the meaning
of all equal numbers across a document. `quoted_total` introduces the offered
work price; `deposit_basis` applies only to an occurrence used inside an
explicit percentage-deposit calculation. If the same occurrence supports both
or context is missing, `unknown` is required: no precedence chooses a label.
An `additional_charge` label never establishes that a condition for charging
it has occurred. Semantic labels still require independent review.

The only output is `{"relation":"one label"}`. The same reviewed prefix mask
and actual tokenizer checks admit all seven labels, including incorrect choices
and `unknown`. The mask does not inspect source text or expected answers.
Nothing repairs or rewrites the output. All syntax and EOS tokens count;
completion is still labeled grammar-terminal. No calculator or final-answer
call is scheduled, and the runner never continues to another occurrence.

## Budget and composition limits

Exact official-tokenizer preflight is **407 prompt tokens**, with a **64-token
maximum** output: at most **471 charged tokens** for this diagnostic. Canonical
outputs use six to eight tokens including EOS. Source model, nonthinking greedy
policy, repetition1.0, and original aggregate ceilings of 4,096 generated /
8,192 total / 16,000 raw UTF-16 remain unchanged.

A tokenizer-only projection of the complete first case has seven monetary
calls: 2,881 total prompt tokens plus at most 448 generated tokens. The old
878-token empty final-answer control leaves 3,985 tokens for nonmonetary
interpretation, actual tool-result growth and final generation. The retained
correction case has five monetary calls, 2,675 prompt tokens, at most 320 output
tokens and a 1,957-token empty final control: 3,240 tokens remain.

These are incomplete composition costs, not a claim that the complete workflow
fits or succeeds. Dates, budget/deposit relationships, conditions, contradictory
clauses and correction still need qualified interpretation. Multiple calls add
prefill and invocation cost; no latency improvement is claimed. Replaying full
original history per monetary/fact occurrence is intentionally not proposed.
Any eventual final answer must receive the original ordered history and actual
source-bound calculations, and must pass all unchanged seven cases plus the
two locked holdouts. No diagnostic label exempts those gates.

## Controls

- Six pure contract controls cover all labels, arbitrary escaped enums, invalid
  syntax, duplicate fields, missing/partial lexemes, distinct repeated monetary
  occurrences, altered offsets and absence of expected labels from input.
- Exact installed-tokenizer controls use artificial logits to choose **every**
  relation. All preferences survive. No semantic option is masked.
- Three complete-runner synthetic controls choose unknown, choose quoted_total,
  and inject a failure after two tokens. Each stays unqualified, retains exact
  prompt accounting and performs zero additional calls.
- Preparation caught and repaired a punctuation-boundary test failure and a
  synthetic suite encoding error: this evaluator expects the system instruction
  in `suite.instruction`, with only user/assistant turns in each case. Exact
  rendered input still matches the preflight. Neither failure used model weights.

No JavaScript or canonical evaluator changed. `constraint_adapter.py` reuses the
previous hash-bound constraint/evaluator hook and supplies only a finite output
grammar. `freeze.json` binds source weights/tokenizer receipts, software,
contracts, messages, suite and controls. The original loader verifies every
source-file receipt before loading.

Component: source document-quality diagnostic. Intent: preserved. Acceptance:
synthetic controls and tokenizer preflight only. Boundary effects: artifact-only
input projection/output grammar. Production and full-task qualification remain
open. Launch requires parent review of this freeze and CPU scheduling; no GPU,
new model, download, seed search or retry is permitted.
