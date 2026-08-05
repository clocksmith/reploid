# Blueprint 0x0000AD: Pool Scientific Fitness

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/scientific-evaluation.js`, `/self/pool/scientific-fitness.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/scientific-evaluation.js`, `pool/scientific-fitness.js`

**Former Blueprint Paths:** `self/blueprints/0x0000AD-pool-scientific-fitness.md`
**Objective:** Require frozen, adjudicated, family-disjoint evidence of
model-specific scientific value before a Poolday model can be promoted.

**Target Upgrade:** pool/scientific-fitness.js, pool/scientific-evaluation.js

**Affected Artifacts:** /pool/scientific-fitness.js, /pool/scientific-evaluation.js,
/pool/config-contract.js, tests/unit/pool-scientific-fitness.test.js

---

### 1. Intent

Technical parity and browser execution do not establish scientific value. A
candidate must compare against an exact baseline on a frozen family-disjoint
cohort with independent adjudication. The evidence may support only its declared
claim boundary. It does not establish protein function, mutation fitness, or
biological truth.

### 2. Architecture

The frozen evaluation manifest binds public cohort member hashes, source and
cohort hashes, candidate and baseline exact-model identities, protocol/run/
result-set hashes, family partition definition and disjoint hashed memberships,
independent adjudication protocol and outcome hashes, exact model result sets,
and measured metric deltas. The scientific-fitness receipt must reference that
persisted manifest by path and canonical hash, then repeat its identities,
partition, adjudication, and metrics exactly. Each metric binds its own
definition/result hash, the frozen evaluation run, and an exact baseline contract. At least
one declared metric must show candidate improvement, with an improvement flag
consistent with its direction and frozen values. The record repeats the
candidate's frozen claim boundary; it cannot relabel residue plausibility as
mutation fitness. A configuration state of `qualified` also requires a
persisted scientific-fitness receipt reference.

### 3. Promotion Boundary

ESM-2 remains a baseline-release candidate until persisted clean-release
evidence exists. AMPLIFY, ESMC, and Nucleotide Transformer remain disabled.
Their scientific-fitness records cannot share model authority, coordinate spaces,
or licensing decisions.

### 4. Verification Checklist

- [x] Candidate and baseline bind exact model contracts
- [x] Family partition requires frozen, disjoint holdout and development sets
- [x] Independent adjudication and measured value are required
- [x] Metric improvement flags and candidate claim boundaries are fail-closed
- [x] Qualified config state requires a persisted receipt reference
- [x] Qualified fitness receipts require a matching persisted frozen-evaluation manifest
- [ ] Publish an adjudicated family-disjoint ESM-2 baseline evaluation
- [ ] Publish candidate evaluations before promotion

*Last updated: August 2026*
