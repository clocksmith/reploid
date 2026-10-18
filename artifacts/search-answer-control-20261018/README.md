# Independent search-answer controls

The supplied National Geographic passage says the Eiffel Tower was completed in
March 1889. Deployed Qwen 2B answered `3`. The exact failed request also answers
`3` on the owned M3 and under independent Transformers CPU equations using the
same retained quantized weights. Original checkpoint weights answer `[2]`.
None answers the requested year.

| Execution | Answer | Generated IDs including stop |
| --- | --- | --- |
| Doppler Q4_K | `3` | 18, 248046 |
| Independent CPU, same Q4_K bytes | `3` | 18, 248046 |
| Independent CPU, original BF16 weights | `[2]` | 58, 17, 60, 248046 |

[Comparison](comparison.json), [GPU capture](gpu.json),
[Q4 reference](reference.json), and [original-weight reference](original-reference.json)
retain the results. All 801 input IDs match between GPU and the Q4 CPU control;
the output sequences match through natural stop. The original-weight control
uses those same input IDs. Quantization changes the output but is not necessary
for this request's failure. This does not establish general model incapability,
general runtime correctness, or a useful-answer qualification.

## Identity and execution bounds

The [contract](contract.json) pins Reploid `69d03ecc`, installed Doppler 0.6.32,
its archive hash, host files, retained request and Qwen 2B manifest identity
`sha256:83e5a01a21e234d238ea3ed5b0b234cc52781ddfce51861abd0fdf0ae3199028`.
The existing [capture fixture](../../tests/fixtures/movie-request-control.js)
runs the application streaming path and scoped generation separately. Both
return `3`; the second preserves output IDs. The 32-token diagnostic cap replaces
the original 256-token allowance, but both stop naturally after two tokens.
Input token count matches the public attempt. Owned GPU cleanup completed.

The [Q4 reference contract](reference-contract.json) and
[original-weight contract](original-reference-contract.json) allow one CPU run
each, four threads, 40 GiB address-space cap, 48 GiB minimum available host memory,
and a 600-second deadline. Both finish successfully, in
[20.76 seconds](reference-process.json) and
[18.75 seconds](original-reference-process.json), including loading. These are
bounded diagnostics, not performance or peak-memory benchmarks. They use the
already-installed CPU dependencies; no weights or dependencies were downloaded.

CPU model equations use Transformers 5.13.1 with Torch 2.12.1+rocm7.2 in CPU mode;
gguf 0.19.0 independently decodes the Q4 tensors. A pinned SHA-256 piece index
verifies every quantized shard and tokenizer piece. Historical hashes remain
unchanged. Original weights use Qwen/Qwen3.5-2B revision
`15852e8c16360a2fea060d615a32b45270f8a8fc`; the already-provisioned download receipt
verifies all source bytes. Original BF16 weights are converted to F32 and the
original tied head is restored. Both controls retain F32 equations and F16 KV
storage. The original-weight control is not native BF16 arithmetic or an F16
model deployment. No physical Vulkan support claim follows from CPU execution.

[Template comparison](template-comparison.json) compares the captured prompt IDs
with the original official tokenizer's no-thinking chat template: all 801 IDs
match. This rules out that specific template mismatch, separately from numerical
agreement. The initial probe mishandled Transformers'
structured encoding return; it ran no inference. The corrected probe explicitly
renders then encodes, as recorded in the receipt.

## Rejected application candidates

Production retrieval instructions and generation settings remain unchanged.
[Prompt review](prompt-review.json) records why none of these candidates is
accepted:

- [Repetition penalty 1.0](penalty-candidate.json) leaves the failed answer as `3`.
- [Longer source instructions](instruction-candidate.json) give correct requested
  facts but two exposed answers hit the 64-token diagnostic cap. This does not
  establish truncation under the production 256-token cap.
- [Concise instructions](concise-instruction-candidate.json) answer the exposed
  year question, but the Austen answer adds an unsupported claim that the source
  describes composition throughout the 19th century. That passage describes
  reviews, not composition.
- The candidate was frozen as SHA-256
  `58150a6e866753d163148356558e6b3b0e8996009b6912c4277fbbbbae6aea5a`
  before [eight fresh fixed-document checks](source-grounding-contract.json).
  [Both arms](source-grounding.json) completed with alternating order and reset
  state. Mechanical checks passed 5/8 for baseline and 7/8 for candidate. The
  candidate returned `[M1]` instead of the supplied author's name; manual review
  also rejects its failure to honor the movie question's name-only format.

These are development confirmation cases, not independent protected evaluation,
a live-search campaign or a benchmark. A higher mechanical score does not override
known unsupported claims or failed tasks. Do not tune this candidate against
these now-exposed confirmation cases and call the same cases held out again.

## Reproduction

Preserve these receipts. Copy this directory to a new two-level scratch directory
under the repository and explicitly adapt local paths in contracts. The native
probes use already-provisioned weights; each has a 90-second request deadline.
The diagnostic instruction scripts run at most two or four requests; the fixed
source suite allows 16 requests, at most 64 output tokens each. They close their
owned provider and device in `finally`.

The GPU capture uses the existing fixture and a fresh destination:

```sh
node tests/fixtures/movie-request-control.js /path/to/contract.json /path/to/new-gpu.json
```

Enforce its 240-second process deadline externally. Independent CPU runners
verify their frozen file hashes, headroom and process bounds. Expand the two
retained tool snapshots beside the copied contracts before invoking the runners:

```sh
gunzip -k qwen35-deployed-reference.py.gz qwen35-original-weight-generation.py.gz
python3 run-reference.py
python3 run-original-reference.py
```

The commands and exact Python/dependency paths are retained in the process
receipts. They refuse an existing reference output. Native prompt probes use
`penalty-candidate.mjs`, `instruction-candidate.mjs`,
`concise-instruction-candidate.mjs` and `source-grounding.mjs`; their JSON receipts
retain exact inputs or the original request references and proposed instructions.

Next gate: a stronger model or new application candidate must pass frozen useful
answer and source-support criteria before promotion, followed by the complete
same-model deployed journey. The current 2B source-answer behavior is not accepted.
The reload repair's green CI remains separate from these quality failures.

Component: application verification. Intent preserved. Boundary effects: none.
No Doppler arithmetic, model identity, runtime package, public contributor, search
prompt, catalog activation or production generation setting changed here.
