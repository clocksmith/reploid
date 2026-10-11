# Recoverable ICE disconnection during selective acquisition

Component: peer transport. Intent: preserved. Boundary effects: connection lifetime only.

The retained two-device 2B application run `2026-10-11T03-19-08-374Z`
failed while acquiring shard 16, piece `piece-9260155ca7f0a999601c2acef74ad279132e3f0ceb78f97401a27c92cfd27a24.bin`, chunk 1.
`failed-physical-run.tar.gz` preserves its complete captured output and state.

At 03:25:19.667 and 03:25:20.374 UTC the Mac retired peers from the
connection-state callback with ICE/connection state `disconnected`, data
channels still `open`, signaling still connected, and last-seen ages 19474 and
6877 milliseconds. Linux subsequently recorded the same teardown mechanism.
The requester downloaded no weights and contributors made no origin requests.

`disconnected` is recoverable according to the [WebRTC state contract](https://www.w3.org/TR/webrtc/#dom-rtcicetransportstate-disconnected).
Both incoming and outgoing swarm paths previously destroyed connections at this
transition. They now retain them within the existing heartbeat deadline;
terminal failed/closed states, channel closure and explicit disconnect still
retire immediately. No permissions, timeouts or model settings changed.

Seven regression cases failed against the original implementation and pass
with this repair. The focused selection passes 41 tests; the repository runner
passes 2994 with 29 skipped. Sixteen real-browser custody/job/storage tests pass.
The separate lifecycle selection passes 11 host tests, but two legacy suites
cannot import their obsolete `core/utils.js` path; that invocation is retained.
Library types, layers, CATSCAN and regenerated browser delivery checks pass.

The initiating network interruption remains unexplained. These observations
establish a current premature-teardown defect, not the missing triggering event
of the older uninstrumented acquisition failure. A repeated physical acquisition
run is still required; this receipt does not close numerical, task-quality,
capacity or complete application acceptance.
