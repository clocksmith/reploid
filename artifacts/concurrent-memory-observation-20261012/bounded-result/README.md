# Bounded 1,588-token baseline: rejected

Exact candidate `0fadac51…`, fixture `f966d582…`, original prompt/generation and
1,420,000,000-byte executor ceiling. The Mac input partition did not return its
first activation within the frozen 300-second operation limit. No output token
was produced; overlap, cancellation of one surviving attempt and retry were not
reached. `direction-0.json.gz` is the untouched failed capture, with raw identity
in `summary.json`. No threshold, timeout or runtime change was made after launch.

Both residents prepared. During the first prefill, the observer saw continuing
submissions through index459, no pending pipeline preparation, and no device
errors. Mac peak allocation was809,120,240bytes. The retained rolling submission
history has gaps of8.9–16.6seconds after `resident_partition_layers` boundary
submissions. The exact source awaits `recorder.submitAndWait()` at those boundaries.
These are host submission intervals, not per-kernel GPU timings. They distinguish
this execution deadline from the previous native cold pipeline-creation delay,
but cannot attribute the cost to one arithmetic kernel or establish isolated
performance on shared machines. Public browser/native residents remained intact.

Both attempt closes and final queue barriers subsequently completed. Both pools
reported zero retained model, active and deferred-cleanup owners; reusable bytes
remained610,410,240 on Mac and51,468,288 on AMD. The controller still failed its
separate `device.categories.weights === 0` assertion. Its original rejection is
preserved, not rewritten into a passing lifecycle receipt.

Source inspection and `accounting-control.js` distinguish the counters:
`markDeviceWeights` labels a device allocation until actual destruction, whereas
loader unload releases active buffers to the pool and removes persistent model
ownership. The exact archived modules, exercised with a mocked device, reproduce
zero retained/active/deferred owners with a positive weight-allocation category;
the same buffer is successfully reacquired by an unrelated owner. Explicit pool
destruction then reduces allocated bytes to zero. This proves the category cannot
stand in for current model ownership. It does not retroactively inspect each
physical pooled buffer or qualify the failed long operation.

Mac controller85760 exited1. Its owned contexts/browser closed; the external AMD
browser owner3538048 was then stopped and exited0. Owned server/tunnel processes
also exited. No GPU operation is left running by this controller.

Next unresolved boundary: identify which already-declared paired operations
consume the long prefill's layer completion intervals using the existing timing
capability in a separately authorized bounded control. Do not infer a compiler
stall, increase the timeout, change numerical authority, or substitute a shorter
prompt for this acceptance case. Correct the category/ownership assertion with a
focused regression before any later lifecycle qualification.
