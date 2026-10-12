# Typed calculation requests: frozen experiment

Parent source-scoped selection was rejected in `47512bbf`: the model generated
a date-minus-money operation, reused fact IDs as results, invented forward/self
references, and exhausted its source allowance without closing the call. Full
source text, lexical values and explicit kinds were present.

This candidate changes the tool input contract, not the model, factual rubric,
source documents, sampling settings or final conversation history. It does not
claim that a JSON schema constrains generation. The strict handler admits only
valid requests; generated invalid requests remain failures.

## Contract

The model supplies `money` and `dates` arrays to the official `Calculate` tool.
A money request contains one to five signed source money terms, each optionally
multiplied by one source number or percentage. The first term must add. A date
request contains one source date and one source days/weeks duration. Source-local
schema enums declare the actual allowed aliases for each field. At most six
money requests and three date requests are admitted. Unsupported expressions
are rejected rather than approximated.

The host assigns result identities and translates this nonrecursive structure
into existing `calculateScope`/`calculateCatalog`/`runCalculation` operations.
No new arithmetic engine, source fact, semantic label, zero/one operand, expected
answer, or automatic choice is inserted. Single unmultiplied amounts retain
source identity and are marked nonderived. All derived values retain the source
IDs and actual operations that produced them. At most thirty executed arithmetic
operations are allowed across a case.

Wrong selections remain wrong: an included allowance selected as an additional
charge is calculated exactly as requested and fails the unchanged factual
review. Types and quote matches establish neither entailment nor completeness.

## Invocation and correction

Each document retains the prior source projection: original user turns, exact
selected passages and literal aliases, other document identities with empty
passages, no prior assistant claims. The final answer retains the complete
original ordered history, including previous incorrect assistant claims, plus
all exact generated tool calls and their actual tool responses. Final generation
has no callable tool schema; it must not issue another call.

A naturally completed invalid request receives at most one explicit correction
turn containing its unchanged raw output and the actual validator error. The
fixed correction instruction asks for a corrected request using the existing
source and allowed fields. A malformed response is never repaired by the host.
Non-EOS, timeout, process failure or exhausted budget does not trigger a retry.
A second invalid response stops the case. Both failed and corrected responses
remain in the evidence and final tool history when a final phase is reached.

## Frozen acceptance and resource limits

All seven original cases, ordered final histories, factual/citation and tool
attribution requirements are byte-equivalent as JSON values to the parent suite.
The two existing independent holdouts remain locked until those cases pass.
Model: original authorized Qwen3.5-2B, revision
`15852e8c16360a2fea060d615a32b45270f8a8fc`, nonthinking, greedy, repetition 1.0.
Source equations/F16 KV and exact official template remain unchanged.

Each case has at most 4,096 generated tokens, 8,192 prompt-plus-generated tokens
and 16,000 raw UTF-16 output units. Source calls share 1,536 generated tokens;
each source receives `floor(1536 / documentCount)`, including any correction.
Every repeated prompt, raw model output and resubmitted tool response is charged.
The first structural, tool, completion or budget failure stops the run; later
calls/cases remain unrun. Semantic review is manual and conjunctive, including
citations, conditions, omissions, corrections and natural completion. Parser or
calculator success cannot qualify the configuration.

Tokenizer-only preflight fits all seven minimum prompts. The longest retained
history leaves 2,182 tokens before actual tool outputs/corrections, so runtime
admission remains necessary. Empty preflight tool responses are not model data.
No model weights were loaded for preflight and no source generation has occurred
at this freeze.

## Checks and identities

- `node adapter.test.js`: unrelated operand/type/scope/identity/provenance and
  operation-bound checks, actual calculator values and semantic nonrepair.
- `python3 protocol_test.py`: strict official wrapper, exact failure feedback,
  duplicate/missing/unknown parameter rejection; no output repair.
- `python3 budget_test.py`: shared source allowance, repeated prompt charging,
  no continuation after max-tokens, and at most one correction.
- `verify-worker.js`: actual Verification Worker in an isolated VM passes with
  two relative-import warnings and no errors.
- `freeze.json`: exact files, reused source/evaluator/template dependencies.

A source run must verify every identity on its executing host, use four CPU
threads with `nice -n 10`, and wait for the shared physical workload owner to
release the heavy CPU window. No GPU, model download, production integration,
package promotion or deployment is part of this experiment.
