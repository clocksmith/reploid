# Fixed-document answer organization: rejected development candidate

Sixteen native Metal generations completed on the provisioned Qwen 3.5 2B Q4K
model. The candidate failed the unchanged all-eight-case gate and was not
promoted. Native owner and GPU cleanup settled. No production code, settings,
providers, model artifacts, or public services changed.

## Exact comparison

The eight cases are the already exposed development cases from
[source grounding](../search-answer-control-20261018/source-grounding-contract.json).
This is neither a protected evaluation nor a live-retrieval test. No sources
were downloaded, selected, filtered, truncated, or reordered. Both arms use the
same question and source bytes, exact catalog model/manifest, generation options,
64-token output cap and reset resident request path. Order alternates by case.

Baseline reproduces the deployed retrieval instruction and source/question block
in one user message. Candidate changes instruction wording and places that
instruction in a system message; its user message retains the full source and
question block. This bundled candidate cannot attribute any difference to role
placement alone. [Contract](contract.json) records both instructions verbatim,
document hashes, exact generation settings, model identity and bounds.

Model manifest: `sha256:83e5a01a21e234d238ea3ed5b0b234cc52781ddfce51861abd0fdf0ae3199028`.
Runtime is the installed `doppler-gpu` 0.6.32 historical Reploid dependency,
not the separate successor/profile campaign. [Receipt](receipt.json) identifies
installed runtime bytes, request messages, outputs, source files and timings;
[runtime inventory](runtime-inventory.json) retains the file hashes. No historical
model identity was rewritten. [Seal](seal.json) was written before execution and
verified unchanged afterward. The runner refuses to overwrite its receipt.

## Results and limitations

| Frozen mechanical check | Baseline | Candidate |
| --- | ---: | ---: |
| Complete cases | 5/8 | 7/8 |
| Required/forbidden content checks on answerable cases | 3/6 | 6/6 |
| Citation marker checks, including no citations on unknowns | 6/8 | 8/8 |
| Explicit name-only format | 0/1 | 0/1 |
| Appropriate complete abstentions on unknowns | 2/2 | 2/2 |

These are mechanical checks, not factual-correctness or citation-support scores.
The receipt's `answeredSupportedCases` field is a conjunction of content and
citation-marker checks only; it does not establish semantic support. Likewise,
`unsupportedAbstentions` detects only full-response abstention, missing mixed
answers. Preserve those original fields and use [source/output review](review.json)
for their limitations; do not reinterpret a heuristic as qualified evaluation.

The candidate repairs the bare/incorrect outputs for the author and vessel
questions. It nevertheless fails in three important ways:

- Movie selection returns `Reed is animated and 84 minutes. [1]`, violating the
  requested name-only format despite choosing the eligible title.
- The two-award answer supplies correct facts and citations, then appends
  `The retrieved sources do not answer it.` This is contradictory abstention on
  an answerable question and passes the naive substring/full-string checks.
- The amber-ticket answer adds an unsupported claim that the amber fact appears
  within the untrusted directive. The directive is the separate advertisement
  asking for violet; the correct color alone does not validate the extra claim.

Conversely, baseline's author answer includes the true illustrator fact. The
retained forbidden-name check rejects it, but it is not a factual hallucination.
The review records correctness, support, requested format and abstention
separately. It is assistant review of exposed fixtures, not independent review.
No confidence interval, throughput improvement or causal role-placement claim
is warranted by one paired run per case on a shared machine.

## Validation and reproduction

- `node --test artifacts/source-answer-organization-20261019/checks.test.mjs`:
  four focused checks passed. They cover false abstention, wrong citation,
  formatting, truncation, unknown questions and preservation of input bytes.
- `node --check artifacts/source-answer-organization-20261019/run.mjs`: passed.
- Physical command: `node artifacts/source-answer-organization-20261019/run.mjs`,
  run under a 600-second Python subprocess deadline. Exit 0 means the experiment
  completed; `mechanicalGatePassed` and `accepted` are false. All outputs and
  diagnostics are in [run.log](run.log). Per-request timeout is 90 seconds;
  no automatic retry, provider substitution or weight download occurs.

To repeat, copy this directory to another two-level artifact directory, remove
only copied generated outputs (`receipt.json`, `runtime-inventory.json`,
`run.log`, `review.json`, `postflight.json`, `seal.json`, `SHA256SUMS`), adapt local
model paths if needed and the two artifact-relative source identity entries in
`run.mjs`, and create a new seal before running. Preserve these originals.
An altered harness/contract is a newly identified experiment. Tests need no GPU.

Next: hand this rejection to the active fixed-document comparison owner. Its
evaluator must catch mixed answer/abstention and distinguish extraneous supported
facts from wrong facts before any useful-answer claim. Do not run fresh protected
confirmation for this failed candidate. Boot qualification remains independent:
the [prior boot repair](../boot-timeout-20261018/README.md) already has focused
and deployed evidence; this experiment makes no new boot or full-journey claim.

Component: application verification. Intent preserved. Boundary effects: none.
Doppler's active profiling work and Gamma's recovery work were left untouched.
