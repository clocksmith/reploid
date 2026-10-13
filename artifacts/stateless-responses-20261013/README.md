# Stateless text Responses compatibility

This checkpoint adds an explicitly mounted `POST /v1/responses` adapter to the
installed native entry. It borrows the existing automatic requester, authentication,
disclosure and generation owners. It does not mount an anonymous server, create a
response store, change the runtime pin or generate token usage estimates.

`store:false` is required. Text input/history and optional instructions reach the
same immutable authorized request. Sampling, tools, structured output, prior IDs,
conversation/background and caller token overrides are explicitly rejected.
Stop/EOS produces `completed`; an actual output-token limit produces
`incomplete/max_output_tokens` with no completion timestamp. Context limit and
unknown termination produce explicit errors, never a fabricated successful or
output-budget terminal response. Both protocol adapters share HTTP admission for
the same borrowed participant and retain unresolved requests after disconnect.

Evidence:

- `protocol-freeze.json`: event and terminal contract recorded before implementation,
  official documentation links and the installed SDK declarations hash.
- `tests.txt`: 75 passing Responses, Chat Completions and native host composition
  controls. Mounted Responses tests reach the real automatic requester, grants,
  peer owners and three injected numerical stages; recipient denial dispatches
  zero stages. No physical GPU work is represented by these controls.
- `native-regressions.txt` / `native-delivery.txt`: native lifecycle and existing
  package closure controls. `types.txt`, `charters.txt`, `worker.json` retain source
  checks; actual Verification Worker passes with warnings preserved.
- `source-freeze.json`: clean committed base plus exact owned overlays used by the
  existing `packageNative` tool. `package-before-doc-correction.json` preserves the
  intermediate package before a documentation wording correction.
- `native-package.json`: final ordinary native archive and descriptor. Installed
  source/runtime bytes are checked against all descriptor/archive members by
  `installed-consumer.mjs`, not merely by package version.
- `installed-result.json`: official OpenAI SDK 7.32.0 uses the installed public
  native export over loopback. Nonstream, typed stream, stream accumulator,
  incomplete output, errors, cancellation and Chat Completions regressions pass.
  The SDK dependency remains isolated from the published native package.
- SDK package/lock bytes are retained in the neighboring
  `../text-chat-completions-20261013/sdk-package.json` and `sdk-lock.json`; the
  result records their actual installed lock hash.

Reproduce from this checkout:

```sh
npx vitest run tests/integration/responses.test.js tests/integration/chat-completions.test.js tests/unit/ordered-host-composition.test.js --exclude '**/.deployment-checkouts/**' --reporter=verbose
node artifacts/stateless-responses-20261013/verify-worker.js
node artifacts/stateless-responses-20261013/installed-consumer.mjs artifacts/stateless-responses-20261013/native-package.json /var/tmp/reploid-text-api-20261013/consumer-final /tmp/responses-installed-result.json
```

The installed proof uses injected numerical text and no GPU/cloud calls. Neither
ordinary canonical publication, physical inference nor coding quality is qualified
by this checkpoint. Anthropic Messages and tool/structured-output compatibility
remain unimplemented. The existing accepted runtime pin and public processes are
unchanged.

Component: hosted services / installed native HTTP adapters. Intent: preserved.
Boundary effects: server protocol projection and native public export only; the
actual requester remains computation and lifecycle owner.
