# Branch integration evidence

Source baseline: `a5ce2bba`. Merge decisions and exact branch tips:
[integration record](../../docs/branch-integration-2026-09-26.md).

| Evidence | Result |
| --- | --- |
| [Full Vitest run](unit.json) | 2,755 passed, 4 failed, 29 skipped. |
| [Baseline conversation tests](baseline-conversation.json) | Same 4 failures reproduced at `a5ce2bba`; 3 passed. |
| [Chromium integration](browser.json) | 21 passed: chat persistence, bounded peer jobs and native journal recovery, Zero boot/refresh. |
| [Verification Worker](verification-worker.json) | 18 merged modules accepted in an actual browser worker. |
| [Registry regression](registry-tests.json) | 9 passed, including missing/escaping genesis file declarations. |

The four full-suite failures are confined to `conversation-workspace.test.js`:
composer send eligibility, direct follow-ups, execution failure display, and
cancellation. Its fixture creates mesh-scoped threads without an execution peer
and expects automatic local execution. Both the pre-merge and merged code reject
that unsupported placement. The merge does not change conversation runtime/UI.

Additional passing checks: library types, layer/loader/cycle rules, 39 component
charters, Doppler runtime configuration, all three journey registries, 14 claim
rows, ESLint on changed runtime owners, and served browser bundle verification.
The registry reports 1,365 source files, 68 modules, 176 blueprint declarations,
98 executable owners, and zero unresolved issues. All eight generated projections
were hash-identical across two consecutive canonical regeneration runs.

Commands:

```sh
npx vitest run --reporter=json --outputFile=/tmp/reploid-branch-merge-final-unit.json
npx vitest run tests/unit/registry-contract.test.js
npx playwright test tests/e2e/chat-workspace.spec.js tests/e2e/peer-pack-jobs.spec.js tests/e2e/zero-ui-refresh.spec.js --project=chromium
npx playwright test tests/e2e/branch-integration.spec.js --project=chromium
npm run verify:library-types
npm run verify:layers
npm run verify:catscan
npm run verify:runtime-config
npm run verify:journeys
node scripts/verify-surface-claim-index.js
node scripts/validate-registry.js
npm run verify:browser-bundle:local
```

Browser peers are contexts on one physical Mac, with injected execution in the
protocol fixtures. This is not physical-network, actual generation, LoRA, or
split-model GPU qualification. No deployment occurred. Previous release evidence
is retained, and `artifacts/split-chat-2026-09-26/` remains unchanged.
