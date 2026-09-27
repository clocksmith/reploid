# CATSCAN: Cloudflare Discovery and TURN

Parent: [Hosted Services](../CATSCAN.md)

## Target
Provide bounded public/private peer discovery and authenticated temporary TURN credentials.

## Authority
Owns the Cloudflare adapter for signaling and credential issuance. Does not execute models or grant conversation, custody, compute, or improvement permission.

## Scope
This subtree; browser workspace and Firebase records remain with their existing owners.

## Contracts
Inputs: [bootstrap policy](../../self/config/swarm-bootstrap.json), Firebase identity tokens, private namespace capabilities.
Outputs: existing signaling envelopes and expiring RTC configuration.

## Invariants
- Each namespace has an independent hibernating room object; admission leases enforce shared bounded capacity, not message routing.
- Exact origins, active membership, scoped capabilities, frame/rate limits and expiry precede signaling.
- Private capability hashes survive object eviction and empty rooms.
- No application relay, virtual peer, model execution or automatic contribution.
- Credentials require verified Firebase issuer, audience, signature and time claims; secrets never reach clients or logs.
- Failure is explicit. Existing Google endpoints remain available for operator rollback, not silent fallback.

## Acceptance
- Evidence: [runtime tests](../../tests/cloudflare/swarm.spec.js) cover admission, hibernation state, isolation, expiry, credential validation and failures.
- Production qualification separately requires automatic app discovery, forced TURN data channels, persistence and disconnect evidence.

## Non-goals
Unlimited overlay, trustless compute, replacing Firebase records, or qualification of inference/layer splitting.

## Freedom
Preserve these boundaries and qualify changes against the prior deployment.
