# Blueprint 0x000171: Pool Model Promotion Evidence

**Objective:** Verify the content of persisted browser-qualification and
scientific-fitness evidence before a qualified Poolday model can enter a
release.

**Target Upgrade:** pool/model-promotion.js

**Affected Artifacts:** /pool/model-promotion.js,
/scripts/verify-pool-production.js, tests/unit/pool-model-promotion.test.js

---

### 1. Intent

A receipt filename is not promotion proof. The release verifier must read the
immutable persisted record and bind it to the exact enabled model contract.
It must not enable candidates, infer scientific value, or allow a candidate to
reuse a different model's browser evidence.

### 2. Architecture

The promotion validator checks browser evidence only for catalog entries marked
browser-qualified. It checks scientific evidence only for entries marked
scientifically qualified. Scientific evidence resolves each baseline from the
governed catalog and requires the enabled ESM-2 exact contract as a baseline.
Unknown, disabled, or self-declared baseline identities fail closed. The DNA
lane additionally requires one hash-addressed, exact-contract admission record
for privacy, reference coordinates, DNA scientific fitness, licensing, and
product use. Admission strings and filenames alone cannot satisfy that gate.

The production verifier accepts receipt paths only beneath `docs/status`, parses
them as JSON, and sends the records through the validator. Baseline-release
states remain distinct from qualified candidate promotion until clean-release
evidence is published.

### 3. Verification Checklist

- [x] Qualified browser state reads and validates persisted record content
- [x] Qualified scientific state resolves governed exact baseline contracts
- [x] ESM-2 baseline identity is required for candidate scientific value claims
- [x] DNA qualification requires hash-addressed exact-contract admission records
- [x] Receipt paths are constrained to durable status records
- [ ] Persist clean-release ESM-2 browser and baseline-evaluation evidence
- [ ] Validate each candidate's browser and scientific record before promotion

*Last updated: August 2026*
