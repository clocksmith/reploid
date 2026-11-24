# Confidential execution and the inference API

`reploid/inference` is Reploid's native inference API. The browser chat, the
`reploid ask` CLI and the SDK all use it, and the OpenAI- and Anthropic-shaped
HTTP endpoints are adapters over it. So are the native fleet host's owner
`generate` command and the daily game's fleet turn. This page describes what each execution
mode guarantees and exposes. It also gives the request, plan, event, result and
receipt shapes, and the stable refusal codes.

Source: [`packages/reploid/src/inference/`](../packages/reploid/src/inference/),
[`chat/execution-policy.js`](../packages/reploid/src/chat/execution-policy.js)
(requirement compiler and backend registry),
[`chat/execution-offers.js`](../packages/reploid/src/chat/execution-offers.js)
(backend eligibility). The layered peer policy underneath is described in
[execution-privacy.md](execution-privacy.md).

## Names

- **Confidential execution**: no executor can read the content it processes.
  In the API this is `confidentiality: "requester-only"`. **No backend
  qualifies today**, so every such request fails closed with
  `CONFIDENTIAL_EXECUTION_UNAVAILABLE` and nothing is sent.
- **Executor-readable**: `confidentiality: "executor-readable"`. Each computer
  that runs the model reads the content in plaintext. Every route that runs
  today is executor-readable.
- **Encrypted** is not used as a product term. WebRTC (DTLS) and HTTPS protect
  the wire. The computer that runs the model still reads the content.
- **Participants** are the computers allowed to read content: the providers
  that execute it, and, for a paired native host, its coordinator.

## Presets in the Poolday chat

The chat's "Who can read it" dialog offers three presets. Each one is a set of
API requirements, and the dialog states availability and exposure before Send.

| Preset | Requirements | Availability | Who reads the content | What else is exposed |
| --- | --- | --- | --- | --- |
| Standard · Approved computers may read the content | `network-allowed`, `participants: open` (or the computer chosen in "Answer on"), `executor-readable` | Available | The computer that answers, approved before anything is sent; on a split, every stage | Model identity, timing and message sizes can be visible to coordinators, credit ledgers and relays |
| Only your devices can read content | `local-only`, or `network-allowed` with `participants: named` = the desktop this device paired with; `executor-readable` | Available on this device; and on your paired desktop when one is paired | This device, or your paired desktop, in plaintext | Local: nothing leaves the device. Desktop: a relay that carries the WebRTC connection can see timing and message sizes |
| Confidential execution · No device can read content | `requester-only` | **Unavailable**. Shown disabled, never applied | Not applicable | Not applicable |

"Only your devices" is placement plus named participants with
executor-readable confidentiality, stated plainly: your devices read the
content. Your paired desktop counts as yours because you approved its
single-use pairing code on that desktop
([owner pairing](../apps/poolday/host/owner-pairing.js)). Reploid does not
otherwise verify who owns a computer. A host that invited you as a guest is
never counted as one of your devices.

## The native API

```js
import { createInference } from 'reploid/inference';

const plan = await inference.prepare({
  model: { id: 'qwen-3-5-2b-q4k-ef16-af32', identity: 'sha256:…', adapterIdentities: [] },
  generation: { maxOutputTokens: 128 },
  execution: {
    placement: 'network-allowed',                     // or 'local-only' (participants { kind: 'none' })
    participants: { kind: 'named', ids: ['peer:…'] }, // or { kind: 'open' }
    confidentiality: 'executor-readable',             // or 'requester-only'
    allowMetadata: ['model-id', 'timing', 'length']   // subset of model-id, timing, length, access-patterns
  }
}, { signal });

const run = await inference.run({ planId: plan.id, requestId: 'caller-key-1', input: { messages } }, { signal });
for await (const event of run.events) { /* admitted, output.delta…, then completed | cancelled | failed */ }
const result = await run.result;
```

The host provides two ports. `resolveRoute` describes the route a request would
take without sending anything. `execute(job, controls)` runs it through the
existing peer binding, and must call `controls.requestApproval(preview)` with
the execution binding before any remote disclosure.

### prepare

`prepare` takes no prompts, tools or prompt hashes. Any other field is
`EXECUTION_REQUEST_INVALID`. It compiles the requirements into the verified
peer policy (`reploid.execution-policy/v2`), refuses unsupported confidentiality
and disallowed metadata, and pins a route. It places no credit hold.

```json
{
  "id": "plan_6f0c…",
  "expiresAt": 1795557597507,
  "route": {
    "id": "sha256:83ee…",
    "schema": "reploid.inference-route/v1",
    "shape": "remote",
    "selection": "one-of",
    "participants": ["peer:4b1d…"],
    "backend": "doppler-plaintext/v1",
    "protocol": null,
    "model": { "id": "qwen-3-5-2b-q4k-ef16-af32", "identity": "sha256:…", "adapterIdentities": [] },
    "planIdentity": null
  },
  "maxCharge": { "maximum": 128, "unit": "noncash-service-credit" },
  "disclosures": {
    "contentReadableBy": { "requesterDevice": false, "participants": ["peer:4b1d…"], "selection": "one-of" },
    "executorsReadContent": true,
    "metadata": ["model-id", "timing", "length"],
    "statement": "One of the listed participants reads the content in plaintext. …"
  }
}
```

- `shape` is `local`, `remote` or `split`. A split route also carries its
  partition `planIdentity`.
- `selection` says how `participants` relates to who reads:
  - `all`: every listed participant reads the content. Used for a split, or a
    paired native coordinator plus its provider.
  - `one-of`: exactly one listed participant will. Used for named whole-model
    participants.
  - `any-eligible`: an open whole-model request. The provider's identity is
    proved at admission, so the plan cannot name it in advance. The `admitted`
    event names it before anything is sent.
- `maxCharge` is the route's service-credit ceiling when it quotes one (a
  paired private pool), otherwise `null`.
- `disclosures` describe the backend, not the permission. `metadata` is what the
  route can expose beyond the readers. A local route exposes nothing.

### run

`run` rechecks the pinned route, its charge ceiling and the plan's expiry before
anything sensitive leaves. A plan runs once; a repeated `requestId` returns the
same run. When the executor asks to disclose, the admitted binding must match
the plan's backend, protocol, model, adapters and participants, and its policy
may only narrow the requested one. Otherwise the run fails with
`EXECUTION_PLAN_CHANGED`, and the approval returns false before any content is
sent. After the first admission no other route is accepted.

Events, in order:

```json
{ "type": "admitted", "requestId": "caller-key-1", "attemptId": "attempt_…",
  "route": { "id": "sha256:…", "planRouteId": "sha256:83ee…", "policyId": "sha256:…", "shape": "remote",
             "participants": ["peer:4b1d…"], "backend": "doppler-plaintext/v1", "protocol": null } }
{ "type": "output.delta", "requestId": "caller-key-1", "attemptId": "attempt_…", "sequence": 0, "text": "Hel" }
{ "type": "completed", "result": { … } }
```

Exactly one of `completed`, `cancelled` or `failed` ends the stream. The result:

```json
{
  "requestId": "caller-key-1",
  "attemptId": "attempt_…",
  "status": "completed",
  "output": { "text": "Hello.", "finishReason": "stop", "stopReason": "eos-token" },
  "usage": { "inputTokens": 7, "outputTokens": 3 },
  "settlement": { "unit": "noncash-service-credit", "charge": 3, "outputTokens": 3 },
  "executionReceipt": { … }
}
```

Partial text is never a successful result. On `failed` or `cancelled`, `output`
and `usage` are `null` and `error` holds `{ code, message }`. `finishReason` is
`length` for a token or context limit, and `unknown` when an older provider
reported no reason. In that case the receipt lists `termination-reason` as not
verified.

### Execution receipt

`reploid.execution-receipt/v1` binds the requested requirements and their policy
identity, the actual route, the backend and protocol identity, and the
disclosures. It keeps evidence for confidentiality and for result integrity
separate. `by: "requester"` means this inference client checked the claim
itself. A claim not listed was not checked.

```json
{
  "schema": "reploid.execution-receipt/v1",
  "api": "reploid.inference/v1",
  "requestId": "caller-key-1", "attemptId": "attempt_…", "planId": "plan_6f0c…", "status": "completed",
  "requested": { "model": { "id": "…", "identity": "sha256:…", "adapterIdentities": [] },
                 "execution": { "placement": "network-allowed", "participants": { "kind": "named", "ids": ["peer:4b1d…"] },
                                "confidentiality": "executor-readable", "allowMetadata": ["model-id", "timing", "length"] },
                 "policyId": "sha256:…" },
  "route": { "planRouteId": "sha256:83ee…", "admittedRouteId": "sha256:…", "policyId": "sha256:…", "shape": "remote",
             "participants": ["peer:4b1d…"], "backend": "doppler-plaintext/v1", "protocol": null, "planIdentity": null },
  "disclosures": { "…": "as in the plan" },
  "evidence": {
    "confidentiality": {
      "mode": "executor-readable",
      "contentReadBy": { "requesterDevice": false, "participants": ["peer:4b1d…"] },
      "verified": [{ "claim": "content-recipients", "by": "requester", "method": "route-binding-before-disclosure", "value": ["peer:4b1d…"] }],
      "notVerified": ["recipient-conduct", "erasure", "hardware-attestation", "cryptographic-protection"]
    },
    "integrity": {
      "verified": [
        { "claim": "model-identity", "by": "requester", "method": "answer-identity", "value": "sha256:…" },
        { "claim": "adapter-identities", "by": "requester", "method": "answer-identity", "value": [] },
        { "claim": "stream-matches-answer", "by": "requester", "method": "text-comparison" }
      ],
      "providerReceipt": { "digest": "sha256:…", "checkedHere": false },
      "notVerified": ["correct-computation", "reported-token-counts"]
    }
  }
}
```

`content-recipients` means the requester bound the request to that recipient
set before sending, under the peer admission protocol. It says nothing about
what a recipient did afterwards. A local route records
`content-stayed-on-requester-device` instead. `providerReceipt` is a digest of
the provider's signed record when one was returned. The inference layer retains
it and does not re-verify it.

### Refusal codes

| Code | When | Sent |
| --- | --- | --- |
| `CONFIDENTIAL_EXECUTION_UNAVAILABLE` | `confidentiality: "requester-only"`. No backend qualifies. The request is never retried as readable and never made local | Nothing |
| `LEAKAGE_NOT_ALLOWED` | The route exposes metadata that `allowMetadata` omits | Nothing |
| `EXECUTION_PLAN_EXPIRED` | The plan lapsed, was already run, or never existed | Nothing |
| `EXECUTION_PLAN_CHANGED` | The route, participants, backend, model, adapters or charge ceiling differ from the plan, before or at disclosure | Nothing beyond what the plan admitted |
| `RESULT_UNVERIFIED` | The answer names another model or adapters, contradicts its stream, exceeds the limit, or arrives without an admitted route | The plan's participants already had the content; no result is returned |
| `EXECUTION_REQUEST_INVALID` | Malformed requirements, a prompt or tool given to `prepare`, an invalid `requestId` | Nothing |
| `EXECUTION_ROUTE_UNAVAILABLE` | No route meets the requirements, for example local-only on a network-only deployment or a split outside the named participants | Nothing |

The first five codes come from the owner's API specification. The last two are
additions for malformed input and for routes that do not exist. Errors that
the executor itself raises keep their own messages and are not given these
codes.

## HTTP adapters

`/v1/chat/completions`, `/v1/messages` and `/v1/responses` accept the same
optional `reploid` extension. It carries the same `model` pin and `execution`
requirements as `prepare`, plus the private pool and conversation:

```json
{
  "reploid": {
    "model": { "identity": "sha256:…", "adapterIdentities": [], "planIdentity": "sha256:…" },
    "execution": { "placement": "network-allowed", "participants": { "kind": "named", "ids": ["peer:4b1d…"] },
                   "confidentiality": "executor-readable", "allowMetadata": ["model-id", "timing", "length"] },
    "poolId": "reploid-swarm-team",
    "conversationId": "conv-alpha"
  }
}
```

Per endpoint, the extension sits beside the protocol's own fields:

```json
POST /v1/chat/completions  { "model": "…", "messages": [{ "role": "user", "content": "Hi" }], "reploid": { … } }
POST /v1/messages          { "model": "…", "max_tokens": 64, "messages": [{ "role": "user", "content": "Hi" }], "reploid": { … } }
POST /v1/responses         { "model": "…", "input": "Hi", "reploid": { … } }
```

The adapter reads the extension before the protocol parses any message. A body
without one runs under the standard requirements (`open`, executor-readable,
`model-id`, `timing` and `length` allowed), bounded by the operator's
`executionPolicyFor` policy. The caller's requirements may narrow the operator's
policy but never widen it.

**Confidential execution is refused on these endpoints.** An ordinary JSON body
is plaintext to the server that receives it, so these endpoints cannot protect
it afterwards. A `requester-only` request is answered with HTTP 422 and
`code: "confidential_execution_unavailable"`. It is not authorized, executed or
forwarded. The bytes have still reached this server's process. A client that
must keep content from the server must not send it over plain JSON.

When the extension is present, all three return the same record in a top-level
`reploid` field. Chat Completions puts it on its final chunk when streaming,
Messages on `message_delta`, and Responses on the final response object:

```json
"reploid": {
  "executionReceipt": { "schema": "reploid.execution-receipt/v1", "…": "as above" },
  "execution": { "…": "the executor's own report (timing, partition summary), carried as reported" },
  "poolId": "reploid-swarm-team",
  "conversationId": "conv-alpha"
}
```

Error bodies carry the stable code in lower case: `error.code` on Chat Completions
and Responses, `error.code` inside the Anthropic-shaped `error` on Messages. The
HTTP statuses are 400 (invalid), 422 (confidential unavailable, leakage), 409
(plan changed or expired), 503 (no route) and 502 (unverified result).

Responses no longer requires `store: false`. This server stores no responses,
so `store` may be omitted or false. `store: true` asks for storage that is not
offered and is refused.

## CLI

```sh
npx reploid ask 2b "Hello" --participant peer:4b1d… --allow-metadata model-id,timing,length
npx reploid ask 2b "Hello" --confidentiality requester-only   # refused before discovery: CONFIDENTIAL_EXECUTION_UNAVAILABLE
```

`--participant` (repeatable) names who may read the prompt. `--allow-metadata`
lists the metadata the route may expose. `--confidentiality` defaults to
`executor-readable`. The flags configure the inference request and never the
participant process.

## Threat model per mode

- **Executor-readable, open:** any provider that passes admission for the exact
  model can read the prompt and answer. The requester binds the request to one
  identity-proved recipient before sending (metadata and a salted commitment
  first, messages only after a matching admission). A dishonest recipient can
  keep, copy or misuse what it reads. Signaling, relays and credit ledgers can
  see timing, sizes, model identity and participant identities.
- **Executor-readable, named (including "Only your devices"):** the same, with
  readers limited to the named participants. A provider outside the list
  receives nothing, even if it is the only one ready. With your paired desktop
  as the only participant, no computer outside your devices reads the content.
  The desktop's own software and anyone with control of it can.
- **Local-only:** nothing leaves this device. Software on the device can read
  the content.
- **Requester-only (confidential execution):** intended to keep content from
  every executor, including under collusion of all remote parties
  (`collusion: "all-remote"`). No cryptographic or attested backend is qualified,
  so it is refused before disclosure on every surface.

## Not claimed

- No trustless compute, hardware attestation or cryptographic protection
  from executors. Neither the backend registry nor any advertisement can enable
  them, and no surface turns a requester-only request into a readable one.
- A recipient's conduct after it reads content: retention, copying, erasure.
- Correct computation. The receipt checks identities and stream consistency,
  not numerical correctness, and reported token counts are the provider's.
- Ownership of a device beyond the pairing the user approved on it.
- Confidentiality from the server that receives an ordinary HTTP JSON body.
- Tests use injected generators and in-memory transports. They establish the
  contract, not physical inference or production readiness.
