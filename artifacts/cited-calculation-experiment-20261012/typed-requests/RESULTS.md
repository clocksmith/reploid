# Typed requests and bounded correction: rejected

The first source case, `fresh-bathroom-comparison` / D1, failed the frozen
protocol. The initial call naturally completed after 275 tokens. It requested
six date results despite the limit of three, supplied null durations, and used
literal money/date/percent strings in fields whose schema enumerates source
money aliases. The strict validator returned `Request count exceeds bounds`
before executing any arithmetic.

The single permitted correction received the complete unchanged call, that
actual error, and the frozen correction instruction. Its 237 generated tokens
were exactly the first 237 output token IDs from the initial attempt. It reached
max-tokens without closing the call. The original 512-token source allowance
was exhausted; no continuation or further retry occurred.

| Measurement | Observed |
| --- | ---: |
| Initial prompt / output | 1,148 / 275 tokens |
| Correction prompt / output | 1,491 / 237 tokens |
| Total prompt + generated charge | 3,151 tokens |
| Raw generated UTF-16 units | 1,445 |
| Executed arithmetic operations | 0 |
| Observed CPU process duration | 182.627844 seconds |

The process exited 0 as a completed harness run, not successful model acceptance.
No final answer ran. D2/D3, the remaining six cases and both locked holdouts were
unrun. No full factual/citation criterion is established. This is a rejected
source document/tool configuration, not a result about basic chat or distributed
runtime correctness.

## Input and tool-boundary findings

Actual executed input IDs matched admitted IDs in both calls. The correction
rendered prompt contains the original raw response, actual validator error and
fixed correction request; its input IDs differ from the first call. The existing
source evaluator constructs a new `StoredHalfCache` per call. No serialization
or reused-cache defect was established by this evidence. The actual first-step
raw `<tool_call>` logit differed: 27.589157 versus 25.517612. Identical greedy
prefixes therefore do not establish identical underlying computation.

A [post-result audit](source-execution-audit.json) exercised the actual evaluator
and official tokenizer with a sentinel forward, without loading model weights.
It received the complete 1,148- and 1,491-token tensors and distinct initially
empty attention/recurrent cache objects. Source inspection found full-sequence
embedding/position construction and a zero initial recurrent state for prefill.
This proves the evaluator boundary, not every original model internal state;
uncaptured deeper implementation behavior remains uncertain.

Typed validation prevented invalid requests from reaching arithmetic. It did
not make the model follow the contract or answer correctly. The model's semantic
choices were not repaired, and matching a JSON schema would still require all
factual, citation, condition and correction checks. No additional candidate was
started.

## Retained evidence

[Run binding](run-binding.json) records the exact command, environment, process,
source and freeze identity. [Executing-host identity](executing-host-identity.json)
records verified bytes independently of the checkout revision.
[Review](review.json) retains the complete unchanged factual criteria and unrun
case dispositions. [Raw identities](raw-identities.json) bind compressed and
original bytes for `result.json.gz`, both per-call JSON receipts and `run.log.gz`.
Originals remain at the x128 directory in the run binding.

The pre-output freeze, source model, numerical policy, sampling, criteria and
aggregate budgets remain unchanged. Nothing was promoted or deployed.
