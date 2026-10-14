# Cause of two wrong chat answers on the signed ordered route

Date: 2026-10-14. Machine: `mac-host` only (no SSH). Retained as produced; the coordinator committed it.

Both answers are wrong, and this work does not change that. Correct values:
`doubleEvens([1, 2, 3, 4])` is `[4, 8]` and `doubleEvens([-2, 3, 6])` is `[-4, 12]`.

| Turn | Delivered (runs 5 and 4) | Correct |
|---|---|---|
| 1 | code, then `// Output: [2, 4, 6, 8]` | `[4, 8]` |
| 2 (follow-up) | `[-6, 12, 18]` | `[-4, 12]` |

## Conclusion

1. **Distribution and application are not the cause.** Three things were checked:
   - **Same machine, same output.** A single-machine Doppler run on this Mac reproduces the delivered tokens exactly. It used the same `2df37d88` runtime, the same signed model bytes, the same plan, settings and prompt tokens. This holds both as three ordered stages in one process and as one unsplit pipeline.
   - **Independent code, same output.** An independent implementation over the same deployed weights also reproduces them exactly. It uses Hugging Face transformers equations with weights decoded by gguf, and no Doppler code.
   - **Same numbers.** Doppler's GPU logits and the independent CPU logits differ by at most 0.0015. The smallest top-1/top-2 margin in either answer is 0.207.
2. **Template and settings are not the cause.** There is no mismatch to fix:
   - **Template.** The official Qwen3.5 chat template renders the same bytes as the application's template. It produces the same token IDs (56 and 189).
   - **Settings.** The application's settings are greedy decoding, and the reference was run greedy.
3. **Turn 1 `[2, 4, 6, 8]`: the deployed quantization of the transformer body, on top of a weakness the source model shares.**
   - **Source checkpoint answers correctly.** Given the identical 56 prompt tokens, the original `Qwen/Qwen3.5-0.8B` bf16 checkpoint answers `// [4, 8]`, in both f32 and bf16 arithmetic.
   - **Divergence starts at token 1.** The deployed Q4_K weights pick `javascript` where bf16 picks `js`, and from there they produce a different completion.
   - **The head is not the cause.** Tying the head to the deployed f16 embedding still gives the wrong answer. So the separately quantized Q4_K LM head is not the cause; the Q4_K body weights are.
   - **The source shares the mistake.** Fed the delivered text up to `// Output: [`, the bf16 checkpoint also writes `2, 4, 6, 8]`. At the first value it prefers `2` (logit 23.385) over `4` (22.134).
   - **Sampling shows the same weakness.** With Qwen's recommended non-thinking sampling, the bf16 checkpoint gave a wrong value in 3 of 8 seeds.
4. **Turn 2 `[-6, 12, 18]`: retained model-quality failure.**
   - **Same input, still wrong.** Given the identical 189 prompt tokens, the source bf16 checkpoint is also wrong. Greedy gives `[-4, 6, 12]`, and 8 of 8 sampled runs are wrong.
   - **Quantization only changes which wrong answer.** The divergence is at token 1: Q4_K gives `6`, while bf16 prefers `4` by 1.5 logits.
   - **Turn 1's error carries into turn 2.** With the turn-1 comment corrected to `[4, 8]`, the bf16 checkpoint answers `[-4, 12]`. The deployed weights still answer wrongly, `[-6, 12]`.

The earlier claim in `../signed-completion-journey-20261013/README.md`, "these look like the model's own errors, not distribution errors", is right that distribution is not the cause. It is incomplete for turn 1: the source checkpoint's greedy answer is correct, so quantization decided this particular wrong answer. The 55-prefix numerical pass could not show this, for two reasons:
- It used a different workload: three contractor-quote document requests.
- Its F64 oracle decodes the deployed Q4_K weights. It therefore checks Doppler's arithmetic against the quantized model, not the quantized model against the source checkpoint.

I did not edit that README or any existing evidence.

## What matched

| Check | Turn 1 | Turn 2 |
|---|---|---|
| Prompt tokens implied by delivered activation bytes (2 edges x 8192 B per row, minus decode rows) | 56 | 189 |
| Prompt tokens from Doppler's resident `tokenize` / HF official template + tokenizer | 56 / 56, IDs equal | 189 / 189, IDs equal |
| Official template text == Doppler-rendered text | yes | yes |
| Delivered decode steps (stop `eos-token`) / Doppler ordered / Doppler unsplit / q4k control | 100 / 100 / 100 / 100 | 12 / 12 / 12 / 12 |
| Delivered token IDs == Doppler ordered == Doppler unsplit == q4k control | yes | yes |
| Doppler ordered activation bytes == delivered | 2539520 == 2539520 | 3276800 == 3276800 |
| q4k control teacher-forced on delivered tokens: argmax disagreements | none | none |
| Max abs top-5 logit difference, Doppler GPU vs q4k control | 0.0010 | 0.0015 |
| Smallest top-1/top-2 margin | 0.2075 | 0.2148 |
| Run 4 (different browser bundle and native artifact) | same text, steps, activation bytes | same |
| Execution identity of all 3 stages and unsplit vs Capsule TargetPlan | `8f33ed28...` == `8f33ed28...` | same |

Delivered token IDs were not transferred per step (`stepSummary.detail: "aggregate; no per-step trace transferred"`). They are reconstructed from the report's `streamSamples`: every content change is one streamed delta, and the deltas number 99 and 11 plus the EOS step. Each delta maps to exactly one vocabulary entry. The reconstruction equals the reproduced IDs exactly.

## Where they diverge from the source checkpoint

| | Step | Delivered / Q4_K (logit) | bf16 checkpoint argmax (logit) |
|---|---|---|---|
| Turn 1 | 1 | `javascript` 25.65 (bf16 rank 1) | `js` 26.79 |
| Turn 1 | 86 (`// Output: [` then ...) | `2` 22.306, `4` 19.573 | with the same prefix: `2` 23.385, `4` 22.134, so it agrees |
| Turn 2 | 1 (after `[-`) | `6` 22.951, `2` 22.736, `4` 22.442 | `4` 24.577, `6` 23.076 |

Teacher-forced on the delivered turn-1 tokens, the bf16 checkpoint disagrees at steps 1, 12, 18, 20, 26, 49, 62 and 81. It agrees at every step from 82 on, including all of `[2, 4, 6, 8]`.

## What the model received

Cited at the installed export `/var/tmp/reploid-signed-completion-app-5-20261013/app`. Its files are byte-identical to Reploid commit `1a43dd13`; the checkout has since moved on. The vendored Doppler 0.6.28 equals the `2df37d88` archive and Doppler `b946f486`.

- **Messages.** `packages/reploid/src/chat/workspace.js:312-316` builds the history from completed messages. A system message is prepended only when `systemContext.content` or `purpose` is non-empty; both were empty, and `systemContext.enabled: false`. The request is stored at `:126`.
- **Routing.** The request passes unchanged through:
  - `self/host/chat-execution.js:50`
  - `self/host/work-swarm.js:61`
  - `packages/reploid/src/mesh/partitions/automatic-ordered-partitions.js:66`
- **Tokenization.** `partition-ordered-chat.js:77` calls the stage-0 resident `tokenize`, which runs:
  - Doppler `src/inference/pipelines/text/resident-partition.js:321-347`
  - `:337` `tokens.tokenize(messages, allocation.generation)`
  - `src/client/model-host/model-session.js:70-89`
- **Template.** Capsule `manifest.json` has `inference.chatTemplate = {type: "qwen", enabled: true, thinking: false}`. The renderer is `src/inference/pipelines/text/chat-format.js:283-293`. History assistant turns are rendered verbatim (`:293`), with no reasoning block. The generation prompt is the non-thinking prefill `<|im_start|>assistant\n<think>\n\n</think>\n\n` (`:286`). The official template's default is identical.
- **Rendered prompts and IDs.** They are in `failed-examples.json`. Turn 1 is:

  ```
  <|im_start|>user\nWrite a short JavaScript function ... Show its result for [1, 2, 3, 4].<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n
  ```

  Turn 2 contains, in order:
  1. the same user turn;
  2. `<|im_start|>assistant\n` followed by the turn-1 answer verbatim and `<|im_end|>\n`;
  3. the follow-up as a user turn;
  4. the same non-thinking prefill.
- **Generation settings.** From the installed `self/config/chat-models.json:12-24`, chosen because the model declares `generation` (`self/config/partition-generation.js:7-14`, `self/host/work-partitions.js:17`):

  | Setting | Value |
  |---|---|
  | `maxTokens` | 1024 |
  | `maxSeqLen` | 4096 |
  | `temperature` | 0 |
  | `topK` | 1 |
  | `topP` | 1 |
  | `repetitionPenalty` | 1 (window 0) |
  | `presencePenalty` | 0 |
  | `suppressTokenIds` | `[]` |
  | `stopSequences` | `[]` |
  | `useChatTemplate` | true |

  The settings are returned by `tokenize` (`resident-partition.js:347`) and bound at `partition-ordered-chat.js:79-81`. The digest is `generationDigest` in `doppler-single-machine.json`.
- **Seed.** None. The contract requires a seed only when `temperature > 0`, and `samplingSeedForToken(undefined, step)` returns `undefined` (`src/inference/token-sampling.js:12-13`).
- **Sampling.** `resident-partition.js:211-212` calls `sampleCapsuleLogits`. In `src/inference/token-sampling.js`, `padTokenId` 248055 is masked (`:289`) and then argmax is taken (`:303-313`). The pad token was never top-1 in any reference step.
- **Stop rules.** `src/inference/generation-step.js:18-26` stops on `eosTokenId` 248046 (`<|im_end|>`), `stopTokenIds` [248046, 248044], or 1024 tokens.

## Mismatches between application and reference

None in template, sampling or execution. The only differences are deliberate deployed precision choices:
- **Weights.** 151 Q4_K_M tensors, including a separately quantized Q4_K LM head where the source ties the head to its bf16 embedding. Configured by Doppler `src/config/conversion/qwen3/qwen-3-5-0-8b-q4k-ehaf16.json:10` (`"weights": "q4k"`) and `:12` (`"lmHead": "q4k"`).
- **Embedding.** f16.
- **KV cache.** f16.
- **Activations.** f32, carried as two-f32 values between stages.

The body quantization changes these answers; the head quantization does not. One naming point: the model id `...-ehaf16` and the brief's "f16 embedding/head" do not describe the head. The deployed `lm_head.weight` is `Q4_K_M`; only the embedding is f16.

## Runs

| Run | Environment | Script | Output |
|---|---|---|---|
| Distributed extract | Python 3.14 `-I` | `scripts/extract-distributed.py` | `distributed-observed.json` |
| Doppler single machine | Node v22, extracted archive `2df37d88` unmodified, `webgpu` (Dawn) on Apple M3 Metal, Capsule `-c` model bytes (all 21 sha256 match the signed catalog), plan `7a4ce534...` | `scripts/doppler-reproduce.mjs` | `doppler-single-machine.json` (+ `.log.gz`) |
| Source checkpoint | CPU, torch 2.11.0, transformers 5.3.0, `Qwen/Qwen3.5-0.8B` rev `2fc06364` already on disk (weights, tokenizer and config hashes equal the official HF etags; nothing downloaded) | `scripts/hf-reference.py` | `hf-reference.json` (+ `.log.gz`) |
| Deployed-weights control | Same CPU stack; deployed bytes decoded by gguf 0.17.1, f16 KV storage | `scripts/q4k-weights-control.py` | `q4k-weights-control.json` (+ `.log.gz`) |
| Join | Python `-I` | `scripts/assemble.py` | `failed-examples.json`, `comparison.json` |

Commands, run in order. `S` is the session scratchpad; the extracted archive got a `node_modules` link to `doppler/node_modules` for the `webgpu` provider. `APP=/var/tmp/reploid-signed-completion-app-5-20261013/app` and `CK=.../valera/generated/hf-models/Qwen-Qwen3.5-0.8B-2fc0636`.

```
python3 -I scripts/extract-distributed.py <run-5 report> <run-4 report> $APP/self/config/chat-models.json distributed-observed.json
node scripts/doppler-reproduce.mjs $S/archive-2df37d88/package /var/tmp/qwen35-capsule-completion-20261013-c $APP/self/config/chat-models.json $APP/self/config/partition-policy.json distributed-observed.json doppler-single-machine.json
python3 -I scripts/hf-reference.py $CK doppler-single-machine.json distributed-observed.json hf-reference.json
python3 -I scripts/q4k-weights-control.py $S/pylib-gguf /var/tmp/qwen35-capsule-completion-20261013-c $APP/self/config/chat-models.json $CK/config.json doppler-single-machine.json distributed-observed.json q4k-weights-control.json
python3 -I scripts/assemble.py distributed-observed.json doppler-single-machine.json hf-reference.json q4k-weights-control.json failed-examples.json comparison.json
```

Measured runtimes:
- Doppler run: 864 s, model loading included.
- q4k control: 518 s.
- bf16 greedy: 112 s (turn 1, f32) and 14 s (turn 2).

## Limits

- **No per-step trace in the evidence.** The delivered prompt token IDs and output token IDs were not recorded per step. The prompt IDs are established by three things: the recorded messages, the exact token counts implied by activation bytes, and the 100- and 12-step token-exact reproductions.
- **Reproduction ran on one machine only.** The Mac browser, AMD and Intel stages were not rerun; run 4 and run 5 agree.
- **Sampled runs are context only.** They are 8 seeds with temperature 0.7, top_p 0.8 and top_k 20. They omit Qwen's recommended presence penalty (1.5) and are not the application's settings.
- **Reference version.** The bf16 reference uses transformers 5.3.0. Doppler's earlier intake recorded 5.6.2 on `amd-host`.

## Files

- `README.md`: this summary.
- `failed-examples.json`: the preserved failed examples. For each turn it has the exact messages, rendered prompt, prompt token IDs, settings and token contract. It also has the delivered output for runs 5 and 4, with token IDs, steps, activation bytes and attempt IDs, plus source citations.
- `comparison.json`: the per-turn comparison table, including the supplementary bf16 sampling, corrected-history and tied-head results.
- `distributed-observed.json`: extracted from the evidence reports, including per-step streamed deltas.
- `doppler-single-machine.json`, `doppler-single-machine.log.gz`: the Doppler runs, with per-step top-5 logits.
- `hf-reference.json`, `hf-reference.log.gz`: the source checkpoint runs, with template rendering, greedy, teacher-forced and supplementary results.
- `q4k-weights-control.json`, `q4k-weights-control.log.gz`: the deployed-weights control, with greedy, teacher-forced and attribution variants.
- `scripts/`: the five scripts listed above.

Component: acceptance evidence for the signed completion journey (artifact only). Intent: preserved. Acceptance evidence: the commands above. Boundary effects: none; no application, Doppler, evidence or `/var/tmp` install was modified.
