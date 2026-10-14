# Useful-answer set for the Launch 1 model, Q4_K against bf16

Date: 2026-10-14. Machine: `mac-host` only, CPU only (no GPU, no SSH).

The model is `qwen-3-5-0-8b-q4k-ehaf16`: `Qwen/Qwen3.5-0.8B` revision `2fc06364`, with the deployed Q4_K weights. This folder holds a frozen set of 40 ordinary chat items and the results of running it on two arms:
- **Q4_K**: the deployed weights.
- **bf16**: the source checkpoint.

It records evidence only. The pass floor and the allowed gap against bf16 are the user's decision, so it sets no threshold and gives no verdict.

The frozen set is `answer-set.json`, sha256 `ac174063024054b9ea048b2dd4c532119bea96ae4d330dab89dd2c3ea62dced5`. No item or check changed after any model output was seen.

## Results

38 items are checked mechanically. 2 explanation items need human judgment; they have a written rubric and are graded provisionally in `review.json`.

| Category | Items | Q4_K pass | bf16 pass |
|---|---|---|---|
| Factual | 6 | 6 | 6 |
| Explanation (mechanical) | 3 | 3 | 3 |
| Code with a stated output | 6 | 2 | 4 |
| Arithmetic and units | 6 | 6 | 6 |
| Two-turn follow-up | 6 | 4 | 5 |
| Rewrite or summarize | 5 | 5 | 5 |
| Format-following | 6 | 6 | 6 |
| **Mechanical overall** | **38** | **32 (84.2%)** | **35 (92.1%)** |
| Explanation (rubric, provisional) | 2 | 1 | 1 |
| **All 40, rubric items provisional** | **40** | **33 (82.5%)** | **36 (90.0%)** |

How the Q4_K results compare with bf16 on the same items:

| Classification | Mechanical items | Items |
|---|---|---|
| Both pass | 32 | |
| Source-model failure (bf16 also fails) | 3 | `code-reverse-string`, `code-js-default-sort`, `fu-double-evens` |
| Quantization-caused (bf16 passes, Q4_K fails) | 3 | `code-double-evens`, `code-count-vowels`, `fu-palindrome` |
| Q4_K-only pass | 0 | |

Under the provisional rubric grades, `expl-list-tuple` fails on both arms and `expl-weather-climate` passes on both. That adds one source-model failure.

All six Q4_K failures and all three bf16 failures are code tasks or follow-ups. Every factual, arithmetic, rewrite and format item passes on both arms.

## The failures

**Quantization-caused** (bf16 passes, Q4_K fails):
- `code-double-evens` (the known turn 1).
  - Q4_K states `// Output: [2, 4, 6, 8]`, which equals the delivered answer token for token.
  - bf16 states `// [4, 8]`, which is correct.
  - The two arms diverge at token 1 (`javascript` against `js`), as in the answer-cause work.
- `code-count-vowels` ("education" has 5 vowels).
  - Q4_K writes a function that calls a nonexistent `str.is_vowel()` and states 4.
  - bf16 states 5. Its function is also broken, and its vowel list is wrong; see the review below.
- `fu-palindrome`.
  - Q4_K's turn-1 function is correct: it lowercases and drops non-alphanumerics. Asked what it returns for "Racecar", Q4_K answers **False** and reverses "racecar" as "carrecra".
  - bf16's turn-1 function is `return s == s[::-1]`, which does not ignore case as asked. It then answers `True`.

**Source-model failures** (both arms fail):
- `code-reverse-string`. The correct reversal of "stressed" is "desserts".
  - Q4_K states "edresst".
  - bf16 states "edreessst".
  - Both functions are correct; only the stated result is wrong.
- `code-js-default-sort`. JavaScript's default sort compares strings, so `[5, 1, 10].sort()` logs `[1, 10, 5]`. Both arms answer `[1, 5, 10]`, with identical tokens.
- `fu-double-evens` (the known turn 2). Each arm's turn 2 follows its own turn 1, as the app does.
  - Q4_K follows its wrong turn 1 and answers `[-6, 12, 18]`, the delivered answer, from the same 189 prompt tokens.
  - bf16 follows its correct turn 1 and still answers `[-4, 6]`. The correct answer is `[-4, 12]`.

## Review of the mechanical verdicts

I read every output of both arms. `review.json` records what I found, and `results.json` reports it separately as "reviewer-adjusted". The declared verdicts above are unchanged. There were no false fails. I found three false passes, where the asked-for result or artifact is wrong but the checks passed:
- **Q4_K `rw-summary-library`.** The one-sentence summary gives the new hours as "from 9 am to 11 pm and 8 pm to 10 pm". The checks do not test the stated times.
- **bf16 `code-count-vowels`.** It states 5, but the function raises `TypeError` (`len(False)`).
- **bf16 `fu-palindrome`.** Its turn-1 function ignores the "ignoring case" requirement. The turn-1 check only tests that a function is defined.

With those three flipped:
- **Pass rates.** Q4_K passes 31/38 (81.6%) and bf16 passes 33/38 (86.8%).
- **Quantization-caused.** 2 items: `code-double-evens` and `rw-summary-library`.
- **Source-model failures.** 5 items: the three above plus `code-count-vowels` and `fu-palindrome`.
- **Q4_K-only passes.** 0.

16 passing answers on the asked point also contain clearly false statements: 7 on Q4_K and 9 on bf16. Examples:
- Q4_K says Canberra is "on the banks of the Murray River" and that Austen died in 1840.
- bf16 says Apollo 11 landed at the Moon's south pole, and works 17 × 24 to 368 before stating 408.
- Both arms invent the history in `expl-leap-year`.

Each case is listed in `review.json`. The checks test the asked point, not the rest of the answer.

## How the arms ran

Both arms are the CPU arms of `../answer-cause-20261014`, reused with the same equations:
- **Q4_K arm.** Hugging Face transformers `Qwen3_5ForCausalLM` in float32, over the signed Capsule `-c` bytes. The bytes are decoded by gguf 0.17.1 and checked against all catalog sha256 values. The LM head is untied as deployed, and K/V are rounded to f16 at storage.
- **bf16 arm.** The source checkpoint, with every file's hash equal to the official etag, upcast exactly to float32. It decodes greedily with `model.generate`.

Both arms use the same application text path. `scripts/doppler-text.mjs` runs Doppler 0.6.28's own code from the same `2df37d88` archive, without a GPU:
- the `qwen` formatter with thinking off and no system message;
- the bundled tokenizer;
- the incremental decoder that builds the delivered text.

For two-turn items, turn 2's history holds the arm's own decoded turn-1 text, as `workspace.js` builds it.

Settings:
- Greedy decoding, as the catalog sets it.
- The pad token (248055) is masked, and it was never the argmax.
- Generation stops on token 248046 or 248044.
- The cap is the installed catalog's `maxTokens` of 1024. No answer reached it; all 90 generations stopped on `eos-token`.

| Check | Q4_K | bf16 |
|---|---|---|
| Turns (one turn-1 prompt shared by two items is generated once) | 46 (45 generated) | 46 (45 generated) |
| Largest prompt, tokens (limit 250) | 189 | 227 |
| Largest turn-1 prompt, tokens | 98 | 98 |
| Official HF template text == application text | 46/46 | 46/46 |
| HF tokenizer IDs == Doppler tokenizer IDs | 46/46 | 46/46 |
| HF decode == Doppler incremental decode | 46/46 | 46/46 |
| Decode steps / generation seconds | 5997 / 433.8 | 5656 / 436.4 |
| Median tokens per second (4 CPU threads) | 12.7 | 12.1 |

**Reproduction of the answer-cause results.**
- **Q4_K.** Its `code-double-evens` tokens equal both the answer-cause control and the delivered run-5 turn 1. Its `fu-double-evens` turn-2 prompt IDs equal the delivered 189, and its output tokens equal the delivered `[-6, 12, 18]`.
- **bf16.** Its `code-double-evens` tokens equal the answer-cause float32 reference.

**Speed change, checked bit for bit.** Without the `causal-conv1d` package, transformers runs the 18 linear-attention layers' decode-step depthwise conv through grouped `F.conv1d`. That takes about 1.1 s per token here. For one-token decode steps, `run-arm.py` replaces it with an equal `torch.bmm` that keeps the original output layout, so the following SiLU takes the same kernel path. At the start of each arm, the script compares full-vocabulary logits over 8 decode steps with and without the replacement. They were bit-identical (maximum difference 0.0) on both arms, and the script refuses to run otherwise. An earlier draft that applied SiLU to a contiguous tensor differed by up to 0.0003. The check caught it, and that draft never produced results.

## What is and isn't shown

Shown:
- **Pass rates and classification.** On this frozen set, with the application's template, tokenizer, decoder and generation settings, these are the useful-answer rates and failure classification of the deployed Q4_K weights and the bf16 source, both computed on CPU.
- **Code tasks.** Every quantization-caused failure in the declared verdicts is a code task with a stated output. bf16 shares the other three Q4_K failures.
- **Matching outputs are rare.** Only 4 of 40 turn-1 answers are token-identical between the arms. Most answers differ in wording, and both arms usually reach the same verdict.

Not shown:
- **This is the CPU control, not the GPU route.** The Q4_K arm reproduces the delivered tokens for the two known turns. The answer-cause work measured at most 0.0015 logit difference between Doppler's GPU and this control. Three Q4_K turns have a top-1/top-2 margin below that, where the GPU route could pick another token: `expl-list-tuple` (0.0003), `arith-percent` (0.0014) and `fu-primary-colors` turn 1 (0.0010). Four more are below 0.003 (`results.json` `q4kNearTies`). The route was not rerun.
- **Precision.** With 38 mechanical items, one item is 2.6 percentage points. Each arm ran one greedy pass. There is no confidence interval and no sampling.
- **Coverage.** The checks test the asked point. They do not catch false side statements (see the review). Code is not executed; only the stated output is checked. Haiku syllables are not counted.
- **Representativeness.** I wrote the set. It is English and short, with turn-1 prompts of at most 98 tokens to fit the route's prompt limit. It is not drawn from real conversations.
- **Human judgment.** The two rubric items and the review are my provisional grades, not a human's.
- **Decision.** No threshold or release decision is made here.

## Process

1. I wrote the set, with checks declared in `answer-set.json` (`checkTypes`, `rules`).
2. I ran the prompt-size preflight, which involves no model.
3. I fixed three checks that would have failed correct phrasings: "365 days, 5 hours", "14:00", and lead-in lines such as "Here is a shorter version:".
4. I ran a three-item harness smoke test (`code-double-evens`, `fu-double-evens`, `fu-translate`) and froze the set. The hash above was taken then; the set did not change afterwards.
5. I ran both arms.
6. `scripts/check.py` applies the declared semantics. It was written while the Q4_K arm ran. Its later edits only add reporting: the near-tie list and the reviewer-adjusted view.

## How it was run

| Run | Environment | Script | Output |
|---|---|---|---|
| Prompt-size preflight | Python 3.14.2 `-I`, Node v22, Doppler 0.6.28 archive `2df37d88` | `scripts/preflight.py` (+ `scripts/doppler-text.mjs`) | `preflight.json` |
| Q4_K arm | CPU, torch 2.11.0, transformers 5.3.0, gguf 0.17.1, 4 threads | `scripts/run-arm.py q4k` | `q4k-run.json` |
| bf16 arm | Same CPU stack; checkpoint already on disk, nothing downloaded | `scripts/run-arm.py bf16` | `bf16-run.json` |
| Checks and classification | Python `-I` | `scripts/check.py` | `results.json` |

Commands, run in order from this folder:
- `S` is the session scratchpad. `PKG=$S/archive-2df37d88/package` is the extracted Doppler archive used in the answer-cause work.
- `CAP=/var/tmp/qwen35-capsule-completion-20261013-c`.
- `APP=/var/tmp/reploid-signed-completion-app-5-20261013/app`.
- `CK=.../valera/generated/hf-models/Qwen-Qwen3.5-0.8B-2fc0636`.

```
python3 -I scripts/preflight.py answer-set.json $PKG $CAP preflight.json
python3 -I scripts/run-arm.py q4k answer-set.json $PKG $CAP $APP/self/config/chat-models.json $CK $S/pylib-gguf ../answer-cause-20261014/doppler-single-machine.json q4k-run.json
python3 -I scripts/run-arm.py bf16 answer-set.json $PKG $CAP $APP/self/config/chat-models.json $CK $S/pylib-gguf ../answer-cause-20261014/doppler-single-machine.json bf16-run.json
python3 -I scripts/check.py answer-set.json q4k-run.json bf16-run.json review.json ../answer-cause-20261014 results.json
```

Measured runtimes: Q4_K 451.2 s and bf16 451.4 s, each including model load and the conv check.

## Files

- `README.md`: this summary.
- `answer-set.json`: the frozen set. It holds 40 items (46 turns) with expected outcomes, declared checks, rules, check semantics and the two rubrics.
- `preflight.json`: the turn-1 prompt sizes and turn-1 answer budgets for the two-turn items, computed before any model ran.
- `q4k-run.json`, `bf16-run.json`: per turn, the following:
  - messages, rendered prompt, prompt token IDs and count;
  - output text and token IDs, stop reason, decode steps and seconds;
  - per-step top-1/top-2 margins;
  - template, tokenizer and decode cross-checks.

  Each file also holds weight provenance and the conv replacement check.
- `review.json`: the provisional rubric grades and my notes on the mechanical verdicts.
- `results.json`: per item and arm, every check with its detail, pass or fail, and the classification. It also holds the rates by category, the reviewer-adjusted view, the reproduction checks, the prompt checks, timing and the Q4_K near-tie list.
- `scripts/`: the four scripts listed above.

Component: acceptance evidence for Reploid Launch 1 model quality (artifact only). Intent: preserved. Acceptance evidence: the commands above. Boundary effects: none. No application, Doppler, existing evidence or `/var/tmp` install was modified.
