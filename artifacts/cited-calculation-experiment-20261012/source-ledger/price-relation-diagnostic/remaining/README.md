# Six remaining local monetary relations

This extension preserves the observed first classification and evaluates the remaining six document-money occurrences in original order. It reuses exactly the seven globally available relations, question context, source passages, model, template, policy and grammar. No model-selected label is corrected. No calculator or final answer runs.

Preflight: 2,474 additional prompt tokens plus at most 384 generated; including the first observed 415 charged tokens, the upper bound is 3,273. The original aggregate 4,096 generated / 8,192 charged / 16,000 UTF-16 limits remain enforced. Actual executed prompt IDs must match the retained tokenizer preflight.

`runner-control.json` exercises the actual source evaluator with artificial logits, not model weights: all six decisions may remain `unknown`; an injected third-call failure retains its two generated tokens and leaves three calls unrun. No test asserts source semantic success.

Complete the six unless a structural/budget failure occurs, then review all seven. `additional_charge` does not prove a charging condition occurred, and `quoted_total` does not establish an all-in price. Every original factual/citation/condition/correction criterion remains open.

Component: application quality experiment. Intent: preserved. Acceptance: bounded runner controls and frozen token admission only. Boundary effects: none; no production changes.
