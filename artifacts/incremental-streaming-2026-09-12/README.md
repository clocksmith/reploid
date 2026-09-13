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

Reploid's full CI has an independent upstream baseline failure: 60 tests in seven
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

Component: Reploid Browser Library, Reploid Runtime Infrastructure, Poolday Evidence Runtime and Verification Evidence.
Intent: preserved.
Acceptance evidence: linked installed, native browser, physical, unit and negative records.
Boundary effects: explicit Doppler v2 adoption, published 0.6.1 default pins and
native journal storage layout; production activation remains separate.

*Last updated: September 2026*
