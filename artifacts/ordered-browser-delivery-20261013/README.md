# Regenerated ordinary browser delivery

Component: generated browser library assets. Intent preserved. The existing
`sync-reploid-library.js` generator copies all 207 canonical library files,
including ordered routes, settlement receipts and actual completion reasons.
The existing browser manifest generator binds 1,932 served files. The accepted
Doppler archive and public deployment remain unchanged.

`verification.json` verifies every copy against its canonical source, declared
length and SHA-256. The actual Verification Worker checks 21 changed JavaScript
modules at their real browser paths. Warnings remain recorded; no policy was
changed. Source checks and the repaired owner boundaries are retained in
[the boundary receipt](../ordered-boundary-repair-20261013/README.md).

The bundle hash is recorded in `verification.json`. Regeneration is delivery
preparation, not publication, signed eligibility, physical execution or deployment.
This keeps the checkout's application copies synchronized while the separate
runtime candidate undergoes qualification.

Reproduce with `node scripts/sync-reploid-library.js`,
`node scripts/build-browser-bundle-manifest.js`, and its `--check` mode.
`verify.js` records changed-file Worker evidence before committing generated
assets; its source-copy comparison always covers the complete inventory.
