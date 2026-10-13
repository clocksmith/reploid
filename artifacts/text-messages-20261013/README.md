# Stateless text Messages with authenticated caller limits

The installed native public `createMessages` export serves the declared text subset at `/v1/messages` through a borrowed automatic requester. The host explicitly mounts it and supplies authentication plus execution/disclosure authorization. Default CLI/public endpoints and the accepted Doppler pin are unchanged. This is ordinary execution, not canonical durable-publication acceptance.

The caller's positive bounded `max_tokens` becomes the immutable `generationRequest` approved with exact messages/model/attempt. Actual tokenization precedes generation; the lower maximum enters the existing generation digest and signed grants, and the existing resident enforces the reduced allocation. Capability discovery rejects older routes before dispatch. Canonical requests do not acquire this option implicitly.

`raw-model-tokens/v1` counts actual model-template input IDs and raw sampled output IDs, including an invisible terminal token. It does not assert Claude tokenizer, billing, caching, or hardware-attested usage equivalence. No counts come from visible text. Streaming requires one bound input-usage observation before deltas; final counts agree with the sampled-step summary. A published usage/delta prevents silent retry into another attempt.

## Evidence

- `final-tests.txt`: 211 passing controls across seven focused suites, including real authenticated grant/peer/entry/facade composition with injected numerical stages, HTTP protocols, legacy admission and cleanup.
- `review.json`, `independent-review-tests.txt`: independent 158-control source/HTTP review. The separate wrong-environment receipt is retained.
- `usage-count-before.txt`, `disclosure-before.json`, `late-delta-before.json`: genuine failing-before observations. Permanent tests now reject altered final counts, output without exact completed disclosure, and callbacks after terminal completion. Final-only text is validated before fallback emission.
- `worker.json`, `types.txt`, `charters.txt`: actual Verification Worker, declarations, and charter checks. Every changed production JavaScript file is included in Worker inputs.
- `layers.txt`: shared checkout has only expected generated-delivery drift; root owns its later regeneration. `isolated-sync.txt` and `isolated-layers.txt` show the existing generator and layer verifier passing in the separate exact source export. No shared generated browser files were changed.
- `native-package.json`, `source-overlay.json`: existing `packageNative` output from a clean committed export plus enumerated exact owned source overlays. Native archive SHA256 `b47d5c8462aea21a9048cc89227c0e9cb45bea9ef8a13587f1662efabe81cf75`; descriptor `5fc71a7d9e67665ef9d7e6cddc3425d74a8e21a94ff0761f5a4d2f9d4fdb3824`; 113 native files. Accepted runtime0.6.27/archive9280ead5 remains unchanged, with1897 installed runtime files compared.
- `installed-consumer.mjs`, `installed-result.json`: actual official `@anthropic-ai/sdk`0.133.0 against a local explicitly mounted installed adapter: nonstream, typed events, `finalMessage()`, cap1, empty visible output, parameter rejection, abort with unresolved admission held. Nine injected generations; OpenAI7.32 Chat/Responses regressions also pass. No GPU, model, cloud request, or public deployment.
- `installed-review.json`, `independent-installed-result.json`: independent archive-to-installed comparison of all113 native files,1897 runtime files and13 source overlays; independent SDK rerun matches the nine-request receipt exactly.
- `protocol.json`, `sdk-identity.json`, `sdk-lock.json`: declared protocol subset, primary documentation, and exact SDK inputs.

Reproduce after installing the exact native archive with `npm ci --ignore-scripts --no-audit --no-fund`:

```
node artifacts/text-messages-20261013/installed-consumer.mjs artifacts/text-messages-20261013/native-package.json /var/tmp/reploid-text-messages-20261013/consumer /tmp/messages-sdk-result.json
node artifacts/text-messages-20261013/verify-worker.js
npm run verify:library-types
npm run verify:catscan
```

The package/consumer paths are retained local artifact locations. Numerical stages in these controls are explicitly injected. Physical model correctness, complete Anthropic API compatibility, tools, structured outputs, sampling overrides and conversation persistence are outside this receipt.

Component: hosted text adapters and partition request contracts. Intent: preserved, with explicit optional caller cap/usage capability. Boundary effects: authenticated requester, entry, generation grant and public native composition; no Doppler source/default policy or public pin changes.
