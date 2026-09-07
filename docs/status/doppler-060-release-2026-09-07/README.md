# Doppler 0.6.0 release continuation

Published `doppler-gpu@0.6.0` is now the exact Reploid npm and browser runtime pin. The lockfile integrity, jsDelivr module/storage/kernel URLs, Pool configuration, deployment declarations, and generated browser bundle agree.

The Doppler publication receipt in `doppler/reports/release-qualification/0.6.0-20260907/publication/` binds the published archive to qualified source `52f5961a`. A fresh registry install verified all 1,779 files byte for byte, all 28 package exports, browser tooling, CLI help, and the synthetic Node provider. Chrome imported the actual CDN runtime and reported version 0.6.0 with public `openCapsule`; the checked CDN entry, storage, tooling, and kernel bytes matched npm.

Local Reploid checks passed 2,436 tests with 35 skips before the browser fixture correction. The corrected fixture supplies Capsule v3 lifecycle data and uses real IndexedDB checkpoint persistence. Its 18 focused regressions and all four Chrome document checks passed afterward, including desktop/mobile layouts and the Verification Worker. Model outputs and Doppler verification in those document tests are synthetic. The initial browser failure remains in the archive.

`receipt.json` binds the exact candidate and archive. The deployed-release verifier passed the local bundle gate, then failed because `https://replo.id` still serves a different bundle. No deployment was performed. The matching [GitHub CI run](https://github.com/clocksmith/reploid/actions/runs/34126100888) passed for `0823357e`.

A direct installed-runtime check then found another unresolved release boundary: the enabled ESM-2 entry uses `full_model_browser_sequence` and has no `executablePack` binding, so it selects `dr.open`. Published 0.6.0 exports `openCapsule` and no `dr.open`; the actual Reploid runtime service rejects preparation. `enabled-model-api.json` retains that mismatch. The retained ESM-2 Pack proof uses development authority and the old Pack schema, with Node-only qualification. It is not an admitted production Capsule. The repin is therefore an unqualified release candidate: production needs a newly signed, browser-qualified ESM-2 Capsule and exact catalog binding before deployment. Passing fixture tests and CI do not close this API migration. Production qualification, physical model requalification and semantic answer review, useful specialization, independently operated machines, and AMD startup diagnosis remain open. Learned scheduling and distributed MoE remain inactive.

Component: `reploid` runtime configuration and verification evidence. Intent: preserved. Acceptance evidence: `receipt.json` and `evidence.tar.gz`. Boundary effects: published Doppler dependency and browser/deployment configuration pins; no catalog admission or production activation.

*Last updated: September 2026*
