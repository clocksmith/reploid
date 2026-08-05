# Blueprint 0x0000A2: pool peer transport

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/peer-transport.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/peer-transport.js`

**Former Blueprint Paths:** `self/blueprints/0x0000A2-pool-peer-transport.md`
**Objective:** Provide interchangeable transports for signed peer-control messages.

**Target Upgrade:** pool/peer-transport.js

**Affected Artifacts:** /pool/peer-transport.js

---

### 1. Intent
Adapt RTCDataChannel and in-memory delivery to one send/subscribe interface.

### 2. Architecture
The DataChannel adapter adds and validates only the bus envelope version. The in-memory adapter provides the same behavior for local rooms and tests.

### 3. Implementation Notes
Transport does not verify message signatures or interpret bodies; those responsibilities remain in the control plane and protocol.

### 4. Verification Checklist
- [x] Both transports expose the same frozen interface
- [x] Invalid wire envelopes are ignored
- [x] Peer room and control-plane tests pass

*Last updated: July 2026*
