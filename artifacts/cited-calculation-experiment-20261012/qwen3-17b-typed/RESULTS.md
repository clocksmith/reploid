# Original Qwen3-1.7B typed comparison: rejected

The first source request naturally completed valid official JSON in 69 tokens.
It chose existing aliases and a compatible price-times-deposit calculation, but
used the deadline date as a duration. The strict validator rejected the complete
plan with `Operand f001 has kind date; required days/weeks`, before executing
any arithmetic. No compatible subset was silently extracted.

The single authorized correction naturally completed the identical 69-token
request and received the same rejection. It exhausted the correction count,
not the token allowance. No calculator result or final answer was produced.
The other two documents, remaining six cases and two locked holdouts were unrun.

| Measurement | Observed |
| --- | ---: |
| Initial prompt / output | 1,023 / 69 tokens |
| Correction prompt / output | 1,168 / 69 tokens |
| Total prompt + generated charge | 2,329 tokens |
| Raw generated UTF-16 units | 402 |
| Executed operations | 0 |
| Observed CPU process duration | 151.984845 seconds |

The process exited 0 as a completed diagnostic; the configuration is rejected.
These timings are observations, not a controlled performance comparison.

The correction prompt contains the exact original call, typed validation error
and fixed correction instruction. Executed IDs matched admitted IDs. First-step
raw logits differ (`<tool_call>` 24.847179 versus 27.477360), despite identical
greedy responses. No new source-forwarding defect is established; full model
internal states were not captured.

## Available-operation mismatch

The [availability audit](operation-availability-audit.json) maps the actual
catalog and question. D1 contains two dates, money and a percentage, but no
days/weeks duration. Nevertheless the tool advertises a dates array with a
start-date enum and an impossible duration schema (`not: {}`). Only an empty
dates array is valid, as the text instructions allow. D1's task requires
preserving a conditional estimate against the deadline, not deriving a new date.
D3, processed later if reached, has an actual duration.

The workflow does not require inventing a duration. However, advertising an
unavailable operation family is a concrete presentation issue. Omitting such
families by lexical type availability could be a bounded application change;
it was not implemented or retested here. The model also omitted mandatory
budget-headroom arithmetic, so resolving the date request alone cannot establish
full factual acceptance.

## Evidence and limits

[Review](review.json) retains every unchanged factual criterion and explicit
unrun disposition. [Run binding](run-binding.json) and
[executing-host identity](executing-host-identity.json) bind the exact command,
checkpoint, CPU affinity and freeze. [Raw identities](raw-identities.json) bind
`result.json.gz`, both per-call receipts and the execution log. Full raw originals
remain on x128 in the run binding's directory.

This comparison kept nonthinking greedy generation and repetition 1.0. Earlier
fourteen-task success used a different thinking/sampled policy and does not
qualify this workflow. No production model, numerical policy, package pin or
UI was changed. No source pass, converted-model qualification or release pass
is claimed, and no further candidate has run.
