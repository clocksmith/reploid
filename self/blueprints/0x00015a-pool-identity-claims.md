# Blueprint 0x00015a: pool identity claims

**Objective:** Apply one participation and role verification law to peer and hosted Poolday paths.

**Target Upgrade:** pool/identity-claims.js

**Affected Artifacts:** /pool/identity-claims.js

---

### 1. Intent
Reject mismatched roots, roles, keys, capabilities, profile hashes, and
advertised limits before routing or execution.

### 2. Architecture
The verifier composes participation-profile signature validation with root role
delegation validation. Peer messages supply their signed envelope identity;
hosted requests supply the same claims directly.

### 3. Verification Checklist
- [x] Peer and hosted paths share the verifier
- [x] Capability escalation fails
- [x] Advertised resource limits cannot exceed signed consent

*Last updated: July 2026*
