# Blueprint 0x00009C: pool config contract

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/config-contract.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/config-contract.js`

**Former Blueprint Paths:** `self/blueprints/0x00009C-pool-config-contract.md`
**Objective:** Own Pool config validation and derived constants independently of the loading environment.

**Target Upgrade:** pool/config-contract.js

**Affected Artifacts:** /pool/config-contract.js

---

### 1. Intent
Validate one Pool config value, freeze an isolated copy, and derive policy/model/runtime accessors from that copy.

### 2. Architecture
Browser and server adapters load JSON differently, then call this pure factory with their environment-specific hash function. The returned aliases preserve the existing public API.

### 3. Implementation Notes
Never mutate imported JSON. Keep aliases referentially consistent and reject incomplete launch, policy, transport, and deployment contracts before use.

### 4. Verification Checklist
- [x] Browser and server adapters share one validator
- [x] Returned config and policy values are deeply frozen
- [x] Cross-environment config tests pass

*Last updated: July 2026*
