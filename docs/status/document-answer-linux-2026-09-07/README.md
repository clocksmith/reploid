# Signed answer Capsule reproduced on Linux

The original Apple answer Capsule was reconstructed from its pinned public
checkpoint, then executed through Reploid's existing local executor and the
installed Doppler 0.6.0 package on physical Intel WebGPU. All eight generated
token sequences and answer texts exactly match `answers-03` from the
[original archive](../document-answer-evidence-2026-09-07/README.md).
The same semantic failures reproduced. This is execution reproduction, not
assistant qualification or independent-operator adoption.

Two subsequent prompt candidates also failed a separate development comparison.
The [development review](prompt-review.md) records all 24 outputs' factual
support and omissions. Neither candidate replaced the product prompt or
proceeded to held-out qualification. `prompt-development.tar.gz` retains both
attempts, including their failures; verify it with the same `SHA256SUMS` file.

## Retained results

- Source: `Qwen/Qwen3-0.6B`, revision
  `c1899de289a04d12100db370d81485cdf75e47ca`.
- All seven source files match the original source-reference SHA-256 values.
  Acquisition used the immutable Hugging Face `resolve/<revision>/<filename>`
  URLs, not a moving model reference.
- The unchanged archived conversion configuration produced 311 tensors and
  23 shards. The converter exited successfully; contract checks passed 2/2,
  layer-pattern checks 8/8, and required-inference checks 1/1.
- The original restoration script verified the size and SHA-256 of all 54
  signed dependencies, including every rebuilt shard, before restoring the
  Capsule. The newly generated manifest was not substituted for the signed
  original manifest. No signatures or TargetPlans were regenerated.
- Capsule byte digest:
  `sha256:9053b0c5177867722c5e45cb14ae50bd5ee8b88cbcf797cd63dd0850660f9ed4`.
- Runtime: locked `doppler-gpu` 0.6.0; Chrome 145.0.7632.6;
  `intel / gen-12lp`, fallback adapter false.
- Reploid source base: `5f36441dbf209da6e34991a50bf71362b6634a92`,
  explicitly dirty. Served module bytes are retained with hashes. The current
  prompt and answer-policy bytes match Apple's `answers-03`.
- Eight completed operations, zero failed operations, one model load and seven
  session reuses. Recorded loading was 80,379.2 ms; total execution was
  136,101 ms. This is one observation, not a controlled performance comparison.
- The 3,286,631,560-byte reservation is a configured estimate, not measured
  GPU residency or process memory. Browser/server cleanup reported no errors;
  the executor state snapshot precedes its final close, so it is not a
  post-close resource inventory.

The [claim-by-claim review](apple-review.md) distinguishes factual support,
missing answers, contradiction handling, and response formatting for both
Apple runs. Linux's byte-identical outputs against identical passages have the
same diagnostic review. The reviewer is this implementation thread's assistant,
not an independent evaluator. The exposed eight cases are no longer a holdout.

## Verify the transferred evidence

Extract the original archive using its README. In this directory:

```sh
sha256sum -c SHA256SUMS
mkdir extracted
tar -xzf evidence.tar.gz -C extracted
node verify.js /path/to/original-archive-extraction ./extracted
```

The verifier checks pinned report bytes, exact corpus, Capsule, TargetPlan,
artifact receipts, inputs, options, output tokens and text, saved source bytes,
and observed load/reuse counts. It explicitly reports semantic qualification
and independent-operator qualification as false. This validates a retained
observation; it does not execute the model again or prove arbitrary receipts.

The archive contains the Linux execution report, captured served sources,
frozen corpus and runner, host-specific configuration, acquisition verification,
conversion and restoration logs, source metadata, converted manifest, and
Capsule envelope. Model weights are omitted. The original archive remains the
authority for signed non-weight dependencies and public verification keys.

## Reproduce physical execution

Provision the seven files named in the original source reference at its exact
revision and verify every hash. Use a new output directory for each attempt.
From Doppler, the conversion command used here was:

```sh
node ../reploid/node_modules/doppler-gpu/tools/convert-safetensors-node.js \
  /path/to/verified-source \
  --config /path/to/original-extraction/reploid-qwen-adapter-closure/source/original-conversion.json \
  --output-dir /path/to/new-converted-model
```

Run the original archive's `restore-capsule.py` against those converted bytes.
Create a separate copy of `evaluation-config.json` with paths and the actual
physical browser/GPU identity for the receiving host. Preserve corpus digest,
generation settings, trust keys, and accepted plans. From Reploid:

```sh
node scripts/evaluate-document-answers.js /path/to/new-evaluation-config.json
```

This observation used ordinary upstream acquisition, not origin-disabled peer
reconstruction. It did not exercise remote LoRA, selective delegation, unrelated
operators, AMD startup, production deployment, or learned scheduling.
Cross-device matching does not establish source-model numerical parity,
universal determinism, semantic correctness, or biological correctness.

## Source-model comparison

The pinned upstream model also reproduced all eight outputs exactly under
PyTorch 2.11.0 CPU and Transformers 5.6.2, float32, eager attention, four CPU
threads, seed zero, and greedy generation. This uses an independent reference
implementation, not an independent operator. Python was 3.12.3; the original
adapter source reference used Python 3.14.4 and a CUDA-capable PyTorch build
while executing on CPU. Those environment differences remain recorded.

Before generation, Hugging Face's template and tokenizer matched Doppler's
formatted strings and input-token arrays in all eight cases. Source generation
then matched every raw token, including EOS, and every decoded answer byte.
Source receipts include embedding and first-layer input-normalization samples
and digests, plus initial top logits. These samples are not a complete
layer-by-layer numerical parity claim. Matching faulty answers is not a
semantic pass.

The consent error and other observed answer failures therefore occur in the
source model with the same task and inputs. A Doppler-specific execution defect
is not needed to explain these eight answers. The remaining repair belongs to
grounded-answer behavior and model/task qualification; weakening semantic
acceptance or changing kernels to compensate would not close it. A candidate
still needs frozen acceptance and independent review on untouched cases.

The first source comparison incorrectly removed source EOS before comparing
with Doppler's EOS-inclusive token array. Its text comparisons passed, while
its token-match flags were false. The original script, outputs, and log remain
in `source-reference-adverse-01.tar.gz` inside the source archive. The comparator
was corrected to compare raw EOS-inclusive arrays, then all eight cases were
executed again successfully. This was a diagnostic comparator defect, not
runtime token divergence. The reference library also warned that sampling-only
temperature/top-p/top-k values are ignored under the declared greedy mode; that
warning remains in both logs. No sampling-based comparison is claimed.

To check the source observation alongside the original and Linux observations:

```sh
mkdir source-extracted
tar -xzf source-evidence.tar.gz -C source-extracted
node verify.js /path/to/original-archive-extraction ./extracted ./source-extracted
```

This reuses the verifier rather than introducing another evaluation entrypoint.
It binds exact report bytes, captured inputs, raw source tokens, answer text,
and the browser observation. The source archive also retains dependency
versions, installation logs, the reference script, and source-file verification.
Changing the completion flag in a separate extracted source report was rejected
at the pinned report-hash boundary; [the rejection log](source-tamper-rejection.log)
is retained. Original reports and archives were not changed by that negative test.
No weights or Python environment are archived. To rerun the source model,
place the retained script, `source-inputs.json`, and `verification.jsonl` next
to the seven verified upstream files in a fresh directory. Install the pinned
CPU reference dependencies in an isolated environment and run
`python source-reference.py`. Its output directory must not already exist.

Component: document-answer qualification evidence and Doppler artifact restoration.
Intent: preserved.
Acceptance evidence: `verify.js`, physical `execution.json`, source
`reference.json`, original signed closure restoration, and Reploid
charter/surface-claim checks.
Boundary effects: no runtime, model release, deployment, or promotion changes.
The existing conversion and restoration tools preserve artifact ownership.

*Last updated: September 2026*
