# Product closure evidence, 2026-09-07

The document assistant now accepts an explicit lack-of-evidence answer, requests support for each factual sentence, and retains retrieved/reranked passages, generation inputs, claims, references, and failed answers for review. Citation syntax remains distinct from semantic support. Local executor metrics record preparation, loading, reuse, switching, release, and execution without changing the one-session policy.

`npm run test:ci` passed 2,436 tests with 35 skipped. Four physical-browser UI/Verification Worker checks passed using fixture model outputs on desktop and mobile viewports. These are application contracts, not model-quality evidence.

The fresh-browser startup probe made exactly one adapter request in each of 20 independently launched Chrome processes on one Apple GPU machine; all completed a small WGSL dispatch. Median startup was 374.7 ms; p95 was 407.8 ms. Requiring AMD on the Apple machine failed at adapter selection as intended. Neither result diagnoses the retained AMD Chromium startup failures or proves independent operators.

The eight-case frozen answer-support corpus covers answerable, partially answerable, contradictory, and unanswerable questions. It has not received physical model execution or independent semantic review. No answer-quality pass is claimed.

## Retained evidence

`receipt.json` binds `evidence.tar.gz`, the exact tested source files, and the browser bundle. The archive includes the full unit/coverage log, focused tests, successful desktop/mobile contracts, the earlier failed browser contract, and all startup attempts. Inspect the archive hash before extracting; it contains no private user documents.

## Open release and physical boundaries

Doppler publication remains blocked by npm HTTP 401; Reploid still pins 0.5.1. The modified 644-file bundle is not the deployed 640-file bundle. A clean package candidate is not a public npm install. Independent machines/operators have not been supplied. Useful adapter promotion, physical answer faithfulness, model-residency improvement, independent operation/adoption, and AMD diagnosis remain open. Learned scheduling and distributed MoE have not been activated.

Component: `reploid` (document search, local Pack execution, acceptance tooling). Intent: preserved. Acceptance evidence: archived commands and observations above. Boundary effects: local answer audit and executor observation fields; disclosure, consent, remote admission, runtime dependency, and production deployment are unchanged.
