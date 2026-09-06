# ESM-2 with durable parallel peer acquisition

The [retained episode](episode.json) reconstructs the signed ESM-2 envelope and
24 dependencies through `openPeerPack`, verifies their bytes, and executes the
actual model through `executeOperation`. All eight frozen reference checks pass.
The receiver begins with empty IndexedDB and OPFS caches. Original-host and
mirror downloads are disabled; the receiver makes zero bootstrap model requests.

The run uses Chromium 151 and AMD Radeon 8060S graphics, with four browser
contexts controlled by one operator on one computer. It does not establish
independent operators, machines, remote-job reliability, or improved scheduling.
Installed runtime JavaScript and two pinned device-probe shaders still come
from the local software server. The development Pack signing key remains explicit.

| Observed measure | Value |
| --- | ---: |
| Concurrent chunks permitted | 2 |
| Peak chunks in flight | 2,097,152 bytes |
| Peak artifact assembly | 67,108,864 bytes |
| Received bytes, including rejected corruption | 134,553,465 |
| Reserved transfer budget used | 136,650,617 bytes |
| Bytes hashed during verification | 534,754,508 |
| Persisted verified payload | 133,504,889 bytes / 149 chunks |
| Cache read bytes | 133,348,077 |
| Duplicate accepted network bytes | 0 |
| Time until executable session opened | 14,285 ms |

Cache reads here are rereads within the same execution, after initial peer
acquisition. They do not demonstrate an already-warm receiver. Storage counts
payload bytes, excluding IndexedDB metadata and browser overhead. Assembly and
in-flight bounds are not total process or GPU memory measurements. Wire,
relay, and interrupted-transfer bytes remain unmeasured. These distinctions are
preserved in the receipt.

Corrupt contributions are rejected and missing chunks are obtained after a
supplier departs. The [first attempt](attachments/episode.json) failed its fault
coverage check: concurrent disconnection prevented corrupted bytes from reaching
the receiver. The corrected fixture schedules departure on the second weight
artifact, allowing both faults to occur. Its actual model output also passed;
that does not turn the failed attempt into a passing episode.

Sampled pooled and token maximum errors are 0.0005117784781856552 and
0.000888853865722683, below the frozen 0.001 tolerance. This is sampled source
agreement, without biological correctness claims.

## Reproduce and inspect

[index.json](index.json) hashes 29 retained files, records both source bases and
patches, and locates the two unchanged weight shards at immutable HTTPS URLs.
The episode binds 571 served runtime files. The patches retain the observed
dirty source state; a local `0.5.2` version string does not mean npm publication.

Use the [original reproduction procedure](../esm2-peer-pack-2026-09-05/README.md#reproduce)
with this directory as `retained`, the recorded source bases plus their patches,
and an available physical Chromium binary. The configuration adds bounded
parallelism of two to custody and transport. Run offline archive validation with
`npx vitest run tests/unit/retained-peer-pack-episode.test.js`.

The separate `tests/e2e/peer-pack-custody.spec.js` closes Chromium, reopens the same
profile, and retrieves only missing pieces under renewed authorization. It uses
small synthetic bytes. This real-model episode itself does not restart its browser.

Component: Poolday Evidence Runtime and browser persistence.
Intent: preserved.
Acceptance evidence: this physical episode, offline archive validation, peer
session unit tests, and browser custody/Verification Worker tests.
Boundary effects: peer acquisition now composes durable storage with the existing
local Pack execution interface; custody does not authorize remote delegation.
