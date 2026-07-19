# Blueprint 0x000159: pool device identity

**Objective:** Bind scoped Poolday roles to one device root with optional passkey protection.

**Target Upgrade:** pool/device-identity.js

**Affected Artifacts:** /pool/device-identity.js

---

### 1. Intent
Prove key possession and role continuity without claiming unique-human identity.

### 2. Architecture
The browser stores a non-exportable P-256 root in IndexedDB when possible. The
root signs requester, provider, publisher, and verifier delegations. A WebAuthn
assertion may bind the root to a passkey.

### 3. Constraints
The exportable fallback is labeled. Passkeys do not prevent Sybil identities.
Delegations expire and bind an exact participation-profile hash.

### 4. Verification Checklist
- [x] One root delegates distinct role keys
- [x] Delegations verify role, key, capability, profile, and expiry
- [x] Protection level remains visible

*Last updated: July 2026*
