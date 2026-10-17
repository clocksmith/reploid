# Independent control of two failed movie requests

**Both wrong answers reproduce with independent Transformers CPU equations over
the same retained Q4_K tensor bytes.** Request history was intact, and the
independent and Doppler output token sequences match through the stop token.
The original [5/12 rejection](../movie-service-20261017/README.md) is unchanged.

| Retained request | Required answer | Replayed Doppler | Independent reference | Generated tokens, including stop |
| --- | --- | --- | --- | --- |
| `format-followup/2` | Pine | Clover | Clover | 49512, 415, 248046 |
| `missing-availability/1` | UNKNOWN | Cedar | Cedar | 34, 32112, 248046 |

[Comparison](comparison.json), [GPU receipt](gpu.json), and independent receipts
for [format](reference-v2-0.json) and [availability](reference-v2-1.json) retain the
inputs, outputs, identities and comparison results. This is a diagnostic on two
already-seen failures, not protected quality confirmation or a numerical gate.
It does not distinguish quantization effects from base-model limitations, qualify
other prompts, or prove general Doppler correctness.

## Execution boundaries

The [GPU contract](contract.json) pins the original `8b211c3f` runtime archive
(`6b057b0e…`), the retained application snapshot and host file hashes. All 2,028
regular archive members matched the installed snapshot before execution. The
model is Qwen3.5 2B Q4_K, manifest `83e5a01a…`; source and tokenizer bytes were
unchanged. Execution used local Apple M3 Metal and the snapshot's application
provider. No network participant, public service or production setting changed.

For each retained request, the fixture obtains prompt IDs from the loaded
session's public tokenizer using the exact recorded messages. The 321- and
290-token counts match the original completion receipts. It runs the application
provider's streaming path, resets the session, and runs the scoped generation
API to retain output token IDs. Both paths return the original wrong answer.
The original execution did not retain input token IDs; these are replay captures.

The diagnostic output cap is 32 instead of the original 4,096. Every execution
ends naturally at three generated tokens, so the shorter cap does not truncate
these results. Four GPU generations completed; the process exited successfully
after unloading and destroying its owned device. [GPU log](gpu.log.gz).

The independent control uses Doppler's existing
[`qwen35-deployed-reference.py`](https://github.com/clocksmith/doppler/blob/63d099c2/tools/qwen35-deployed-reference.py)
diagnostic, with its SHA-256 frozen in the reference contract. Transformers 5.13.1
supplies the model equations, gguf 0.19.0 decodes Q4_K, and CPU Torch uses F32
arithmetic with F16 KV storage. The pinned piece index verifies every retained
shard and tokenizer piece before loading. Input IDs independently round-trip
through the tokenizer. The [source config](source-config.json) comes from the
recorded Qwen revision `15852e8c16360a2fea060d615a32b45270f8a8fc`.

Both initial reference attempts failed during weight dequantization under the
[24 GiB virtual-address limit](reference-contract.json), before inference:
[process results](reference-processes.json), [first log](reference-0.log.gz),
[second log](reference-1.log.gz). These failures remain retained.

The [revised contract](reference-contract-v2.json) permits two retries with a
40 GiB address-space cap, requires at least 48 GiB host memory available before
starting, and retains four CPU threads and a 600-second per-case deadline.
The host reported 58 GiB available. Model, inputs, arithmetic and comparison rules
were unchanged. Both retries exited successfully in approximately 20 and 22
seconds, including model loading: [process results](reference-v2-processes.json),
[format log](reference-v2-0.log.gz), [availability log](reference-v2-1.log.gz).
This is not a memory-efficiency or performance qualification.

## Reproduce

Use the exact snapshot, archive, provisioned model and file hashes in the contract.
Adapt local paths explicitly. The fixture refuses to overwrite its output:

```sh
node tests/fixtures/movie-request-control.js \
  artifacts/movie-request-control-20261017/contract.json /path/to/new-gpu.json
```

Enforce the contract's 240-second external process deadline as well as its
180-second cooperative deadline. Preserve failures rather than overwriting them.
Independent controls are exact rows from `gpu.json`, serialized with two-space
JSON indentation and a trailing newline; their hashes are frozen in the reference
contract. The small capture file contains the same `modelIdentity` under the key
`manifestIdentity`. These derived inputs need not be stored a second time.

For each control, use the pinned reference tool, source config and
`self/config/model-pieces/qwen-2b-pieces.json`, with the recorded Python packages:

```sh
python qwen35-deployed-reference.py \
  --model /path/to/qwen-3-5-2b-q4k-ehaf16 \
  --source-config source-config.json --capture capture.json \
  --piece-index qwen-2b-pieces.json \
  --piece-index-identity sha256:fb16dcc36771b478d811e83b3fad453cd1ee23b8b01d33eb0b797412032109dc \
  --reference control.json --generation-control control.json \
  --prefixes 1 --threads 4 --linear-prefill source-chunk --normalization source \
  --out /path/to/new-reference.json
```

Apply the revised address-space, deadline and host-headroom limits externally.
The reference diagnostic writes progress to its output; choose a new destination.
Compare input IDs, generated IDs, decoded answers and natural stop, not just a
plausible-looking final answer.

Component: verification evidence. Intent: preserved. Acceptance evidence: four
physical GPU executions and two successful independent CPU controls, with two
failed loading attempts retained; fixture syntax and scoped ESLint pass. Boundary
effects: none. No production code, model policy, adapter or deployment changed.
