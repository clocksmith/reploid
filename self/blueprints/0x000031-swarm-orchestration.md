# Blueprint 0x000031: Swarm Orchestration

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000031-swarm-orchestration.md`

## Retired design

This design proposed `/capabilities/communication/webrtc-coordinator.js`, which split agent tasks across peers over WebRTC, shared reflections and asked peers to vote on risky modifications. That module does not exist. Two of its rules also contradict current authority and are withdrawn: a timed-out vote fell back to approval, and peers ran tasks delegated to them. Admission to a room or swarm never grants execution (`packages/reploid/src/transport/message-types.js`), and peer agreement or model scores never grant activation; the operator adopts changes (see [INTENT.md](../../INTENT.md)). Peer transport is `packages/reploid/src/transport/swarm.js`, with [0x000038](0x000038-webrtc-swarm-transport.md) for the X swarm transport and [0x0000A2](0x0000A2-pool-peer-transport.md) for signed peer-control transport.
