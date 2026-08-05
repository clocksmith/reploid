# Blueprint 0x0000A6: core doppler runtime service

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/config/doppler-local-models.js`, `/self/core/doppler-runtime-service.js`, `/self/infrastructure/doppler-runtime-service.js`

**Planned Artifacts:** None

**Owned Source Files:** `config/doppler-local-models.js`, `core/doppler-runtime-service.js`, `infrastructure/doppler-runtime-service.js`

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
- Requires the scoped `dr.open` contract.
- Owns one session per explicit Reploid scope.
- Reuses a session only when the scope and source identity match.
- Closes replaced sessions and supports `closeAll`.

Callers retain workload and evidence policy. Poolday still owns assignments and
requester acceptance. Zero still owns VFS mutation, Shadow isolation,
verification, and promotion.

### 3. Implementation Notes

- The browser module, kernel base, package spec, semantic version, and Git commit
  come from `config/doppler-local-models.js`.
- Node and the browser pin the published `doppler-gpu@0.5.1` package. The
  lockfile binds the npm tarball integrity, while the browser module and kernel
  URLs bind the same immutable version.
- Different scopes can keep text and protein sessions independently.
- Legacy handle adaptation exists only under Vitest and never runs in the
  deployed browser.
- Unsupported or mixed Doppler versions fail before model loading.

### 4. Verification Checklist

- [x] Unit tests cover reuse, scope separation, close, and fail-closed identity.
- [x] Local provider and Poolday adapters use the scoped API.
- [x] Runtime-config synchronization binds Node and browser imports to one exact
  Git commit.
- [x] Real two-browser text and protein lanes pass after deployment.
- [x] A real two-provider ring quorum passes through the deployed server relay
  with signed requester acceptance.
- [ ] Real Zero bounded RSI passes after deployment.

*Last updated: July 2026*
