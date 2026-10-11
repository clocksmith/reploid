# Versioned declared-main reference correction

Component: verification evidence. Intent: preserved. Boundary effects: active
implementation-regression fixture selection; no model/runtime change.

The user instructed “finish the rest” after the prepared correction and item
8 approval requirement were presented. The reviewed correction is now selected
through `tests/fixtures/distributed-reference-contract.json`, revision 2.
The historical `distributed-reference.json.gz` remains byte-for-byte unchanged.
All historical failures retain their original identities and verdicts.

The replacement corrects the known mismatch between the declared `main`
normalization shader and the historical producer's `main_subgroup` execution.
Inputs, generation settings, model/plan identity, all 55 expected tokens, stop
reasons and final text are unchanged. The threshold remains 0.001. Nine focused
checks verify binding and prevent unrelated fixture changes.

The independent source-equation calculation still exceeds 0.001. This correction
qualifies neither full-model accuracy nor deployment. Its scope is the declared
implementation regression. The independent source, task-quality and lifecycle
gates remain separate and required. The original review and independent
actual-operand controls are linked from the versioned contract.

The ordinary distributed runner now requires applicable numerical tolerance by
default, and rejects an opt-out before starting devices. Explicit tracking is
restricted to `--numerical-only` diagnostics. Application browser tests always
assert the frozen gate. Result records distinguish failed, passed, not-run and
not-applicable numerical status. Twelve focused tests pass, including rejection
of an ordinary opt-out and preservation of a failed diagnostic verdict. This
closes a harness acceptance bypass; it does not clear independent-source accuracy.
