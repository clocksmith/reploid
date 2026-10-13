# Product acceptance expansion

Component: documentation and journey verification. Intent: expanded by user direction to include concrete product acceptance. Boundary effects: new targets under existing REP-7/DR-6 owners; no runtime/pin/deployment changes in this checkpoint.

The canonical TODO adds five unchecked items: first-use acceptance, developer compatibility, optional coding, physical independent-user demonstration, and comparative product evidence. Basic chat remains first. Portable checkpoints stay deferred; MoE offload needs an explicit model/runtime scope. Competitor descriptions are not independent evidence or performance claims.

The catalogue adds JOB-06 (bounded coding) and DEV-02 (existing client compatibility), and explicit scenario references. Coding and compatibility targets are not claimed as implemented. Required IDs now include both; variable family sizes and flow lengths remain supported. The compatibility target requires unsupported parameters to reject before execution, not silent partial emulation.

Validation:

- `npm run verify:journeys`: 33 catalogue journeys and the three supporting registries pass integrity checks.
- `npx vitest run --config tests/vitest.config.js --maxWorkers=2 tests/unit/reploid-journey-catalogue.test.js tests/unit/critical-user-journeys.test.js`: 11 tests pass.
- `npm run verify:catscan`: 39 charters pass.
- Actual Verification Worker passes for the validator scripts; hashes and warning retained in `worker.json`.

No capability checkbox was completed by these edits. Source/API/isolation implementation and physical qualification proceed under their existing owners and retain separate evidence.
