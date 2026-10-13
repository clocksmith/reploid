# Installed text Chat Completions adapter

Component: hosted services. Intent preserved: authentication, explicit execution and recipient disclosure approval precede the existing ordinary partition requester. Native host exports the adapter and delegates `generate` to its existing automatic owner. The adapter borrows that owner; it does not close it or substitute a cloud/local model. Boundary effect: a host can explicitly mount `http.createServer(api.handle)` at `/v1/chat/completions`; neither the CLI nor standalone signaling server mounts it automatically.

## Exercised support

- `model`, text `messages` (system/user/assistant), optional boolean `stream`, one choice.
- Host-authenticated subject and separately approved exact input/actual recipient preview.
- SSE deltas, stable identity, actual stop/length termination, no invented usage.
- Disconnect/body/auth/authorization cancellation, held HTTP admission until execution settles, independent borrowed owner closure, explicit failures after partial output.
- Unsupported fields including tools, structured outputs, seed/top_p/temperature/max_tokens reject400. Responses and Anthropic routes are not implemented. Unknown terminal reason fails without a successful DONE.

`tests.txt` records39 passing source controls. The mounted handler reaches actual automatic discovery/requester, grant, entry, peer and stage owners with injected numerical text; refusal of the recipient disclosure produces no stage execution. `native-regressions.txt` records12 existing native/package controls. `worker.json` is the actual Verification Worker under its existing `/testing/` Node tooling capability, with warnings retained. Types and charters pass.

`installed-result.json` records official OpenAI JavaScript SDK7.32.0 nonstream and stream calls against the exact installed native export, plus400 unsupported-parameter and404 Responses controls. `sdk-package.json`/`sdk-lock.json` freeze that separate consumer dependency; it is not a native application dependency. The SDK calls loopback only. Numerical text is injected, no provider/model is opened, and this is not physical inference, coding quality, canonical publication or full developer compatibility acceptance.

## Reproduction and identities

`native-package.json` identifies the standard `packageNative` output. It was built in `/var/tmp/reploid-text-api-20261013/source`, exported from the Git base in `binding.json`, with only the bound native entry/adapter/docs overlays. It retains the accepted0.6.27 runtime/pin/catalog. Existing `package-native.js` copied canonical closure and made the archive; `npm ci --ignore-scripts` installed it. The consumer independently compared all109 native descriptor members and1897 installed runtime files with its bound archive before import. These inputs stay under the isolated directory; no public contributor, supply ledger or served delivery changed.

Commands:

```sh
npx vitest run tests/integration/chat-completions.test.js tests/unit/ordered-host-composition.test.js --exclude '**/.deployment-checkouts/**' --reporter=verbose
npx vitest run tests/unit/native-participant.test.js tests/unit/native-delivery.test.js --exclude '**/.deployment-checkouts/**' --reporter=verbose
node artifacts/text-chat-completions-20261013/verify-worker.js
npm run verify:library-types
node scripts/verify-catscan.js
node artifacts/text-chat-completions-20261013/installed-consumer.mjs artifacts/text-chat-completions-20261013/native-package.json /var/tmp/reploid-text-api-20261013/consumer-final artifacts/text-chat-completions-20261013/installed-result.json
```

For a copied consumer, install the retained SDK lockfile in its own directory and pass that directory as the second script argument. For an application-owned mount and port contracts see [native documentation](../../docs/native-participant.md#opt-in-text-chat-completions).

## Retained preparation limits

The attempted standalone signaling mount was removed before checkpoint. Its existing console message contains `localStorage.setItem`, which the Worker regex treats as a storage operation even inside a string; `worker-existing-literal-rejection.json` retains the first rejection and `worker-baseline.json` reproduces it on unchanged standalone source. Neither the validator nor that CLI message was changed. Both final changed server modules pass. `default-mount-expectation-failure.txt` retains the test's intermediate expectation after removing that mount; the final test correctly verifies the unchanged server returns404 and has no adapter field.

Earlier package receipts and the initial SDK lock are preparation records, not final installed proof. `binding.json`, `native-package.json`, `sdk-lock.json` and `installed-result.json` identify the final bytes.

Protocol source: official [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Full Responses/Anthropic, tool calls, structured outputs and sampling overrides remain missing product boundaries, not aliases of this text adapter.
