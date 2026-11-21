# Wire Visibility: Who Can Read What

Every Reploid chat and game attempt has four distinct vantage points: **your device**, **the coordinator**, **the network relay**, and **the serving computer**. Today all model execution is plaintext on the serving computer (`doppler-plaintext/v1`); splitting a model across machines does **not** hide your prompt, and encrypted remote inference is not shipped.

## Four-Party Visibility Table

| Party | Prompt text | Answer text | What it actually sees |
| --- | --- | --- | --- |
| **Your device (browser / CLI)** | **Plaintext** | **Plaintext** | Everything you type, the disclosed Ed25519 identity of the serving computer (`Readable by: <computer>`), model SHA-256, and the signed receipt. |
| **Coordinator (`replo.id` signaling, peer rooms, fleet credit ledger)** | **None** | **None** | WebSocket SDP/ICE rendezvous frames, enrolled Ed25519 public keys, model identity, token counts, and salted SHA-256 request/output digests on credited routes. `/pool/peer/rooms` and production `/pool/jobs` reject plaintext prompt submissions with HTTP `400`. |
| **Network relay (WebRTC TURN / UDP packet relay)** | **None** | **None** | DTLS-encrypted `RTCDataChannel` ciphertext packets, client/host IP addresses and ports, packet byte lengths, and timing. |
| **Serving computer (your own PC, an inviter's PC, or a public host)** | **Plaintext** | **Plaintext** | The conversation messages, tool schemas, and generated tokens required to execute the model weights. When the serving computer is **your own paired PC**, trust is identical to local execution; when it belongs to **a friend or a public host**, that operator can read the prompt. |

## Route-by-Route Summary

| Route | Transport | Coordinator sees | Network relay sees | Serving computer sees |
| --- | --- | --- | --- | --- |
| **Local browser (`local-only`)** | In-tab WebGPU | Nothing | Nothing | Your own browser tab (plaintext) |
| **Paired PC / friend invite / swarm (`restricted` or `provider-visible`)** | WebRTC `RTCDataChannel` (direct ICE or TURN UDP/TCP relay) | Room rendezvous & SDP/ICE (`0` prompt/answer bytes) | DTLS ciphertext, IP/port, packet size, timing (`0` plaintext prompt/answer bytes) | Plaintext prompt & answer |
| **Credited Fleet settlement (`POST /v1/fleet`)** | HTTPS / loopback signed JSON envelopes | Ed25519 public keys, model SHA-256, token counts, salted SHA-256 commitments & digests (`0` prompt/answer bytes) | TLS ciphertext | Plaintext prompt & answer (via WebRTC DataChannel) |
| **Local OpenAI / Anthropic API (`server/fleet/text-api.js`)** | `127.0.0.1` HTTP on requester -> WebRTC `RTCDataChannel` to provider | Same as credited Fleet (`0` prompt/answer bytes) | DTLS ciphertext (`0` plaintext prompt/answer bytes) | Plaintext prompt & answer |
| **Local browser bridge (`server/fleet/browser-bridge.js` `/bridge/generate`)** | `127.0.0.1` loopback HTTP only | Not contacted | Loopback only; **never** expose `/bridge/generate` behind a third-party TLS-terminating tunnel without end-to-end payload encryption, because an HTTP reverse proxy terminates TLS and sees JSON bodies | Local host process (plaintext) |

## Reproducible Capture Check

Anyone can rerun the live wire-capture check locally without a GPU or external account:

```sh
node scripts/verify-wire-visibility.js
```

The script ([verify-wire-visibility.js](../scripts/verify-wire-visibility.js), covered in CI by [wire-visibility.test.js](../tests/integration/wire-visibility.test.js) and recorded in [wire-visibility-audit.json](../reports/release-015-qualification/wire-visibility-audit.json)):

1. Starts a live `SignalingServer`, a live `FleetService` SQLite credit ledger, a production-configured `createPoolRouter` (`allowPlaintextJobPrompts: false`), and an instrumented UDP packet relay socket between two `RTCPeerConnection` endpoints.
2. Rewrites ICE candidates so every WebRTC `RTCDataChannel` packet traverses the packet-capturing UDP relay, sends a random 256-bit canary prompt, returns a random 256-bit canary answer, and settles signed non-cash service credits over `/v1/fleet`.
3. Verifies that the serving computer receives the canary prompt and the requester receives the canary answer, while **zero occurrences (`0` bytes)** of either canary appear in WebSocket signaling frames, captured UDP relay packets, `/v1/fleet` HTTP envelopes, coordinator memory, or `credits.sqlite`, and verifies HTTP `400`/`403` fail-closed rejection against prompt injection on `/pool/peer/rooms`, `/pool/jobs`, and `/pool/audits/canary`.
