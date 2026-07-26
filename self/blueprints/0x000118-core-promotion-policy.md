# Blueprint 0x000118: core promotion policy

**Objective:** Define the shared promotion, quarantine, and external-authority
checks for Shadow candidates.

**Target Upgrade:** core/promotion-policy.js

**Affected Artifacts:** /core/promotion-policy.js

---

### 1. Intent

Ordinary Zero RSI candidates continue through replay, byte binding, rollback,
and validator-quarantine checks. Candidates explicitly tagged with
`authorityClaim: "clockwork"` cross a different authority boundary and cannot
be promoted from Reploid, Doppler, or M3T4 evidence alone.

### 2. Architecture

- Normalize and allowlist `/shadow`, `/artifacts`, and `/self` paths.
- Require replay evidence and bind it to the promoted candidate bytes.
- Quarantine mutations to validators and authority registries.
- For Clockwork claims, validate the complete Gamma receipt, all six gates,
  canonical self-digest, candidate/challenge identity, and a checked-in trusted
  receipt registry entry.
- Preserve target bytes and a rollback receipt before every accepted write.

### 3. Implementation Notes

- `self/config/clockwork-gamma-receipts.js` is the local trust projection. It is
  a validator-quarantine target, so Zero cannot self-authorize new Gamma
  receipts.
- M3T4 receipts remain advisory even when included for lineage.
- Omitting Clockwork authority from an ordinary RSI candidate does not add a
  Gamma dependency; the gate is typed, not global.
- A receipt hash alone is insufficient. Reploid recomputes the receipt's
  canonical digest and checks the source revision pinned by the trusted entry.

### 4. Verification Checklist
- [x] Ordinary Zero replay promotion is unchanged.
- [x] Doppler or M3T4 evidence alone cannot promote a Clockwork claim.
- [x] Candidate, challenge, gate, source, and receipt mismatches fail closed.
- [x] The trusted receipt registry is quarantined from self-promotion.

*Last updated: July 2026*
