# Runtime assets and public discovery release — 2026-09-23

## Deployed identity

- Application: https://replo.id (Firebase site `reploid`).
- Release snapshot: `18b27b9fa5bc5a9d774db9e9c99836c2c12ea446`.
- Cloud Build: `f73719ff-aa95-4de6-b821-59e621abf682`, SUCCESS.
- Cloud Run: `reploid-pool-00106-4wf`, 100% service traffic, maximum one instance.
- Direct rendezvous: `wss://reploid-pool-kbxuhkisna-uc.a.run.app/swarm`.
- Image digest: `sha256:67a7195282f84628014256a093d78117e4c44655ab54cfba945ad013c707cfc4`.
- Coordinator runtime: `sha256:9f738d12e2aa0c01d65b431e3c724a378534253f2206f08241d3303338d279a5` (2,738 files).
- Browser bundle: `sha256:267eb545c4292a7a19dd627be484fed761bae0e8193f1cbeddeab0bec7ae97dd` (2,677 hashed files, plus descriptor).

The release was built from a clean detached snapshot. The original branch remains
at `1b6e50e`; working-tree edits were preserved and nothing was pushed. The snapshot
is retained in the `release-final` worktree under the temporary
`reploid-swarm-release-IGccQr` directory. An earlier build was cancelled before its
deploy step after a stale generated inventory hash was detected.

## Acceptance evidence

- Exact 2,157,914-byte Doppler archive matched the lockfile SHA-512. All 1,864
  shipped files are present in the release; Docker verified and cached that same
  archive before `npm ci`, without changing dependency declarations.
- 125 focused Vitest assertions passed across 13 unit/integration files; 9 Node
  bootstrap tests passed. They include capability isolation, origins, limits,
  failed acknowledgements, async negotiation failures and disconnect races.
- 10 Playwright checks passed: desktop/mobile light/dark workspace states,
  injected-execution persistence, import boundaries and Verification Worker checks.
  Mutable modules passed; privileged bootstrap storage remains rejected as a
  mutable candidate. No sandbox privilege was broadened.
- Runtime configuration, layer boundaries, library types and 37 component charters
  passed. Registry audit: zero unresolved issues. Its 18 modules without individual
  architectural blueprints remain informational inventory, not unresolved owners.
  A second complete generator run was byte-identical.
- `npm run smoke:swarm-bootstrap -- --url https://replo.id` passed: complete browser
  runtime/tooling imports, 296 WGSL fetches, normal automatic public WebRTC startup,
  private isolation, contribution off, and disconnect persisted through reload.
- `node scripts/verify-browser-bundle.js --url https://replo.id` verified every
  declared served file byte-for-byte. JavaScript MIME type was correct; a missing
  module returned HTTP 404 rather than a successful application fallback.
- Direct production WSS join acknowledgement passed; absent/spoofed origins were
  rejected with HTTP 403. `/pool/deployment/check` returned `ok: true`, with exact
  snapshot/image/runtime identities, through both direct backend and Hosting URLs.
  All nine deployed Firestore composite indexes were READY; none were changed.

## Scope and remaining qualification

Component: pinned runtime delivery, browser swarm lifecycle and hosted discovery.

Intent: deliberately changed startup to automatic bounded public discovery;
preserved independent conversations, presentation and all resource/disclosure grants.

Boundary effects: Reploid composes lifecycle and placement; Poolday transport moves
authorized data; Doppler remains the execution owner. Discovery does not authorize
input sharing, compute, file distribution or improvement adoption.

The live test used three isolated browser contexts on **one physical machine**.
Two-physical-device WebRTC acceptance, especially across different networks, remains
pending. Model generation, LoRA application and layer splitting were not exercised
and are not qualified by this release. The dependency installation reported three
moderate advisories; dependency versions were not changed by this repair.
