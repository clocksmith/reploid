# Execution security and disclosure

The transport, authorization, computation and integrity layers answer different questions.
No layer supplies another layer's guarantee.

| Layer | What it establishes | What it does not establish |
| --- | --- | --- |
| Transport | Poolday discovers and signals connections over WebSocket. WebRTC data channels carry peer requests; a paired native bridge uses an authenticated HTTPS or loopback route. | A connection or room membership alone is not permission to receive a prompt. |
| Authorization | The requester verifies current peer identity and authorizes an exact request, model, route and complete recipient set. A room admits participants; it does not approve their access to request content. | A named recipient is not an encrypted or attested executor. |
| Execution | Local or allowed network placement and the requested computation method. Plaintext compute allows each approved worker or coordinator to read the data that reaches it. | Encryption in transit does not conceal plaintext computation from its recipient. |
| Integrity | Pinned model/artifact identities, signed records and independently scoped correctness checks. | A signed disclosure or settlement receipt does not prove correct computation, erasure, or availability. |

## Current policy and cutover

`reploid.execution-policy/v2` has separate placement (`local-only`, `network-allowed`),
recipient authorization (`none`, `named`, `open`) and computation
(`plaintext`, `cryptographic`, `attested`). Named authorization requires a
nonempty, unique list of identities. Open authorizes consideration of candidates,
not automatic disclosure: a verified recipient must still be approved for the
exact attempt. Transport configuration does not change any of these settings.

Callers do not write this policy. They state requirements through
[`reploid/inference`](confidential-execution.md) (protection, route,
participants, allowed metadata), and `compileExecutionRequirements` compiles
them into it: `route: "local"` becomes `local-only` placement with no
recipients, every other route `network-allowed` with the named or open
participants. Only `protection: "plaintext"` compiles there;
`homomorphic` and `secret-sharing` are refused before disclosure with
`CONFIDENTIAL_EXECUTION_UNAVAILABLE` unless a host enables their unreviewed
routes, and `attested` is always refused.

Missing or obsolete policy is rejected at protected wire edges. There is no
old-policy decoder, remote implication from placement, or downgrade retry.
Older conversation history remains readable: settings reset explicitly to
local-only/no remote recipients, and old disclosure grants are discarded.
This does not execute old policy or carry forward permission. A historical
attempt using an unsupported policy cannot retry; review settings, then send a
new request. Answers record a `reploid.execution-receipt/v2` that states what the
requester checked; older answers with the retired `reploid.privacy-receipt/v2`
display their disclosure as unrecorded.

## Request admission

- **Whole-model WebRTC:** the requester verifies the peer for the active
  channel and rejects peers without admission protocol 2. It binds the policy,
  identity, model, adapters and offer. After exact requester approval, the
  recipient first receives metadata and a salted commitment, not content.
  The provider verifies eligibility, capacity, replay fences and configured
  credit admission. Only a matching admission lets the requester send
  messages, tool definitions, output schema and the salt. Unsupported,
  cancelled or changed requests deliver none of that content. Both named
  and open recipient modes use this exchange.
- **Partition:** unbound or old protocol workers and entry routes are ineligible.
  Grants and payloads bind the exact stage and coordinator identities; no stage
  not named by the current approved route receives activations or tokens.
- **Paired bridge:** version 3 exposes exact enrolled route identities before
  the browser dispatches. The native requester is itself a plaintext recipient;
  the browser and native host validate it and all downstream workers. A fresh
  route check follows consent. Older bridge protocol is not a fallback.
- **Standard HTTP API:** adapters over `reploid/inference`; see
  [HTTP adapters](confidential-execution.md#http-adapters) for the `reploid`
  extension and which protections and routes they refuse. Native fleet
  composition binds the enrolled identity set, intersected with the configured
  recipient list when present.
- **Retrieval:** only host-installed paths with complete recipient disclosures
  can run. A qualified Brave server advertises
  `reploid.search-disclosure/v2` at the configured exact HTTPS origin
  (loopback HTTP in test/local setups only). It recomputes the binding before
  upstream work. Extraction and redirects stay within the approved origin.
  A configured MCP search origin is separately disclosed. Undeclared paths
  fail without sending the query rather than falling back to unrestricted search.
- **Peer operations:** private input requires
  `reploid.peer.execution_consent/v3` bound to the exact operation, model,
  offer and identity. The separate, explicitly public input contract is not a
  compatibility route for private data.

## Unavailable and unproven

Who can read what under each protection and route, what is refused, and what
is not claimed are stated once, in [confidential execution](confidential-execution.md)
(its [threat model](confidential-execution.md#threat-model-per-protection-and-route)
and [Not claimed](confidential-execution.md#not-claimed)). Ordinary execution allows
existing recovery storage but never publication, training or reuse.

Controlled integration tests cover malformed and missing policies, obsolete
clients, changed routes and recipients, unavailable computation, cancellation,
and protected wire paths. Tests with fixture providers do not qualify physical
GPU attestation, malicious-provider resistance, or production encrypted inference.

## Optional tagged landing links

An ordinary replo.id visit sends no landing-attribution event. A link to the
homepage with one valid opaque `?v=` code lets Reploid count that link's
landings. The page removes the code from the address before boot and makes one
best-effort same-origin request without cookies or a referrer. It does not send
the code to inference providers, peers, or third-party analytics. Global
Privacy Control and Do Not Track suppress this event. Remove the code before
opening a link if you do not want it counted.

The application logs only a hash of the code and an event type; those entries
are not public. Normal hosting and connection logs are separate, and the
initial URL received by hosting cannot be erased by the browser. Counts can
include automated previews, repeated opens, and recipients of forwarded links;
they do not establish that a particular person clicked.
