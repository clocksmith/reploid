# Installed Doppler integration and incremental streaming

The September 12-13 candidate consumes public Doppler APIs through Reploid's
actual runtime service, operation executor, signed peer protocol and native
journal. Existing v1 callers retain their contract. No production deployment or
new npm publication was performed.

## Runtime identities

Reploid `46a27ee175086e68fbf2603a13a3bc7f534609e6` includes the prepared
published-0.6.1 pin update, now cherry-picked as `81f5dae`. The original prepared
worktree is local at `/home/x/deco/worktrees/reploid-doppler-061`; no SSH host is
required. Its [historical acceptance record](../doppler-release-061-2026-09-08/2026-09-12/)
remains distinct from this streaming candidate.

| Archive | SHA-256 | Use |
| --- | --- | --- |
| Published npm 0.6.1 | `96d2699a3e677815890f804459c023bea4fb2e2a1a59d157b5b6a04c9e573d5f` | Package and browser defaults |
| Unpublished streaming candidate, version 0.6.1 | `c21230a20471c8beb9fa414a326b7a2da889a4ef9d07c13f3f23e8db9a1ca962` | Explicit v2 installed acceptance |

The latter archive contains Doppler runtime source
`54299e47484a71faeebdbb6bbd7a07a363157816`. Its local and CI tarballs are
byte-for-byte identical. [The exact-archive record](final-ci-record.json) binds
the producer fixture revision and downloadable CI artifact. The version number
alone does not identify v2 support; the runtime service requires the configured
archive's public reconstruction helper before accepting v2 execution.

## Acceptance

- [Installed runtime and adapters](final-ci-reploid-consumer.json) pass settings,
  stopping, cancellation, stale-request and request-bound adapter checks using
  injected model programs. Missing designated setup fails instead of skipping.
- [Real WebRTC and native journal replay](final-ci-webrtc-consumer.json) pass
  between browser contexts: three v2 deltas, two deliveries and one model
  execution. Dropping completion and replacing the provider restores its signed
  responses from IndexedDB. Offline verification accepts the reconstructed
  execution identity. This is one operator with an injected model program.
- [Physical shared-device execution](final-physical-shared-device.json) passes
  in Chrome on AMD RDNA 3: two Qwen3-Embedding-0.6B sessions submit to the same
  device, closing the first leaves the second usable, and complete embedding
  outputs, including per-item receipts, match exactly. Capability-probe devices
  are recorded separately from the device receiving inference submissions.
- [Physical generation and reranking](final-physical-reploid.json) pass on the
  same archive. Qwen3-4B-Instruct-2507 matches all 16 frozen reference token IDs,
  and its complete text, IDs, sampling and token-limit stopping reason equal
  [the standalone output](final-physical-standalone.json). Qwen3-Reranker-0.6B
  completes its two-document operation; no new semantic ranking oracle is claimed.
- [45 targeted pin and service tests](published-pin-regressions.log) and the
  [Verification Worker](verification-worker-final.log) pass. Earlier focused
  operation/journal tests and their before/after copying measurements remain
  in this directory.

Together, the physical records cover generation, embedding and reranking through
both installed consumers in Chrome 146.0.7680.177 on AMD RDNA 3, without a fallback
adapter. Full descriptors, request settings, retained-local release policy and
environment are included. Physical execution does not establish task-quality or
fleet qualification, authorize release promotion, or infer current revocation status.

## Preserved failures

The physical two-session check exposed a Doppler lifecycle bug: restoring the
same GPU device advanced its generation and caused the global pool to destroy
another session's live buffers. The candidate fixes that owner; it does not
destroy the shared device or replace the inference implementation.

Reploid's original full CI has an independent upstream baseline failure: 60 tests in seven
files fail both in [remote CI](https://github.com/clocksmith/reploid/actions/runs/34735477819)
and on unchanged upstream `2cbe2fc85d8fc4e5a5ba652f962219566c951fed`.
[The retained upstream run](upstream-ci-failures.log) covers agent-loop, VFS,
boot-seed, CATSCAN, p2p-transport, self-runtime and webrtc-swarm tests. The designated
installed-consumer job passes; this record does not claim the entire Reploid CI
or its upstream charter-inventory gate is green.

Earlier WebRTC failures from upstream configuration syntax also remain retained;
they passed after upstream `2cbe2fc` supplied its repair.

## September 13 transport recovery follow-up

The upstream peer-transport close failure was reproduced and repaired in the
existing public browser-library transport. Closing while offer or description
setup is pending now rejects both public waiters immediately with the declared
error code and diagnostics. Connection deadlines also settle pending setup.
Ownership is cleared before cleanup callbacks, and late events or setup results
cannot reopen a closed connection or publish another offer or answer.

[The original close failure](peer-transport-close-before.log),
[four failing lifecycle probes](peer-transport-lifecycle-before.log) and
[the reentrant observer failure](peer-transport-observer-before.log) are retained.
All [57 focused transport, signaling and peer-job tests](peer-transport-regressions.log)
and [Verification Worker checks](peer-transport-verification-worker.log) pass.
This repairs one of the original 60 upstream failures; the other failing files
retain their earlier negative evidence and are not claimed green.

The [installed browser rerun](peer-transport-installed-browser.json) now uses
Reploid's public assignment transport for actual WebRTC setup, alongside signed
v2 streaming and native IndexedDB replay. It passes with three deltas, two
deliveries, one model execution, a replaced provider and no cleanup errors.
Its signaling fixture transfers gathered SDP between two contexts; it does not
test production signaling or separate operators. The Doppler archive remains
`c21230a20471c8beb9fa414a326b7a2da889a4ef9d07c13f3f23e8db9a1ca962`.
Physical model receipts above retain their original source and environment scope.

[Remote installed-consumer CI also passes](https://github.com/clocksmith/doppler/actions/runs/34738987245)
with the repaired transport pinned at `2aac9a2d5595b79ba0e03a16b12f5c1646c549eb`.
The [downloaded CI archive comparison](peer-transport-ci-record.json) confirms
byte-for-byte equality with the physical Doppler candidate. The
[browser receipt](peer-transport-ci-browser.json) records actual connected
transport diagnostics and the same successful streaming/replay assertions.

The [new full CI failure comparison](peer-transport-ci-failure-comparison.json)
reports 59 failures across six files, 208 passing files and three skipped files.
Every remaining failure identity belongs to the original upstream baseline;
only the repaired peer-transport close test was removed, and none was added.
Full-suite acceptance remains incomplete.


## September 13 VFS readiness follow-up

Reploid `173f1e8ec16426dbda0658077bc34bdc0a82edb5` restores storage readiness:
`VFS.init()` now awaits the IndexedDB open and rejects failures before reporting
success. Concurrent initialization shares one open without enumerating files;
closed stores reject reinitialization. The application retains its existing
surface/instance database name, inline `path` key and logging. Native Chromium
ruled out a key-path migration defect: existing files already survived writes
and connection replacement before this repair.

The [initial native run](vfs-native-before.log) proves two readiness failures.
The [regression run](vfs-regressions.log) passes all 36 VFS integration tests.
Mocks now deliver request success before transaction completion with distinct
transactions. The clear test verifies empty storage instead of a particular
IndexedDB method. Runtime writes still settle only after commit.

[Six native browser and Verification Worker checks](vfs-native-after.log) pass:
existing database persistence, eager readiness and connection reuse, native
version errors, aborted writes without committed-change events, independent
connection shutdown, and verification of changed modules. The verifier's
[previous rejection of the extracted storage owner](vfs-verifier-before.log)
is retained. Its correction allows only IndexedDB for the exact generated
`/vendor/reploid/adapters/browser.js`; neighboring files, tools, applications,
other storage access and malformed source remain rejected. This validator
candidate stays isolated in the draft branch; testing is not runtime approval
or activation.

[Local and remote full-suite comparison](vfs-full-suite-comparison.json) records
2,505 passing tests, 36 skipped tests and 25 remaining failures across five files.
All 34 former VFS failures are removed; no failure identity was introduced.
The remaining failures concern agent-loop timing, boot seed size, self-runtime
mocks, the swarm feature flag and existing CATSCAN inventory errors. The
[full CI log](vfs-remote-reploid.log) and [charter check](vfs-catscan.log) preserve
the failures. Full Reploid CI remains unaccepted.

The [installed runtime check](vfs-installed-reploid.json) and
[installed public transport/browser check](vfs-installed-browser.json) pass with
the unchanged Doppler archive `c21230a20471c8beb9fa414a326b7a2da889a4ef9d07c13f3f23e8db9a1ca962`.
[Required cross-repository CI](https://github.com/clocksmith/doppler/actions/runs/34739953850)
also passes with Reploid pinned at `173f1e8`. The
[downloaded archive comparison](vfs-ci-record.json) binds the exact remote
fixture revision and confirms identical candidate bytes. These installed model
programs are injected; physical model receipts retain their original scope.
The [source and evidence hashes](vfs-readiness-acceptance.json) bind this repair.

Reproduce from Reploid with a writable `TMPDIR`:

```sh
node node_modules/vitest/vitest.mjs run tests/integration/vfs.test.js
REPLOID_E2E_SKIP_LOCAL_SERVER=1 node node_modules/@playwright/test/cli.js test tests/e2e/vfs-storage-contract.spec.js tests/e2e/peer-pack-jobs.spec.js --project=chromium-swiftshader --grep 'VFS|init |aborted write|Verification Worker' --reporter=list
DOPPLER_TEST_CONSUMER=/path/to/retained/consumer node tests/fixtures/doppler-installed-generation.js
DOPPLER_TEST_CONSUMER=/path/to/retained/consumer node tests/fixtures/doppler-installed-peer-browser-check.js
```

Component: Reploid Browser Library, Agent Core and Verification Evidence.
Intent: preserved.
Acceptance evidence: the VFS source/hash record, regression logs, native browser
checks and installed-consumer CI above.
Boundary effects: Verification Worker recognizes the extracted IndexedDB owner's
existing storage responsibility through an exact file/pattern rule. No package
publication, deployment or candidate activation.

Component: Reploid Browser Library, Reploid Runtime Infrastructure, Poolday Evidence Runtime and Verification Evidence.
Intent: preserved.
Acceptance evidence: linked installed, native browser, physical, unit and negative records.
Boundary effects: explicit Doppler v2 adoption, published 0.6.1 default pins and
native journal storage layout; production activation remains separate.

*Last updated: September 2026*
