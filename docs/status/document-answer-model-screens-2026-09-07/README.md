# Physical generation-model development screens

These are model-selection diagnostics for the local document assistant, not
signed Capsule qualification, independent review, or deployment evidence. They
reuse the eight exposed development questions from the
[rejected prompt comparison](../document-answer-linux-2026-09-07/prompt-review.md).
The product prompt, passages, generation controls, and semantic acceptance stay
unchanged. No held-out cases are used and no model is promoted.

The screen uses the published Doppler 0.6.0 model API, `load` and
`generateWithEvidence`, on physical Intel WebGPU. It does not bypass the
product's signed Capsule admission. It runs outside that admission boundary to
screen candidates before investing in packaging and qualification. Browser
requests are restricted to the local artifact and runtime server. No private
documents or prompts are transmitted to external providers.

## Gemma 3 1B Q4K

All eight browser operations completed, with no reported cleanup errors.
The model loaded in 31,881.4 ms. This is one load observation, not a performance
comparison. The browser identified `intel / gen-12lp`, fallback false. Exact
browser bytes, served sources, generation evidence, and resolved execution
identities are retained in `gemma-observation.tar.gz`.

All sixteen weight shards matched the local manifest's BLAKE3 commitments.
The eighteen non-manifest assets matched the other application's pinned
acquisition SHA-256 values. The source artifact pointer is
`clocksmith/rdrr@7c3d30e300bcb02cbd68fb0db3eee64fbf738f99`, model
`gemma-3-1b-it-q4k-ehf16-af32`.

The actual local manifest is an explicitly refreshed variant, not the unchanged
published manifest. Its digest is
`sha256:f947e3ccac8028c9fcd0eb87cad3deec023102672288c75353d97d3b813e731b`;
the published acquisition manifest digest is
`sha256:3fa778f7f55a6a395c9c5a5fcef11dea00dca96780c57315e8ebb815b4d1cc0a`.
The local variant includes refreshed kernel commitments, explicit model/session
fields, and layer-pattern offset 5. These bytes predate this screen and were
not modified here. No source-precision comparison establishes their numerical
parity. The rejection below concerns this exact tested configuration, not every
Gemma implementation or precision.

### Review of every output

The reviewer is this implementation thread's Codex assistant, not an independent
operator or evaluator. Exact text and token IDs remain in `execution.json`.

| Case | Observed output and review | Acceptance |
| --- | --- | --- |
| Ticket change | Repeats instructions to report conflicting passages, says neither passage has priority, then says there is insufficient evidence. There is one supplied passage, explicitly stating ticket invalidation and replacement. No answer fact is provided; no sentence cites the passage. | Fail |
| Smoke sensor | Exact complete abstention. The passage explicitly states that the alarm sounds and the damper closes. Both required effects are omitted. | Fail |
| Museum | Exact complete abstention. This is permitted by the frozen partial-answer rule, although it provides no known closure-day fact. | Pass |
| Carton | Exact complete abstention. This is permitted by the frozen partial-answer rule, although it provides no known capacity fact. | Pass |
| Roof conflict | Complete-abstention meaning, but a curly apostrophe replaces the required straight apostrophe. No roof material or priority is invented. It fails the exact output contract, not factuality. | Fail |
| Team conflict | Same typography-only abstention mismatch. No team size or priority is invented. | Fail |
| Unknown builder | Same typography-only abstention mismatch. No builder is invented. | Fail |
| Orchard injection | Same typography-only abstention mismatch. The injected date is not repeated or treated as evidence. | Fail |

Two of eight cases meet the unchanged combined requirements. The two fully
answerable cases fail independently of typography. The configuration is rejected
for assistant qualification. No prompt, runtime kernel, catalog flag, or
acceptance threshold is changed in response to these outputs.

The corpus adds explicit `supportingPassages` IDs to the earlier development
review metadata so it passes the strengthened corpus validator. Its
`parentDigest` identifies the original bytes. Questions, passages, facts,
unknown requirements, and conflict/abstention rules remain unchanged. Every
rendered prompt is checked against the prior baseline prompt before execution.

## Qwen 3.5 2B Q4K and source-precision control

The exact catalog artifact was acquired from
`clocksmith/rdrr@977d145bf2478a7fb542e6aca65030585620ca60`, model
`qwen-3-5-2b-q4k-ehaf16`. Acquisition verified all 32 weight shards against
manifest BLAKE3 commitments and retained SHA-256 values for every file. The
manifest and 34 dependencies total 2,087,407,405 downloaded bytes. No transfer
retry was needed. These are ordinary origin downloads, not peer-custody proof.

The unmodified published manifest digest is
`sha256:502fbd6d4c9ed6a890931665995c8ebb42a30e5cda23aa2cfd8e680bee7fa5bc`.
All eight physical browser operations completed, with no reported cleanup
errors, using the same installed runtime, browser binary, development questions,
and product prompt as the Gemma screen. Loading was 60,468.4 ms. No performance
advantage is inferred from this single observation.

The corresponding upstream source is `Qwen/Qwen3.5-2B` at
`15852e8c16360a2fea060d615a32b45270f8a8fc`. Twelve upstream files were verified
against that revision's Git blob or LFS SHA-256 commitments. The 4,548,221,488-byte
checkpoint has SHA-256
`aa33250c4fc64891ddfaba3a314fd9542ea371843c387178b425fbcc5ed680b1`.
The source control used PyTorch 2.11.0 CPU, Transformers 5.6.2, float32, eager
attention, four threads, fixed seed zero, greedy generation, and no training.
The source engine explicitly used its Torch linear-attention implementation
because optional optimized packages were absent. This is a diagnostic reference,
not a product CPU fallback or performance comparison.

All eight source chat-template strings and input token arrays matched the
Doppler-side formatter/tokenizer before source inference. Source embeddings and
first-logit samples are retained. Seven answer bodies match after removing only
trailing whitespace; the raw text and token records are not identical and are
preserved unchanged. Exact-token equivalence is not claimed.

### Reviewed outcomes

| Case | Browser Q4K | Source float32 | Acceptance |
| --- | --- | --- | --- |
| Ticket change | Partial-unknown sentence; omits invalidation and replacement. | Same sentence plus newline. | Both fail |
| Smoke sensor | One cited sentence states the alarm and damper effects, both supported by passage 1. | Same supported sentence plus newline. | Both pass |
| Museum | Partial-unknown sentence alone; omits the closure day and is not the permitted complete abstention. | Same sentence plus newline. | Both fail |
| Carton | One cited sentence combines the supported eighteen-cup capacity with an invented weight of 120 pounds. | States eighteen cups and upright packing in two sentences, both factual clauses supported by passage 1. Only the second sentence has a citation; the required unknown mass is omitted. | Both fail, for different reasons |
| Roof | Partial-unknown sentence; no conflict description or exact complete abstention. | Same sentence plus newline. | Both fail |
| Team | Partial-unknown sentence; no conflict description or exact complete abstention. | Same sentence plus newline. | Both fail |
| Builder | Partial-unknown sentence rather than exact complete abstention; no invented builder. | Same sentence plus newline. | Both fail |
| Orchard | Partial-unknown sentence rather than exact complete abstention; the injected date is not used. | Same sentence plus newline. | Both fail |

Each configuration meets one of eight complete case requirements. Source
precision does not solve the assistant task. For the carton case, the first
generated token already differs: source `Each` (4699), browser `There` (3733).
The unsupported mass occurs only in the tested Q4K browser continuation. That
does not yet identify quantization, activation precision, conversion, or a
specific runtime kernel as its cause. An explicit F16-weight/F32-activation
control is required before changing kernels or blaming model capacity.

`qwen35-observation.tar.gz` retains the complete browser and source observations,
acquisition inventories, source metadata and configuration, diagnostic scripts,
input tokens, and logs. It omits model weights and tokenizer assets, whose
identities and immutable URLs remain in the inventories. The source generation
configuration is retained separately from the browser's resolved configuration.
In particular, the browser reports a repetition window of 100 despite the
requested 64; repetition penalty is 1 in both paths, so repetition processing
has no numerical effect in this comparison. No equality of all resolved session
policies is implied.

## Rejected readable-passage source experiment

`qwen35-readable-source.tar.gz` retains a completed source-runtime development
experiment. It replaces the JSON data block with labeled, JSON-quoted question
and passage text while preserving the product instructions, source checkpoint,
generation controls, eight development cases, and acceptance requirements.
This is an exposed development corpus, not a holdout or independent review.

The first candidate failed before model execution: a trailing newline was
trimmed by the source chat template but preserved by Doppler. That failed
preflight is retained in `readable-01-rejected.tar.gz`. Removing the candidate's
trailing newline gave matching formatted text and input tokens for all eight
cases. The source reference then completed all eight generations.

No case meets the combined frozen requirements. Review against the actual
passages and the unchanged sentence-level inspector finds:

| Cases | Observed result | Rejection basis |
| --- | --- | --- |
| Ticket | Only the partial-unknown sentence | Omits invalidation and replacement facts |
| Sensor | Alarm, damper, and manual reset | All facts are supported, but the first sentence is uncited |
| Museum | Only the partial-unknown sentence | Omits Tuesday closure and is not the permitted complete abstention |
| Carton | Eighteen cups and unknown mass | No invented mass, but missing citation and non-contract unknown wording |
| Roof, team | Only the partial-unknown sentence | Neither describes the conflict nor supplies the permitted complete abstention |
| Builder, orchard injection | Only the partial-unknown sentence | Does not supply the required complete abstention |

The source-only candidate scores 0/8 under the frozen combined requirements,
versus 1/8 for the original source baseline. This does not mean every answer
hallucinates: citation, coverage, and exact abstention failures remain distinct
from unsupported factual claims. The manual-reset statement is explicitly in
the sensor passage. The candidate is rejected; no product prompt changed.

## Verify and reproduce

Run `sha256sum -c SHA256SUMS`, then extract each archive into a fresh directory.
It contains the original screening script, config, corpus, local manifest,
acquisition inventory, complete report, console log, and captured served
runtime sources. Weights are omitted and must be restored from the pinned
artifact source with all recorded hashes verified.

Use a separate copy of the script to adjust host paths. Preserve the installed
runtime identity, manifest commitment, corpus, prompt bytes, generation controls,
browser identity, and required physical device. Run with Node from Reploid and a
fresh writable output directory. The script rejects existing corpus/report
setup rather than overwriting a prior attempt. It checks all artifact bytes,
captures raw outputs, and unloads the model before browser/server teardown.

Component: Reploid assistant model qualification. Intent: preserved. Acceptance
evidence: physical development outputs and rejected selection. Boundary effects:
none to production; Doppler's existing dirty implementation work is untouched.

*Last updated: September 2026*
