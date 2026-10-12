# Native delivery after signed source-path repair

The standard native application was rebuilt from Reploid
`342f0760f80f66d851ef33ffaa9b83b482dc2572` on x128 with Node 22.22.1, extracted
outside the checkout, and installed with ordinary `npm ci --no-audit --no-fund`.
The existing `packageNative` export from `scripts/package-native.js` produced
the archive; no alternate source tree or dependency mechanism was introduced.

The 86-file delivery includes the new shared
`self/host/work-partition-artifact-source.js`. Every delivery entry matched its
declared length and SHA-256, and the helper imported successfully from the
installed application. CLI help exited successfully without creating state.
All 1,897 installed Doppler files matched the accepted bundled archive exactly.
The archive remains `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`,
version 0.6.27. Named installed dependencies are recorded in `installed-check.json`.

- Native archive SHA-256: `a2ce789a270963d3bd03de049ee974ed8022463fc145415ec579aabb478e125c`.
- Delivery manifest SHA-256: `7411c883f5248aa9af5eca065b7e804dd932ce21c3990e5adfa7aa634749912f`.
- Exact artifact, extraction and installation paths: `build.json` and
  `installed-check.json`; all are under `/var/tmp/reploid-native-path-delivery-20261012`.
- Verification script: `check.mjs`; retained inventory: `native-delivery.json`.

The canonical regression command also passed at that source revision:

```sh
npx vitest run --config tests/vitest.config.js --maxWorkers=2
```

Result: 3,164 tests passed, 29 skipped; 292 files passed, three skipped.
`full-unit.log` retains all output, including localhost:3000 connection refusals,
SQLite experimental notices and negative-path warnings; none was suppressed.
The install log retains the transitive `domexception` deprecation warning.
CPU work overlapped other agents' correctness investigations; these timings
are not performance measurements.

This check covers delivery closure, installed identity and regression behavior.
It did not connect a participant, initialize a GPU, acquire weights or run
inference. The earlier installed physical journey is separately retained in
`../native-installed-execution-20261012/`; it did not use this new artifact.
Physical signed Capsule acceptance, numerical qualification and useful-document
quality remain separate gates. Nothing was deployed or promoted.

The changed host sources passed the actual Verification Worker in
`../signed-resident-paths-20261012/worker.json`. The retained installation
checker is an operator-side evidence script using Node filesystem and tar;
it is not a browser Worker capability claim. The pre-existing native build-tool
Worker scope limitation remains unchanged.

Component: native application delivery. Intent: preserved. Acceptance evidence:
the receipts and logs in this directory. Boundary effects: inclusion of the
shared host mapper already introduced in `342f0760`; no new runtime changes.
