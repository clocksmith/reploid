# Durable canonical stage evidence

Component: conversation publication. Intent: preserved. This source-only opt-in extends the existing transaction owner; it does not activate RD-CANON or replace the accepted package.

`requireCommitEvidence: true` binds exact signed stage envelopes to the publication acknowledgments and persists that requirement in attempt admission. The publication, evidence digest, evidence and receipt commit together. Inputs are privately copied before asynchronous verification. Restart replay uses retained envelopes and verifies them again, without a live signature lookup or signer. An explicit legacy owner cannot downgrade an already admitted required-evidence attempt. Admission-only output stores an empty evidence array without fake execution acknowledgments.

`tests/canonical-publication-evidence-source.js` exercises actual Doppler target transitions, WebCrypto signatures and transaction fault injection: restart, concurrent duplicate publication, invalid/missing/duplicated proof, forged signatures with recomputed hashes, caller mutation, corrupted retained records, cancellation, revocation, writer takeover and uncertain storage completion. `before.log` retains the first regression: the old owner cannot pass supplied evidence to the real verifier and rejects with `Unauthenticated stage commit`; the new required-evidence contract first rejects absent proof explicitly, then accepts/verifies/persists genuine supplied proof. `after.log` retains the completed controls.

`browser.log` records four actual Chromium tests with `--disable-gpu`: real IndexedDB transactions and close/reopen, signed evidence revalidation after signing authorities close, corruption refusal, existing transaction races, and the actual Verification Worker. No GPUDevice, weights or inference was used. `browser-before.log` preserves one harness false negative: insertion-order `JSON.stringify` equality failed because existing `snapshotJson` sorts object keys. Deep structural equality now checks every retained value, while cryptographic hashes/signatures continue to pass without modification.

`legacy-source.log`, `legacy.log` (41 tests), `types.log`, and `worker.json` retain existing source-contract, workspace/session/charter, declaration and actual Worker checks. Worker passed with three warnings. `mirror.log` records library-only generation; no combined application manifest, catalog or pin was changed.

Reproduce from Reploid:

```sh
DOPPLER_SOURCE_ROOT=/Users/xyz/deco/doppler node tests/canonical-publication-evidence-source.js
DOPPLER_SOURCE_ROOT=/Users/xyz/deco/doppler node tests/canonical-publication-source.js
DOPPLER_SOURCE_ROOT=/Users/xyz/deco/doppler npx playwright test --config artifacts/canonical-publication-evidence-20261012/playwright.config.mjs
npm run verify:library-types
```

Boundary effects: optional fourth `authenticateCommit` argument supplies the exact envelope, `publish` accepts evidence, and durable records retain it. Existing legacy callbacks/publications remain compatible. This proves the publication/storage boundary; ordinary runner/conversation/UI integration and exact-package physical qualification remain separate work.
