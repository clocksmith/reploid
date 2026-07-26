# Blueprint 0x00016a: config clockwork gamma receipts

**Objective:** Pin the Gamma receipts that may authorize typed Clockwork
promotion claims.

**Target Upgrade:** config/clockwork-gamma-receipts.js

**Affected Artifacts:** /config/clockwork-gamma-receipts.js

---

### 1. Intent

Reploid may preserve and compare advisory evidence, but only Gamma decides a
Clockwork candidate's acceptance. This registry projects Gamma's accepted
receipt identity into Reploid without copying Gamma's verifier authority.

### 2. Architecture

Each entry binds the receipt, challenge, candidate, Gamma verifier source, and
Gamma Git revision. `core/promotion-policy.js` recomputes the supplied receipt
digest and requires an exact entry before `Promote` can accept a
Clockwork-tagged Shadow.

### 3. Implementation Notes

- The canonical schemas and receipts remain in Gamma.
- A receipt registry entry is intentionally checked in and reviewable.
- This file is a validator-quarantine target. Zero cannot promote a mutation to
  it using its own replay evidence.
- Ordinary Zero candidates do not consult this registry.
- Doppler reasoning receipts and M3T4 advisory receipts never appear here.

### 4. Verification Checklist
- [x] The accepted Gamma receipt is pinned to challenge and candidate identity.
- [x] Gamma source and Git revisions are recorded.
- [x] Promotion tests cover trusted, untrusted, advisory-only, and tampered
  evidence.
- [x] The registry path is quarantined from self-promotion.

*Last updated: July 2026*
