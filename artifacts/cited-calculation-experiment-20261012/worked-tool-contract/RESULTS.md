# Worked-contract result

Rejected; frozen candidate `3251d780`.

The first extraction reached EOS with valid JSON, but the unchanged calculator rejected `Invalid or duplicate fact ID`. Raw arguments also label `excluded` as a number, invent `400` from `40%`, and mix unrelated contractor amounts and date operands. The final call again emits a tool plan instead of an answer; no additional tool executes. The declared stopping rule ended the process cleanly with exit code 0 after this rejected case. The six other cases, including correction followups, are unrun.

Actual cost: 1039 extraction tokens plus 933 final tokens; 1979 extraction-prompt tokens plus 2444 final-prompt tokens. Total 6395 charged tokens and 5393 raw UTF-16 units, within the unchanged limits. Elapsed 652.90 seconds includes loading, both prefills, reporting and concurrent CPU work; it is not an isolated performance measurement. `review.json` records full criteria, failure attribution and disposition; raw receipts/log and hashes remain beside it. Parser success did not qualify extraction, calculations, or an answer.

The independent example and original requirements remain unchanged. No production code, model, precision, pin or deployment changed. `freeze.json` continues to bind every pre-output file exactly; result files are separate.
