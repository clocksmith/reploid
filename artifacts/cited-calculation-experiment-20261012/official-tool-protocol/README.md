# Official tool protocol control

Status: rejected after one complete case; the other six cases were stopped without output. The freeze and independent review preceded generation. This is a separate source application experiment, not production integration or model qualification.

The official envelope was emitted, but its operations array lacked a closing bracket, so parsing rejected it before calculation. Raw arguments also violated numeric and identifier requirements. The final call repeated the invalid tool call byte-for-byte instead of answering; no second tool was executed. Both calls naturally reached EOS and used 1422 generated tokens, 3504 prompt tokens counting repeated history, and 4080 raw UTF-16 units: 4926 total charged tokens, within the unchanged limits. Budget compliance does not qualify the missing answer.

`review.json` records the rejection and six unrun cases. `prompt-contract-audit.json` traces the executed prompt through raw output to strict rejection and retains one schema ambiguity: global ID uniqueness was enforced but not explicitly described in prose. Numeric lexeme, identifier spelling, date-operation and matching-unit rules were present in the actual prompt. No output repair or third candidate followed. Raw receipts, log, hashes, exact command and boundary-stop identity are retained beside this file.

The preceding configuration failed its first two attempted cases: malformed comma-separated facts and then repeated facts until the extraction cap. Its remaining five cases were stopped without output. None of those failures are repaired or removed.

The retained official Qwen3.5-2B tokenizer template has a `tools=` branch which specifies `<tool_call><function=Calculate><parameter=facts>...</parameter><parameter=operations>...</parameter></function></tool_call>`. The previous control used free-form JSON instructions and never exercised that branch. This candidate tests that concrete protocol boundary.

`tools.json` supplies the explicit function schema, including previously unstated fact-ID spelling. `protocol.py` accepts one matching native call, requires the two unique JSON-array parameters and rejects unknown functions, duplicate keys, non-JSON constants, additional calls and trailing output. It never repairs model output. Parsed arguments pass through the unchanged cited calculator and existing authorized Reploid tool runner.

The second call preserves the original ordered messages, the exact raw assistant tool call and the actual tool-role result. The existing source evaluator's sampling, F32 equations and F16 KV storage are unchanged. A narrow diagnostic message adapter allows official tool-role history; the actual messages and rendered prompt remain in each raw receipt. The original helper rejects tool-role history, so this adapter is explicitly part of the candidate identity rather than an unnoticed contract change.

The loaded source tokenizer configuration and chat template must match `template-binding.json`. Before each call, the runner charges the exact official prompt and asserts that the source evaluator executed those same token IDs. Both calls share 4096 generated tokens, 8192 prompt-plus-generated tokens including repeats, and 16000 raw UTF-16 characters. No retry or extra model call is allowed.

All seven cases, source identities, generation policy, full factual/citation requirements and tool-attribution criteria equal the preceding freeze. The first two are reused observed cases. The remaining two original conversations and three new holdouts had no model outputs at candidate selection. The final answer still must preserve conditions, contradictions, scope and citations; a syntactically valid call cannot establish those properties.

Checks before generation:

```sh
python3 artifacts/cited-calculation-experiment-20261012/official-tool-protocol/protocol_test.py
node artifacts/cited-calculation-experiment-20261012/calculate.test.js
```

Component: document tool protocol. Intent: preserved. Boundary effects: diagnostic artifacts only. No package pin, model weights, production prompt, permission policy, or numerical reference changes.
