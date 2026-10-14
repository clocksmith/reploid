# Shared signed resident opening and native release persistence

Component: `Model Partition Coordination` and `Hosted Services`.
Intent: preserved. Boundary effects: browser/native host composition and explicit
failed-preparation cleanup ownership; no computation or authorization policy changes.

The native participant now recognizes the existing catalog's explicit Capsule
configuration. It uses Doppler's public `openCapsule` and resident factory,
Reploid's existing `assertWorkResidentCapsule` admission and release-history
policy, and a shared provider-injected signed resident lifecycle. Incomplete
signed configuration fails closed; it never selects manifest opening instead.
The application catalog and accepted Doppler 0.6.27 archive are unchanged.

Native custody exposes an artifact store bound to the approved model source.
Metadata reads require exact path, hash and size. Weight reads must match a
complete authenticated piece; whole-weight reads and arbitrary ranges are
rejected. These reads reuse the existing verified cache and signed peer custody.
File-sharing permission remains separate from computation permission.

Native release checkpoints live in `release-checkpoints/release-checkpoints.sqlite`
beside the configured model-cache directory. Authority/application namespaces
come from the unchanged application release policy. SQLite transactions provide
monotonic compare-and-swap and durable commits, including competing handles and
workers. Corrupt history and conflicting updates fail closed; they do not reset
history. The native signed path requires Node's `node:sqlite` module (tested
with Node 22.20.0). Import is lazy; manifest participation does not require it.

Both hosts retain opened Capsule sessions until cleanup succeeds. Concurrent
close callers share a pending close; explicit retry targets failed owners and
does not reclose settled ones. Loaders register a preparation cleanup owner with
the existing automatic partition controller. Registration remains local while
loading, preserving Stop. A rejected load transfers the owner to the existing
unsettled set; replacement stays blocked until explicit stop settles it. A
successful resident assumes preparation ownership.

## Evidence

The retained `focused-tests.log` records **152 passing tests across 13 files**:

```sh
npx vitest run tests/unit/automatic-partition-lifecycle.test.js tests/unit/work-partitions-lifecycle.test.js tests/unit/native-release-storage.test.js tests/unit/native-model-files.test.js tests/unit/native-participant.test.js tests/unit/work-partition-capsule-admission.test.js tests/unit/pool-pack-release-policy.test.js tests/unit/partition-api.test.js tests/unit/partition-discovery-invalidation.test.js
```

The same injected opening, revocation, cancellation and cleanup tests execute
against browser and native host composition. Separate admission tests reject
changed identity, model, manifest, target, operation, scope and closure evidence.
Native filesystem/custody tests exercise real disk storage and the existing
protocol fixture, not a physical GPU.

The actual browser Verification Worker passed six changed host/runtime files;
its source-bound receipt is retained. Its preceding SQLite rejection is also
retained: the scanner mistook SQLite's `.exec()` for process execution. Fixed
SQL statements now use prepared-statement `.run()` operations; no validator
rule was changed or invocation hidden.

`npm run verify:layers` passed. The application library was regenerated with
`npm run sync:library`, and `npm run build:browser-bundle` plus its `--check`
passed. No dependency, numerical reference or runtime precision changed.

**Physical signed native inference remains unqualified.** These tests validate
host wiring, exact admission, storage and cleanup, not the accepted archive's
support for signed resident piece opening. A compatible qualified standard
archive and physical signed two-computer journey are still required before
claiming or deploying that capability. Existing manifest-path physical receipts
remain scoped to manifest opening.

## Full regression and physical manifest control

At Reploid `b7699a57`, the canonical amd-host Node 22.22.1 sweep passed
**3,156 tests across 291 files**, with 29 tests / three files skipped:

```sh
npx vitest run --config tests/vitest.config.js --maxWorkers=2
```

`full-suite-pass.log.gz` retains the complete output. The preceding
`full-suite-collection-failure.log.gz` remains: the DOM default transformed a
native lifecycle fixture's `node:sqlite` import for a browser. Its explicit Node
test environment fixes collection without changing assertions or runtime code.
Twelve Chromium desktop/phone interaction cases then passed
(`browser-pass.log.gz`), including the actual Verification Worker. These are
browser simulations, not physical phone or unfamiliar-user observations.

`hosting.log.gz` and `served-local.log.gz` record prepared hosting and fresh HTTP
verification of all 1,905 assets. The immutable local browser identity is
`eac23c6a242eae9cc84e70439c54631eef40af2ea759496a17622c1512864d68`.
No public deployment occurred.

The retained `manifest-regression-controller.mjs` drove the ordinary requester
against a Suby browser input partition and amd-host native output partition at
source `e83049df`, with the unchanged accepted Doppler 0.6.27 archive. Automatic
discovery, approval of both actual recipients, a $36 answer, and a
history-dependent $48 follow-up completed. Other conversations stayed unchanged.
The requester observed zero weight-file HTTP requests; a subsequent OPFS walk
found only the two-byte empty chat-checkpoint index and no model weights.
`manifest-regression-physical.json` retains the observations and histories.

The native host reused its previously acquired 75 verified assigned pieces.
Its launch identity and exact command are in `manifest-regression-launch.json`.
`manifest-regression-process.log.gz` retains initial connection refusal when the
first tunnel ended, automatic connection after the persistent tunnel started,
both settled attempts, model unload and GPU device destruction on explicit stop.
The already-reaped process's exit code was unavailable, recorded as null in
`manifest-regression-stop.json`; it is not claimed to have exited zero. The Mac
browser contributor was restored afterward and the requester again showed ready.

This control establishes manifest-path compatibility after the shared-host
change. It does not establish physical signed opening, general factual quality,
full numerical acceptance or the original long-prompt memory gate.
