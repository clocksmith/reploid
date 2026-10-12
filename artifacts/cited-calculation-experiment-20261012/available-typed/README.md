# Available operation families: frozen application correction

The original1.7B typed experiment (`0134e619`) naturally emitted the same invalid
date-as-duration request twice. Its first source had no duration at all, yet the
tool schema advertised calendar addition with an impossible `duration` schema.
The strict validator prevented execution, but exposing the unavailable family
made the tool interface misleading.

This candidate advertises money requests only when source-local money aliases
exist, and calendar requests only when both date and days/weeks aliases exist.
Unavailable families are omitted from the schema and rejected by the parser
and validator, even if supplied as empty arrays. Available families accept empty
arrays. If neither family has compatible operand kinds, no calculation tool or
source selection call is offered; the final answer still receives the unchanged
complete conversation. No fictitious result is inserted.

This is lexical type eligibility, not proof of numerical range or semantic
appropriateness. The unchanged calculator still rejects unsupported dates,
durations, bounds, quotes and operations. It does not decide which price or
condition applies. Selecting an included allowance as extra, omitting headroom,
or giving an unsupported citation still fails the original full criteria.

The adapter translates absent unavailable API families into empty arrays only
for the old internal Calculate contract. That is the declared input adapter,
not repair of a generated invalid field: extra/unknown/unavailable fields reject.
No output is rewritten, no partial plan executed and no expected fact supplied.

## Preserved contracts

Original downloaded Qwen3-1.7B revision
`70d244cc86ccca08cf5af4e1e306ecf908b1ad5e`; official JSON tool template; original
F32 source weights/equations and F16 KV; nonthinking greedy repetition1.0.
All seven task messages and factual/citation/tool-attribution criteria remain
unchanged. The sole prompt edit replaces the stale requirement to supply both
families with the instruction to supply exactly the available schema fields.
Schema descriptions mention only families actually exposed. Source passages,
questions, conditions and literal catalogs are byte-equivalent to the parent.

Original final history, including incorrect prior assistant answers, is retained
with actual tool calls/results. At most one explicit validator-error correction
per source, only after natural completion, sharing the same source allowance.
No continuation after max-tokens and no hidden repair.

Budgets remain 4,096 generated / 8,192 prompt-plus-generated tokens / 16,000 raw
UTF-16 units, including repeated prompts and resubmitted tool outputs. Source
selection shares 1,536 generated tokens; the divisor remains the original total
document count even when a source has no tool. At most thirty arithmetic
operations. First structural/tool/completion/budget failure stops the run, with
later cases unrun. Calculator success is not factual acceptance. Two existing
independent holdouts remain locked until all original cases pass manual review.

## Checks and launch boundary

`adapter.test.js` covers no duration, no money, no tool, required later D3
calendar support, unchanged source projections, empty arrays, unknown/wrong
operands and unavailable-family rejection. The strict JSON parser and budget
controls pass. Actual Verification Worker passes with two relative-import
warnings and zero errors. Original calculator and validation remain reused.

Tokenizer-only minimum prompt totals: 3,847; 4,052; 4,114; 5,383; 1,130; 937;
1,213. The longest case leaves 2,809 tokens before actual calls/results or any
correction are charged; runtime admission remains necessary.

`freeze.json` binds all files and reused loader/evaluator/adapter identities.
No source output exists at freeze. A reviewed run uses x128 CPUs4–7, four threads,
nice10, no GPU and no downloads. A source pass would enable subsequent converted
and installed-runtime qualification, not promote the deployed0.8B model or close
numerical/distributed-release requirements. Prior failed candidates are unchanged.
