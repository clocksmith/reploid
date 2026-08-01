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
- A record becomes dedupe-eligible only after its consumer dispatch succeeds.
  If a local consumer throws, the cursor remains at the preceding successfully
  dispatched record and the failed record retries with bounded backoff. This is
  a local delivery failure, not evidence that the relay circuit is unavailable.
- Each participant owns one room subscription. Per-session WebRTC signaling
  attaches filtered listeners to that bus rather than opening additional relay
  pollers. This keeps polling, acknowledgements, cursor state, and relay health
  independent of quorum size.
- `relay-ack` is a signed, target-bound peer proof for a durable relay record.
  It confirms relay receipt only. It does not confirm inference execution,
  output validity, receipt acceptance, or hardware behavior.
- Pending acknowledgement recovery is same-tab durable for its bounded replay
  window. Every relay poll prunes expired entries, persists the new state, and
  emits `relay-ack-expired`; stale acknowledgements cannot accumulate silently.
- Relay records remain replayable only until their bounded expiry. A receiver
  that resumes after expiry must re-run discovery or the applicable assignment
  recovery flow.

## Fault Matrix and SLOs

Browser verification must induce provider reload during negotiation and active
inference, requester reload before receipt acknowledgement, duplicate/delayed/
out-of-order relays, ICE-before-offer and queue expiry, relay 429/5xx/timeout,
listener and poll recovery, network switches, NAT-restricted peers, and stale
or corrupted IndexedDB resume state.

For a requester reload during an in-flight public sequence request, Poolday
keeps only a short-lived, same-tab session record. On reload it validates the
room, relay, current model contract, explicit public-sequence sensitivity, and
expiry before presenting an explicit retry-or-discard decision. It does not
resume a WebRTC session, infer acceptance, or automatically publish a second
request. Retrying creates a new request and receipt path; discard removes the
same-tab record.

Provider capacity is released when an assigned transport reaches `closed` or
`failed`, including a requester close before input delivery. A terminal
transport must not retain an open-session slot and make later healthy requests
appear unavailable.

Transport diagnostics record pending, expired, and queue-overflowed remote ICE
candidates. Failure details expose those counters with connection state and
TURN configuration so an expired early candidate is distinguishable from a
relay outage or a network with no usable route.

SDK signaling polling uses the same bounded retry discipline as room relay
polling: failures back off to a capped delay, cross a circuit threshold, and
emit open, half-open, recovered, and closed status transitions. A signaling
outage therefore cannot silently continue at the normal poll rate.

The relay rate limiter returns `429`, `retryable: true`, and an integer
`Retry-After` value in both the response header and JSON body. The browser SDK
preserves that value as `retryAfterMs`. Room and signaling pollers wait for the
greater of their exponential delay and that server deadline, bounded by their
configured maximum. A rate-limited browser therefore neither resumes normal
cadence immediately nor accepts an unbounded delay from a malformed response.

Before a soak, record delivery-lag percentiles, oldest relay backlog age,
reconnect success rate, ICE queue expirations, duplicate suppression count,
relay publish retries/failures, acknowledgement latency, and job completion
rate under each induced fault. Set service targets from measured baselines; do
not infer them from successful unit tests.

The SDK relay bus exposes its bounded-run counters through `getStatus()` and
the completed requester result records its snapshot as `relayMetrics`:
publish and acknowledgement latency count/total/max, delivery-lag
count/total/max, oldest backlog age count/total/max and latest sample, duplicate
suppression, poll and dispatch failures, retry counts, acknowledgement expiry,
and successful reconnects. Delivery lag uses
the server relay timestamp observed by the browser, so it is an operational
measurement rather than a cross-machine clock proof. Aggregate these snapshots
outside the receipt before setting production SLOs.

## Server Boundary

Signaling servers may relay:

- offer
- answer
- ICE candidate
- close
- ping

They must not carry prompts, biological sequences, outputs, token ids, full
receipts, or model shards.

*Last updated: August 2026*
