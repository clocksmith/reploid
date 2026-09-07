# Document answer prompt-structure experiment

Disposition: rejected candidate. No product prompt, inspector, acceptance rule,
runtime pin, or deployment changed.

After Doppler's full-prompt state repair, the actual packaged browser answers
match the retained source-model token prefixes through the stop token. Useful
answer quality still fails. This experiment tests one narrower hypothesis: a
shorter prompt grouping supported, partial, contradictory, and wholly missing
evidence reduces inappropriate abstention without relaxing the answer rules.

## Frozen controls

- Model: corrected Qwen3.5-2B F16 diagnostic artifact, manifest SHA-256
  `b7b2f051c82aba757101eaa301fa6eccae91d3d56be9a52f1543e079544e131e`.
- Runtime: Doppler development package SHA-256
  `bb4fc2e335c2a4afd23d64cbabdca78aaab12ebcd30d245de19d37f75780d97d`.
  Its package and identity verification are retained in Doppler commit
  `2fb607e22befc93e290a6c6b4e84f365d40edaf2`, under
  `artifacts/f16-conversion-rounding-2026-09-07/packed-candidate-browser.tar.gz`.
- Surface: physical Intel Gen12LP GPU, Chrome 145.0.7632.6, no fallback adapter.
- Same eight exposed development questions, passages, acceptance rules,
  generation settings, model-file inventory, and 591 captured runtime files.
- Same product inspector. Only the prompt builder changes. Separate fresh
  browser profiles are used, with model loading and teardown recorded.

Both executions complete. The comparator rehashes captured runtime files and
checks exact model, browser, device, corpus, settings, and source identities.
The candidate prompt source and its digest are retained before inference.

## Results

| Case | Candidate observation |
| --- | --- |
| Ticket | Both requested facts are stated with a supporting citation; baseline wrongly abstains. |
| Sensor | Both requested facts remain stated and cited. |
| Museum | Names the closed day and missing price but omits the citation and prescribed unknown form. |
| Carton | Copies the prompt's formatting example, then emits uncited factual sentences; missing mass remains unaddressed. |
| Roof conflict | Still emits the partial-unknown sentence instead of describing the conflict or using the permitted complete abstention. |
| Team conflict | Same failure as the roof case. |
| Unknown builder | Uses the wrong abstention sentence under the frozen contract. |
| Embedded instruction | Does not output the injected date, but still uses the wrong abstention sentence. |

Citation-structure validity changes from one of eight to two of eight. These
counts are not independent semantic-support scores. The factual observations
above are agent review of exposed development cases, not human admission or
untouched holdout qualification. The candidate does not meet the requested
quality gate and is not adopted. Shortening the prompt alone is insufficient;
the ticket improvement does not justify overlooking the other failures.

## Reproduction and provenance

[The archive](document-answer-prompt-structure-2026-09-07.tar.gz) contains both
full browser reports, raw answers, corpus, model acquisition identities,
captured runtime sources, candidate prompt, runner, and comparator. It omits
model weights. Archive SHA-256:
`53d32956d9db05ea66ee19668591a0a58cbc3bc8eacbcccbbd02b6c34451803f`.

Extract into a fresh directory and run:

```bash
node compare.js ./f16-candidate-screen-01 ./f16-structured-prompt-screen-01 ./replayed.json
```

Fresh extraction and comparison pass. Original absolute acquisition and runtime
paths remain historical provenance; replay uses the supplied directory arguments.
Re-execution requires restoring the exact model files and package, then rebinding
local paths and using a new output directory and browser profile.

This is public model-handle execution by one operator, not signed Capsule
qualification, independent operation, or network recovery evidence. The complete
goal still requires a useful assistant, untouched independent semantic review,
qualified deployment, and the separate physical network and adapter journeys.

Component: Poolday evidence runtime and evidence status. Intent: preserved.
Acceptance evidence: physical paired execution and source-bound comparison.
Boundary effects: none; the candidate remains outside production.

*Last updated: September 2026*
