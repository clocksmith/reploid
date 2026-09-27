# Hosting deployment: September 25, 2026

User explicitly requested deployment after the implementation handoff.
Firebase Hosting deployment and live verification completed around 13:26 UTC.

- URL: https://replo.id (Firebase site https://reploid.web.app).
- Target: `hosting:reploid`, project `reploid`.
- Browser bundle: `sha256:c46b08204868c3747c176c8a9843aaa1757bb8e067bd4d231141c14e5ebeef36`.
- 2,688 declared files verified byte-for-byte on the custom domain. Hosting
  uploaded 2,689 files including the bundle descriptor itself.
- Source: baseline `f45d1c1632127c3961adfb45c1b0d2c2250c6100` plus the preserved
  uncommitted source overlay in this directory. No commit or push performed.
- HTML boot marker remains `2026091901`; the exact bundle hash, not that reused
  marker, identifies this Hosting release.

## Commands and results

```sh
npm run verify:runtime-config
npm run verify:layers
npm run verify:browser-bundle:local
node scripts/validate-registry.js
git diff --check
firebase deploy --only hosting:reploid --project reploid --non-interactive
npm run verify:browser-bundle -- --url https://replo.id
npm run smoke:swarm-bootstrap -- --url https://replo.id
```

All passed. The live smoke test imported the pinned Doppler 0.6.2 module graph,
loaded all 296 shaders, and confirmed missing runtime modules return 404.
Ordinary application startup automatically established public WebRTC peer
connections with compute contribution off. A private namespace stayed isolated;
manual disconnect prevented rejoin and survived reload.

The smoke used three isolated browser contexts on one physical machine and
performed no inference. It does not close the disk-blocked three-tab real
model/adapter journey, signed complete-job qualification or layer splitting.

## Unchanged backend

Read-only Cloud Run inspection confirmed `reploid-pool-00106-4wf` is the latest
ready revision and receives 100% traffic. Existing tagged revisions receive no
percentage of production traffic. No backend, functions, Firestore rules/indexes,
authentication or TURN configuration was deployed or changed. This is a
Hosting-only release, not a newly matched full Poolday backend/browser qualification.

Component: browser Hosting delivery. Intent: preserved.
Acceptance evidence: deployed file hashes and live smoke results above.
Boundary effects: browser delivery only; existing backend retained.
