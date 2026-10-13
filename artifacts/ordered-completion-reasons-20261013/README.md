# Preserve ordered completion reasons

Component: partition coordination and conversation workspace. Intent: preserved. Boundary effects: the runner's actual ending reason now survives ordered execution summaries through requester chat. The workspace retains limit-ended output as an incomplete answer.

Before repair, the ordered runner returned `stopReason` only beside its execution receipt. Chat retained only `execution`, and the ordered summary omitted the reason again. Four genuine-grant/injected-numerics entry regressions failed with `undefined` instead of the runtime reason. Both forwarding boundaries now preserve it without inventing a successful ending.

A second regression showed the workspace already rejected `max-tokens` but marked runner `length` and runtime `context-limit` output completed. All three limits now retain partial content and record an incomplete failure with a separate retry. Natural stop reasons are unchanged. This does not normalize arbitrary unknown reasons or claim model usefulness from EOS.

Validation:

- `npx vitest run --config tests/vitest.config.js --maxWorkers=2 tests/unit/chat-workspace.test.js tests/unit/ordered-partition-chat-entry.test.js tests/unit/partition-route-runner.test.js tests/unit/partition-summary.test.js`: 65 tests pass; four missing-reason and two false-completion controls failed before the respective fixes.
- `npm run verify:library-types`: passes.
- Actual Verification Worker passes; exact hashes and warnings in `worker.json`.

Source evidence only. Browser mirrors, native delivery, public runtime pin and deployment remain unchanged pending the coordinated package freeze.
