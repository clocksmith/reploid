# Blueprint 0x0000AC: Pool Browser Qualification

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/browser-qualification.js`,
`/self/pool/browser-release-identity.js`,
`/self/config/browser-bundle-manifest.json`

**Planned Artifacts:** None

**Owned Source Files:** `pool/browser-qualification.js`, `pool/browser-release-identity.js`

**Former Blueprint Paths:** `self/blueprints/0x0000AC-pool-browser-qualification.md`
**Objective:** Bind an authentic browser model-qualification journey to one
exact Poolday model contract without promoting a model from Node WebGPU parity
or a catalog declaration.

**Target Upgrade:** pool/browser-qualification.js

**Affected Artifacts:** /pool/browser-qualification.js,
/pool/browser-release-identity.js, /config/browser-bundle-manifest.json,
/pool/config-contract.js, scripts/verify-browser-bundle.js,
scripts/verify-pool-release.js, tests/unit/pool-browser-qualification.test.js,
tests/unit/pool-browser-release-identity.test.js

---

### 1. Intent

Browser qualification is a release-evidence gate. It requires immutable artifact
delivery, complete hash verification, WebGPU execution, OPFS persistence and
restoration, receipt integrity, cancellation, stale-result rejection, corruption
rejection, interruption recovery, and independent reproduction. Node WebGPU
parity is useful provenance but is not browser qualification.

### 2. Architecture

The qualification record binds model, model bytes, manifest, tokenizer, runtime,
backend, and exact model-contract key. It also binds the source revision,
browser identity, GPU adapter identity, policy hash, output hash, and receipt
hash. The two reproduction records must agree on the declared output hash while
retaining distinct participant, browser-run, browser, and provider-bound receipt
identities. The parent receipt anchors one reproduction; it is not reused as
the receipt identity of every provider.

Qualification requires an explicitly clean source state. Missing or placeholder
browser, GPU, and release identities remain incomplete evidence; non-empty
placeholder strings cannot satisfy the gate.

The release identity has three separately checked projections. A clean Git source
identity binds the exact commit and the raw tracked-tree listing. A deterministic
browser-bundle manifest binds the byte length and SHA-256 digest of every file
under the Firebase `self/` public root, except the manifest descriptor itself.
The Cloud Run coordinator reports a commit-tagged image plus a deterministic
runtime bundle over `server/`, `self/`, the Dockerfile, and locked package inputs.
The release verifier requires the deployed descriptor to match and fetches every
declared path, and it requires the live coordinator commit and runtime hash to
match the same clean checkout before starting browser lanes.
Rebuilding unchanged generated inputs produces the same bundle hash.
Each lane's Playwright JSON and embedded attachments are copied and hashed before
the next lane overwrites the shared reporter path. The resulting release-evidence
index binds all nine lane records to the clean source, browser bundle, deployment,
and Poolday config. Every required JSON attachment repeats that release identity,
and aggregation rejects a transplanted or mismatched attachment. The index is
explicitly non-promotable and does not reinterpret
same-operator provider tabs as independently operated reproductions.

The record contract validates evidence shape and identity. Every passed check
must include a hash-addressed browser-run observation with a check identifier,
browser-run identity, timestamp, observed-result hash, and artifact hash. Each
check repeats the parent record's exact model/artifact set, release,
browser/GPU, policy, output, and receipt bindings, preventing a check from one
release from qualifying another. Each independent reproduction separately binds
the exact model contract, artifact set, release, policy, output, receipt,
browser-run identity, and browser/GPU identity. A
harness begins with an explicitly incomplete observation and cannot finalize it
unless every governed check is both passed and evidenced. The actual ESM-2
browser journey attaches an incomplete observation for the checks it has
executed. A dirty or incompletely identified smoke run records those checks as
`observed`, never `passed`; that attachment is not a persisted qualification
receipt.

A qualified catalog entry also requires a persisted qualification receipt path
before it can be enabled. This is not evidence that a GPU was honest or that a
model output is biologically true.

The Playwright harness may target an already-running, separately inspected
local server with `REPLOID_E2E_SKIP_LOCAL_SERVER=1`. This only suppresses its
second local-server launch. It does not suppress artifact preflight, browser
checks, OPFS recovery, or promotion validation.

### 3. Promotion Boundary

Qualification evidence remains model-specific. A passing ESM-2 journey cannot
qualify AMPLIFY, ESMC, or Nucleotide Transformer. Scientific fitness and license
admission remain separate gates. A candidate stays disabled until every required
gate has evidence.

### 4. Verification Checklist

- [x] Exact model-contract identity binds qualification evidence
- [x] Required browser recovery and integrity checks are explicit
- [x] Independent reproduction requires distinct identities and matching output
- [x] Browser-qualified catalog state requires a persisted receipt reference
- [x] Passed checks require hash-addressed browser-run observations
- [x] Passed checks bind the same release, artifacts, browser/GPU, policy, output, and receipt as the qualification record
- [x] Runtime cancellation invalidates late sequence output before receipt construction
- [x] Deterministic manifest binds every Firebase-served browser file byte
- [x] Release verification rejects dirty Git state and deployed browser-byte drift
- [x] Hosted readiness and release verification bind Cloud Run commit, image, platform revision, and runtime bytes
- [x] Release verification preserves every lane report and attachment in one bound evidence index
- [ ] Persist clean-release browser evidence for ESM-2
- [ ] Run authentic browser qualification for each candidate

*Last updated: August 2026*
