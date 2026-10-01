# Open mesh architecture and storage checkpoint

This checkpoint does **not** pass end-to-end acceptance. See
[report.json](report.json) for topology, limits, source scope and observations.

The actual three-context browser test automatically discovered participants and
loaded the catalog Qwen 0.8B model from a consenting file seed into a compute
contributor whose origin access was blocked. After correcting double-counted
transfer staging, it reached `Ready` with 139,419,053 bytes of reported storage
under the unchanged 335,544,320-byte quota. This is one physical machine.

Generation then failed. The requester displayed:

> [Embed] CPU-resident embedding gather requires a verified preloaded row;
> materialize a GPU or split embedding weight.

The [browser log](browser-run.log) records the load and the assertion timeout;
the [requester screenshot](generation-failure.png) records the runtime error.
There is no completed answer, physical partition proof or combined-capacity proof
in this run. The harness was subsequently improved to surface terminal attempt
errors directly and retain state even when generation fails.

The [browser guard log](browser-guards.log) covers four passing tests, including
Verification Worker acceptance and missing/truncated OPFS checkpoint repair.
The [Vitest log](unit-tests.log) records 2,814 passing and 29 skipped tests.
Library types, ESLint, CATSCAN validation and regenerated browser bundle checks
also passed. Skipped tests establish no behavior.

Component: Reploid open mesh architecture, host artifact cache and checkpoint storage.

Intent: deliberately changed the obsolete invited-mesh requirement to the user's
open-discovery requirement; preserved runtime ownership and independent consent.

Acceptance evidence: the logs above, `npm run verify:catscan`,
`npm run verify:library-types`, modified-file ESLint, and
`npm run verify:browser-bundle:local`. The complete target and ordered remaining
gates are in [the architecture](../../../docs/open-mesh-architecture.md).

Boundary effects: host storage accounting, OPFS checkpoint/index recovery,
browser delivery manifest, test diagnostics and architecture documentation.
Doppler model semantics and public execution code were not changed here.
