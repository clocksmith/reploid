# Worked tool-contract control

Pre-output candidate. This adds one unrelated validated protocol demonstration to the preceding official-tool extraction instruction. Source checkpoint, model equations, generation policy, calculator, parser, tool schema, original ordered histories, factual/citation criteria and aggregate budgets remain unchanged.

The preceding run confused operand identifiers with passage identifiers, placed qualitative words in money fields and constructed invalid typed operations. The official template demonstrates its XML envelope with placeholders, not this nested argument contract. A worked example tests whether that missing demonstration explains those concrete failures. It is not an evaluator-bug claim or an answer-specific instruction.

`source_api_audit.py` used the actual retained source tokenizer API without loading weights. It exactly reproduced both rejected prompts/token IDs and found identical official serialization for structured versus equivalent raw tool calls across all seven histories. An initial audit expectation sorted JSON keys, whereas the official API preserves insertion order; correcting that audit-only expectation established equivalence. No prior model input was changed or repaired.

`example.json` uses unrelated numerical/date operands and source `D4:P1`, absent from every frozen evaluation case. `validate_example.py` runs the example through the unchanged strict parser and authorized calculator, checks the results, and verifies unchanged evaluation cases and criteria. These unit results establish a usable demonstration, not model quality or semantic extraction.

Both model calls share the original 4096 generated-token, 8192 prompt-plus-generated-token and 16000 raw UTF-16 limits. The example appears only in the extraction instruction; all actual prompt tokens, including repeated history in the final call, are charged. No retry, repair, constrained decoding, extra tool execution or generated-answer rewrite is introduced.

Stopping is declared before output: complete the current case's two-call attempt, then stop after a structural/tool failure or a final response that attempts another tool call. Remaining cases are unrun, never failed or passed by inference. If structural checks pass, complete all seven cases, including ordered correction histories, then manually apply every unchanged factual, conditional and citation requirement. A parser pass, tool success or EOS cannot qualify an answer.

No production code, package pin, model artifact, runtime precision or deployment changes.

Checks:

```sh
python3 artifacts/cited-calculation-experiment-20261012/worked-tool-contract/validate_example.py
python3 artifacts/cited-calculation-experiment-20261012/worked-tool-contract/protocol_test.py
```

Component: document tool protocol. Intent preserved. Boundary effects: diagnostic artifacts only.
