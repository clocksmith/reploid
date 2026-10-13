# Ordered browser/native preparation

Component: browser and native host composition. Intent: preserve contribution authorization and preparation ownership while admitting explicitly assigned ordinary ordered stages. Boundary effects: host controls now accept `ordered: { stage: { index, participantId, transportId, residentId, executionId } }`; the public accepted package and default contribution path are unchanged.

Both hosts snapshot the selected plan and complete local stage identity before asynchronous acquisition. Ordered contribution requires a declared Doppler v3 plan, a matching stage, and the provider's ordered plan/generation interfaces. Unsupported installed providers reject before acquisition or native GPU initialization. No stage or route is inferred from the number of peers. Canonical replay remains a separate unsupported combination for this ordinary path.

The provider resolves the actual assigned index against the manifest. The existing resident receives the ordered runtime and local stage binding, and the host awaits preparation before returning. Existing signed factories, source cleanup and permission ownership remain intact; no alternate loader or package pin is introduced.

Validation:

- `npx vitest run --config tests/vitest.config.js --maxWorkers=2 tests/unit/work-partitions-lifecycle.test.js tests/unit/work-partition-plan.test.js tests/unit/native-participant.test.js`: 90 tests pass. Controls include browser/native middle-stage binding, delayed readiness, caller mutation during acquisition, missing/wrong stage, canonical mixing, unsupported provider, and existing signed/cleanup failures. Host ports and numerical execution are injected.
- The actual installed accepted Doppler package rejects ordered preparation in the plan tests, without silently falling back to A/B.
- `node artifacts/ordered-host-preparation-20261013/verify-worker.js`: actual Verification Worker passes; hashes and warnings retained in `worker.json`.
- Library declarations and component charters pass.

Automatic contribution still needs to supply these host identities through its network composition. These controls do not establish physical signed opening, selective GPU loading, complete chat, throughput, memory fit, or deployment for an N-stage package. The prior two-stage physical evidence remains separate.
