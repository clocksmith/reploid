# Retire failed RTC and rediscover capacity

Component: Reploid authenticated transport. Intent: preserved.

The ordinary requester lost its Suby RTC connection while signaling remained
healthy. Terminal connection failure removed the peer, but the rendezvous did
not emit another join for that still-present peer. Only a manual reload restored
capacity. Parent browser evidence retains that failure separately.

The regression reproduces this boundary: before the repair, no second discovery
socket appears (14 passed, 1 failed). The repair rejoins through the existing
bounded reconnect backoff after terminal direct-channel failure, closure,
negotiation expiry or liveness expiry. Still-open channels are retained. Explicit
disconnect cancels recovery; introduction-only exchanges keep their own path.
No generation request or permission is replayed.

Validation: 63 focused tests pass across swarm-signaling-independence,
webrtc-swarm, swarm-rtc-config and swarm-credential-renewal. Before/after logs are
retained. The actual browser Verification Worker accepts the generated transport
module with warnings and no errors; its receipt also includes the parent's two
UI files and does not qualify unrelated changes. Generated library and layer,
loader, cycle and canonical delivery checks pass.

Physical fault control remains to be run against the new served bytes: close one
actual requester RTCPeerConnection, observe replacement and preserve other open
channels, then submit a new authorized request. Local deliberate closure is not
a reproduction of the original underlying network failure. Unit checks establish
bounded repair behavior, not physical distributed release acceptance.
