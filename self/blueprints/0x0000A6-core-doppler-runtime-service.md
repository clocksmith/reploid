# Blueprint 0x0000A6: core doppler runtime service

**Classification:** Canonical Full Specification

**Implementation Status:** In-Progress

**Verified Artifacts:** `/self/config/doppler-local-models.js`, `/self/config/doppler-execution-contracts.js`, `/self/core/doppler-runtime-service.js`, `/self/infrastructure/doppler-runtime-service.js`

**Planned Artifacts:** None

**Owned Source Files:** `config/doppler-local-models.js`, `config/doppler-execution-contracts.js`, `core/doppler-runtime-service.js`, `infrastructure/doppler-runtime-service.js`

**Former Blueprint Paths:** `self/blueprints/0x0000A6-core-doppler-runtime-service.md`
**Objective:** Define the single Reploid owner for Doppler imports and scoped
model sessions.

**Target Upgrade:** infrastructure/doppler-runtime-service.js

**Affected Artifacts:** /infrastructure/doppler-runtime-service.js, /core/doppler-runtime-service.js, /config/doppler-local-models.js

---

### 1. Intent

Local chat, Poolday, Zero, Semantic Memory, and inspection may apply different
policies, but they must not independently select Doppler versions or own hidden
GPU-session caches. This module centralizes those mechanics without merging the
authority of those surfaces.

The implementation lives in infrastructure so Poolday and core consumers share
it without crossing their dependency boundary. The former core path is a thin
compatibility export.

### 2. Architecture

The service:

- Imports the one configured immutable Doppler module.
- Verifies the exact runtime version.
- Uses scoped `dr.open` for legacy and RSI consumers. Checked-in execution-contract
  JSON maps each signed format to its public `openPack` or `openCapsule` method,
  session, operation, receipt, and adapter schema. Unknown formats fail explicitly.
- Prepares signed runtimes without requiring an unrelated legacy `dr.open` method.
- Revalidates signed model eligibility on every opening and serializes scope replacements.
- Owns one session per explicit Reploid scope.
- Reuses a session only when the scope and source identity match.
- Closes replaced sessions and supports `closeAll`.

Callers retain workload and evidence policy. Poolday still owns assignments and
requester acceptance. Zero still owns VFS mutation, Shadow isolation,
verification, and promotion.

### 3. Implementation Notes

- The package name, version, spec, tarball, integrity, browser module and
  kernel base come from `config/doppler-local-models.js`, which reads
  [`shared/config/doppler-package.json`](../../shared/config/doppler-package.json).
  That file is the one pin: it names the `dopplerx` package and its tarball
  integrity. Node installs that tarball through the root `package.json`
  dependency, and the browser module and kernel URLs live under
  `/vendor/doppler/<version>/`, so both bind the same immutable package. Do not
  repeat the version in prose.
- Different scopes can keep text and protein sessions independently.
- Legacy handle adaptation exists only under Vitest and never runs in the
  deployed browser.
- Unsupported or mixed Doppler versions fail before model loading.
- Pack and Capsule identities remain distinct. Existing signed files and history
  retain their original fields; new Capsules require publisher-issued identities.

### 4. Verification requirements

- [x] Unit tests cover reuse, scope separation, close, and fail-closed identity.
- [x] Local provider and Poolday adapters use the scoped API.
- [x] Runtime-config synchronization binds Node and browser imports to the one
  package pinned in `shared/config/doppler-package.json`.
- [x] Real two-browser text and protein lanes pass after deployment.
- [x] A real two-provider ring quorum passes through the deployed server relay
  with signed requester acceptance.
- [ ] Real Zero bounded RSI passes after deployment. Open: no retained receipt
  exists, so this declared verification boundary keeps the status In-Progress.

*Last updated: July 2026*
