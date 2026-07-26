# Blueprint 0x000169: core doppler runtime service

**Objective:** Define the single Reploid owner for Doppler imports and scoped
model sessions.

**Target Upgrade:** core/doppler-runtime-service.js

**Affected Artifacts:** /core/doppler-runtime-service.js

---

### 1. Intent

Local chat, Poolday, Zero, Semantic Memory, and inspection may apply different
policies, but they must not independently select Doppler versions or own hidden
GPU-session caches. This module centralizes those mechanics without merging the
authority of those surfaces.

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
- Because npm publication is unavailable on the release host, Node installs an
  HTTPS tarball addressed by the exact Git commit. The browser CDN uses that
  same commit, and the lockfile additionally binds the tarball integrity.
- Different scopes can keep text and protein sessions independently.
- Legacy handle adaptation exists only under Vitest and never runs in the
  deployed browser.
- Unsupported or mixed Doppler versions fail before model loading.

### 4. Verification Checklist

- [x] Unit tests cover reuse, scope separation, close, and fail-closed identity.
- [x] Local provider and Poolday adapters use the scoped API.
- [x] Runtime-config synchronization binds Node and browser imports to one exact
  Git commit.
- [ ] Real two-browser text and protein lanes pass after deployment.
- [ ] Real Zero bounded RSI passes after deployment.

*Last updated: July 2026*
