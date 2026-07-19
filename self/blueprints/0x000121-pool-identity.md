# Blueprint 0x000121: pool identity

**Objective:** Describe implementation for pool/identity.js.

**Target Upgrade:** pool/identity.js

**Affected Artifacts:** /pool/identity.js

---

### 1. Intent
Expose requester and provider roles derived from one browser device root without
making a unique-human or hardware-attestation claim.

### 2. Architecture
`device-identity.js` owns the P-256 root and optional passkey binding.
`participation-profile.js` owns mode, capability, and resource consent.
`identity.js` creates scoped role keys and root-signed delegations bound to the
active profile hash.

### 3. Implementation Notes
IndexedDB stores a non-exportable root when supported. The labeled localStorage
fallback is exportable. Passkeys prove credential possession and continuity,
not one-person identity or Sybil resistance.

### 4. Verification Checklist
- [x] Requester and provider roles share one root
- [x] Delegations cannot exceed signed participation capabilities
- [x] Passkey and fallback protection levels remain receipt-visible

*Last updated: July 2026*
