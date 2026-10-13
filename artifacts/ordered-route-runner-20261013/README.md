# Ordinary ordered-route sequencing

Component: existing model-partition runner. Intent deliberately extended from the two-stage configuration to an explicitly selected ordered-stage path. Boundary effects: provider-defined v3 plan and Reploid route/attempt contracts; legacy and canonical two-stage entry points retain their behavior.

`createLayerPartitionRunner({ route, stages, ... })` uses the same owner to reserve all stages before input disclosure, authorize each stage and adjacent activation edge, execute each token through the ordered stages, and stream only the final stage's selected output. Doppler still owns tensor representation, numerical operations, sampling, decoding and stopping. Generation identity comes from the public Doppler `hashPartitionGeneration`, not a Reploid metadata hash. The first real source integration rejected the earlier incompatible digest; [before/after integration evidence](../ordered-route-integration-20261013/README.md) retains that boundary.

The current ordinary path is coordinator-mediated: stage 0 observes intermediate transfers. Each authorization request identifies the coordinator and complete token/activation/output recipient path. It is not direct adjacent-peer pipelining and makes no transferred-performance claim.

A host must inject authenticated stage ports; this source change does not supply or qualify those remote adapters.

An admission call is treated as possibly owning resources before it returns. Lost acknowledgments therefore trigger cleanup of that owner too. Failed cleanup keeps the attempt charged against admission; explicit `retryCleanup` retries only unsettled stages, and `close` reports unsettled failures. The runner preserves its FIFO token lease and delivers output outside it. This does not establish fairness across different route runners, physical shared-device budgets or parallel GPU operation.

Focused controls cover 2/3/4/5/6/7/16 logical stages, twenty admitted requesters with a rejected twenty-first, private attempt bindings, complete reservation before input, missing middle grants, lost reserve acknowledgment, altered middle-edge bytes/identity, revocation, middle-stage cancellation with a surviving conversation, cleanup retry and output backpressure. Independent review added mutation controls before asynchronous hashing and around mutable stage ports/authorization objects. Computation is injected. These are not hardware-capacity, numerical, signed-publication or physical-network results.

Validation at this checkpoint:

- `npm run verify:library-types` passes.
- `npx vitest run --config tests/vitest.config.js --maxWorkers=2 tests/unit/partition-route-runner.test.js tests/unit/partition-route-mutation.test.js tests/unit/partition-runner.test.js tests/unit/partition-route-placement.test.js tests/unit/partition-placement.test.js`: 61 tests pass (20 new runner/mutation, 24 legacy runner, 17 placement controls).
- `node artifacts/ordered-route-runner-20261013/verify-worker.js`: actual Verification Worker passes; file identities and warnings retained in `worker.json`.

The explicit ordered path rejects canonical mode. Authenticated remote N-stage adapters, discovery/host composition, all-stage durable publication, signed package support, hardware-wide accounting and physical execution remain separate unfinished integration work. The frozen signed two-stage candidate and public package pin are unchanged. This checkpoint does not qualify N-stage deployment, predictive decoding, consensus or all network combinations.
