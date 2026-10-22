# External reasoning for local X

The `external` provider lets a same-machine controller, including dot using its
terminal tools, supply decisions to X. X keeps its existing agent loop, tool
execution, approval controls, verification and promotion gates. The controller
is not an execution endpoint and cannot grant itself authority.

This is a pull/reply mailbox, not a callable dot inference API. A ChatGPT
subscription is not an API credential. No model API key, paid inference or
WebGPU is needed for this provider. X still requires a modern browser with its
normal service worker and IndexedDB support; the local server requires Node 22+.

## Start and select

```sh
npm ci
REPLOID_EXTERNAL_BRAIN=true REPLOID_SKIP_CLOUD_ACCESS_BUILD=true npm start
```

Open `http://127.0.0.1:8000/x`, choose **Connected agent**, enter a goal, and awaken.
The option is available only on local X. Readiness means the mailbox is enabled,
not that a responder is connected. No goal starts automatically. Only the
external model is selected; there is no paid-provider fallback.

The mailbox is disabled by default. Enabling it binds the entire proxy process
to `127.0.0.1`. Do not reverse-proxy, tunnel or expose it to other machines. No
credentials are created. Loopback is not authentication against other local
processes: they can read pending model context and submit decisions. Use a
trusted, isolated local session and do not run it on a shared machine.

## Controller contract

All calls require `X-Reploid-External-Brain: 1`. Mutations also require JSON.
The server checks the actual loopback socket, local Host and exact same Origin
when supplied, without trusting forwarded headers or granting cross-origin access.

```sh
curl -H 'X-Reploid-External-Brain: 1' \
  http://127.0.0.1:8000/api/external-brain/requests
```

`pending` contains `requestId`, `sessionId`, `modelId`, `messages`, `tools`,
`createdAt` and `deadlineAt`. Read the goal, context and advertised OpenAI-shaped
function schemas. Copy both identities from the selected request into a response:

```json
{
  "schema": "reploid.external-brain.response/v1",
  "requestId": "COPY_REQUEST_ID",
  "sessionId": "COPY_SESSION_ID",
  "content": "I will inspect the supplied file.",
  "toolCalls": [{ "name": "ReadFile", "args": { "path": "/artifacts/example.txt" } }]
}
```

Save that JSON to `response.json`, then submit it:

```sh
curl -H 'X-Reploid-External-Brain: 1' -H 'Content-Type: application/json' \
  --data-binary @response.json \
  http://127.0.0.1:8000/api/external-brain/requests/COPY_REQUEST_ID/respond
```

The selected tool must be advertised by that request. X rechecks its own authority
before execution. Tool results and denial observations appear in the next pending
request's `messages`. `settled` contains bounded status summaries, not old context.
The existing X loop may continue after a milestone; use X's Stop control to end it.

- `GET /status`: mailbox availability and bounds.
- `POST /generate`: browser provider's held request, with schema
  `reploid.external-brain.request/v1` and the context fields above.
- `POST /requests/:requestId/respond`: one correlated decision.
- `DELETE /requests/:requestId` with `{ "sessionId": "..." }`: cancel that request.

Browser Stop aborts the held request and sends cancellation. Disconnect, timeout
and server shutdown settle the waiter. Wrong identities, duplicate decisions and
late replies fail rather than execute. A request is not a persistent agent session.
Never reuse request IDs: deduplication retains pending IDs and the latest 64
settlements, and resets when the process restarts. Unknown IDs are rejected.

Bodies are capped at 256 KiB and JSON depth 64; contexts at 256 messages and 128
tool schemas; the queue at 16 pending requests. Default expiry is five minutes.
No context or decisions are written to disk by the mailbox.

## Verification scope

Focused tests exercise real HTTP transport, the registered provider and the
actual X AgentLoop with real file-tool implementations and in-memory host storage:

```sh
npx vitest run --config tests/vitest.config.js \
  tests/unit/external-brain-provider.test.js tests/unit/external-brain-boot.test.js \
  tests/integration/external-brain.test.js tests/integration/external-brain-agent.test.js
```

The separate `tests/e2e/external-brain.spec.js` exercises the browser X UI and VFS.
Its dedicated configuration starts the opt-in loopback server:

```sh
npx playwright test --config tests/playwright.external-brain.config.js
```

It requires a working sandboxed Chromium; do not disable browser security to run
it. Node-host tests do not qualify browser boot, model quality, GPU execution,
remote access or all X journeys.

*Last updated: October 2026*
