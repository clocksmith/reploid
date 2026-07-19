# Blueprint 0x000155: pool p2p artifact transfer

**Objective:** Transfer an exact adapter artifact over an assignment-bound peer channel.

**Target Upgrade:** pool/p2p-artifact-transfer.js

**Affected Artifacts:** /pool/p2p-artifact-transfer.js

---

### 1. Intent
Move adapter chunks between selected Poolday peers without treating the signaling
relay as an artifact host.

### 2. Architecture
The requester names assignment, pack, adapter, peers, and missing chunk indexes.
The seeder emits chunk payloads from the pack's governed chunk table. Assembly
checks payload hashes, chunk hashes, byte count, and final adapter SHA-256.

### 3. Implementation Notes
Every payload is scoped to the assignment and peer pair. Successful assembly
returns acquisition evidence suitable for the provider receipt. This is artifact
transfer, not tensor, layer, attention, or KV sharding.

### 4. Verification Checklist
- [x] Missing, duplicate, corrupt, and wrong-peer chunks fail closed
- [x] Final bytes match the promoted adapter identity
- [x] Transfer receipt identifies the seeding peer and assignment

*Last updated: July 2026*
