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

## Server Boundary

Signaling servers may relay:

- offer
- answer
- ICE candidate
- close
- ping

They must not carry prompts, biological sequences, outputs, token ids, full
receipts, or model shards.

*Last updated: June 2026*
