# Blueprint 0x000158: pool participation profile

**Objective:** Persist and sign Request, Contribute, or Both consent with explicit capabilities and resource limits.

**Target Upgrade:** pool/participation-profile.js

**Affected Artifacts:** /pool/participation-profile.js

---

### 1. Intent
Make network participation explicit, portable across Poolday routes, and
verifiable by peers and the hosted coordinator.

### 2. Architecture
Preferences map deterministically to capabilities. The device root signs the
normalized mode, permissions, limits, revision, and public identity.

### 3. Constraints
Contribution does not grant publisher or adapter-creation authority. Numeric
limits are bounded before signing. Capability escalation invalidates the
profile.

### 4. Verification Checklist
- [x] Three modes map to explicit role capabilities
- [x] Preferences persist locally and normalize deterministically
- [x] Signature and hash verification fail closed

*Last updated: July 2026*
