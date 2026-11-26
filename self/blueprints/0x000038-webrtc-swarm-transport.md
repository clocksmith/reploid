# Blueprint 0x000038: WebRTC Swarm Transport

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/communication/webrtc-swarm.js`, `/packages/reploid/src/transport/swarm.js`, `/packages/reploid/src/transport/message-types.js`, `/shared/capabilities/communication/library-adapter.js`, `/tests/integration/webrtc-swarm.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/communication/webrtc-swarm.js`

**Former Blueprint Paths:** `self/blueprints/0x000038-webrtc-swarm-transport.md`
**Objective:** Connect X instances to peers in the same room over WebRTC data channels, with signaling through a WebSocket server, a validated message envelope and bounded reconnection.

**Prerequisites:** [0x00004F](0x00004F-event-bus-infrastructure.md) (event bus)

Signed peer-control transport for the product is [0x0000A2](0x0000A2-pool-peer-transport.md). The task-delegation and voting layer of the retired [0x000031](0x000031-swarm-orchestration.md) was never built.

---

### 1. Layers

- `self/capabilities/communication/webrtc-swarm.js` registers `WebRTCSwarm` (genesis level `full`, async, dependencies `Utils`, `EventBus`). Its factory is `createWebRTCSwarm(createLegacyNetworkOptions(deps))`.
- `shared/capabilities/communication/library-adapter.js` (`createLegacyNetworkOptions`) resolves the room from the URL and storage (`resolveSwarmJoin`), the signaling URL, the RTC configuration (relay credentials fetched at negotiation, falling back to direct-only candidates and publishing `reploid:relay-state` when they are unavailable) and the invite URL.
- `packages/reploid/src/transport/swarm.js` is the transport. The browser loads it through `shared/vendor/reploid/transport/`.

### 2. Transport

- **Signaling.** A WebSocket to the configured signaling server joins a session-scoped room (`roomId`, and a `swarmToken` for private rooms). Offers, answers and ICE candidates pass through it; pending remote ICE candidates are bounded per peer and expire.
- **Peers.** Each peer gets an `RTCPeerConnection` and one ordered data channel. Heartbeats detect dead peers (`peerTimeoutMs`). Signaling reconnects with exponential backoff up to `maxBackoffMs`. An open connection can be ICE-restarted (`restartPath`) and can open up to 8 extra `reploid-path-N` channels (`openFreshPath`).
- **Auxiliary channels.** Only the labels in `SWARM_AUXILIARY_CHANNELS` (`reploid-custody`, `reploid-partitions`, `reploid-partitions-input`, `reploid-partitions-control`, `reploid-jobs`, `reploid-partitions-ordered`, `reploid-training`) can be opened or handled (`openDataChannel`, `onDataChannel`).
- **Envelope.** Every message is `{ protocolVersion, type, peerId, timestamp, payload, payloadSize }`. `validateEnvelope` rejects a wrong protocol version, a type not in `RTC_MESSAGE_TYPES` (`message-types.js`), a missing peer ID or timestamp, and a payload over `maxMessageBytes`. A message whose `peerId` does not match the sending connection is dropped. `timestamp` is a logical clock (`tick`, `getClock`) used by swarm sync.

Limits (`maxMessageBytes`, `heartbeatIntervalMs`, `peerTimeoutMs`, `reconnectBaseMs`, `maxBackoffMs`, ICE servers, channel options) come from the resolved library configuration, not from constants in the module.

### 3. Public API

`init`, `disconnect`, `sendToPeer`, `broadcast`, `onMessage`, `getConnectionState`, `getConnectedPeers`, `getPeerStates`, `observePeerAuthentication`, `onDataChannel`, `openDataChannel`, `supportsFreshPaths`, `openFreshPath`, `restartPath`, `allowPathRecovery`, `getPeerBinding` (local and remote DTLS fingerprints of an open connection), `getStats`, `getClock`, `tick`, `getPeerId`, `getIntroductions`.

### 4. Authority

The transport delivers messages; it decides nothing. Admission to a room never grants execution (`message-types.js`): handlers for Raft, federated-learning, sync and artifact messages belong to the embedding application through `onMessage`, and each applies its own grants. There is no task-delegation or consensus-vote message type.

### 5. Verification conditions

- An envelope with an unknown type, a wrong protocol version, or an oversized payload is rejected.
- A message claiming a different `peerId` than its connection is dropped.
- `openDataChannel` refuses a label outside `SWARM_AUXILIARY_CHANNELS`.
