# Published Doppler 0.6.1 integration

Reploid now pins the registry package, browser URLs and enabled ESM-2 runtime
identity to `0.6.1`. This is a locally validated application candidate. No
production deployment or npm publication was performed during this follow-up.
The [September 8 record](../README.md) remains historical candidate evidence.

## Exact inputs

- Reploid base: `659c0d7b546fd51a140cdbf6bcb80d5f297d041e` on
  `codex/doppler-061-deployment`.
- [Tested file hashes](candidate-files.json) bind all changed implementation,
  configuration, generated inventory and test files.
- Published archive: `https://registry.npmjs.org/doppler-gpu/-/doppler-gpu-0.6.1.tgz`.
- Archive SHA-256: `96d2699a3e677815890f804459c023bea4fb2e2a1a59d157b5b6a04c9e573d5f`.
- Registry integrity:
  `sha512-4KvROg0SLUxkdaWNqIAw4JJ+1bhWX8in3Q5XMPlvZp8SWdo0E4q7gw8s6bgYqEq2Ib7k+tvomRudFUMKF+05SQ==`.
- [Installed package comparison](package-comparison.json): all 1,784 files match
  the registry archive byte for byte.
- Browser inventory: 651 files,
  `sha256:ff7afe61f6c7b4f0513548d695ea1ee712990c598e129120f14dd583396407bf`.

The registry archive differs from the September 8 retained archive in 34
conversion/source-package JSON files. Runtime JavaScript and WGSL are identical.
The published Qwen 3.5 9B f16 conversion recipe still contains two stale kernel
digests. Doppler branch `fix/release-kernel-digest-validation` fixes these source
recipes and gates both source and installed-package digests. Those fixes are
unpublished and are not present in the package exercised here. This integration
does not convert that Qwen model.

## Validation

- `npx vitest run`: [2,506 passed, 36 skipped](unit.log), across 211 passing and
  three skipped files. Runtime synchronization now rejects enabled model pins
  that differ from the browser runtime, without silently rewriting their
  identities. Disabled model pins remain unchanged.
- `DOPPLER_TEST_CONSUMER=<this checkout> DOPPLER_TEST_CHECKOUT=<Doppler 9df46c39>
  node tests/fixtures/doppler-installed-generation.js`: [passed](installed-contract.json),
  17 phase calls, 17 releases and two closed sessions. The signed test fixture
  injects logits; it is API-contract evidence.
- [Published browser API import](published-browser-api.json): Chrome imports
  the configured CDN module, observes `DOPPLER_VERSION=0.6.1`, `openCapsule` and
  the public generation contract.
- `REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test
  tests/e2e/document-search.spec.js --project=chromium`:
  [four passed](browser-documents.log), including Verification Worker and
  persisted release checkpoints. Model outputs are injected.
- `REPLOID_E2E_ACTUAL_INFERENCE=1 REPLOID_E2E_CHROMIUM_CHANNEL=chrome
  npx playwright test tests/e2e/p2p-actual-inference.spec.js --project=chromium
  --grep 'empty room falls back' --timeout=180000`:
  [one passed](physical-esm2.log). The real signed ESM-2 Capsule loads its weights,
  executes locally in Chrome/WebGPU, returns 480 embedding dimensions and
  restores the result after reload. The [retained receipt](esm2-local-receipt.json)
  binds runtime `0.6.1`; its hash is
  `sha256:fc36cc80b53a836cdf3884d4b1051a3f23c1e5e800207b4e9da2351932a53bf6`.
- `npm run verify:runtime-config`, `verify:doppler-generation`,
  `verify:browser-bundle:local`, `verify:module-system`, `verify:catscan` and
  `verify:layers`: all passed on the final configuration.

The physical run uses the bucket-approved origin `http://localhost:8000`, local
relay discovery and a public test sequence. It does not share compute. This
smoke verifies local execution and persistence, not numerical parity, semantic
quality, independent peers or deployed production behavior.

## Preserved failures

The [initial physical attempt](initial-version-mismatch.log) rejected the old
ESM-2 `0.6.0` pin. Its explicit update and the new configuration regression gate
fix that mismatch. A subsequent attempt exhausted the `/tmp` user quota;
validation moved to an isolated `/var/tmp` directory. Port 8061 then encountered
an [origin rejection](origin-rejection.log). [HTTP observations](artifact-origins.json)
confirm that the bucket permits port 8000 and rejects 8061. The passing run uses
the permitted origin without bypassing CORS or changing the bucket.

Component: Reploid runtime integration and deployment configuration.
Intent: preserved.
Acceptance evidence: the commands, logs and receipts above.
Boundary effects: explicit package, browser-runtime and enabled ESM-2 version
pins; production activation remains separate.

*Last updated: September 2026*
