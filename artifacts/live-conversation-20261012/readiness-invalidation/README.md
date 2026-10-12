# Readiness invalidation after a fresh failed preparation check

Component: `Model Partition Coordination`. Intent: preserved.
Boundary effects: discovery model hints and their existing UI subscribers only.

The physical failure in `../contribution-stop-readiness-failure.json` recorded
contribution restart at 04:08:26.568Z and retry creation at 04:08:26.591Z,
23 ms later. Discovery polls every 2,000 ms and descriptors expire after
10,000 ms. The UI could therefore still show the preceding ready snapshot.
The new attempt failed before approval with “No prepared cooperative partition
path is available.” That receipt does not distinguish the two assertions with
that message; it does not establish that the restarted prepared runtime failed.

The injected regression reproduces the narrower proven contract defect:
cached discovery offers a ready model, a fresh entry refresh returns no prepared
path, and subscribers still receive the old ready offer. Both cooperative test
variants failed that assertion before the repair.

The repair removes only the affected model from that input peer's discovery
hint and notifies subscribers. A discovery response already in flight cannot
restore that rejected hint. A subsequent new observation can restore readiness;
the user must explicitly retry. User cancellation is not treated as evidence
of contributor unavailability. Approval, placement and execution contracts are
unchanged; no input is automatically sent or retried.

Validation:

```sh
npx vitest run tests/unit/partition-api.test.js tests/unit/automatic-partition-lifecycle.test.js tests/unit/partition-discovery-invalidation.test.js
npm run sync:library
npm run build:browser-bundle
```

45 tests passed across three files. The direct discovery regression preserves
an unrelated model and capacity metadata, rejects an old in-flight observation,
and restores readiness after a new observation. The actual browser Verification
Worker passed both changed browser modules with four warnings and zero errors;
its source-bound result is retained alongside this note.

These checks prove availability invalidation and explicit recovery under injected
conditions. They do not promise race-free distributed availability or establish
a new physical contribution-stop/retry acceptance run.
