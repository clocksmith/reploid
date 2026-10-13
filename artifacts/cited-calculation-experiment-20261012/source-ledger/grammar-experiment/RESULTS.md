# Rejected: valid syntax, invalid source-role selection

Preparation `604bbd78` was executed once on the original cached Qwen3-1.7B,
nonthinking greedy/repetition1.0, using the unchanged first original document
case. Freeze `6ec0fb8f8c100eda60ee4bd7f1859f0c7b1918af2434ce3cd0c84481b28387e4`
matched before and after execution. Both weight shards and all seven retained
source files were independently rehashed before and after; the source loader
also performed its bound receipt checks.

The model emitted one complete 281-token tool call. Its envelope, allowed tags,
17 fact rows and nine passage rows were valid. Nine raw next-token winners were
masked by the grammar. The terminal raw winner was already EOS, but the call's
completion remains labeled grammar-terminal: there was no unconstrained rerun.

The unchanged tool validator rejected **`Conflicting price roles`**. The model
repeated groups of tags across facts instead of choosing supported roles. For
example, the question's budget fact was simultaneously assigned `base`,
`unitPrice`, `additional`, `payment`, `includedAmount`, and `depositBase`, as
well as `budget` and `deadline`. No row-specific semantic mask hid those choices.
Replaying the unmodified selection through `compileRows` reproduces the same
rejection, without running the model again.

No calculation or final-answer call occurred. Useful-task acceptance is zero.
The other six original cases and two locked holdouts remain unrun. Full factual,
citation, condition and correction requirements remain unchanged. This fixes
syntax on the reused first case; it does not demonstrate source understanding,
useful document answers, or production/runtime qualification.

The attempt charged 2,276 prompt tokens plus 281 generated tokens: 2,557 total,
with 1,388 raw UTF-16 characters. It stayed within every frozen cap. Recorded
masking took 1.005 seconds; total process elapsed including loading was 259.342
seconds. Functional signed acquisition and public contributors were concurrent,
so these are run observations, not isolated performance claims.

The wrapper (2211671) and source process (2212038) exited zero and were confirmed
absent. No GPU was used. `run-binding.json` records the exact command and CPU
reservation; `resources-before.json` omits command lines to avoid unrelated
private room information. `source.json.gz` contains original messages, raw
output, token IDs, actual tool rejection and per-step grammar trace.
`postrun-identity.json` binds its uncompressed bytes and unchanged sources.

No additional candidate, retries, answer repairs, model downloads, runtime pin
changes, or deployment followed this rejection.
