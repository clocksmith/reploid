# Poolday P2P Envelope Protocol

Poolday state-changing peer messages are signed typed envelopes.
Raw JSON messages must not mutate protocol state.

## Envelope Fields

Required fields:

- `peerControlVersion`
- `network`
- `type`
- `fromPeerId`
- `toPeerId`
- `publicKey`
- `body`
- `createdAt`
- `expiresAt`
- `nonce`
- `causalRefs`
- `messageHash`
- `signature`

`network` must be `poolday`.
Peer-message signatures use the `poolday.peer_message.v1` domain.

## State Rules

Every message type needs:

- schema
- signature domain
- required previous state
- allowed next state
- expiration rule
- replay policy
- audit event

Duplicate exact messages are idempotent.
Nonce reuse with a different payload is invalid.

## Relay Delivery Contract

Poolday rendezvous relay delivery is durable, bounded at-least-once. It does not
claim exactly-once delivery across browser, WebRTC, or Firestore restarts.

- The server assigns a monotonic `relaySequence` transactionally per room or
  signaling session. Client `createdAt` fields are envelope evidence only.
- A publisher supplies an idempotency ID (`relayId` or signal `id`). Repeating
  that ID returns the original stored relay record and does not allocate a new
  sequence.
- Consumers resume with `afterSequence`, retain a bounded dedupe window, and
  suppress duplicate relay IDs.
- `relay-ack` confirms another peer received a durable relay record. It does
  not confirm inference execution, output validity, receipt acceptance, or
  hardware behavior.
- Relay records remain replayable only until their bounded expiry. A receiver
  that resumes after expiry must re-run discovery or the applicable assignment
  recovery flow.

## Fault Matrix and SLOs

Browser verification must induce provider reload during negotiation and active
inference, requester reload before receipt acknowledgement, duplicate/delayed/
out-of-order relays, ICE-before-offer and queue expiry, relay 429/5xx/timeout,
listener and poll recovery, network switches, NAT-restricted peers, and stale
or corrupted IndexedDB resume state.

Before a soak, record delivery-lag percentiles, oldest relay backlog age,
reconnect success rate, ICE queue expirations, duplicate suppression count,
relay publish retries/failures, acknowledgement latency, and job completion
rate under each induced fault. Set service targets from measured baselines; do
not infer them from successful unit tests.

## Server Boundary

Signaling servers may relay:

- offer
- answer
- ICE candidate
- close
- ping

They must not carry prompts, biological sequences, outputs, token ids, full
receipts, or model shards.

*Last updated: July 2026*
