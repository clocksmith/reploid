# Confidential execution and the inference API

Parked 2026-11-25: the Orin kill gate failed (latency, memory and key-size limits); the route stays disabled and unmaintained beyond safety fixes.

`reploid/inference` is Reploid's native inference API. The browser chat, the
`reploid ask` CLI and the SDK all use it, and the OpenAI- and Anthropic-shaped
HTTP endpoints are adapters over it. So are the native fleet host's owner
`generate` command, the daily game's fleet turn, Work's network steps and AskPeer
tool, and the model-imitation study. This page describes what each execution
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
  `CONFIDENTIAL_EXECUTION_UNAVAILABLE` and nothing is sent. The error's
  `reason` is `awaiting independent security review`. A research
  [protected route](#protected-route-research-unavailable) exists behind an
  explicit host flag that is off everywhere Reploid ships.
- **Attested execution**: `confidentiality: "attested-execution"`, a separate
  value. The content is readable only inside an attested enclave: an NVIDIA GPU
  in confidential-computing mode inside a confidential VM (AMD SEV-SNP or Intel
  TDX), running an approved runtime. That holds only if the hardware vendors'
  attestation is sound. It never satisfies `requester-only`. It is **off by
  default**: every request fails closed with `ATTESTED_EXECUTION_UNAVAILABLE`
  unless a host enables the [attested GPU route](#attested-gpu-route-unreviewed-off-by-default).
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
| Standard: the computer that answers reads your messages | `network-allowed`, `participants: open` (or the computer chosen in "Answer on"), `executor-readable` | Available | The computer that answers, approved before anything is sent; on a split, every stage | The readers also see access patterns. Model identity, timing and message sizes can be visible to coordinators, credit ledgers and relays |
| Only your devices | `local-only`, or `network-allowed` with `participants: named` = the desktop this device paired with; `executor-readable` | Available on this device; and on your paired desktop when one is paired | This device, or your paired desktop, in plaintext | The readers also see access patterns. Local: nothing leaves the device. Desktop: a relay that carries the WebRTC connection can see timing and message sizes |
| Confidential execution (a planned target) | `requester-only` | **Not available yet**. Shown disabled with that reason, never applied | Not applicable | Not applicable |

The "Answer on" sheet keeps its computer and model consistent with these
presets. Choosing a model that only contributors run moves the sheet to
Contributors and states who can read the prompt before anything applies; a
private-pool model, which never runs on this device, chooses its pool and applies
at once, and its route binds only the enrolled computers it names. Under
"Only your devices" (chosen in "Who can read it", or stored on a sent
conversation) the sheet does not move: it explains the preset beside the model
and offers "Use contributors", which changes the preset only when pressed. An
invite link keeps its host as the only computer that may read prompts.

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
    allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] // a plaintext route discloses all four
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
    "metadata": ["model-id", "timing", "length", "access-patterns"],
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
  route can expose. A plaintext executor reads the content, so it also observes
  its access patterns: both plaintext backends list `access-patterns` with
  `model-id`, `timing` and `length`, and an executor-readable request must allow
  all four (providers on earlier releases refuse a plaintext policy that omits
  any of them). Coordinators, credit ledgers and relays can see the other three.
  The protected backend computes data-independently and does not list
  `access-patterns`. A local route exposes nothing.

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
                                "confidentiality": "executor-readable", "allowMetadata": ["model-id", "timing", "length", "access-patterns"] },
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
| `ATTESTED_EXECUTION_UNAVAILABLE` | `confidentiality: "attested-execution"` where the attested route is not enabled (every shipped surface) | Nothing |
| `ATTESTATION_REJECTED` | The executor's proof failed one check. `reason` names which (see [failure modes](#failure-modes)) | A fresh nonce only; never the prompt |

On the research protected route, `RESULT_UNVERIFIED` also covers a failed
known-answer trap and a protocol violation the evaluator signed (an
authenticated, in-sequence frame of the wrong kind or for the wrong step, such
as a decrypt request). `EXECUTION_PLAN_CHANGED` covers an evaluator that cannot
be bound as the planned identity, before anything is uploaded. Two executor
codes are the route's own:

- `PROTECTED_SESSION_CLOSED`: the evaluator dropped or timed out, or a frame
  failed authentication in a way anyone on the path could cause. That covers a
  blob altered in transit and lost frames. Such failures are never blamed on
  the evaluator.
- `PROTECTED_SESSION_EXPIRED`: the session binding lapsed, checked again after
  every wait.

The first five codes come from the owner's API specification. The next two are
additions for malformed input and for routes that do not exist, and the last two
belong to the attested route. Errors that
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
                   "confidentiality": "executor-readable", "allowMetadata": ["model-id", "timing", "length", "access-patterns"] },
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
`model-id`, `timing`, `length` and `access-patterns` allowed), bounded by the operator's
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
HTTP statuses are 400 (invalid), 422 (confidential or attested unavailable, attestation rejected, leakage), 409
(plan changed or expired), 503 (no route) and 502 (unverified result).

Responses no longer requires `store: false`. This server stores no responses,
so `store` may be omitted or false. `store: true` asks for storage that is not
offered and is refused.

## CLI

```sh
npx reploid ask 2b "Hello" --participant peer:4b1d… --allow-metadata model-id,timing,length,access-patterns
npx reploid ask 2b "Hello" --confidentiality requester-only   # refused before discovery: CONFIDENTIAL_EXECUTION_UNAVAILABLE
```

`--participant` (repeatable) names who may read the prompt. `--allow-metadata`
lists the metadata the route may expose; it defaults to all four, which is what a
plaintext route discloses. `--confidentiality` defaults to
`executor-readable`. The flags configure the inference request and never the
participant process.

## Work and the model-imitation study

Every Poolday call that runs inference on a Reploid peer outside a conversation
goes through
[`providers/peer-inference.js`](../apps/poolday/providers/peer-inference.js),
which prepares and runs it through `reploid/inference`:

- Work's network steps (the agent's own model steps and helper steps on a peer)
  and its AskPeer tool. The plan carries the thread's stored policy as
  requirements. Each step's execution receipt is kept on the saved thread
  (`peerSteps`, and `execution.receipt` for the latest step) and summarized in
  the task header and the thread's activity list.
- The model-imitation study. Each call names only the recipients reviewed when
  the study started. The study's own recipient and identity checks run after the
  disclosure matched the plan. Each answer keeps its receipt in the study
  record and its export.

The refusals are the API's: a requester-only policy is
`CONFIDENTIAL_EXECUTION_UNAVAILABLE` before anything is sent, and is never run on
this device instead. A Work thread with such a policy is refused before it is
saved. A second recipient proposed after the first approval is
`EXECUTION_PLAN_CHANGED`, and nothing more is sent.

**Not Reploid peer inference.** Work's local steps, which run on this device's
Doppler runtime, and non-Doppler cloud adapters injected by other hosts keep their own
paths in [`work-network-provider.js`](../apps/poolday/providers/work-network-provider.js).
They carry no execution receipt. Work's RequestPeerJob tool runs signed Pack
operations under its own operation-consent protocol, not this API.
`generateOnPeer` in `peer-inference.js` is the internal peer binding. Only
inference execute ports call it: the one in `peer-inference.js`, and the
conversation port in `host/chat-execution.js`.

## Threat model per mode

- **Executor-readable, open:** any provider that passes admission for the exact
  model can read the prompt and answer. The requester binds the request to one
  identity-proved recipient before sending (metadata and a salted commitment
  first, messages only after a matching admission). A dishonest recipient can
  keep, copy or misuse what it reads, and it sees the access patterns of the
  content it reads. Signaling, relays and credit ledgers can
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
  so it is refused before disclosure on every surface. The research protected
  route below is the candidate; its threat model is stated there.
- **Attested execution:** content readable only inside an attested GPU enclave
  in a confidential VM. The cloud operator is outside the trust boundary; the
  hardware and the approved runtime are inside it; NVIDIA, and AMD or Intel, are
  trusted. Refused on every shipped surface; see the
  [attested GPU route](#attested-gpu-route-unreviewed-off-by-default).

## Protected route (research, unavailable)

Source: [`mesh/protected-generation.js`](../packages/reploid/src/mesh/protected-generation.js)
(protocol), [`inference/protected.js`](../packages/reploid/src/inference/protected.js)
(API integration), [`server/protected-route/`](../server/protected-route/) (Node
host ports, the evaluator peer and the links to Doppler's processes). The
backend is Doppler's single-key CKKS prototype (`tools/privacy-protected/` on
Doppler's `protected-route` branch): Go and Lattigo on the CPU, a one-block
32-symbol fixture model, about 1.5 to 2 minutes per token on the secure ring.
It is a research fixture, not a catalogued model, and the route is not a product
capability.

### Enabling it

Nothing in Reploid enables it. A host must construct the port and pass the flag
itself:

```js
import { createInference, createProtectedExecution } from 'reploid/inference';

const protectedExecution = createProtectedExecution({ policy, discover, connect, openCrypto });
const inference = createInference({ resolveRoute, execute, protectedExecution, unreviewedProtectedExecution: true });
```

Without both, `prepare` with `requester-only` throws
`CONFIDENTIAL_EXECUTION_UNAVAILABLE` before discovery, exactly as before, and
`PROTECTED_EXECUTION_STATUS` is `{ available: false, reason: "awaiting
independent security review" }`. The HTTP adapters, the CLI and the chat never
pass the flag, no advertisement or capability list mentions the route, and
`server/fleet/browser-bridge.js` keeps refusing `requester-only`. The ports:

- `discover({ signal, model })` returns signed advertisements. It sends no
  content, no prompt length and no model choice the advertisement did not
  already name.
- `connect(endpoint)` returns a frame channel (`send`, `receive`, `close`).
  [`frame-socket.js`](../server/protected-route/frame-socket.js) carries it over
  TCP; a WebRTC data channel adapter is still to be written.
- `openCrypto({ parameterSet })` returns the requester's key holder. In Node it
  is Doppler's `privacy-protected bridge` child process
  ([`go-bridge.js`](../server/protected-route/go-bridge.js)); in a browser it
  would be the same Lattigo code built for WebAssembly. The secret key is made
  and kept inside the key holder and never crosses its interface.

### Protocol `reploid.protected-generation/v1`

1. **Advertisement.** The evaluator peer signs a backend descriptor
   (`reploid.protected-backend/v1`) with its Reploid signing identity: protocol,
   backend `doppler-protected-ckks/v1`, engine protocol and implementation,
   scheme, parameter-set id and digest, circuit identity and layout (model
   identity, vocabulary, context, input level, slots, rotations), evaluator
   participant identity and public key, key-epoch policy (longest key lifetime,
   reuse), and the most lanes per session. The requester checks the signature
   and that the key hashes to the named participant.
2. **Eligibility in `prepare`.** The requester's own allowlist decides, never
   the descriptor: allowed protocols and engine protocols, parameter sets by
   digest (with the requester's own record of which are insecure development
   sets), pinned circuits with their layout, each circuit's trap oracle
   (endpoint and pinned Ed25519 keys), a trap-lane count, a largest accepted
   tolerance and a longest key epoch. `prepare` sees no prompt and contacts no
   oracle. It returns the route (one named evaluator, `selection: "one-of"`, and
   a `protected` block with the descriptor, parameter-set and circuit digests,
   the trap source with its oracle keys, and the lane counts) and these
   disclosures (plus `trapOracle`, what the oracle learns):

   ```json
   { "contentReadableBy": { "requesterDevice": true, "participants": [], "selection": "all", "target": true },
     "executorsReadContent": false,
     "confidentiality": { "status": "target-not-established", "reason": "parameters not estimated; awaiting independent security review" },
     "metadata": ["model-id", "timing", "length"],
     "computedBy": ["peer:…"],
     "leaks": ["model and circuit identity", "prompt length (in the bind offer, before the endpoint proves its key) and generated token count",
               "lane count", "ciphertext and message sizes", "timing of each step", "session linkage through the key epoch",
               "after a session, whether a verification failed (through the evaluator lockout and key-epoch rotation): exposure bounded to log2(n + 1) chosen bits per evaluator per key epoch over n sessions, not closed",
               "evaluator and requester identities and network metadata"],
     "review": { "available": false, "reason": "awaiting independent security review" } }
   ```

   On an insecure development parameter set the same disclosures list the
   evaluator in `contentReadableBy.participants`, set `executorsReadContent:
   true` and `confidentiality.status: "none"`, and the statement says there is
   no confidentiality. A request that does not allow all of `model-id`,
   `timing` and `length` is `LEAKAGE_NOT_ALLOWED`. `run` resolves the route again and refuses any change
   (`EXECUTION_PLAN_CHANGED`) before connecting.
3. **Binding before upload.** The requester sends a `bind-offer` signed with a
   fresh signing key: plan id, route id, descriptor digest, evaluator identity,
   requester identity and key, key epoch id and expiry, a 256-bit requester nonce,
   a session expiry, and the schedule (lanes, prompt tokens, generated tokens).
   The evaluator checks that the offer names it and its current descriptor, is
   unexpired, has an unseen nonce and fits its limits, then answers a signed
   `bind-accept` with the offer's digest, a 256-bit evaluator nonce and the digest
   of evaluation keys it already holds for that epoch. The binding digest is the
   hash of the offer and the evaluator nonce; the requester confirms it in a
   signed `bind-confirm`. Only then are evaluation keys (or `keys-held`) and
   ciphertexts sent. The `admitted` event carries the binding digest as the
   admitted route id.
4. **Frames.** Every frame after the offer carries the schema, the binding
   digest, the session id, a per-direction sequence number starting at zero, and
   the size and SHA-256 of each blob, all signed by the sender. The requester
   authenticates before anything else, and only an authenticated, in-sequence
   frame can be held against the evaluator:
   - Ignored (up to 16 per session): junk, wrong schema, bad or missing
     signature, an unsigned `abort`, a frame of another session, a reflected
     requester frame, a replayed old frame. None of these can make the requester
     end or blame anything.
   - Closed with `PROTECTED_SESSION_CLOSED`, not blamed: a signed frame whose
     blob was altered, and a sequence gap.
   - `RESULT_UNVERIFIED`, held against the evaluator: an authenticated frame of
     a kind the requester is not waiting for (it accepts only `bind-accept`,
     `ready`, `result` and a signed `abort`), including a decrypt request.

   The bind offer carries the prompt length and lane count before the endpoint
   has proved its key; the disclosures list this. Expiries tolerate five
   minutes of clock skew between the two machines. The requester's session
   lasts 25 minutes and the evaluator accepts up to 30.
5. **Steps.** One `step` per generated token: the prefill carries every lane's
   prompt tokens, each decode one token per lane, each a fresh encryption. The
   evaluator returns one logits ciphertext per lane. The schedule is fixed and
   public: no early stop.
6. **State, logs and recovery.** Both sides keep a protected journal separate
   from the plaintext generation journal. Its records are checked against a field
   allowlist (session, binding and descriptor digests, sequence and step numbers,
   trap verdicts and errors, result digests, frame counts and sizes); tokens,
   logits, text and ciphertexts have no field to go in. The evaluator peer logs
   sizes, timings and digests. Recovery never resumes: an unfinished session is
   marked abandoned, and a new plan starts a new session. A failure is never
   retried as readable or local.

### Result verification: secret known-answer traps (v2)

The requester holds no weights, so it cannot recompute an answer, and two
evaluators agreeing proves nothing if they collude. The route checks results
with known-answer traps that the evaluator cannot tell from the real input.

**Why v1 was broken.** Version 1 used a public, signed trap set. An evaluator
that reads the set can compute, on ciphertext and without any key, an indicator
I(x) that is 1 exactly when a lane's prompt is a published trap, and add
(1 − I(x)) · δ to the logits. The perturbation vanishes on every published trap
and corrupts every other input, so every trap passes and every real answer is
wrong. Doppler's evaluator implements this attack (`--misbehave vanish:<set>`),
and the tests show it passing undetected under v1. Any fixed list has the same
flaw. The public set is now ineligible unless a policy sets
`allowPublicTrapSet: true`, which only the comparison tests do.

**v2: a trap oracle.** A party the evaluator cannot see into holds the pinned
public weights and runs Doppler's `privacy-protected trap-oracle`. That party can
be the model publisher or a separate host. For each session:

1. The requester sends `doppler.protected-trap-request/v1`: the circuit digest,
   the prompt length, the generated count, the number of traps, a fresh 256-bit
   nonce and a one-time X25519 public key. It sends nothing about the prompt.
2. The oracle samples fresh trap prompts of that length with the platform
   CSPRNG. For the fixture it draws a third letter progressions (the training
   task), a third sequences the model itself generates from a random start, and a
   third random letters. Nothing comes from a fixed list. It keeps prompts whose
   trajectory stays inside every approximation interval with a top-1 margin of
   at least 2.5. For each it records the greedy continuation and the expected
   logits from the pinned approximate circuit.
3. It encrypts the batch to the requester's one-time key (X25519 with a fresh
   oracle key, HKDF-SHA256 salted with the nonce, AES-256-GCM). It signs a
   header with its Ed25519 key, and the header binds the batch id, the circuit,
   the requester's nonce and key, the oracle's one-time key, the IV, the
   ciphertext digest, the issue time and the expiry (10 minutes).
4. The requester checks the signature against its pinned oracle key, the nonce
   and key binding, the expiry, that the batch id is unused, the digest,
   decryption, and every trap's shape and tolerance. Any failure ends the run
   before anything reaches the evaluator (`EXECUTION_ROUTE_UNAVAILABLE`,
   "Trap batch refused"). A forged, altered, expired or replayed batch never
   opens.
5. The session runs as before. The T traps are placed at random lane indices
   beside the real lane, every lane is a fresh encryption on the same schedule,
   and each step's traps are checked within the tolerance (and on argmax)
   before the real lane is decrypted. A failure is `RESULT_UNVERIFIED`, with
   nothing real decrypted.

The batch is end-to-end encrypted and signed, so any transport can carry it. The
Node host posts it over HTTP
([`requester-host.js`](../server/protected-route/requester-host.js)). The
requester is anonymous to the oracle. **The oracle learns** that a session is
starting, its prompt length, generated count and trap count, the request time
and the network address. It never learns the prompt, the answer or which
evaluator runs the session. The disclosures say so in `trapOracle`, and the
receipt records the batch id and the oracle key.

**Trust assumption.** The oracle must not collude with the evaluator. An oracle
that tells the evaluator its traps defeats v2 completely: the evaluator then
perturbs only the other lane. This is weaker than verifiable computation. Traps
check a sample of the evaluator's work against outputs the oracle computed, and
prove nothing about the real lane itself. The receipt lists
`trap-oracle-independence-from-the-evaluator` as not verified.

**Detection versus trap ratio.** These odds hold only for an evaluator that
tampers blindly, or by a predicate of the input it cannot aim at traps. An
evaluator that knows the traps (an oracle colluding with it) or the real lane is
never caught. With K = T + 1 lanes:

- An evaluator that tampers lanes it cannot tell apart is caught with
  probability 1 − C(K − T, m) / C(K, m) for m tampered lanes. That is T / K for
  one lane (0.75 at T = 3) and certainty for two or more.
- An evaluator that tampers by input, on some set C of prompts, corrupts a real
  prompt drawn from the oracle's distribution D with probability p = D(C). It is
  caught with probability 1 − (1 − p)^T. Its chance of a silent corruption per
  session is p (1 − p)^T, at most (T/(T+1))^T / (T + 1): 0.25 at T = 1, 0.105 at
  T = 3, 0.049 at T = 7.
- Under v1 a public set made p ≈ 1 with zero detection. Under v2 a perturbation
  that vanishes on fresh traps must also vanish on most real prompts like them.

**Tokens streamed before a failure.** The real index is drawn once per session,
so steps do not compound. From step 2 on, a failing step follows real tokens
that were already decrypted, checked only by earlier steps' traps, and streamed
as `output.delta` events. The run then fails and returns no result, but the
streamed tokens came from an evaluator that was caught tampering: treat them as
unverified. A caller's `cancel()` also ends the schedule early, and the
evaluator sees that.

**What v2 does not catch.**

- Real prompts unlike the oracle's distribution. An attack on rare inputs (small
  p) is rarely caught, and it hurts a requester whose prompt is in that rare set.
  The requester cannot tell the oracle its prompt's style without leaking it.
- Low-margin inputs. Traps are filtered to a top-1 margin of at least 2.5, so
  inputs with smaller margins are never sampled, and an attack confined to them
  is unseen.
- Deviations below the tolerance (0.75 logits), and approximation error of the
  pinned circuit itself.
- An oracle that colludes with the evaluator, or an oracle that is down: the run
  fails, never silently.

**Cost per session**, beyond an unprotected one:

- T more lanes of evaluator compute and upload (K = 4 is four times the work).
- One round trip to the oracle.
- T greedy trajectories of the plaintext circuit on the oracle: about a
  millisecond for the fixture, T × (L + G) forward passes for a real model.
- A batch of T × G × vocabulary expected logits (about 10 KB for the fixture).
- On the requester: one X25519 key generation, one ECDH, HKDF, AES-GCM and one
  Ed25519 verification, a few milliseconds.

Dual evaluation (two evaluators, byte-identical results) remains an optional
extra in Doppler's own requester, not this route's guarantee.

**Trap freshness and revocation.** v1 trap sets carry no expiry and cannot be
revoked, another reason they are ineligible. v2 batches expire 10 minutes after
issue, open once (the requester remembers batch ids until they expire), and are
bound to one request's nonce and one-time key. Revoking an oracle key means
removing it from the requester's pins. The tests and the two-machine script pin
the oracle key out of band: from the seed file the test wrote, or from the
oracle host's own log. They never take it from the endpoint it authenticates.

### Selective failure: the trap verdict as an oracle

A trap verdict depends on the evaluator's output, and the evaluator can make its
output depend on the real input. On ciphertext it can add to every lane a term
that is zero on trap-like inputs and large when the real prompt satisfies a
predicate P of its choosing ("is the prompt exactly `hkn`?"). If the requester
aborted when a trap failed, the abort would reveal P(prompt), one bit per step.
A user retrying would feed a search. The verdict would also be a pass/fail
decryption oracle on evaluator-chosen ciphertexts under the key epoch.

The route's response limits this exposure; it does not close it:

1. **Silent failure.** When a trap fails, the requester stops decrypting
   anything, trap or real. It keeps feeding every lane fresh encryptions on the
   fixed schedule (the real lane gets a dummy token), sends `bye` as usual, and
   only then reports `RESULT_UNVERIFIED` to its caller. The evaluator's view
   (frames, kinds, sizes, schedule, close) is the same as for a passing session.
   Every step decrypts all T traps before judging, so the count of decryptions
   per step does not depend on which trap failed.
2. **Key epoch retired** on any `RESULT_UNVERIFIED`: the key holder deletes the
   stored secret key and epoch, so each key answers at most one failed verdict,
   and the next session makes a new key and uploads new evaluation keys.
3. **Lockout and budget.** A requester does not use an evaluator again for
   `failureLimits.windowSeconds` (default 24 hours) after
   `failureLimits.perEvaluator` failures (default 1). After
   `failureLimits.total` failures in the window (default 3) the whole route is
   closed. The host may persist the record (`failureStore`); otherwise it lasts
   as long as the protected execution object.
4. **No automatic retry.** Nothing in Reploid retries a protected run. The error
   says not to retry automatically, and the lockout makes an immediate retry
   against the same evaluator impossible.
5. **Layouts.** The real lane's index is uniform per session (tested over 4,000
   draws). Re-randomizing it per step was considered and rejected: each lane
   holds its own encrypted KV cache, so moving the real input between lanes
   would need an oblivious permutation on ciphertext.

**Exposure, bounded but not closed.** These channels stay open:

- **Timing within a session.** After a failure the requester skips its
  decryptions, a few milliseconds per lane-step on the fixture against seconds of
  evaluator compute per step. It is small, but not removed.
- **After the session.** The verdict shows through the lockout (the requester
  stops coming back), the rotated key epoch (a new epoch id and a key upload in
  the next session, visible to any colluding evaluator), and whatever the user
  does out of band.

Each of these reveals at most which session first failed. Exposure is
bounded to log2(n + 1) bits per evaluator per key epoch, where n is the number
of sessions that evaluator served under the epoch. A locked-out evaluator gets
nothing more until its window ends, and then only under a new epoch. Colluding
evaluators get at most the sum of these over the evaluators used. The budget
stops the route after `total` failures per window, so at most `total`
evaluators per window see a predicate come out true. The bound is the
requester's own accounting under these mechanisms, not a proof: the
selective-failure leak is limited, not closed, and it is one reason
requester-only stays off.

Each bit is a predicate the evaluator chose, so a targeted guess is confirmed
outright when it is right. The user's own reactions are outside this bound:
retrying the same prompt elsewhere, or rewording it.

### Threat model

- **Confidentiality is a target, not an established property.** The design
  rests on RLWE with one secret key that never leaves the requester's key
  holder, and aims to hold if every remote party colludes. Nothing here shows
  that it does. The parameters were never security-estimated, the protocol is
  unreviewed, and on the insecure development parameter set
  (`dev-insecure-n12`, used by the tests) there is **no confidentiality**. There,
  the disclosures list the evaluator as a reader. The disclosures and receipts
  never claim that no one else can read the prompt. They state
  `confidentiality.status`: `none` for insecure parameters,
  `target-not-established` otherwise, and the receipt lists `confidentiality`
  and `requester-held-key` as not verified. The
  evaluator sees the model and circuit identity, the evaluation keys, the prompt
  length, the generated count, ciphertext sizes, per-step timing (Lattigo is not
  constant-time) and network metadata. The requester never returns a decrypted
  value; its next input is a fresh encryption of a token it chose. Publishing
  outputs gives an IND-CPA-D adversary argmax decisions only; key epochs bound
  how much is encrypted under one key.
- **Integrity** is the trap detection above, under the assumption that the trap
  oracle does not collude with the evaluator. The binding prevents a different
  evaluator, a replayed frame or a network attacker from substituting results;
  it does not make the bound evaluator honest.
- **Not covered:** the requester's own device and software, side channels on
  it, the publisher colluding with evaluators (it could tell them the traps),
  denial of service, parameter security (`research-n16` is 1629 bits of QP at
  N = 2^16, compared only with the commonly cited 1772-bit ceiling; never
  estimated), and Lattigo's handling of untrusted ciphertexts and keys.

### Tests

- [`tests/unit/protected-generation.test.js`](../tests/unit/protected-generation.test.js)
  pins the protocol with in-process fakes (no cryptography): flag off,
  eligibility and leakage, happy path and journal contents, expired and changed
  plans, wrong identity, replay, transit tampering, all-lane lies, decrypt
  request, drop, non-finite real values, offer replay, and a 200-trial
  single-lane liar. Trap v2 cases: the vanishing perturbation undetected under
  v1 and caught under v2, forged or altered batches refused, a stale batch
  replayed into a later session refused, the oracle request carrying only sizes.
  Review cases: silent trap failure (the evaluator's view equal for a fired and
  a quiet predicate), epoch retirement, lockout, failure budget and window,
  uniform real-lane placement, six kinds of injected post-binding frames
  ignored, expiry after waiting, single-field allowlist failures, the flag and
  port gates, the requester's own longest key epoch, and journal value checks
  and recovery.
- [`tests/integration/protected-route.test.js`](../tests/integration/protected-route.test.js)
  runs real processes: this process as requester through `reploid/inference`,
  Doppler's key holder as its child, Doppler's trap oracle as its own process,
  and each evaluator peer as a separate Node process with its own Go CKKS
  evaluator, on the insecure development ring. The vanishing-perturbation peer
  computes the attack homomorphically. It
  is skipped unless `REPLOID_PROTECTED_BACKEND_DIR` names Doppler's
  `tools/privacy-protected` and Go is installed.
- [`scripts/protected-route-e2e.js`](../scripts/protected-route-e2e.js) runs the
  requester and an evaluator peer on two machines over the network, with the
  secure ring by default.

### Swapping in the GPU evaluator

The evaluator peer talks to its engine through one port (`describe(profile)`,
`open(schedule)` returning `sendKey`, `keysHeld`, `ready`, `step`, `close`);
[`go-evaluator.js`](../server/protected-route/go-evaluator.js) is the CPU one. A
WebGPU evaluator implements the same port, computes the same pinned circuit
(same profile digest and circuit digest, so the same trap oracle applies), returns
one logits ciphertext per lane at the pinned layout, and never constructs a
secret key. Nothing in the protocol, the API or the traps changes.

### Known, unfixed issues

The route is parked. A second session of the same operator reviewed it (not
the independent review). These findings from that review remain open:

- The bind offer sends the prompt length and lane count before the endpoint
  proves its key. This is disclosed, not moved after the key proof.
- The selective-failure exposure is bounded, not closed: the timing residual,
  the lockout and the epoch rotation remain (see above).
- A caller's `cancel()` ends the fixed schedule early, visibly to the evaluator.
- The receipt cannot verify that the secret key stayed in the key holder; it
  records the key holder's report.
- Session linkage: every session in one key epoch carries the same epoch id.
- Traps cover only the oracle's distribution, margins of at least 2.5 and
  deviations above the tolerance (see "What v2 does not catch").
- The descriptor's scheme, implementation label and issue time are not checked
  against the allowlist.
- The key holder's last 2 KB of stderr is quoted into error messages. Its
  contents were not audited.
- Not done: a WebRTC channel adapter, a WebAssembly key holder, the two-machine
  run, a parameter-security estimate and the independent review.

Fixed since the review: honest disclosures, the abort oracle bounded (silent
failure, epoch retirement, lockout and budget), the gate on
`createProtectedExecution`, abort and other unauthenticated frames verified
before use and never blamed on the evaluator, `maxKeyEpochSeconds`, clock skew
and the expiry recheck, the frame schema, the journal's nested values and
`recover()`, and `request.protected` selecting the protected path.

### Before review

An independent cryptographer reviews the parameters (lattice estimate for the
exact N, Q, P and secret distribution), the protocol (binding, sequence and
replay handling, key-epoch reuse, the trap oracle's channel and its sampling
distribution, trap indistinguishability,
decrypt-after-verify ordering, behaviour on approximation failure, timing
leakage, IND-CPA-D exposure), the implementation (Lattigo deserialization of
untrusted input, memory handling, side channels on the requester) and this
integration (no readable fallback, state and log separation). Until that review
and the two-machine end-to-end run both pass, the flag stays off, no surface
offers the mode, and `PROTECTED_EXECUTION_STATUS.available` stays false.

Passing that review would qualify only a **single-evaluator** (`selection: "one-of"`)
fixture route, which remains a stepping stone rather than Reploid's long-term
product goal in [`GOALS.md`](../GOALS.md#operating-mission). Proving confidential
pooled split exchange requires one end-to-end run that earns credits by serving
someone else and spends them on a confidential request **split across multiple
independently operated GPUs** where every participating GPU fails solo on memory,
the split beats single-host CPU offload within frozen latency and quality limits,
the privacy tier is named honestly (neither hardware-attested execution nor
non-colluding secret sharing may silently pass `requester-only`), and an
independent security review, the reference answer, and outsider-reproducible
requester debit and stage payouts are all verified from that same run.

## Attested GPU route (unreviewed, off by default)

Source: [`inference/attested/`](../packages/reploid/src/inference/attested/)
(verifier, HPKE, session protocol, report parsers, API port),
[`server/attested-gpu/`](../server/attested-gpu/) (the executor that runs inside
the confidential VM, and its evidence collectors),
[`scripts/attested-gpu-pilot.js`](../scripts/attested-gpu-pilot.js) (pilot
harness). The route is **an optional hosted tier**: one operator's machine, one
GPU, one model. It does not move the confidential split gate (see
[Split stages across operators](#split-stages-across-operators)).

**What it claims.** The content is readable only inside the attested enclave,
assuming the hardware vendors' attestation is sound. "Nobody can read it" stays a
labelled target and is not claimed. Speed on confidential hardware is not
claimed until it is measured.

**Trust boundary.**

- **Inside:** the GPU in confidential-computing (CC) mode, the confidential VM,
  and the approved runtime and model named by the attested launch.
- **Outside:** the cloud operator, its hypervisor and staff, whoever rents or
  administers the machine, and the relays, coordinators and credit ledgers that
  carry the session.
- **Trusted:** NVIDIA, and AMD or Intel, for sound attestation and hardware
  isolation; and the publisher of the requester's launch allowlist.

### Enabling it

```js
import { createInference, createAttestedExecution, connectWebSocketFrames } from 'reploid/inference';

const attestedExecution = createAttestedExecution({ policy, discover, connect: url => connectWebSocketFrames(url), credits, hooks,
  unreviewedAttestedExecution: true });
const inference = createInference({ resolveRoute, execute, attestedExecution, unreviewedAttestedExecution: true });
```

The flag is needed in both places. Without the port and the flag on
`createInference`, `prepare` refuses `attested-execution` with
`ATTESTED_EXECUTION_UNAVAILABLE` before discovery. A port built without its own
flag refuses the same way from `resolve` and `execute`, before it discovers or
connects, so calling it directly does not open the route. `ATTESTED_EXECUTION_STATUS`
is `{ available: false, reason: "awaiting a measured pilot on attested hardware
and independent security review" }`. The peer policy compiler, the HTTP adapters,
the CLI and the chat never pass the flag. `requester-only` keeps its meaning and
never runs on this route.

The policy belongs to the requester (`reploid.attested-gpu-policy/v1`). The
executor cannot add to it. It holds:

- pinned roots, as SubjectPublicKeyInfo digests: AMD ARK, Intel SGX root and
  NVIDIA device root;
- the launch allowlist: platform, CPU measurement, the exact image, runtime and
  model, and coverage;
- GPU reference measurements taken from NVIDIA's RIMs;
- for TDX, the identity of Intel's quoting enclave (`tdxQe`: signer, product
  id and lowest version), taken from Intel's published QE identity. A policy
  with a TDX launch and no `tdxQe` is refused;
- revocation and freshness limits, and the highest credit price.

Its digest is the execution policy's `attestation` requirement.

### Evidence

The executor returns one bundle per session (`reploid.attested-gpu-evidence/v1`):

- **The CPU TEE report.** Either an AMD SEV-SNP `ATTESTATION_REPORT` with its
  VCEK, ASK and ARK chain, or an Intel TDX quote v4 with its PCK chain. The
  requester checks:
  - the chain to the pinned root, the report signature (for TDX, the QE report
    and attestation-key chain too), and debugging: SNP guest policy bit 19, and
    for TDX the whole debug group of `TD_ATTRIBUTES` (bits 0 to 7, which also
    hold host profiling);
  - migration: SNP guest policy bit 18 (a migration agent may be associated)
    and TDX `TD_ATTRIBUTES` bit 29 (MIGRATABLE). The host chooses the agent
    and the agent receives the guest's state, and neither bit is part of the
    launch measurement, so both are refused (`migration-allowed`);
  - for TDX, that the quote was made by the pinned quoting enclave: its signer,
    its product id, a lowest version, and not a debug enclave. A PCK
    certificate vouches for any enclave its platform certified, so a quote from
    another enclave proves nothing about the trust domain
    (`quoting-enclave-unknown`);
  - the minimum TCB, when its policy sets one;
  - the launch measurement against the allowlist: SNP `MEASUREMENT`, or TDX
    `MRTD` plus RTMR0 to RTMR2, with RTMR3 optional.
- **The NVIDIA GPU report.** An SPDM GET_MEASUREMENTS request, which carries the
  32-byte nonce, plus its signed MEASUREMENTS response. With it come the GPU's
  device certificate chain and one stapled OCSP response per non-root
  certificate. The requester checks:
  - the chain to the pinned NVIDIA root;
  - each OCSP response: signed by the issuer or its delegated responder, `good`,
    and current;
  - the report signature (P-384) and the nonce;
  - the measurements against a RIM-derived reference set;
  - the CC state: `on`, and developer-tools (debug) mode off. The measured guest
    reads this through NVML and binds it into the CPU report.

**Verified locally in the requester, not through NRAS.** The browser re-implements
the checks of NVIDIA's local verifier: chain, OCSP, report signature, nonce and
reference measurements. It uses Web Crypto only, so a light requester can run
them. NRAS is left out for three reasons:

- NRAS would make a third party's verdict the decision.
- It would add a live dependency on every request.
- NVIDIA would learn the timing of every session.

NVIDIA stays trusted as the root of the GPU chain, for its OCSP answers, and for
the RIMs. RIMs are fetched and compared when the policy is published, not per
request; the policy pins the resulting reference sets. An NRAS token can be added
as an optional cross-check hook; it is never required and never sufficient.

CPU certificate revocation (AMD and Intel CRLs) and TDX TCB status (Intel PCS
collateral) run through hooks the policy names. A policy may mark them
`not-checked`. That is then listed in every receipt's `notVerified`
(`cpu-certificate-revocation`, `tdx-tcb-status`), never silently skipped. The
quoting enclave's identity is not one of them: it is pinned in the policy and
checked on every TDX quote.

### Binding

```
session       = { protocol, requesterNonce, executor: { participantId, kem, publicKey },
                  platform, launch: { image, runtime, model }, issuedAt, expiresAt }
sessionDigest = SHA-256(canonical JSON of session)      -> the nonce of every GPU report
reportData    = SHA-512(canonical JSON of { session: sessionDigest,
                  gpus: [{ index, architecture, ccMode, devToolsMode, report digest }] })
                                                        -> the 64-byte REPORT_DATA of the CPU report
```

The executor generates the X25519 key inside the VM for one session. The private
half is non-extractable and is dropped when the session ends. The CPU TEE
therefore signs four things:

- the requester's fresh nonce;
- the key the prompt is encrypted to;
- the launch claims;
- the GPU evidence it collected.

Each GPU signs the same session. A proof replayed to another key, nonce or GPU
fails `key-unbound`.

The requester then seals the prompt with HPKE (RFC 9180 base mode:
DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM, checked against the RFC's
vectors). The `info` and the associated data are the session digest. Answers come
back under a key exported from the same HPKE context. Each frame carries its
sequence number in the associated data.

**Coverage.** Each allowlist entry states what its measurement covers:

- `full-image`: the measurement covers the root filesystem, for example a
  dm-verity root hash on the measured kernel command line. The runtime and model
  claims then come from measured code.
- `boot-chain-only`: the measurement covers firmware, kernel and command line
  only. The runtime and model claims are then the executor's own statement, and
  every receipt lists `runtime-and-model-measured-only-by-the-executor-itself`.

### The route

1. **`prepare`** takes no content. It discovers unsigned offers (participant,
   platform, launch id, model, operator, credit price) and keeps only those on
   the requester's allowlist within its price ceiling. It pins one, and requires
   `generation.maxOutputTokens`, so `maxCharge` = limit × price in
   `noncash-service-credit`. All four metadata names must be allowed.
2. **`run`** connects and sends a challenge with a fresh 32-byte nonce, the model
   and the launch id. The executor answers with evidence. The requester verifies
   all of it, and checks that the attested participant, launch and platform are
   the planned ones (`EXECUTION_PLAN_CHANGED` otherwise).
3. **Credits.** Only after verification does it reserve the credit ceiling, and
   only then does it seal and send the prompt. With no valid proof it sends
   `abort` and nothing else. Nothing falls back to readable, local or another
   executor.
4. **The answer** streams as `output.delta` events. The result has the ordinary
   shape: `output`, `usage`, and `settlement` with the charge in Reploid credits
   (output tokens × the planned price). The `executionReceipt` names the
   requested model. Its confidentiality evidence lists what this requester
   checked:
   - `requester-nonce`
   - `cpu-confidential-vm`
   - `gpu-confidential-computing`
   - `approved-launch`
   - `session-key-binding`
   - `sealed-to-attested-key`

   It also lists what it did not check, and the requester's own timings.

**What is disclosed.** Disclosed to the hardware operator, carriers and the
credit ledger:

- the model identity and attested launch;
- prompt and answer sizes, and the timing of every frame;
- page-level memory access patterns, which confidential VMs do not hide from the
  hypervisor (hence `access-patterns`);
- the participant, operator, region and network metadata.

Disclosed to the vendors: trust in NVIDIA, and in AMD or Intel.

**Not claimed:**

- that nobody can read the content;
- side-channel resistance;
- correct computation;
- the runtime's conduct beyond what its measurement covers;
- availability, since an operator can always refuse or stop the VM;
- independent review.

A one-GPU pass proves a useful hosted option and nothing about splits.

### Failure modes

Every row fails closed: no prompt is sealed, no credits are held, and the run
fails with no output.

| Failure | Result |
| --- | --- |
| Route not enabled | `ATTESTED_EXECUTION_UNAVAILABLE` before discovery |
| No allowlisted offer, price above ceiling, unnamed participant | `EXECUTION_ROUTE_UNAVAILABLE` |
| Leakage not allowed, no output ceiling | `LEAKAGE_NOT_ALLOWED`, `EXECUTION_REQUEST_INVALID` |
| Evidence answers another nonce | `ATTESTATION_REJECTED` `nonce-mismatch` |
| Evidence too old, or a session longer than policy | `evidence-stale` |
| CPU measurement or launch not on the allowlist | `measurement-unknown` |
| Launch serves another model | `model-mismatch` (or the executor refuses first) |
| SNP DEBUG, any TDX debug-group attribute, a debug quoting enclave, or GPU developer-tools mode | `debug-enabled` |
| SNP policy allows a migration agent, or the TDX trust domain is migratable | `migration-allowed` |
| TDX quote made by an enclave other than the pinned quoting enclave | `quoting-enclave-unknown` |
| GPU CC mode off | `gpu-not-cc` |
| REPORT_DATA or the GPU nonce does not bind this session and key | `key-unbound` |
| Expired certificate | `certificate-expired` |
| Unpinned root, broken chain | `certificate-invalid` |
| OCSP says revoked | `certificate-revoked` |
| OCSP missing, stale or unknown, or a required hook missing | `revocation-unchecked` |
| GPU measurements match no RIM reference set | `gpu-measurement-unknown` |
| Report signature does not verify | `signature-invalid` |
| TCB below policy, quoting enclave below the pinned version, TDX collateral not up to date | `tcb-out-of-date` |
| Not enough credits for the ceiling | the ledger's refusal, before sealing |
| Tampered, reordered or unknown frame after binding | `ATTESTED_PROTOCOL_VIOLATION`, no output, credits released |
| Runtime failure inside the VM | `ATTESTED_RUNTIME_FAILED` (a code only), credits released |
| Session expired before the request | `ATTESTED_SESSION_EXPIRED` |

### What a confidential-VM host exposes

The executor ([`server/attested-gpu/executor.js`](../server/attested-gpu/executor.js))
serves three endpoints:

- `GET /offer`, the unsigned offer;
- `GET /ready`;
- `WS /attested`, one session per connection.

It runs on top of four host ports:

- `collectCpuEvidence(reportData)`: Linux configfs-tsm (`inblob`, `outblob`,
  `auxblob`). For SNP it reads the VCEK from the extended report's certificate
  table, or from AMD KDS. For TDX it reads the quote with its PCK chain.
- `collectGpuEvidence(nonce)`: NVML through
  [`gpu-evidence.py`](../server/attested-gpu/gpu-evidence.py), giving the
  attestation report, the certificate chain and the CC state, plus OCSP
  responses fetched and stapled by the host. Stapling is safe because the
  requester verifies each response.
- `generate`: a loopback OpenAI-compatible runtime in the same VM. That is
  Reploid's native host with Doppler, or a CUDA runtime if the Vulkan path is
  unavailable in CC mode. Either way it must not log prompts.
- `launch`: from a `reploid.attested-gpu-launch/v1` manifest whose runtime and
  model files are hashed at start. Any mismatch refuses to start.

The executor logs sizes, timings and codes only. A requester that disconnects
at any point ends its own session and nothing else.

The platform must give the guest a raw CPU report with guest-chosen REPORT_DATA.
GCP's TDX confidential VMs do (configfs-tsm). Azure's SEV-SNP confidential VMs
generate the report below the guest, through a paravisor and vTPM, and bind
guest data only through a vTPM quote. That needs a vTPM adapter, which is not
built.

### Split stages across operators

The design extends to a protected handoff between split stages run by separate
operators. It is not built.

**The concrete next step:**

1. **Attest every stage.** The requester runs the challenge and verification
   above against every stage of a partition plan before sending anything. Each
   stage has its own nonce, key and launch, and each launch pins the Doppler
   partition build for that stage.
2. **Route ticket.** The requester signs a ticket for each stage with a key
   named in its challenge. The ticket carries the route id, the stage's index,
   and the attested HPKE key and session digest of the next stage (the last
   stage's next hop is the requester).
3. **Sealed activations.** Stage *i* seals each boundary activation to stage
   *i + 1* with HPKE. The associated data binds the route id, stage index,
   decode step and sequence. The KV cache never leaves a stage. Operator A sees
   stage B's traffic only as ciphertext, sizes and timing.
4. **Failure.** Any stage that fails attestation refuses the whole route before
   the prompt is sealed. Any frame that fails authentication ends the session.

**What is missing:**

- the ticket and per-hop sealing in `mesh/partitions/`;
- Doppler's partition boundary carried through that sealed channel;
- a measurement of the added per-token latency between operators.

Until that handoff exists and passes a test with two operators, attested
execution remains an optional hosted tier, and a one-GPU pilot does not move the
confidential split gate.

### Tests

- [`tests/unit/attested-gpu-hpke.test.js`](../tests/unit/attested-gpu-hpke.test.js)
  checks HPKE against the RFC 9180 A.1 vectors, plus tampering, context and
  sequence checks.
- [`tests/unit/attested-gpu-verifier.test.js`](../tests/unit/attested-gpu-verifier.test.js)
  runs the verifier and session against **synthetic** fixture reports from
  [`tests/helpers/attested-gpu-fixtures.js`](../tests/helpers/attested-gpu-fixtures.js).
  The structures are real (X.509 DER, OCSP, SNP report v3, TDX quote v4, SPDM)
  and the keys are test-only. It covers valid evidence on both platforms, and
  each case fails before the prompt is sealed:
  - wrong nonce, stale evidence, unknown measurement (both platforms), a change
    in each pinned TDX RTMR, and the TD quote body layout stated independently
    of the fixture builder;
  - SNP, TDX and GPU debug, GPU not in CC mode, TDX host profiling, and a guest
    the host could migrate (both platforms);
  - a TDX quote from an unpinned, debug or outdated quoting enclave, and a
    policy that pins none;
  - unbound key (both platforms);
  - expired, revoked and stale-OCSP certificates, an unpinned root;
  - unknown GPU measurements, a bad report signature, another model;
  - a missing revocation hook.
- [`tests/unit/attested-gpu-route.test.js`](../tests/unit/attested-gpu-route.test.js)
  checks the API end to end: off by default everywhere, including the port
  called directly without its own flag, distinct from
  requester-only, the disclosures, the receipt with model and credit charge, and
  the credit hold released or never placed.
- [`tests/integration/attested-gpu-executor.test.js`](../tests/integration/attested-gpu-executor.test.js)
  runs the executor over a loopback WebSocket with the pilot's requester flow, a
  streamed loopback runtime, a requester that leaves while evidence is being
  collected, launch measurement, the SNP certificate table and OCSP requests.

The configfs-tsm and NVML collectors have not run on real hardware. The first
pilot is their first exercise.

## Not claimed

- No trustless compute, and no cryptographic protection from executors.
  Hardware attestation is checked only on the unreviewed attested GPU route,
  which no shipped surface enables, and only under the assumptions stated there.
  Neither the backend registry nor any advertisement can enable a protected or
  attested route, and no surface turns a requester-only or attested-execution
  request into a readable one.
- A recipient's conduct after it reads content: retention, copying, erasure.
- Correct computation. The receipt checks identities and stream consistency,
  not numerical correctness, and reported token counts are the provider's.
- Ownership of a device beyond the pairing the user approved on it.
- Confidentiality from the server that receives an ordinary HTTP JSON body.
- Tests use injected generators and in-memory transports. They establish the
  contract, not physical inference or production readiness.
