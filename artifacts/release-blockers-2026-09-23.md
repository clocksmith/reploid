# Reploid release blockers: 2026-09-23

Component: browser-library delivery and Doppler loader boundaries.
Intent: preserved. Reploid places computation; Doppler owns tensor codecs and
numerical comparison; Poolday transport is unchanged.
Boundary effects: the partition runner and parity helper now require an explicit
host-supplied `runtime`. The mesh import no longer imports Doppler. Provider
fallback no longer clears host-owned localStorage.

## Pull and repairs

`bash /Users/xyz/deco/rdpull.sh reploid` aligned with origin/main at
`1b6e50ebdf2fae358b5645b02515f8b6baae7acf`; pre-existing edits were preserved.

- Removed the partition runner's eager package import; added missing-runtime
  regression coverage and retained the Doppler-owned codec/comparison tests.
- Regenerated `self/vendor/reploid` from canonical library source.
- Updated exact dynamic-loader declarations to match their host-owned sources.
- Removed direct provider localStorage mutation after Verification Worker
  reproduced that boundary violation.
- Registry-audit generation parsed successfully, was byte-identical on its
  second run, and reported zero unresolved issues.

## Acceptance evidence

- 64 focused unit tests passed across partition, layer, provider, runtime,
  base-resolution, chat, charter and style suites.
- 9 Chromium tests passed: conversation presentation/persistence, inert mesh
  import without a Doppler import map, and Verification Worker checks.
- Library TypeScript checks and layer/loader/canonical-delivery checks passed.
- Two release-boundary browser tests passed against the deployed site.
- Firebase Hosting deployed; Cloud Run was unchanged.
- `node scripts/verify-browser-bundle.js --url https://replo.id` verified all
  808 served files as
  `sha256:e0f296a8430ea74c00ea33e28d950a16778de86b12851074d874bbf8471d3910`.

These checks do not establish model inference or qualified split execution.
The partition tests use injected execution and actual Doppler codec helpers.

## Actual live inference check: failed

A fresh Chromium WebGPU browser imported the deployed chat host, created a
session with default runtime, no injected service, no persisted history and no
swarm, then sent `hi`. The attempt transitioned queued -> loading -> failed:

```
Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/doppler-gpu@0.6.2/src/index.js
```

The answer was empty; the session and browser closed. This was a terminal failed
attempt, not an ongoing retry. Production has no localhost recovery fallback.
An independent HTTP check returned 404 for that URL; `npm view
doppler-gpu@0.6.2 version` returned E404. The installed package reports 0.6.2,
but that does not prove published artifact availability or provenance. No
Doppler publication, version downgrade or replacement artifact was performed.

The earlier `7c7db224` handoff is not the current source baseline. Current code
pins 0.6.2 and includes a scheduler/capsule path, but still maps discovered models
to `provider: 'peer'` while execution requires `doppler`, copies requested
identities into completion, and conditionally skips adapter application when
the session lacks `setAdapters`. Those require verified catalog/execution
integration; this release repair does not qualify them.
