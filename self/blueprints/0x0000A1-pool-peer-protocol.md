# Blueprint 0x0000A1: pool peer protocol

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/peer-protocol.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/peer-protocol.js`

**Former Blueprint Paths:** `self/blueprints/0x0000A1-pool-peer-protocol.md`
**Objective:** Own the signed Poolday peer-message envelope and validation contract.

**Target Upgrade:** pool/peer-protocol.js

**Affected Artifacts:** /pool/peer-protocol.js

---

### 1. Intent
Create, canonicalize, hash, sign, and verify allowed peer messages on the Poolday network.

### 2. Architecture
The protocol depends only on receipt cryptography. Higher layers construct message bodies; transports carry signed envelopes without interpreting them.

### 3. Implementation Notes
Signatures exclude signature and messageHash fields. Expired messages and unknown types fail validation before state ingestion.

### 4. Verification Checklist
- [x] Envelope fields and message types remain compatibility-stable
- [x] Hash and signature domains are enforced
- [x] Peer signature and nonce tests pass

*Last updated: July 2026*
