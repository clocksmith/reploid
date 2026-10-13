# Rejected source-row control

Preparation 22e33092, freeze `e84785d1030e057d69db16f0b50c48ecc9a779d08db070a7b117a057a4e59141`. The first original task ended naturally after 300 generated tokens, but the model omitted the closing tool-call wrapper. The strict parser rejected it: `Exactly one tool call and no prose required`.

No calculation or final-answer call ran. The raw output also contains 11 fact-role lists for 17 source facts,5 passage lists for 9 passages, undeclared kind words and broad incompatible role combinations. These remain raw rejected output, not repaired selections. All remaining six original cases and both locked holdouts are unrun.

Actual input 2276 tokens; total charged 2576 tokens; raw 1033 UTF-16 units. Every frozen budget passed, so this rejection is protocol/selection quality rather than budget exhaustion. Elapsed 331.649694 seconds includes loading and concurrent correctness work; not a performance claim. Both owned CPU processes exited 0 and are absent. No GPU was used.

Raw source/log archives, exact executed history/token IDs/schema, run binding, source identities and criterion-by-criterion disposition are retained. Postrun hashes match the immutable preparation. The strict error reproduced locally from the unchanged raw text without a model rerun.

Eight adapter tests, five protocol/accounting tests, and the actual Verification Worker pass their software scopes. They do not qualify source extraction or document usefulness. No production files, pin, deployment, model or budget changed. No further candidate was launched.
