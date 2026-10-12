# Cited calculation experiment

Status: frozen and independently reviewed before generation in `82603086`. The run stopped at the second-case boundary after both attempted cases failed; five cases remain unrun. No qualification or production change.

Component: Reploid document reasoning. Intent: preserved. Pure generation configurations remain rejected. This tests a different application workflow, not another sampling or wording campaign.

Existing boundaries inspected at Reploid `64b642320dfec92bf0c7c6ad7c766cdea3a0efc1`:

- `self/host/document-comparison.js`: `comparisonSources(content)` returns original question and identified document passages. It does not verify the truth of a cited claim.
- `packages/reploid/src/agent/tool-runner.js`: `createToolRunner({builtInTools, authorize})`, then `executeTool(name,args,{signal})`, provides explicit tool admission and closing. It has no calculator built in.
- `self/host/work-inputs.js`: ListInputs/ReadInput and artifact integrity checks belong to the separate work host. InspectArtifact checks syntax/integrity, not facts.
- `self/host/work-session.js`: RunTool executes pinned registered improvement targets. Reusing that would import an unrelated improvement workflow into conversation reasoning.

The smallest proposed reuse is the existing source parser and minimal authorized tool runner. The bounded Calculate handler and quote validation are **new diagnostic handlers**, not an existing application capability. They remain in this evidence directory until a qualified result supports production integration.

## Hypothesis

An already-authorized source model extracts calculation operands and their exact source spans. Code validates source identities, spans, numeric lexemes, types and bounded operations. Code computes arithmetic/calendar results using only the extracted operands. A second model call receives those results and the unchanged conversation, and must answer the original question with correct conditions, contradictions and citations.

No code reads expected answers, searches for case-specific keywords, repairs model output or fabricates missing facts. A quote match establishes text provenance, not semantic entailment. Wrong subjects, negation, conditions, omitted facts and unsupported recommendations still fail the original manual criteria.

Both calls share one 4096-generated-token, 8192-total-token and 16000-UTF-16-character allowance. Repeated prompt tokens count again. Tool output included in the second prompt counts. Failure to parse, validate, finish naturally or stay in budget is retained without retry. Calculation failure cannot be hidden from the final response.

The original four ordered conversations and complete review criteria are retained. Fresh holdouts are frozen before any generation. The source identity, official template, nonthinking mode and greedy repetition-1.0 policy stay fixed; this does not reopen the rejected pure-generation configuration or qualify converted weights.

## Required gates

1. Independent calculator/quote-validator normal and boundary tests, including mismatched IDs, altered quotes, out-of-scope literals, division/overflow limits, incompatible units, ambiguous calendar dates, cancellation and unauthorized tools.
2. Pre-output freeze of prompts, cases, all handlers/evaluator identities and aggregate budget accounting; independent review.
3. CPU source runs on x128 in an agreed window; preserve raw extraction, tool inputs/results, both prompts/token IDs and unedited final answer.
4. Manual review of every unchanged factual/citation/natural-completion requirement, fresh holdouts and actual closed-loop followup before any implementation transfer.

Boundary effects: none in production. No new permissions, scheduler, model mathematics, runtime archive or package pin.

## Running receipt and reproduction

`run-binding.json` records the exact command, environment, host and process identity. The supervisor writes final exit status to the same remote binding. Live output is `/home/x/deco/reploid/reports/local/cited-calculation-experiment-20261012/result.json`; `run.log` and per-case extract/answer JSON files retain incremental output. Inspect these read-only. Do not rerun a failed case or change policy while the frozen run is active.

The source checkpoint is already verified locally on x128. Reproduce the command in the binding from `/home/x/deco/reploid` with its explicit environment, after coordinating the CPU window. Reproduction is diagnostic, not a way to select a favorable answer.

## Disposition

`review.json` records the two rejected cases and five unrun cases. The first extraction returned malformed JSON; its answer invented successful tool receipts and retained factual/citation failures. The second extraction repeated date facts until its1536-token cap. The parent explicitly stopped this admitted-failing configuration at that boundary. All raw reports and logs are retained compressed with original hashes. The separately identified `official-tool-protocol/` candidate uses the checkpoint's actual tool template; it has no output yet.
