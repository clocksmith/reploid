# Answer regression harness

**Automated regression evaluation — not independent acceptance.**

This harness catches engineering regressions in Reploid's answers. It runs a fixed item set on one target, applies automated checks, and compares the run with a stored baseline run of the same target.

It does not establish answer quality, acceptance or a release decision, and it is not independent review. Human reviewers assess the working experience separately, under the [review packet](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/independent-answer-review-20261014/README.md) and its protocol. Every file the harness writes carries the label above. Automated judge output also carries the label "automated judge, not independent review".

## Layout

| Path | Content |
|---|---|
| `harness.js` | The command-line entry: `run`, `evaluate`, `compare`, `reproduce`, `search-preflight`. |
| `lib/targets.js` | The three targets behind one interface, and the identities each records. |
| `lib/checks.js` | The mechanical, format, instruction and search checks. |
| `lib/mechanical.js` | The useful-answer set's check types, ported from its frozen `scripts/check.py` with the same verdicts and detail text. |
| `lib/python-compat.js` | The Python `str`, `repr`, `re` and `json` behaviours those check types name, reimplemented in JavaScript. |
| `lib/code-exec.js` | Executed-code checks in a sandboxed scratch directory (JavaScript only). |
| `lib/judge.js` | The optional automated judge adapter. |
| `lib/evaluation.js` | Applies the checks to one run. |
| `lib/report.js` | The regression report: baseline against candidate. |
| `lib/reproduce.js` | Confirms the harness reproduces the frozen useful-answer results. |
| `lib/search-preflight.js` | Retrieval records and prompt sizes for the search set, with no model. |
| `lib/context-candidate.js` | Loads and replays the retained `whole-passages-250` context candidate. |
| `node/retrieval-helper.js` | Retrieval and citation checks through the retrieval component's exported interface. |
| `node/doppler-run.mjs` | The single-machine Doppler runner that target (b) copies to its host. |
| `sets/useful-answer-overlay.json` | Instruction checks and code probes for the frozen 40-item set. |
| `sets/search-tasks.json` | The frozen search-task set, not yet exercised. Its preflight is `sets/search-tasks.preflight.json`. |
| `targets/` | `cpu-q4k-mac.json` (target a; it identifies the stored baseline and no longer generates), and example configurations for targets (b) and (c). |
| `judges/judge.example.json` | An example judge configuration. It is not configured. |
| `baselines/cpu-q4k-mac-20261015/` | The first baseline: the run, its evaluation and the reproduction result. |
| `tests/unit/answer-regression-harness.test.js` | Focused tests of the harness, using synthetic answers only (vitest). |

## JavaScript only

Reploid is JavaScript only, so this harness is Node ESM (Node 22 or later) and starts no Python process. Compared
with the earlier Python harness:
- **Target (a) refuses to generate.** It ran the useful-answer set's frozen Python `run-arm.py`. `run` on it stops
  with "target (a) ran a Python control; removed under the JavaScript-only order". Its stored baseline still
  evaluates, compares and reproduces. New runs use target (b) or (c).
- **Mechanical checks are ported, not loaded.** `lib/mechanical.js` reimplements every check type of the frozen
  `scripts/check.py` (sha256 `1a303808…`), including Python's `repr` text, code-point lengths, Unicode-aware `\w`,
  `\d`, `\b` and `$`, and `json.loads` error messages. Evaluations record the port's own sha256 and the file it
  was ported from.
- **Python-language code is not executed.** The overlay's Python cases (`code-sum-squares`, `code-count-vowels`,
  `fu-palindrome`) and the `code-python-slice` reference program are recorded with `pass: null` and the reason
  "not executed: python execution removed (JavaScript-only)". An unfenced Python `codeOnly` answer is recorded as
  not checked (`pass: null`, `checked: false`). Ungraded rows do not count toward a family's rate; a family whose
  rows are all ungraded has `pass: null`. The overlay itself is unchanged.
- **JavaScript code runs in a fresh child `node`** (the harness's own `process.execPath`) with the same limits as
  before; the 8 MiB file-size limit is applied through the shell's `ulimit -f`.

The frozen useful-answer set and the review packet left the source tree for the
[evidence catalog](../../docs/evidence-catalog/README.md). Restore them before evaluating or reproducing
useful-answer runs, either in place or into a root outside the repository named by `REPLOID_ARX_EVIDENCE_ROOT`:

```sh
node scripts/restore-evidence.js artifacts/useful-answer-set-20261014 "$SCRATCH/evidence"
node scripts/restore-evidence.js artifacts/independent-answer-review-20261014 "$SCRATCH/evidence"   # judge policies
export REPLOID_ARX_EVIDENCE_ROOT="$SCRATCH/evidence"
```

Every restored file the harness reads is pinned by sha256; records name its canonical repository path.

## Targets

Every target receives the same plan: for each turn, the exact user content to send. Every target returns turns with the same fields, so the same checks and comparisons apply to all of them.

Each run records its identities:
- the package or archive hash;
- the model manifest identity;
- the Capsule id and catalog entry hash;
- the route or placement;
- the prompts: messages, prompt token IDs and the rendered-prompt hash;
- the sampling settings and token contract;
- the limits.

Machine paths come from `${ENV}` references. Records keep the configured text and the hashes, never the paths themselves.

| | Kind | What runs | State |
|---|---|---|---|
| (a) | `cpu-q4k-control` | Was the useful-answer set's frozen Python `run-arm.py` and `doppler-text.mjs` on mac-host CPU. Generation is removed under the JavaScript-only order; `run` refuses. | Baseline stored; no new runs |
| (b) | `doppler-single-machine` | `node/doppler-run.mjs` on one host through Node WebGPU (Dawn). It runs the package unmodified, with the catalog's generation settings, as `unsplit` (whole model) or `ordered-three-stage` (the catalog plan's resident partitions in one process). It checks the package root against its archive file by file, checks the Capsule model bytes against the catalog, and checks that the execution identity matches the TargetPlan. | Preflight checked; GPU path not yet run |
| (c) | `installed-route` | The installed native participant's mounted text API: `/v1/chat/completions`, or `/v1/messages`, which reports raw token usage. Sampling is the route's own, because the API takes no overrides. Placement is declared by the operator, because the API does not report it. | Not yet run |

## Checks

| Family | What it tests |
|---|---|
| mechanical | The useful-answer set's check types and `grade_arm`, ported from its frozen `scripts/check.py` to `lib/mechanical.js` with identical verdicts and detail text. The two rubric items stay ungraded. |
| format | On every generated turn: a non-empty answer; a stop on the end-of-turn token rather than the length limit; no leaked template tokens; no U+FFFD; no degenerate repetition; and the prompt within the route limit. |
| instruction | The overlay's checks of explicit form requirements, such as "two or three sentences", "just the output", "only the corrected sentence", "just the code", named functions, and "filter and map". An unfenced JavaScript `codeOnly` answer is parsed with `node --check`; an unfenced Python one is not checked. |
| code | The answer's own JavaScript, run verbatim by a fresh child `node` in a new directory outside the repository, followed by a probe that calls the function on the prompt's inputs. It runs with a 10 s timeout, PATH and HOME only, an 8 MiB file-size limit, and, on macOS, `sandbox-exec` with no network and no writes outside the case directory (`unshare` with no network on Linux where available). The JavaScript reference program confirms the expected output of `code-js-default-sort`. Python cases and the Python reference program are recorded as not executed. |
| search | The retrieval outcome. The asked point, checked with the frozen check types. Abstention, for unanswerable items. Citation validity from `verifyCitations` with no support checker: citations resolve, reference entries match, no unrecorded URL appears, and the expected sources are cited. Claim coverage is reported separately. Support is never judged here. |
| judge | Optional and off by default. A configurable adapter, `openai-chat` or `anthropic-messages`, grades each answer under the frozen evaluation policies. The judge must be a different model from the generator. The harness refuses a judge whose model name or identity matches the run's model, or whose endpoint is the run's own route. It discards any response that reports the generator or another model. Credentials come from an environment variable or a file outside the repository. |

## Usage

Run every command from the repository root with `node`. Work and scratch directories must be outside the repository.

```sh
# Evaluate a run and compare it with the stored baseline of the same target
node tests/answer-regression/harness.js evaluate --run "$SCRATCH/arx-candidate"
node tests/answer-regression/harness.js compare --baseline tests/answer-regression/baselines/cpu-q4k-mac-20261015 \
  --candidate "$SCRATCH/arx-candidate" --out "$SCRATCH/arx-report" --fail-on-regression

# Reproduction of the frozen useful-answer mechanical results (needs the restored evidence, above)
node tests/answer-regression/harness.js reproduce --run tests/answer-regression/baselines/cpu-q4k-mac-20261015 --out "$SCRATCH/reproduction.json"

# Optional automated judge (off unless given)
node tests/answer-regression/harness.js evaluate --run "$SCRATCH/arx-candidate" --judge my-judge.json --out "$SCRATCH/arx-candidate/evaluation-judged.json"

# Harness tests
npx vitest run --config tests/vitest.config.js tests/unit/answer-regression-harness.test.js
```

`compare` refuses runs of different targets or item sets. For search, generated turns must bind the frozen sources, context digest and actual dispatched messages; changed or missing inputs require a separate baseline. Both runs must contain the same evaluated item IDs. Non-dispatched retrieval failures remain visible failures. Timing and citation verification metadata do not change source identity or establish answer quality. It reports:
- identity changes, with a note when sampling or limits changed, so answer differences are not read as arithmetic drift;
- changed answers, with the first diverging token;
- every verdict that newly fails or newly passes;
- pass rates, including the judge pass rate when both runs were judged;
- per-category counts;
- per-item details.

### Pointing it at the GPU target later (b)

1. Copy `targets/doppler-single-machine.example.json` and keep its `id` stable per host and placement. Runs of different packages then compare against each other.
2. Set the `REPLOID_ARX_REMOTE_*` variables to paths on the host:
   - a work directory;
   - `node`;
   - an installed package root with its dependencies, and the archive it came from;
   - the Capsule;
   - the installed catalog;
   - `partition-policy.json`.
3. Set `host` to an SSH alias from your own SSH configuration, such as `amd-host`, or to `local`.
4. Run the preflight first. It checks identities and tokenizes the prompts, and opens no GPU:
   `node tests/answer-regression/harness.js run --target my-amd.json --work "$SCRATCH/w" --out "$SCRATCH/pre" --preflight`.
5. Drop `--preflight` to generate. Logs and the run directory stay on the host; only `out.json` comes back.
6. Store the first evaluated run of that target as its baseline.

### Pointing it at the installed route later (c)

1. Mount the adapters as `docs/native-participant.md` describes.
2. Copy `targets/installed-route.example.json` and set:
   - `REPLOID_ARX_ROUTE_URL`;
   - `REPLOID_ARX_ROUTE_TOKEN`, a credential your `authenticate` port accepts;
   - `REPLOID_ARX_INSTALLED_APP`, the installed application directory. The harness records its catalog entry, package pin and partition policy from there.
3. Choose `protocol`:
   - `messages` reports prompt and output token counts, so the route prompt limit is checked;
   - `chat-completions` compares by text only.
4. Write the route's placement into `declaredPlacement`.

### Search items

`sets/search-tasks.json` holds 8 frozen items that follow policy R. Each item retrieves from its own fixed documents through `createFixedSearchProvider`, so retrieval is deterministic. A target runs them with `run --set search` once retrieval is wired:
- Targets (a) and (b) receive the dispatched content: the numbered sources plus the question, exactly as `withSourceContext` builds it.
- Target (c) refuses them until the chat request API has a retrieval opt-in. Set `"retrieval": true` in its configuration once it does.

No model has answered these items. The preflight shows that every retrieved item's dispatched prompt is 303 to 378 tokens. That is over the current 250-token route limit, so the items will record `overPromptLimit` until the route's limit rises.

## Baseline and reproduction

The first baseline is in `baselines/cpu-q4k-mac-20261015/`. It is target (a), run on 2026-10-15 on mac-host CPU over the 40-item useful-answer set (sha256 `ac174063…`).

Its identities:
- **Package.** Doppler 0.6.28, archive sha256 `2df37d88…`.
- **Model.** Manifest `sha256:6b2cb026…`, with 18 shards verified.
- **Capsule.** `…-capsule-v3-67f240af…`.
- **Sampling.** Greedy: catalog temperature 0, topK 1; the pad token is masked.
- **Limits.** maxTokens 1024; route prompt limit 250.

`run-arm.py` took 630 s, slower than on 2026-10-14 because the machine was busy with other work. Every one of the 45 generations stopped on its end-of-turn token.

| Family | Baseline |
|---|---|
| mechanical | 32/38 (84.2%). Failing: `code-double-evens`, `code-reverse-string`, `code-js-default-sort`, `code-count-vowels`, `fu-double-evens`, `fu-palindrome`. The two rubric items are not graded. |
| format | 39/40. `fact-adult-bones` repeats one bullet three times in a row. |
| instruction | 10/10 items. |
| code | 5/6 cases. `count_vowels` raises before the probe runs. Both reference programs give the expected output. |

`reproduction.json` (written by the earlier Python harness) confirms the harness reproduces the useful-answer set's frozen mechanical results exactly:
- **Check equivalence.** The harness's verdicts for the stored 2026-10-14 Q4_K and bf16 arm runs equal `results.json`. That covers 38 items and 60 checks per arm, compared on pass and detail text, with 0 mismatches.
- **Generation.** All 46 turns of the fresh run equal the stored Q4_K run in prompt token IDs, rendered prompt, output token IDs, text, stop reason, decode steps and smallest top-1/top-2 margin.
- **Verdicts and rates.** The fresh run's verdicts equal `results.json`'s Q4_K verdicts. The mechanical rates by category equal `results.json` for the fresh run (32/38), the stored Q4_K run (32/38) and the stored bf16 run (35/38).
- **Whole evaluation.** The stored Q4_K run, evaluated now, agrees with the baseline evaluation in every mechanical, format, instruction and code verdict.

The JavaScript harness, run on 2026-11-25 against the same stored run, reproduces it: check equivalence 0 mismatches
in 60 checks per arm (pass and detail text), generation 0 differing turns of 46, baseline verdicts 0 mismatches, all
three rate rows equal, and the whole evaluation equal in every mechanical, format, instruction and code verdict except
four that needed Python: the code verdicts of `code-sum-squares` (was pass), `code-count-vowels` (was fail) and
`fu-palindrome` (was pass), and the `fu-palindrome` `codeOnly` instruction verdict (was pass). Those are now
ungraded, so a fresh evaluation of the baseline run reports instruction 9/9 and code 3/3 against the stored 10/10 and
5/6, with no newly failing or newly passing verdict. `reproduce` lists them under `ungradedWithoutPython`.

The reproduction reads only the mechanical fields of `results.json`. Its review section and provisional rubric grades are not used.

The baseline run record was written before the harness was committed. It names the pinned `run-arm.py` and `doppler-text.mjs` that generated it. The evaluation records the harness commit and a digest of the harness code.

## What this does not show

- **Quality.** It shows no answer quality, no acceptance and no independent review. The checks test the asked point and the declared form, and the judge is a model.
- **The GPU route.** Target (a) is the CPU control. Target (b)'s GPU path has not been run, and target (c) has not been run.
- **The search items.** They are unexercised. Citation support is not judged.
- **Variation.** Each run is one greedy generation; there is no confidence interval.

*Last updated: November 2026*

## Retained 250-token context candidate

`context-candidates/whole-passages-250.json` retains the original prompts, two
rejected truncated variants, and a separately identified full-passage candidate.
The candidate tries two complete ranked passages, then one, using only the exact
250-token budget for selection. Required source IDs are checked afterward.
Compact citation/abstention instructions are recorded as a separate task policy;
source documents, evaluator checks, model catalog and route limit are unchanged.
The seven dispatched prompts contain 184–242 tokens; empty retrieval dispatches
nothing. Earlier truncated prompts remain rejected.

`context-candidates/identity.json` binds the fixture bytes and canonical selected
inputs, including passages, digests, dispatched messages and tokenizer IDs. These
are development input identities. No model has answered this candidate, and
source coverage establishes neither citation entailment nor answer quality.
The ordinary frozen-set comparator continues to reject changed source contexts;
this candidate needs its own explicitly bound baseline.

Run the read-only coverage check from the repository root:

```sh
node tests/answer-regression/test-context-candidate.js
npx vitest run --config tests/vitest.config.js tests/unit/answer-regression-harness.test.js
```

As of 2026-11-25 the replay fails on main: the retrieval component's records now carry a `partial` field that the
retained fixture lacks. The harness then refuses the candidate, and the unit tests run the refusal test instead of
the candidate group until the fixture is re-retained under a new pin.

The existing `run` command accepts `--set search --context-candidate whole-passages-250`.
This replays and verifies the retained fixture through the public retrieval API,
then sends its exact full-passage messages through the selected existing target.
It records a separate context identity and per-item limits. `evaluate` uses the
same frozen answer/citation checks with that candidate's bound rendering policy;
citation support remains unjudged. `compare` requires both runs to bind the same
context candidate and item subset. An original-context run cannot be its baseline.
Partial runs retain explicit `notRun` rows; omitted items do not become successes.

No generation is started by adding this option or running the harness tests. Before
physical execution, qualify the exact target/package/model and obtain the applicable
host/campaign approval. The retained 184–242 token counts apply to their recorded
text path; the selected target must record its own actual prompt counts and limit
failures. Reload, cancellation and provider-replacement tests remain separate from
answer checks (`tests/unit/chat-retrieval.test.js` and `chat-workspace.test.js`).
