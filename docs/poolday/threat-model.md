# Poolday Threat Model

Poolday is audited as a browser inference marketplace and control plane.
It is not `/zero` and it is not `/x`.

## Protected Assets

- model artifact identity
- prompt hash and generation config hash
- provider receipt signature
- requester acceptance signature
- commit and reveal evidence
- receipt agreement hash
- points and reputation events
- provider admission state

## Adversaries

- dishonest provider returning fabricated output
- provider that commits and then refuses to reveal
- provider that reveals after seeing another output
- requester that refuses to accept a valid quorum
- requester that submits secrets to public providers
- colluding provider group
- sybil provider group
- signaling relay that injects or withholds metadata
- artifact host serving wrong bytes

## Trust Boundaries

Browser execution is not hardware-attested.
The protocol therefore treats provider output as a claim until it is checked by deterministic comparison, quorum, canary, challenge, or reputation history.

Servers can help with discovery, signaling metadata, rate limiting, and abuse filtering.
Servers should not be the final authority for model identity, receipt validity, quorum acceptance, or reputation truth when signed peer artifacts exist.

## Required Evidence

An accepted result should be reconstructible from:

- signed intent
- signed provider adverts
- assignment plan
- commitment events
- reveal events
- provider receipts
- requester acceptance
- reputation events
- model and manifest hashes
- deterministic generation config

*Last updated: June 2026*
