# Proposed source-literal catalog control

Status: read-only assessment after the rejected worked-contract run. No new candidate, extractor, tool or model run is implemented by this proposal.

The first broken boundary remains model-produced operands. The worked example improved JSON syntax but did not stop invented values, nonnumeric values, duplicate aliases or invalid operation arguments. A separate hypothesis is to remove operand transcription from the model's job: enumerate supported literal spans deterministically, then ask the model to select existing references and operations. This does not establish semantic attribution or a useful answer.

Reuse `sourceMap(messages)` and `calculate(plan,messages)` from the existing diagnostic `calculate.js`, plus the existing authorized tool runner and official source-template adapter. `sourceMap` already excludes assistant messages, retains original passage identity, and rejects changed text under one passage ID. No existing literal enumerator was found. A new bounded diagnostic enumerator and operations-only tool adapter would therefore be necessary; they must be identified as new work.

The enumerator would visit original user questions and passages in stable order, record source ID, exact character span, full original quote, exact value and lexical kind, and issue unique aliases from position. Explicit `$` and `%` mark money and percent; spelled calendar dates and whole duration lexemes retain their source units. Plain numerical values remain numbers. It must not label a value as a base price, inclusion, exclusion, deposit, deadline, total, or truth. Conditions, conflicting clauses, unknown values and prior assistant claims remain for the unchanged model/manual factual review.

The model would receive a compact catalog of alias, kind, exact value and passage ID alongside the unchanged original documents/history. Full quote/span bindings remain in the host for validation, avoiding repeated full paragraphs in every catalog row. The tool accepts operations only; it combines them with the immutable catalog internally and calls the same calculator. This is an explicit new input contract, not repair of malformed model output. No literal operands, invented aliases, semantic defaults or extra tool retries are accepted.

A read-only lexical-span count over the existing seven source maps found approximately 17, 17, 18, 18, 5, 3 and 6 spans respectively, below the existing 40-fact cap. This preliminary count is not a validated extractor: citation identifiers, overlap, unsupported formats and units need dedicated tests. It does not prove final prompt fit. A compact catalog could replace the former fact-schema burden and remove the 599-token worked example, but exact tokenizer preflight must measure both calls before any run. The existing 4096 generated/8192 total/16000 UTF-16 budgets stay unchanged, including all repeated prompt tokens.

Before implementation/run, freeze and independently review:

- Supported lexical grammar, overlap order, stable alias ownership, quote/span checks and the distinction between exact text and entailment.
- Rejection of partial values, omitted signs/units, compound number words, impossible dates, conflicting source identities, ambiguous duration units and unsupported quantity formats. No silent conversion or invented zero for an unknown charge.
- Tests using unrelated positive/boundary cases, including repeated equal amounts in different clauses, included allowances, negation, percentages, dates across month/year boundaries, citations containing digits and attempts to cite prior assistant text.
- Exact operations-only schema, adapter and strict official parser behavior; no repaired responses or hidden retries.
- The same seven ordered cases and all factual/citation/conditional criteria, including both correction histories. Fresh independent holdouts and a closed-loop conversation remain necessary if this control earns a source pass.
- Explicit stopping at the first completed structural/tool/budget failure, or full seven-case completion otherwise. A valid arithmetic plan is insufficient if it selects the wrong cited operands or omits conditions.

This hypothesis can remove demonstrated transcription/alias failures. It cannot cure demonstrated planning errors such as summing competing bids or adding two dates. Those must remain visible rejections. Source acceptance would still require converted-model and actual application qualification before any production change.
