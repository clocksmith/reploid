# Wire Visibility: Who Can Read What

Every Reploid chat and game attempt has four distinct vantage points: **your device**, **the coordinator**, **the network relay**, and **the serving computer**. Today all model execution is plaintext on the serving computer (`doppler-plaintext/v1`); splitting a model across machines does **not** hide your prompt, and encrypted remote inference is not shipped.

## Four-Party Visibility Table

| Party | Prompt text | Answer text | What it actually sees |
| --- | --- | --- | --- |
| **Your device (browser / CLI)** | **Plaintext** | **Plaintext** | Everything you type, the disclosed Ed25519 identity of the serving computer (`Readable by: <computer>`), model SHA-256, and the signed receipt. |
| **Coordinator (`replo.id` signaling, peer rooms, fleet credit ledger)** | **None** | **None** | WebSocket SDP/ICE rendezvous frames, enrolled Ed25519 public keys, model identity, token counts, and salted SHA-256 request/output digests on credited routes. `/pool/peer/rooms` and production `/pool/jobs` reject plaintext prompt submissions with HTTP `400`. |
| **Network relay (WebRTC TURN / UDP packet relay)** | **None** | **None** | DTLS-encrypted `RTCDataChannel` ciphertext packets, client/host IP addresses and ports, packet byte lengths, and timing. |
| **Serving computer (your own PC, an inviter's PC, or a public host)** | **Plaintext** | **Plaintext** | The conversation messages, tool schemas, and generated tokens required to execute the model weights. The serving computer's operator can read what reaches it, including on paired, invited and public routes. |

## Route-by-Route Summary

Placement policy determines where inference may run. The runtime executes the model; transport carries the request between endpoints, if any. WebGPU is a runtime interface, not a request transport.

| Route | Transport | Coordinator sees | Network relay sees | Serving computer sees |
| --- | --- | --- | --- | --- |
| **In-tab browser inference** (`local-only` placement; WebGPU runtime) | None. The inference request stays in the browser. | Nothing | Nothing | Your own browser tab (plaintext) |
| **WebRTC swarm** | DTLS data channel (direct ICE or relay) | Room rendezvous and SDP/ICE. Generic local capture: no prompt or answer canary found. | DTLS ciphertext, IP/port, packet size and timing. Generic UDP-shim capture: no canary found. | Plaintext prompt and answer. Invite and reconnect fixtures below do not qualify a deployed route. |
| **Credited Fleet settlement (`POST /v1/fleet`)** | HTTPS / loopback signed JSON envelopes | Ed25519 public keys, model SHA-256, token counts, salted SHA-256 commitments & digests (`0` prompt/answer bytes) | TLS ciphertext | Plaintext prompt & answer (via WebRTC DataChannel) |
| **Local OpenAI / Anthropic API (`server/fleet/text-api.js`)** | `127.0.0.1` HTTP on requester -> WebRTC `RTCDataChannel` to provider | Credit coordination is separate from the native requester, which sees plaintext | DTLS on the WebRTC leg. A TLS-terminating HTTP proxy on the requester leg could read the JSON. | Plaintext prompt & answer |
| **Local browser bridge (`server/fleet/browser-bridge.js` `/bridge/generate`)** | `127.0.0.1` loopback HTTP only | Not contacted | Loopback only; **never** expose `/bridge/generate` behind a third-party TLS-terminating tunnel without end-to-end payload encryption, because an HTTP reverse proxy terminates TLS and sees JSON bodies | Local host process (plaintext) |

## Reproducible Capture Check

Anyone can rerun the live wire-capture check locally without a GPU or external account:

```sh
node scripts/verify-wire-visibility.js
```

The script ([verify-wire-visibility.js](../scripts/verify-wire-visibility.js), covered in CI by [wire-visibility.test.js](../tests/integration/wire-visibility.test.js) and recorded in [wire-visibility-audit.json](../reports/release-015-qualification/wire-visibility-audit.json)):

1. Starts a live `SignalingServer`, a live `FleetService` SQLite credit ledger, a production-configured `createPoolRouter` (`allowPlaintextJobPrompts: false`), and an instrumented UDP packet relay socket between two `RTCPeerConnection` endpoints.
2. Rewrites a loopback ICE candidate through the local UDP relay shim, exchanges canaries with random 128-bit suffixes, and settles signed non-cash service credits over `/v1/fleet`.
3. Verifies that the serving computer receives the canary prompt and the requester receives the canary answer, while **zero occurrences (`0` bytes)** of either canary appear in WebSocket signaling frames, captured UDP relay packets, `/v1/fleet` HTTP envelopes, the coordinator store projection, or `credits.sqlite`, and verifies HTTP `400`/`403` fail-closed rejection against prompt injection on `/pool/peer/rooms`, `/pool/jobs`, and `/pool/audits/canary`.

### Invite and reconnect fixtures

The optional extension uses loopback WebSocket signaling, native RTC and temporary
desktop control SQLite files with synthetic inference. It runs against independent
checkouts of the wave-one ports:

~~~sh
node scripts/verify-wire-visibility.js --circle-fixture invite /absolute/guest-admission-checkout
node scripts/verify-wire-visibility.js --circle-fixture reconnect /absolute/owner-pairing-checkout
~~~

The invite fixture redeems a host grant for the verified signer and calls the
guest admission port from the test host's pre-disclosure callback. It admits one
request and rejects another after revocation. **Live guest dispatch is not wired
to this port.** This is not a browser invite-route measurement.

The reconnect fixture waits for explicit desktop approval, retains the paired
owner under the same desktop key, then opens a new fingerprint scope. Its fixture
authorizer rejects the previous scope before sending a request on the fresh scope.
Both fixtures require positive canaries at the endpoints and real metadata in the
signaling and SQLite captures. Neither intermediary contains prompt or answer
canaries. The test verifies the selected direct ICE pair and traffic during the
successful request; it does not capture direct UDP traffic or inspect arbitrary
process memory. The base harness's UDP shim is separate and is not TURN.

Run the integration suite with `REPLOID_WIRE_INVITE_CHECKOUT` and
`REPLOID_WIRE_PAIRING_CHECKOUT` set to the respective absolute paths. Missing ports
in the current checkout cause their tests to skip, not qualify.
[Retained fixture receipt](../reports/release-015-qualification/wire-visibility-circle-fixtures.json).

### Physical cellular qualification (not run)

1. Start with an authorized test phone, desktop, fixture room and synthetic
   canaries. Confirm the desktop signing identity and approve pairing there.
2. Run a synthetic request over Wi-Fi. Turn Wi-Fi off and confirm cellular is
   active. Reconnect to the same signing identity with a fresh channel. Try the
   stale scope and check that its payload does not reach the endpoint; approve a
   fresh request and record the endpoint's answer.
3. For each request, capture the selected ICE candidate types and byte counters
   immediately before and after the request, including whether the pair changed.
   For relay qualification, force relay and verify actual bidirectional traffic
   on a selected relay candidate. Merely configuring TURN is not evidence. Use
   [connection-path.js](../packages/reploid/src/transport/connection-path.js) and
   [verify-cloudflare-swarm.js](../scripts/verify-cloudflare-swarm.js) as references.
4. Match those records to authorized staging signaling, coordinator storage,
   relay and proxy observations for the same attempt. Show the canaries at the
   endpoints and check sampled intermediate boundaries separately. Label direct
   RTC, TURN, TLS proxy and loopback legs distinctly. A plaintext browser bridge
   is not eligible for cellular. Missing captures, an unknown path or a changed
   desktop identity leave the route unqualified.
