# Syntax-constrained row annotation: prepared source experiment

The unchanged source row-tag attempt at `f64214a1` emitted 300 tokens, omitted
its closing tool envelope, supplied the wrong number of rows, and invented tags.
This candidate changes token admission rather than adding another instruction.
It was executed once and rejected; see [RESULTS.md](RESULTS.md). No useful task is qualified.

The already installed Transformers 5.6.2 `PrefixConstrainedLogitsProcessor` masks
invalid next tokens in the existing manual greedy CPU evaluator. The insertion
is one hash-checked in-memory replacement immediately before greedy argmax;
canonical Doppler source is untouched. Model computation, cache, repetition
policy, source weights, seven original ordered conversations, full factual
criteria, source row schema, tool validation, and final-answer instructions are
unchanged. Two original locked holdouts remain unrun.

The grammar admits only the frozen tool envelope, JSON structure, global enum
strings, unique lists within existing limits, and exact input row counts. It
permits empty lists and semantically incompatible role selections. No row is
assigned an expected role, filtered according to an answer, or repaired. The
existing adapter still rejects invalid lexical types and contradictory roles.
A valid role list is not evidence that the source supports the selected role.

Before each next-token choice, every candidate is checked using full-stream
`tokenizers` decoding and the official tokenizer with
`clean_up_tokenization_spaces=False`. This includes the special wrapper tokens
and EOS. Only the inspected ASCII ByteLevel continuation language is admitted;
a decoding mismatch aborts without output repair. Multi-character tokens and
alternate tokenizations are supported.

All syntax tokens are generated and charged. At a complete grammar the allowed
set is EOS only; this is **grammar-terminal EOS**, not proof of unconstrained
natural stopping. Per-step records retain the raw winner, selected token/raw
score, allowed set digest/count, state digest, mask time, and whether terminal
EOS displaced the raw winner. The final answer is unconstrained and retains its
natural-completion requirement.

The selection cap remains 1,024 generated tokens. Both calls share 4,096
generated tokens, 8,192 prompt-plus-generated tokens and 16,000 raw UTF-16
characters. Both complete prompts are charged, including actual tool response
and original history. The existing empty-response tokenizer preflight is
reused unchanged; it does not guarantee that a real tool result leaves enough
answer budget. No retries, dropped history, extra allowances, selected seeds,
or answer rewriting are permitted.

Only the first original case may initially run. Stop at a structural/budget
failure; otherwise retain the raw answer and await independent full factual
review. The remaining six original cases and two locked holdouts remain unrun
until that review permits a bound continuation. No production or converted-model
qualification follows from a source result.

## Controls before model execution

- `grammar_test.py`: seven controls, including exhaustive arbitrary tag
  combinations, empty/zero rows, invalid structure, escaped enum strings,
  alternate tokenizations, and intentionally admitted semantic contradictions.
- `constraint_test.py`: five controls with the exact installed tokenizer and
  artificial logits; legal preferences survive unchanged, early EOS is masked,
  disabled masking is identity, wrong prefixes and non-additive candidate
  decoding are rejected before sampling.
- `evaluator_test.py`: synthetic forward outputs through the actual frozen
  evaluator. Disabled hook produces an identical report. Allowed arbitrary
  selection survives unchanged and remains pending manual review.
- `runner_test.py`: synthetic forward outputs through the complete actual
  two-call runner. Unmasked final history and actual token accounting pass;
  injected failure retains its two partial tokens and all six unrun cases.

`tokenizer-control.json`, `evaluator-control.json`, and `runner-control.json`
record these controls. No neural weights were loaded. Trie construction took
0.525 seconds in the retained tokenizer control; masking took 0.0026–0.0032
seconds for arbitrary 27–31-token synthetic paths. These are measured preparation
controls, not source inference performance claims or total-runtime estimates.
Earlier control preparation contained a Python schema-brace syntax error; it
failed before execution and was corrected before these passing controls.

No JavaScript changed: the unchanged row adapter/bridge/calculator retain their
hash-bound Verification Worker and focused test evidence. New Python files
were syntax-checked and exercised above.

Component: application source-quality experiment. Intent: preserved. Acceptance
evidence: the named synthetic controls and `freeze.json`; factual acceptance
pending. Boundary effects: artifact-only token admission in the frozen original
source evaluator; no production runtime, host, or public sampler changes.

## Execution (only after reviewed freeze and resource coordination)

Use a separate snapshot containing the exact `freeze.json` file closure and
already cached source. Verify every source and library identity before import.

```sh
PYTHONPATH=/tmp/doppler-reference-deps PYTHONDONTWRITEBYTECODE=1 \
OPENBLAS_NUM_THREADS=4 OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 \
taskset -c 4-7 nice -n 10 python3 -u run.py \
  --doppler /var/tmp/doppler-archive9-unit-4umv8z92/workspace/doppler \
  --source /var/tmp/doppler-qwen3-17b-source-20261011 \
  --out /owned-experiment/results/source.json
```
