# Fixed-document role comparison: rejected

The single candidate moved the existing source instructions from the user
message into the system message. It changed no instruction words, document
bytes, question order, model, sampling, or output limit. Production is unchanged.

The [contract](contract.json) was frozen before execution. Its eight cases were
already exposed development cases from the retained source-grounding experiment;
they are not fresh or independently authored evaluation. Both arms used the
same provisioned Qwen3.5 2B Q4_K, pinned Doppler 0.6.32, compact application system
context, 64-token diagnostic cap and 90-second request limit. Sixteen requests
ran with alternating arm order and request-state reset through the native owner.
All stopped naturally; model/device cleanup settled. The diagnostic cap is not
the production 256-token limit. This is no speed comparison.

[Raw receipt](run/receipt.json) preserves messages, document/question hashes,
model/configuration/code identities, outputs, failures and elapsed times. The
reusable runner lives in `tests/answer-regression/node/fixed-document-run.js`.
Its companion comparator separates mechanical indicators from semantic review;
marker validity cannot qualify citation support. Runtime failures stop the run
before another arm begins. Existing destinations are refused.

[Unblinded development review](review.json), by the implementation agent:

| Outcome | Baseline | Candidate |
| --- | ---: | ---: |
| Complete correct requests | 6/8 | 6/8 |
| Complete correct supported questions | 4/6 | 4/6 |
| Appropriate abstentions on missing facts | 2/2 | 2/2 |
| Abstentions on supported questions | 0/6 | 0/6 |

The candidate answered the author question instead of returning only `[1]`.
Both arms failed the name-only movie request. The candidate added an uncited
Gull sentence to the Tern answer. The word matcher flags `2062`, but that sentence
does not falsely attribute that year to Tern; its citation omission is the actual
failure. The abstention matcher missed one valid candidate abstention. Raw
indicators remain unchanged; semantic dispositions are separate and not
independent acceptance. The candidate is rejected; no fresh evaluation or
deployment follows this result.

Focused checks: four comparator tests passed. Boot behavior is tracked separately
in the [storage-denied recovery report](../boot-storage-recovery-20261018/README.md).
This answer experiment changes no production behavior and does not resolve the
retained intermittent live boot timeout.

To reproduce, provision the original model locally, use the frozen executable
identities, and select a fresh output directory:

```sh
REPLOID_COMPARISON_MODEL_DIRECTORY=/path/to/provisioned/model node tests/answer-regression/node/fixed-document-run.js artifacts/fixed-document-role-20261018/contract.json /path/to/new-receipt-directory
```

Component: verification. Intent preserved. Boundary effects: none. Next answer
candidate needs separate development evidence before fresh evaluation; the boot
timeout remains an independent unresolved defect.
