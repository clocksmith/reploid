# Blueprint 0x00002A: Module Integrity Verification

**Classification:** Canonical Full Specification

**Implementation Status:** In-Progress

**Verified Artifacts:** `/shared/core/verification-worker.js`, `/shared/core/vendor/acorn.js`, `/shared/core/vendor/ACORN-LICENSE.txt`, `/self/core/vfs-module-loader.js`, `/self/host/sw-module-loader.js`, `/tests/unit/verification-worker-prototype.test.js`, `/tests/unit/tool-verification-gate.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/verification-worker.js`, `core/vendor/acorn.js`, `core/vendor/ACORN-LICENSE.txt`

**Former Blueprint Paths:** `self/blueprints/0x00002A-module-integrity-verification.md`
**Objective:** Bind every verification decision and every approved module load to the exact bytes that were checked, and keep the verifier itself (the Worker and its vendored parser) a fixed, separately protected input.

**Prerequisites:** [0x000040](0x000040-verification-manager.md) (Verification Manager), [0x000011](0x000011-advanced-storage-backend-indexeddb.md) (VFS)

**Affected Artifacts:** `shared/core/verification-worker.js`, `shared/core/vendor/acorn.js`, `shared/core/vendor/ACORN-LICENSE.txt` (served at `/self/core/...`), `self/core/verification-manager.js`, `self/core/vfs-module-loader.js`, `self/core/tool-writer.js`, `self/core/promotion-policy.js`, `self/host/sw-module-loader.js`

---

### 1. Location

The Worker and parser live in `shared/core/` and moved there from `self/core/` (commit `3d8f2a118`) so both surfaces load one copy. The served tree exposes them at `/self/core/verification-worker.js`, `/self/core/vendor/acorn.js` and `/self/core/vendor/ACORN-LICENSE.txt`, and the module inventory keeps the `core/...` paths this blueprint owns.

### 2. What is implemented

There is no `ModuleIntegrity` module, no HMAC signing and no signature file. Integrity is enforced by SHA-256 byte binding at four points:

| Point | Mechanism |
| --- | --- |
| Verifier answer | `VerificationManager` hashes each file it sends; the Worker hashes what it received and returns `verification: { kind: 'static-worker', fileHashes }`. A missing kind or any hash difference is `Worker source hash mismatch` and fails ([0x000040](0x000040-verification-manager.md)). |
| Tool staging | `ToolWriter` keeps a private approval keyed by a frozen receipt object and re-hashes the written file; `assertVerified` fails if the bytes changed ([0x000015](0x000015-dynamic-tool-creation.md)). |
| Module import | `loadVfsModule({ expectedSha256 })` (`self/core/vfs-module-loader.js:175`) hashes the bytes it is about to import and throws `Approved module source hash mismatch`. A pinned load never reuses a pending path-only import. |
| Promotion | `self/core/promotion-policy.js` exports `sha256` and `getEvidenceHash`; promotion evidence records hashes of the candidate, and a `clockwork` authority claim must carry a receipt whose digest matches a trusted receipt ([0x000080](0x000080-core-promotion-policy.md)). |

### 3. The verifier as a fixed input

- `verification-worker.js` is a classic Worker that loads Acorn 8.15.0 with `importScripts` and parses with `ecmaVersion: 'latest'`, `sourceType: 'module'`. A missing parser throws `Verification parser is unavailable`; the Worker never falls back to rewriting or running the candidate.
- On the `x` and `zero` surfaces the Worker is started from `/<surface>/__verifier__/worker.js`, and the Service Worker (`self/host/sw-module-loader.js`) maps that alias and `/<surface>/__verifier__/acorn.js` to `/core/verification-worker.js` and `/core/vendor/acorn.js` in that instance's VFS. With `requireVerification`, the manager refuses to start the Worker unless the controlling Service Worker is the matching active lab registration.
- Agent tools cannot write `/core/` paths: `self/config/vfs-policy.js` limits tool writes to `/shadow`, `/artifacts` and `/cycles`. Promotion quarantines changes to validators: `isValidatorMutationTarget` covers `/self/core/verification-*`, `/self/testing/arena/`, `/self/infrastructure/policy-*` and listed files such as `verification-manager.js`, `promotion-policy.js` and `tool-runner.js`.

### 4. Incomplete boundary

- `/self/core/vendor/acorn.js` is not in the validator quarantine list or prefixes, so a promotion that replaces the parser is not quarantined as a validator change.
- Byte binding proves that the checked bytes and the loaded bytes are the same. It does not prove who wrote them; there is no signature or key.
- Most loads pass no `expectedSha256`; only approval-bound loads (tool activation, `loadPath` with a hash, substrate loads with a hash) are pinned.

### 5. Verification

`tests/unit/verification-worker-prototype.test.js` runs the real Worker source; `tests/unit/tool-verification-gate.test.js` exercises the hash-bound tool gate end to end. No test covers the `expectedSha256` mismatch in `loadVfsModule` directly.
