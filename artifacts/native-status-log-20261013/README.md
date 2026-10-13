# Bounded native CLI status

Component: native host. Intent preserved. Boundary effects: routine CLI log projection only; participant `getState()` and caller-supplied `onChange` retain complete state and receipts.

The stopped isolated log measured in `../native-canonical-installed-20261013/log-measurement.json` contains 1,402 partition-state records totaling 339,813,386 bytes. CLI previously spread every complete state into JSON, repeatedly copying signed Capsule/source bodies.

`server/native-participant.js` now passes the CLI callback through `summarizeNativePartitionState`. It explicitly selects phase/error/progress, model/plan/generation identity, layer range, placement, reservation lifecycle fields, attempt status, opening mode and memory/preparation counters. Strings are limited to 256 characters (top-level error 1,024), collections to 16 rows with total/omitted counts, and layer range to two entries. Truncation is visible. Missing settlement fields remain absent/null; summary does not infer release. Signed artifact/source bodies and conversation text are not traversed. The detailed state API remains unchanged.

Tests retain the missing-function failure (`before.txt`) and passing three projection controls plus nine existing native host controls (`after.txt`). Controls verify body getters are never visited, source state remains intact, cleanup failure/unknown settlement remain visible, oversized strings/collections remain bounded and omitted counts are explicit. Library declaration checks and actual Verification Worker pass; warnings remain in `worker.json`.

Offline replay of the same retained 1,402 records through the exact extracted production projection yields 1,610,245 serialized bytes and maximum record size 1,275 bytes. `retained-log-projection.json` binds both original log and extracted function. This is an offline size comparison, not a live latency or CPU measurement. Full state construction still occurs before the CLI callback. No process was restarted, no package/pin/deployment changed, and no prior deadline cause is established.

Commands:

```sh
npx vitest run --config tests/vitest.config.js --maxWorkers=2 tests/unit/native-status-log.test.js tests/unit/native-participant.test.js
npm run verify:library-types
node artifacts/native-status-log-20261013/verify-worker.js
```
