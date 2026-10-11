# Physical independent-unit acceptance

The same installed `reploid/jobs` coordinator and requester aggregate journal
execute the existing signed Qwen3-Embedding-0.6B Capsule through ordinary signed
jobs. Every operation retains its non-null assignment. Existing release history
is verified through Reploid's durable anti-rollback storage; current signed
eligibility event 2 permits these assignments. Retained-local authorization was
not used for delegation. The Capsule, application, weights and frozen independent
source reference are unchanged.

`accepted-results.json.gz` records the successful final run. Eighteen source
texts become six three-text units. All 36 independent checks pass: exact token
IDs and every vector component within the existing **0.02 embedding tolerance**.
Maximum absolute source difference is **0.00007295608520507812**. This embedding
policy does not alter the separate **0.001 generation tolerance**.

One Linux AMD GPU executes two logical provider identities. This is one
operator and one physical machine, not cross-device reproduction or deployment.
The observed buffer-pool peak is **1,251,218,944 bytes**, below the declared
**1,420,000,000-byte** allocation ceiling. This measures tracked Doppler buffer
allocations, not all physical GPU or process memory. Job capability metadata
uses that explicit bound and the exact Capsule artifact storage size.

The requester commits one unit. A second provider result is durably committed
before its entire response stream is deliberately dropped. After replacing the
browser process, the requester reconstructs progress from IndexedDB and reuses
the retained signed attempt. The provider replays its committed result without
executing it again. Another provider identity completes the remaining units in
reverse order. Final vectors preserve original input order, and duplicate
completion adds no second result. Calls before restart are `[2, 0]`; after
restart they are `[0, 4]`.

A separate parent commits one unit, then cancels its next unit after a real
GPU-produced partial result. The committed unit remains retained; the cancelled
parent cannot accept the later result or disclose a complete aggregate. The
test awaits the provider's owned settlement through `close()`, then a fresh
authorized parent completes another unit. No arbitrary cleanup sleep is used.

The shared output projection now requires `read` authorization for all complete
results, including idempotent creation, existing-unit execution, final commit,
and cancellation of a completed parent. Five native-browser contract scenarios
cover these paths plus superseded writers, conflicting delivery, bounds and
expiry. A denied disclosure does not roll back a durable accepted outcome.

Validation: six combined browser scenarios pass in attempt 4; attempt 5 extends
physical cancellation and passes. All 17 installed-package checks pass.
`npm test` on the combined tree passes **3,003 tests**, with **29 skipped**.
`updated-installed-acceptance.tar.gz` retains the exact Reploid archive and full
installed report. `bindings.json` names both installed archive digests. Doppler's
test archive contains the additive independent-input declaration; the ordinary
standard archive and application package pin remain unchanged.

Development failures remain retained. Attempt 1 rejected incorrect test
capability identity. Attempt 2 exhausted its bounded delivery retries while the
test dropped the completed stream; the corrected interruption explicitly closes
and restores the requester after provider commit instead of assuming retries
remain after GPU execution. Attempt 3 passed before the read-permission review;
attempts 4 and 5 include that correction. The old failures are not reclassified
as passing or hidden by higher retry or memory budgets.

Reproduce through the existing test file, setting
`REPLOID_UNITS_PHYSICAL_CONFIG` to an accepted managed Capsule configuration and
`REPLOID_UNITS_INSTALLED_ROOT` to the isolated Reploid installation. Run
`REPLOID_E2E_SKIP_LOCAL_SERVER=1 npx playwright test --config tests/playwright.config.js tests/e2e/independent-units.spec.js --project=chromium`.
Fresh signed eligibility is required when the retained event expires.

*Last updated: October 2026*
