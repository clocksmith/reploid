# Source-validated embedding after introducer loss

One signed embedding job passed from a weightless Mac requester to an AMD/Linux
provider over authenticated introduced WebRTC channels after their introducer
was removed. Company signaling and external HTTP requests were blocked. This
extends the existing introduction and signed-job fixtures, using the existing
job protocol on the bounded, reliable `reploid-jobs` auxiliary channel.

The Linux provider used **diagnostic Doppler archive `414f61c37e21c07e481c5685afacd24eb93ae98d02e1c0c5a7fdd4010c820e13`**.
The standard 0.6.27 archive `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`
was unchanged. This is complete embedding-job acceptance for this fixture,
not signed resident generation, ordinary distributed chat, or standard-release
acceptance. No model conversion, release renewal, public endpoint, or deployment
was introduced by this test.

## Executed boundaries

- One operator, two physical hosts: Darwin arm64 Google Chrome requester;
  Linux x86_64 Chromium provider with AMD Radeon 8060S Graphics (RADV STRIX_HALO).
- Existing signed Qwen3-Embedding 0.6B F16 application; frozen independent
  reference `be4ed910a95a6e7ed26cfe7ce39d539760187698d7f8703a106afbabcdc46772`,
  original input positions 0, 1, 2. Exact token sequences and all 3,072 vector
  components passed. Maximum absolute error **0.00006299838423728943**, below
  the existing embedding policy **0.02**. Generation tolerance remains **0.001**.
- Managed signed eligibility event 2 was validated by the existing release owner
  at execution. Retained-local permission was not substituted for delegation.
  Recorded eligibility does not establish indefinite future availability.
- Model opening, input disclosure, and computation had separate explicit grants.
  Missing disclosure rejected; denied computation produced zero executor calls.
  After computation approval, exactly one signed assignment executed.
- The observed tracked buffer allocation peak was **1,248,138,752 bytes**, below
  the **1,420,000,000-byte** fixture ceiling. This is tracked allocation evidence,
  not total physical memory or an allocator-enforced global budget.
- The requester made zero Capsule/weight requests. No external HTTP was used.
  SSH forwarded the fixture HTTP and browser-control endpoints; application
  requests and results crossed actual WebRTC data channels.
- Provider session, owned browsers, Mac profile, and owned SSH tunnel were closed.

Bootstrap invitations were supplied through explicit fixture routes. This does
not prove public discovery, arbitrary NAT traversal, independent customer use,
or full ordinary chat acceptance. The existing physical transport checks are
retained separately in [physical-20261011](../physical-20261011/README.md).

## Failures retained

The first physical attempt expected a remote authorization error for a denied
provider admission. Existing provider policy intentionally reports that error
locally without replying, so the requester reached its unchanged deadline.
The complete failed report and log are retained. The corrected negative control
observes the provider's denial and zero execution, then explicitly cancels that
request before granting computation. No deadline, permission, or numerical
threshold was relaxed.

The first repository command passed a worker argument to `npm test`, whose
wrapper rejects it. Its output is retained. The underlying configured Vitest
run then exposed a unit test racing real signature verification against a 10ms
bootstrap deadline. That test now explicitly drives timeout signals and checks
that both route deadlines still use the same 10ms policy. Production timeout
behavior is unchanged; the full failed and passing runs are retained.

## Validation and reproduction

- Full configured Vitest: **3,015 passed, 29 skipped**.
- Chromium introduction and signed-job controls: **19 passed**, one physical test
  conditionally skipped in the ordinary run and separately passed on Mac/Linux.
  Verification Worker checks were included.
- Installed-package checks: **17 passed**, archive
  `eb62696ceb7cd28ff41f096884d861b1456cab4c9f59cedc58125e1448d0dc8f`.
- Public declarations, including accepted and rejected auxiliary labels, passed.
- Browser manifest verified all 1,901 served files, bundle
  `e683fbc5c7c9ec4a01e961f2c6a740f62f4b8512a24ceef4d420f149bd64a675`.

Run the existing Playwright spec with `REPLOID_E2E_SKIP_LOCAL_SERVER=1`,
`REPLOID_EXECUTOR_CDP=1`, an explicitly owned Mac browser WebSocket in
`REPLOID_EXECUTOR_WS`, a forwarded `REPLOID_INTRODUCTIONS_PORT`, and the qualified
managed embedding configuration in `REPLOID_UNITS_PHYSICAL_CONFIG`:

```sh
npx playwright test --config tests/playwright.config.js tests/e2e/peer-introductions.spec.js --project=chromium --grep 'source-validated embedding'
npx vitest run --config tests/vitest.config.js --maxWorkers=4
node tests/library-package-acceptance.js
npm run verify:library-types
npm run verify:browser-bundle:local
```

[bindings.json](bindings.json) records exact source and evidence hashes.
`embedding-observation.json.gz` includes complete job inputs, assignment, outputs,
source comparisons, release checkpoint, allocation counters, and transport
counters. Both complete Playwright reports are retained. The installed evidence
archive preserves every generated file, including the exact package; each
archived file was compared with the original before moving the duplicate working
directory intact to ignored `reports/local/introduced-embedding-20261011/library-acceptance/`.
