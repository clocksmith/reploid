# Protection and route: the inference API

Parked 2026-11-25: the Orin kill gate failed (latency, memory and key-size limits); the route stays disabled and unmaintained beyond safety fixes.

`reploid/inference` is Reploid's native inference API. The browser chat, the
`reploid ask` CLI and the SDK all use it, and the OpenAI- and Anthropic-shaped
HTTP endpoints are adapters over it. So are the native fleet host's owner
`generate` command, the daily game's fleet turn, Work's network steps and AskPeer
tool, and the model-imitation study. This page describes what each protection
and route guarantees and exposes. It also gives the request, capability, plan,
event, result and receipt shapes, and the stable refusal codes.

Source: [`packages/reploid/src/inference/`](../packages/reploid/src/inference/),
[`chat/execution-policy.js`](../packages/reploid/src/chat/execution-policy.js)
(requirement compiler and backend registry),
[`inference/protections.js`](../packages/reploid/src/inference/protections.js)
(the one source of display names, lines and code texts),
[`chat/execution-offers.js`](../packages/reploid/src/chat/execution-offers.js)
(backend eligibility). The layered peer policy underneath is described in
[execution-privacy.md](execution-privacy.md).

## Execution requirements

A request states two things: `protection`, how data is processed, and `route`,
where and how the model runs. The request is typed per protection, so a route a
protection cannot take cannot be written:

```ts
type Participants = { kind: "open" } | { kind: "named"; ids: string[] };

type Execution =
  | { protection: "plaintext"; route: "local"; allowMetadata: MetadataKind[] }
  | { protection: "plaintext"; route: "remote" | "split" | "split-local-edges" | "auto";
      participants: Participants; allowMetadata: MetadataKind[] }
  | { protection: "secret-sharing"; route: "split" | "auto"; participants: Participants; allowMetadata: MetadataKind[] }
  | { protection: "homomorphic"; route: "remote" | "auto"; participants: Participants; allowMetadata: MetadataKind[] }
  | { protection: "attested"; route: "remote" | "auto"; participants: Participants; allowMetadata: MetadataKind[] };
```

`protection` and `route` are required; neither has a default. JSON cannot be
type-checked, so runtime validation refuses anything outside this union with
`EXECUTION_REQUEST_INVALID`, and the error names the routes that protection
allows (for example `protection secret-sharing takes route split, auto`). A
`local` request has no `participants` field: this device has no participants.

The routes:

| `route` | Meaning |
| --- | --- |
| `local` | This device runs the whole model. Plaintext only. |
| `remote` | One other computer runs the whole model. |
| `split` | Several computers run the model in stages, with any eligible computers at the edges. |
| `split-local-edges` | Several computers, with two devices bound to the requester holding the first and last stage. Plaintext only; both edges must be bound to the requester, otherwise the request is refused. |
| `auto` | Any route this protection allows. |

`auto` never chooses weaker protection, but under `plaintext` it may choose any
of `local`, `remote` and `split`. It includes `local` when the model is on this
device, since local means fewer readers. It can also choose a split, which
widens who reads the message: "never weaker protection" does not mean "never
more readers". The plan states the chosen route and its readers before anything
is sent. `auto` never chooses `split-local-edges`, which must be asked for. Plans
and receipts record the concrete `routeKind` (`local`, `remote`, `split` or
`split-local-edges`), never `auto`.

`participants` is `{ kind: "open" }` or `{ kind: "named", ids }`. `open` permits
discovery, not disclosure: every recipient is still bound and checked against
the plan before anything is sent. A device that holds one share is a participant
even though it cannot read the underlying value.

| `protection` | Routes | Status in this build | Refusal when it cannot run |
| --- | --- | --- | --- |
| `plaintext` | `local`, `remote`, `split`, `split-local-edges`, `auto` | Available. Each computer that processes the request reads what it receives | Ordinary route refusals |
| `secret-sharing` | `split`, `auto` | Off unless a host enables its unreviewed route; the protocol (`reploid.secret-shared-2party/v1`) is pinned in the plan and callers choose no share count | `CONFIDENTIAL_EXECUTION_UNAVAILABLE`, reason `secret-shared execution is unreviewed and off by default` |
| `homomorphic` | `remote`, `auto` | Off unless a host enables the unreviewed [protected route](#protected-route-research-unavailable) | `CONFIDENTIAL_EXECUTION_UNAVAILABLE`, reason `awaiting independent security review` |
| `attested` | `remote`, `auto` | Reserved. Accepted as a value and always refused: the attested route is parked and no verified hardware is qualified | `CONFIDENTIAL_EXECUTION_UNAVAILABLE`, reason `no attested route is enabled in this build, so no hardware or its software is verified` |

A refusal happens before discovery or disclosure. Nothing is sent, and a
request is never retried with another protection, made local, or run on a
weaker route.

**Requester-held edges** (`route: "split-local-edges"`) is a strict placement
rule for a plaintext split, not a protection. The first and last stages run on
two devices bound to the requester; every other stage reads plaintext
intermediate activations. Both edge identities must be among the devices the
host's `requesterDevices` port binds to this requester, or the request is
refused with `EXECUTION_ROUTE_UNAVAILABLE`. A protected split has its own route
and disclosure. See [Requester-held edges](#requester-held-edges).

Values before 2026-11-25 map as follows (a clean cutover; the old fields are
refused as `EXECUTION_REQUEST_INVALID`, and the `placement` and `topology`
fields of the first cutover are gone too):

| Old `confidentiality` | Now |
| --- | --- |
| `executor-readable` | `protection: "plaintext"`, with `route: "local"` for local-only placement and otherwise the route asked for (`auto` when none was) |
| `requester-edges` | `protection: "plaintext"`, `route: "split-local-edges"` |
| `secret-shared-2party` | `protection: "secret-sharing"`, `route: "split"` or `"auto"` |
| `requester-only` | `protection: "homomorphic"`, `route: "remote"` or `"auto"` |

**Encrypted** is not used as a product term for the wire. WebRTC (DTLS) and
HTTPS protect the wire; under `plaintext` the computer that runs the model
still reads the content.

## "Who can read it?" in the Poolday chat

The chat's "Who can read it?" dialog opens from the chip beside "Answer on" in
the composer. The chip shows the thread's protection label. The protection is
stored per thread and sent explicitly on every request. The dialog lists every
protection with its line; protections are not ranked, and list order is not
strength. A protection this route cannot use is shown disabled with its reason.

| Label | `protection` | Line |
| --- | --- | --- |
| Standard | `plaintext` | Computers that process your request can read the data they receive. |
| Secret sharing | `secret-sharing` | Each peer gets one share. Two peers on the same stage can combine their shares to read intermediate data. Your device recombines the intermediate results. |
| Compute on encrypted data | `homomorphic` | Your device keeps the key. Remote computers compute on encrypted values. |
| Verified hardware | `attested` | Approved software can read your data inside protected hardware. You're trusting that hardware and software. |

No label promises speed. A latency estimate is shown only from a relevant
measurement (`listCapabilities` returns one only when the host has it).

**Where it runs** is a separate choice: the route, not the protection.

| Label | `route` |
| --- | --- |
| This device | `local` |
| One computer | `remote` |
| Several computers | `split` |
| Several computers, your devices at both ends | `split-local-edges` |
| Let it choose | `auto` |

A route the current protection or model cannot use is shown disabled with its
reason.

**Only your devices** is a participants choice, not a route: `protection:
"plaintext"` with `route: "remote"` or `"split"` and `participants: named`
limited to the devices paired with this one. Your paired desktop counts as
yours because you approved its single-use pairing code on that desktop
([owner pairing](../apps/poolday/host/owner-pairing.js)). Reploid does not
otherwise verify who owns a computer. A host that invited you as a guest is
never counted as one of your devices, and open discovery is never permission to
disclose.

**Any plaintext split** shows how many computers can read the message, counted
from the plan's prompt readers, for example "3 computers can read your
message." A plaintext split with requester-held edges keeps its own line instead:
"Your devices handle the prompt and answer. Other computers see intermediate data that may reveal both."
A protected split states its own disclosure, never that warning.

The "Answer on" sheet keeps its computer and model consistent with these
choices. Choosing a model that only contributors run moves the sheet to
Contributors and states who can read the prompt before anything applies; a
private-pool model, which never runs on this device, chooses its pool and applies
at once, and its route binds only the enrolled computers it names. Under
"Only your devices" the sheet does not move: it explains the choice beside the
model and offers "Use contributors", which changes it only when pressed. An
invite link keeps its host as the only computer that may read prompts.

## The native API

```js
import { createInference } from 'reploid/inference';

const { capabilities } = await inference.listCapabilities({ model, constraints: { participants: { kind: 'open' } } });

const plan = await inference.prepare({
  model: { id: 'qwen-3-5-2b-q4k-ef16-af32', identity: 'sha256:…', adapterIdentities: [] },
  generation: { maxOutputTokens: 128 },
  execution: {
    protection: 'plaintext',                          // required: plaintext | secret-sharing | homomorphic | attested
    route: 'auto',                                    // required; per protection, see the table above
    participants: { kind: 'named', ids: ['peer:…'] }, // or { kind: 'open' }; absent for route 'local'
    allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] // a plaintext route discloses all four
  }
}, { signal });

const run = await inference.run({ planId: plan.id, requestId: 'caller-key-1', input: { messages } }, { signal });
for await (const event of run.events) { /* admitted, output.delta…, then completed | cancelled | failed */ }
const result = await run.result;
```

The host provides two ports. `resolveRoute` describes the route a request would
take without sending anything, including its charge ceiling. `execute(job,
controls)` runs it through the existing peer binding, and must call
`controls.requestApproval(preview)` with the execution binding before any remote
disclosure. Optional ports: `requesterDevices({ signal, context })` lists the
device identities bound to this requester (required for `split-local-edges`),
and `latencyEstimate({ protection, model, route })` returns a measured estimate
(`{ milliseconds, measuredAt, source }`) or nothing.

**Times.** Every time in the API is a string in exactly the form
`YYYY-MM-DDTHH:MM:SS.sssZ`, matching the settlement records: the plan's
`expiresAt`, `checkedAt` and `latency.measuredAt` in capabilities, a `reviewed`
review's `at`, and the receipt's `issuedAt`. There are no epoch numbers. The
receipt's delivery `timeline` is the one exception in kind, not format: its
`at` values are milliseconds from the first frame, a duration rather than a
time.

### listCapabilities

`listCapabilities({ model?, constraints? })` takes no prompt and sends none.
`constraints` may set `participants` and `allowMetadata`. For each protection it
lists every route that protection allows, each `available`, `unavailable` or
`unknown`, with the reason, what was checked and when. The protection's own
`status` is its best route's:

```json
{
  "advisory": true,
  "checkedAt": "2026-11-25T17:10:00.000Z",
  "capabilities": [
    { "protection": "plaintext", "status": "available", "reason": "a remote route resolved for this model and these constraints", "code": null,
      "checked": ["host-configuration", "requirements", "route-resolution", "disclosure", "charge-ceiling"], "checkedAt": "2026-11-25T17:10:00.000Z",
      "routes": [
        { "route": "local", "status": "unavailable", "reason": "This device has no route for this model. Nothing was sent.", "code": "EXECUTION_ROUTE_UNAVAILABLE",
          "checked": ["host-configuration", "requirements", "route-resolution"], "checkedAt": "2026-11-25T17:10:00.000Z" },
        { "route": "remote", "status": "available", "reason": "a remote route resolved for this model and these constraints", "code": null,
          "checked": ["host-configuration", "requirements", "route-resolution", "disclosure", "charge-ceiling"], "checkedAt": "2026-11-25T17:10:00.000Z",
          "latency": { "milliseconds": 820, "measuredAt": "2026-11-24T21:03:11.000Z", "source": "receipt p50" } },
        { "route": "split", "…": "…" }, { "route": "split-local-edges", "…": "…" }, { "route": "auto", "…": "…" }
      ] },
    { "protection": "secret-sharing", "status": "unavailable", "reason": "secret-shared execution is unreviewed and off by default",
      "code": "CONFIDENTIAL_EXECUTION_UNAVAILABLE", "checked": ["host-configuration"], "checkedAt": "2026-11-25T17:10:00.000Z",
      "routes": [{ "route": "split", "status": "unavailable", "…": "same reason" }, { "route": "auto", "status": "unavailable", "…": "same reason" }] },
    { "protection": "homomorphic", "status": "unavailable", "reason": "awaiting independent security review",
      "code": "CONFIDENTIAL_EXECUTION_UNAVAILABLE", "checked": ["host-configuration"], "checkedAt": "2026-11-25T17:10:00.000Z",
      "routes": [{ "route": "remote", "…": "…" }, { "route": "auto", "…": "…" }] },
    { "protection": "attested", "status": "unavailable", "reason": "no attested route is enabled in this build, so no hardware or its software is verified",
      "code": "CONFIDENTIAL_EXECUTION_UNAVAILABLE", "checked": ["host-configuration"], "checkedAt": "2026-11-25T17:10:00.000Z",
      "routes": [{ "route": "remote", "…": "…" }, { "route": "auto", "…": "…" }] }
  ]
}
```

Without a model, an enabled protection's routes are `unknown` (no route was
resolved). A resolution that fails for a reason outside the stable codes is
`unknown`, never `available`. `latency` appears only when the host returned a
measurement with a `measuredAt` in the API's time format. Capabilities are
advisory, never permission to send: `prepare` and `run` check everything again.

### prepare

`prepare({ model, execution, generation })` takes no prompts, tools or prompt
hashes. Any other field is `EXECUTION_REQUEST_INVALID`. It compiles the
requirements into the verified peer policy (`reploid.execution-policy/v2`),
refuses an unavailable protection and disallowed metadata, and pins a route. It
places no credit hold and no charge. It returns an expiring plan:

```json
{
  "id": "plan_6f0c…",
  "expiresAt": "2026-11-25T17:12:00.000Z",
  "protection": "plaintext",
  "routeKind": "remote",
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
  "maxCharge": { "kind": "capped", "maximum": 128, "unit": "noncash-service-credit" },
  "disclosure": {
    "prompt": { "readers": [{ "role": "requester-device" }, { "role": "answering-computer", "selection": "one-of", "ids": ["peer:4b1d…"] }],
                "assumptions": ["recipient-conduct-unchecked", "named-device-ownership-unchecked"],
                "verified": true, "check": "route-binding-before-release" },
    "intermediate": { "…": "as prompt" },
    "answer": { "…": "as prompt" },
    "metadata": { "items": ["model-id", "timing", "length", "access-patterns"],
                  "readers": [{ "role": "requester-device" }, { "role": "answering-computer", "selection": "one-of", "ids": ["peer:4b1d…"] },
                              { "role": "carrier" }],
                  "assumptions": [], "verified": false, "check": null },
    "trustAssumptions": ["recipient-conduct-unchecked", "named-device-ownership-unchecked"],
    "review": { "state": "not-applicable" }
  }
}
```

- `routeKind` is the concrete route the plan chose: `local`, `remote`, `split`
  or `split-local-edges`, never `auto`.
- `shape` is `local`, `remote` or `split`. A split route also carries its
  partition `planIdentity`.
- `selection` is the allowed participant set or selection rule:
  - `all`: every listed participant reads the content. Used for a split, or a
    paired native coordinator plus its provider.
  - `one-of`: exactly one listed participant will. Used for named whole-model
    participants.
  - `any-eligible`: an open whole-model request. The provider's identity is
    proved at admission, so the plan cannot name it in advance. The `admitted`
    event names it before anything is sent.
- `maxCharge` is `{ kind: "capped", maximum, unit }` or `{ kind: "free" }`,
  never null or unknown. A local route is free. A network route whose resolver
  does not state a cap is refused with `EXECUTION_ROUTE_UNAVAILABLE` ("The
  charge for this route cannot be capped"): nothing that could charge is
  planned without a ceiling. At `run`, a free plan must stay free, and a capped
  plan's ceiling may not rise or change unit.
- `disclosure` is broken into `prompt`, `intermediate` (intermediate state),
  `answer` and `metadata`. Each names who can read it (`readers`), under which
  `assumptions`, whether that reader set is checked by this requester
  (`verified`, with the `check` method: `local-route`,
  `route-binding-before-release` or `null`), and for metadata the `items`
  exposed. `readers` is a non-empty list of readers, or `"unknown"`: never an
  empty list, which would read as "nobody" without conditions. Every route
  names at least `requester-device`. `trustAssumptions` collects the
  assumptions. A plan whose disclosure is incomplete, or uses a role or
  assumption outside the fixed codes, is refused with
  `EXECUTION_ROUTE_UNAVAILABLE`.
- `review` is `{ state: "not-applicable" }` (plaintext), `{ state:
  "not-reviewed" }` (secret sharing, computing on encrypted data), or `{ state:
  "reviewed", by, at, reference }` once an independent review exists (none
  does in this build).
- The disclosure carries codes, never prose. `describeDisclosure(disclosure)`
  in `inference/protections.js` renders it as text from the display tables
  below; the CLI and the chat use it. Backend details live under a typed
  `extensions` object: `extensions.secretSharing` (protocol, collusion model,
  `sharesHeldBy`) and `extensions.homomorphic` (status, `computedBy`, `leaks`,
  `trapOracle`).
- The disclosure describes the backend, not the permission. A plaintext
  executor reads the content, so it also observes its access patterns: both
  plaintext backends list `access-patterns` with `model-id`, `timing` and
  `length`, and a plaintext request must allow all four (providers on earlier
  releases refuse a plaintext policy that omits any of them). Coordinators,
  credit ledgers and relays can see the other three. The protected backend
  computes data-independently and does not list `access-patterns`. A local
  route exposes nothing beyond this device.

**Reader roles** are fixed codes. A reader is `{ role, ids?, selection?,
stages?, when? }`; `when` makes it conditional. The display text comes from
`READER_ROLE_DISPLAY`:

| `role` | Display text | Used for |
| --- | --- | --- |
| `requester-device` | this device | Every route |
| `requester-edge-device` | your devices at both ends | `split-local-edges`: prompt and answer |
| `answering-computer` | the computer that answers | `remote` (named, or `any-eligible` with no ids) |
| `stage-operator` | the computers that run each stage | `split`; the middle stages of `split-local-edges` |
| `share-holder` | peers that each hold one share | Secret sharing |
| `evaluator` | the computer that computes on encrypted values | Computing on encrypted data |
| `carrier` | coordinators, credit ledgers and relays | Metadata |
| `signaling` | the signaling server | Reserved |
| `network-observer` | observers of the network | Reserved |

Secret sharing names a **conditional reader**: two share holders of the same
stage, if they combine their shares, can read that stage's intermediate data and
from it reconstruct the prompt and the answer. It is expressed, and tested, as

```json
{ "role": "share-holder", "ids": ["peer:a", "peer:b", "peer:c", "peer:d"],
  "when": { "collusion": { "sameStage": true, "count": 2 } },
  "stages": [{ "stage": 0, "layers": [0, 11], "ids": ["peer:a", "peer:b"] }, { "stage": 1, "layers": [12, 23], "ids": ["peer:c", "peer:d"] }] }
```

beside `requester-device` in the prompt, intermediate and answer readers, never
as an empty list meaning "nobody".

**Assumptions** are fixed codes too, with their text in `ASSUMPTION_DISPLAY`:

| Code | Display text |
| --- | --- |
| `recipient-conduct-unchecked` | Recipients keep what they read: their conduct, retention and erasure are not checked. |
| `named-device-ownership-unchecked` | Reploid does not check who owns a named device. |
| `edge-devices-bound-to-requester` | Both edge devices are bound to you; the binding is checked before release, their conduct is not. |
| `activations-may-reveal-content` | Intermediate data is plaintext model state and may reveal the prompt and the answer. |
| `share-holders-do-not-collude` | Two peers on the same stage do not combine their shares. |
| `requester-recombines-intermediates` | Your device recombines the intermediate results. |
| `semi-honest-operators` | Peers follow the protocol and return correct results; nothing here checks them. |
| `not-independently-reviewed` | Not independently reviewed. |
| `parameters-not-estimated` | The parameters have not been security-estimated. |
| `insecure-development-parameters` | Insecure development parameters: the evaluator can read everything it receives. |
| `requester-key-holder-unchecked` | Your device's key holder alone holds the secret key; this client does not check it. |
| `traps-detect-blind-tampering-only` | Known-answer checks detect only blind tampering. |
| `trap-oracle-does-not-collude` | The trap oracle does not collude with the evaluator. |
| `hardware-vendor-trusted` | You trust the hardware vendor and the approved software. |

### run

`run({ planId, requestId, input })` takes the input on the requester side.
Before releasing it, it resolves the pinned route again, binds and authenticates
the actual participants, completes any required authorization, and checks them,
the backend, the disclosure, the charge ceiling and the plan's expiry against
the plan. If anything no longer fits, the run is refused (`EXECUTION_PLAN_CHANGED`
or `EXECUTION_PLAN_EXPIRED`) and a new plan is required. It never downgrades.
When the executor asks to disclose, the admitted binding must match the plan's
backend, protocol, model, adapters and participants, and its policy may only
narrow the requested one; otherwise the approval returns false before any
content is sent. After the first admission no other route is accepted.

A plan runs once. `requestId` is the caller's idempotency key: a repeated
`requestId` for the same plan returns the same run, a `requestId` that already
ran is never dispatched or charged again (`EXECUTION_REQUEST_INVALID`), and a
run refused before anything was sent frees its `requestId`.

Protected input never goes through an ordinary JSON endpoint that can read it:
the HTTP adapters and the browser bridge refuse every protection but
`plaintext`.

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

`reploid.execution-receipt/v2` is returned on completion, cancellation and
failure. It records when it was issued, the protection and the concrete
`routeKind`, the requested requirements and their policy identity, the route
and parties that actually ran, the backend and protocol identity, and the
disclosure. Its evidence keeps three records separate: `privacy` (the checks
this requester made and their limits), `integrity` (answer checks) and
`credits` (charged or released, as reported). `by: "requester"` means this
inference client checked the claim itself. A claim not listed was not checked.
Every field is typed: there are no open index signatures, and backend details
sit in typed `extensions` objects.

```json
{
  "schema": "reploid.execution-receipt/v2",
  "api": "reploid.inference/v2",
  "requestId": "caller-key-1", "attemptId": "attempt_…", "planId": "plan_6f0c…", "status": "completed",
  "issuedAt": "2026-11-25T17:10:04.218Z",
  "protection": "plaintext",
  "routeKind": "remote",
  "requested": { "model": { "id": "…", "identity": "sha256:…", "adapterIdentities": [] },
                 "execution": { "protection": "plaintext", "route": "auto",
                                "participants": { "kind": "named", "ids": ["peer:4b1d…"] },
                                "allowMetadata": ["model-id", "timing", "length", "access-patterns"] },
                 "policyId": "sha256:…" },
  "route": { "planRouteId": "sha256:83ee…", "admittedRouteId": "sha256:…", "policyId": "sha256:…", "shape": "remote",
             "participants": ["peer:4b1d…"], "backend": "doppler-plaintext/v1", "protocol": null, "planIdentity": null },
  "disclosure": { "…": "as in the plan" },
  "evidence": {
    "privacy": {
      "protection": "plaintext",
      "routeKind": "remote",
      "contentReadBy": { "requesterDevice": true, "participants": ["peer:4b1d…"] },
      "intermediateReadBy": { "participants": ["peer:4b1d…"] },
      "checks": [{ "claim": "content-recipients", "by": "requester", "method": "route-binding-before-release", "value": ["peer:4b1d…"] }],
      "notVerified": ["recipient-conduct", "erasure", "hardware-attestation"]
    },
    "integrity": {
      "checks": [
        { "claim": "model-identity", "by": "requester", "method": "answer-identity", "value": "sha256:…" },
        { "claim": "adapter-identities", "by": "requester", "method": "answer-identity", "value": [] },
        { "claim": "stream-matches-answer", "by": "requester", "method": "text-comparison" }
      ],
      "providerReceipt": { "digest": "sha256:…", "checkedHere": false },
      "notVerified": ["correct-computation", "reported-token-counts"]
    },
    "credits": {
      "record": { "kind": "service-credit", "unit": "noncash-service-credit", "charge": 3, "outputTokens": 3 },
      "digest": "sha256:…",
      "checkedHere": false,
      "notVerified": ["charge-amount", "confidentiality-from-billing"]
    }
  }
}
```

`checks` are typed claims whose `claim` is one of a fixed set of codes:
`content-stayed-on-requester-device`, `content-recipients`,
`edge-devices-bound-to-requester`, `activation-only-recipients`,
`share-recipients`, `fresh-shares-every-round`, `evaluator-session-binding`,
`no-evaluator-requests-answered`, `model-identity`, `adapter-identities`,
`stream-matches-answer`, `known-answer-traps` and `frame-binding`.

`content-recipients` means the requester bound the request to that recipient
set before sending, under the peer admission protocol. It says nothing about
what a recipient did afterwards. A local route records
`content-stayed-on-requester-device` instead. `providerReceipt` is a digest of
the provider's signed record when one was returned. The inference layer retains
it and does not re-verify it. `credits.record` is a typed service-credit record
(`kind: "service-credit"` with optional `id`, `reservationId`, `status`,
`unit`, `settledAt`, `charge`, `charged`, `released` and `outputTokens`), as the
executor or ledger reported it; fields outside that record are dropped and
kept only in `digest`. A signed bill is not proof of confidentiality.

### Refusal codes

| Code | When | Sent |
| --- | --- | --- |
| `CONFIDENTIAL_EXECUTION_UNAVAILABLE` | `protection` is `attested` (always), or `homomorphic` / `secret-sharing` on a host that did not enable its unreviewed route. The request is never retried with weaker protection and never made local | Nothing |
| `LEAKAGE_NOT_ALLOWED` | The route exposes metadata that `allowMetadata` omits | Nothing |
| `EXECUTION_PLAN_EXPIRED` | The plan lapsed, was already run, or never existed | Nothing |
| `EXECUTION_PLAN_CHANGED` | The route, participants, backend, model, adapters or charge ceiling differ from the plan, before or at disclosure | Nothing beyond what the plan admitted |
| `RESULT_UNVERIFIED` | The answer names another model or adapters, contradicts its stream, exceeds the limit, or arrives without an admitted route | The plan's participants already had the content; no result is returned |
| `EXECUTION_REQUEST_INVALID` | Requirements outside the per-protection union (a route that protection does not take, `participants` on a `local` request, a missing `protection` or `route`, an old `confidentiality`, `placement` or `topology` field), a prompt or tool given to `prepare`, an invalid or already-run `requestId` | Nothing |
| `EXECUTION_ROUTE_UNAVAILABLE` | No route meets the requirements, for example `local` on a network-only deployment, an explicit route with no such route available, a route outside the named participants, a network route that cannot cap its charge, or `split-local-edges` whose two edges cannot be established as bound to the requester (it never falls back to an ordinary split) | Nothing |

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
    "execution": { "protection": "plaintext", "route": "auto",
                   "participants": { "kind": "named", "ids": ["peer:4b1d…"] },
                   "allowMetadata": ["model-id", "timing", "length", "access-patterns"] },
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
without one runs under the standard requirements (`protection: "plaintext"`,
`route: "auto"`, `open` participants, `model-id`, `timing`, `length` and
`access-patterns` allowed), bounded by the operator's `executionPolicyFor`
policy. The caller's requirements may narrow the operator's policy but never
widen it. These endpoints run on network participants, so `route: "local"` is
refused.

**Every protection but `plaintext` is refused on these endpoints**, and so is
`route: "split-local-edges"`. An ordinary JSON body is plaintext to the server
that receives it, so these endpoints cannot protect it, or keep it on the
requester's devices, afterwards. A `secret-sharing`, `homomorphic` or `attested`
request is answered with HTTP 422 and `code:
"confidential_execution_unavailable"`; requester-held edges with HTTP 503 and
`code: "execution_route_unavailable"`. Neither is authorized, executed or
forwarded. The bytes have still reached this server's process. A client that
must keep content from the server must not send it over plain JSON.

When the extension is present, all three return the same record in a top-level
`reploid` field. Chat Completions puts it on its final chunk when streaming,
Messages on `message_delta`, and Responses on the final response object:

```json
"reploid": {
  "executionReceipt": { "schema": "reploid.execution-receipt/v2", "…": "as above" },
  "execution": { "…": "the executor's own report (timing, partition summary), carried as reported" },
  "poolId": "reploid-swarm-team",
  "conversationId": "conv-alpha"
}
```

Error bodies carry the stable code in lower case: `error.code` on Chat Completions
and Responses, `error.code` inside the Anthropic-shaped `error` on Messages. The
HTTP statuses are 400 (invalid), 422 (protection unavailable, leakage), 409
(plan changed or expired), 503 (no route) and 502 (unverified result).

Responses no longer requires `store: false`. This server stores no responses,
so `store` may be omitted or false. `store: true` asks for storage that is not
offered and is refused.

## CLI

```sh
npx reploid ask 2b "Hello" --participant peer:4b1d… --allow-metadata model-id,timing,length,access-patterns
npx reploid ask 2b "Hello" --protection homomorphic   # refused before discovery: CONFIDENTIAL_EXECUTION_UNAVAILABLE
npx reploid ask 2b "Hello" --protection plaintext --route remote
```

`--participant` (repeatable) names who may read the prompt. `--allow-metadata`
lists the metadata the route may expose; it defaults to all four, which is what a
plaintext route discloses. `--protection` is `plaintext`, `secret-sharing`,
`homomorphic` or `attested` and defaults to `plaintext` on the CLI (the API
itself has no default). `--route` is one of the routes the protection allows;
it defaults to `auto`. `ask` cannot bind edge devices to the requester, so it
does not offer `split-local-edges`. The flags configure the inference request
and never the participant process.

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

The refusals are the API's: a policy for any protection this host has not
enabled (`homomorphic`, `secret-sharing`, and always `attested`) is
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

## Threat model per protection and route

- **Plaintext, open:** any provider that passes admission for the exact
  model can read the prompt and answer. The requester binds the request to one
  identity-proved recipient before sending (metadata and a salted commitment
  first, messages only after a matching admission). A dishonest recipient can
  keep, copy or misuse what it reads, and it sees the access patterns of the
  content it reads. Signaling, relays and credit ledgers can
  see timing, sizes, model identity and participant identities.
- **Plaintext, named (including "Only your devices"):** the same, with
  readers limited to the named participants. A provider outside the list
  receives nothing, even if it is the only one ready. With your paired desktop
  as the only participant, no computer outside your devices reads the content.
  The desktop's own software and anyone with control of it can.
- **Plaintext, `local`:** nothing leaves this device. Software on the device can
  read the content.
- **Plaintext `split`:** every stage operator reads the prompt and the answer;
  the plan counts them, and the chat shows that count before Send.
- **Plaintext `auto`:** whichever concrete route the plan states. It may be a
  split, with more readers than one computer; the plan's readers are shown
  before anything is sent.
- **Plaintext `split-local-edges` (requester-held edges):** the two edge stages, on devices
  bound to the requester, read the prompt and the answer. Each middle stage
  reads the plaintext activations entering and leaving its layers, the step's
  token count, the generation settings and timing, and signed settlement records
  whose output chain carries no text. An operator of a middle stage can try to
  reconstruct the prompt or the answer from those activations (inversion), and
  learns the prompt and answer lengths. Middle stages that collude learn nothing
  more than each learns alone, apart from pooling their activations.
- **Secret sharing:** each share operator receives one fresh random share of
  each value it computes on and, alone, learns nothing beyond lengths, counts,
  timing and sizes. Two operators of the same stage that combine their shares
  read that stage's intermediate data, from which the prompt and answer can be
  reconstructed: the disclosure names them as a conditional `share-holder`
  reader. The requester's device recombines every intermediate result and
  evaluates every nonlinear step. Unreviewed and off by default.
- **Compute on encrypted data (`homomorphic`):** intended to keep content from
  every remote party, including under collusion of all of them
  (`collusion: "all-remote"`). Not established: its disclosure lists the readers
  beyond this device as `"unknown"`. The research protected route below is the
  candidate; its threat model is stated there. Off by default.
- **Verified hardware (`attested`):** approved software would read the data
  inside protected hardware, trusting that hardware and software. Not stronger
  or weaker than secret sharing; a different trust assumption. Reserved and
  always refused in this build.

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

Without both, `prepare` with `protection: "homomorphic"` throws
`CONFIDENTIAL_EXECUTION_UNAVAILABLE` before discovery, exactly as before, and
`PROTECTED_EXECUTION_STATUS` is `{ available: false, reason: "awaiting
independent security review" }`. The HTTP adapters, the CLI and the chat never
pass the flag, `listCapabilities` reports `homomorphic` as unavailable with that
reason, and `server/fleet/browser-bridge.js` keeps refusing every protection but
`plaintext`. The ports:

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
   the trap source with its oracle keys, and the lane counts) and this
   disclosure (with `extensions.homomorphic.trapOracle`, what the oracle learns):

   ```json
   { "prompt": { "readers": "unknown",
                 "assumptions": ["parameters-not-estimated", "not-independently-reviewed", "requester-key-holder-unchecked"],
                 "verified": false, "check": null },
     "intermediate": { "…": "as prompt" },
     "answer": { "…": "as prompt" },
     "metadata": { "items": ["model-id", "timing", "length"], "readers": [{ "role": "requester-device" }, { "role": "evaluator", "ids": ["peer:…"] },
                   { "role": "carrier" }], "assumptions": [], "verified": false, "check": null },
     "trustAssumptions": ["parameters-not-estimated", "not-independently-reviewed", "requester-key-holder-unchecked",
                          "traps-detect-blind-tampering-only", "trap-oracle-does-not-collude"],
     "review": { "state": "not-reviewed" },
     "extensions": { "homomorphic": {
       "status": { "protection": "target-not-established", "reason": "parameters not estimated; awaiting independent security review" },
       "computedBy": ["peer:…"],
       "leaks": ["model and circuit identity", "prompt length (in the bind offer, before the endpoint proves its key) and generated token count",
                 "lane count", "ciphertext and message sizes", "timing of each step", "session linkage through the key epoch",
                 "after a session, whether a verification failed (through the evaluator lockout and key-epoch rotation): exposure bounded to log2(n + 1) chosen bits per evaluator per key epoch over n sessions, not closed",
                 "evaluator and requester identities and network metadata"],
       "trapOracle": { "learns": ["that a session is starting", "prompt length, generated count and trap count", "request time and network address"],
                       "trusted": "not to collude with the evaluator" } } } }
   ```

   On an insecure development parameter set the same disclosure lists the
   evaluator beside `requester-device` as a reader of the prompt, intermediate
   state and answer, with the single assumption
   `insecure-development-parameters`, and sets
   `extensions.homomorphic.status.protection: "none"`. The route is free
   (`maxCharge: { kind: "free" }`). A request that does not allow all of `model-id`,
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
   has proved its key; the disclosure lists this. Expiries tolerate five
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
evaluator runs the session. The disclosure says so in `trapOracle`, and the
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
`homomorphic` stays off.

Each bit is a predicate the evaluator chose, so a targeted guess is confirmed
outright when it is right. The user's own reactions are outside this bound:
retrying the same prompt elsewhere, or rewording it.

### Threat model

- **Keeping content from remote parties is a target, not an established property.** The design
  rests on RLWE with one secret key that never leaves the requester's key
  holder, and aims to hold if every remote party colludes. Nothing here shows
  that it does. The parameters were never security-estimated, the protocol is
  unreviewed, and on the insecure development parameter set
  (`dev-insecure-n12`, used by the tests) there is **no protection**. There,
  the disclosure lists the evaluator as a reader; otherwise its readers beyond
  this device are `"unknown"`. The disclosure and receipts never claim that no
  one else can read the prompt. They state `status.protection`: `none` for
  insecure parameters, `target-not-established` otherwise, and the receipt's
  `evidence.privacy` lists `protection` and `requester-held-key` as not
  verified. The
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

Fixed since the review: an honest disclosure, the abort oracle bounded (silent
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
the protection is named honestly (neither `attested` nor `secret-sharing` may
silently pass as `homomorphic`), and an
independent security review, the reference answer, and outsider-reproducible
requester debit and stage payouts are all verified from that same run.

## Requester-held edges

`route: "split-local-edges"` with `protection: "plaintext"` (formerly
`confidentiality: "requester-edges"`). It is a placement rule for a plaintext
split, not a protection.

Source: [`chat/execution-policy.js`](../packages/reploid/src/chat/execution-policy.js)
(`EDGES_BACKEND`, `edgesExecutionRoute`),
[`contracts/partition-disclosure.js`](../packages/reploid/src/contracts/partition-disclosure.js),
[`mesh/partitions/partition-route-execution.js`](../packages/reploid/src/mesh/partitions/partition-route-execution.js)
and [`partition-ordered-peer.js`](../packages/reploid/src/mesh/partitions/partition-ordered-peer.js),
[`partition-attempt-evidence.js`](../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js),
[`inference/contract.js`](../packages/reploid/src/inference/contract.js).

### Why this placement rule

The goal is a split request whose operators cannot read the prompt,
intermediate state or answer. The mechanisms considered, against what runs on
ordinary mesh computers today:

- **Hardware-attested execution** trusts the hardware vendor and the attested
  code. The fleet's GPUs (integrated Intel, Jetson, consumer AMD, Apple) offer
  no confidential-computing mode, so it cannot run on them.
- **Homomorphic encryption** (the parked protected route) failed its latency
  and memory limits for any useful model on fleet GPUs.
- **Two-server secret sharing of the linear layers** (Doppler's research
  shares route, now `protection: "secret-sharing"`) hides the input from each
  provider if the two do not collude, and discloses less than this rule. Its measured small-model runs take
  seconds per token over the network with the requester computing every
  non-linear step; it is not integrated with ordered stages, the 27B's packed
  weights or settlement, so it does not run a catalogued split today.
- **Activation masking or permutation without a security argument** was
  rejected: it would invite a confidentiality claim it cannot support.
- **Requester-held edges** keeps the content itself, the token IDs and text of
  the prompt and the answer, on the requester's own devices, at almost no cost,
  using Doppler's ordinary ordered plan (stage 0 holds the embedding and the
  first layers, the last stage holds the last layers, the final norm and the
  output head). It runs on this fleet today. What it leaves exposed is named
  below.

### What it enforces

- The requester names a route whose first and last stage are its own devices,
  and both edge identities must be among the devices the host's
  `requesterDevices` port binds to this requester. If that cannot be
  established, the request is refused with `EXECUTION_ROUTE_UNAVAILABLE` before
  anything is sent, at `prepare` and again at `run`.
  The execution binding (`doppler-partition-edges/v1`) marks those two hops
  `plaintext` and every other hop `activations`; any other shape is refused.
- The coordinator's signed grant names only the two edge stages as token
  recipients. The coordinator sends a middle stage the step's token count and
  its activation, never token IDs; a middle stage refuses a step that carries
  token IDs, and its grant check declines token context. Doppler's resident
  still takes a token array of the step's length, so the middle stage gives it
  zeros; its layers read only the activation.
- The output acknowledgments that every stage holds for settlement chain each
  step with empty text on this route. A chain over each step's text would let a
  middle stage recover the answer by trying every vocabulary entry. The final
  stage and the requester, which compute the chain, are the same principal here.
- `reploid/inference` accepts this route only for such a split: no ordinary
  split substitutes for it, `auto` never chooses it, and no other request runs
  on one. The plan's `routeKind` is `split-local-edges`. Its disclosure lists the
  edge devices as the only readers of the prompt and answer
  (`requester-edge-device`, assumption `edge-devices-bound-to-requester`) and
  the middle stages as readers of intermediate state (`stage-operator`,
  assumption `activations-may-reveal-content`). Its
  line in the dialog: "Your devices handle the prompt and answer. Other
  computers see intermediate data that may reveal both." The receipt records the
  edge binding check and lists `activation-inversion-resistance` as not
  verified.

### What it does not protect

- Middle-stage activations are plaintext model state; inversion attacks can
  recover inputs from them, more easily from early layers. A middle operator also
  learns lengths, timing, the model and the generation settings.
- The edge binding shows the two devices are bound to the requester; it does
  not check what software runs on them or who else controls them.
- It is not a protection: `protection` stays `plaintext`, and no other
  protection is satisfied by it.
- No independent security review has examined it.

## Not claimed

- No trustless compute, hardware attestation or cryptographic protection
  from executors. Neither the backend registry nor any advertisement can enable
  them, and no surface turns a protected request into a plaintext one.
- A recipient's conduct after it reads content: retention, copying, erasure.
- Correct computation. The receipt checks identities and stream consistency,
  not numerical correctness, and reported token counts are the provider's.
- Ownership of a device beyond the pairing the user approved on it.
- Confidentiality from the server that receives an ordinary HTTP JSON body.
- Tests use injected generators and in-memory transports. They establish the
  contract, not physical inference or production readiness.
