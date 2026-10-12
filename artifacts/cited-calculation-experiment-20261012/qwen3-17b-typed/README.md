# Original Qwen3-1.7B typed-request comparison

This separately identified candidate reuses the exact typed calculation adapter,
source projection, validator, correction rule and full factual/citation criteria
from the rejected Qwen3.5-2B experiment (`2f996368`). It changes only the already
authorized original model, its official tokenizer/template, source loader, EOS
identity and the matching official tool parser. No new download or model family
is introduced.

## Why this comparison

The retained original Qwen3-1.7B report passed fourteen simple source tasks under
a different **thinking and sampled** policy: seven cases, seeds 17 and 53,
temperature 0.6, top-p 0.95 and top-k 20. The subsequent short-document report had
eight correct factual conclusions but only five complete citation passes. These
are limited reasons to investigate this model, not qualification of this task.

This experiment retains the rejected typed candidate's **nonthinking, greedy,
repetition 1.0** policy. It neither replays nor claims the earlier fourteen-task
success. There is no favorable seed selection. All seven original task histories,
criteria, source/final instructions and budgets remain unchanged.

## Exact protocol and dependencies

Original source: `Qwen/Qwen3-1.7B@70d244cc86ccca08cf5af4e1e306ecf908b1ad5e`,
already at `/var/tmp/doppler-qwen3-17b-source-20261011` on x128. The existing
`source-model-task-quality.py` loader verifies every retained checkpoint file
against its acquisition receipt/LFS identity and uses original F32 weights,
eager source equations, and the same F16 KV evaluator.

The pinned official Qwen3 template declares exactly this framing:

```text
<tool_call>
{"name":"Calculate","arguments":{"money":[],"dates":[]}}
</tool_call>
```

The parser rejects duplicate JSON keys, nonfinite values, unknown fields/tools,
missing arrays, multiple calls, trailing prose and the Qwen3.5 function-tag
syntax. It never converts another protocol or repairs a generated call. Both
source model and template identities are bound in `template-binding.json`.

The unchanged artifact-only adapter in `../typed-requests/adapter.js` admits
source money terms with optional source numeric/percent factors and date plus
duration requests. It supplies no semantic conclusions, chooses no operands,
and never repairs wrong selected charges. Existing `Calculate` owns all
arithmetic and provenance validation. The prior rejection remains intact.

At most one correction follows a naturally completed invalid call, preserving
the exact call and actual error. Initial plus correction share the same source
allowance. No continuation follows token exhaustion, and no failed request is
silently accepted. Final generation receives the exact original complete
conversation plus actual tool turns, without a callable tool schema.

## Frozen budgets and review

Per case: 4,096 total generated tokens, 8,192 aggregate prompt plus generated
tokens (including repeated prompts and tool responses), 16,000 raw UTF-16 units.
All source calls share 1,536 generated tokens with the same per-source division.
At most thirty executed arithmetic operations. The first structural, completion,
tool or budget failure stops the run; later cases are unrun. Natural completion,
full factual/citation criteria, supporting tool operations, exclusions,
conditions and retained-answer corrections are all required. Calculator or
parser success alone is never model acceptance.

Tokenizer-only preflight totals are 3,993; 4,198; 4,260; 5,529; 1,190; 1,089;
and 1,273 tokens. Actual generated calls, validation corrections and resubmitted
tool results add to those minimum probes. Runtime admission remains mandatory.
The existing two independent holdouts remain locked until the original seven
pass manual review.

`protocol_test.py` and `budget_test.py` pass; the reused adapter and Verification
Worker checks remain bound by hash. `freeze.json` binds all executed artifacts
and source dependencies. No source generation has occurred at this freeze.

A reviewed run uses x128 CPUs 4–7, four threads and nice 10; it does not use GPU
or overlap the native test sweep's CPUs 0–3. Original source success would only
enable subsequent converted-weight, installed-runtime, numerical, budget and
physical application acceptance. It cannot promote the deployed 0.8B model or
close distributed release gates.
