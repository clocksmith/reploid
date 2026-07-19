# Poolday Receipt Schema

The receipt is Poolday's central artifact.
It is a provider claim until verifier checks, quorum agreement, and requester acceptance attach to it.

## Provider Receipt

Required fields:

- `receiptVersion`
- `signatureDomain`
- `assignmentId`
- `jobId`
- `requesterId`
- `providerId`
- `policyId`
- `model.id`
- `model.hash`
- `model.manifestHash`
- `model.runtime`
- `model.backend`
- `runtime`
- `inputHash`
- `generationConfigHash`
- `outputHash`
- `tokenIdsHash`
- `transcriptHash`
- `verification.runtimeProfileHash`
- `providerSignature`

Provider signatures use the `poolday.provider_receipt.v1` domain.

When an assignment requests an adapter, the receipt also requires:

- `adapter.packHash`
- `adapter.adapterId`
- `adapter.adapterSha256`
- exact base-model and manifest hashes
- human-promotion, Doppler parity, and Gamma selection receipt hashes
- publisher and publication identity
- requester adapter-use approval hash
- `adapter.state: "active"`
- at least one verified cache, peer, or origin acquisition record bound to the pack and adapter hashes

Adapter publication, requester approval, and revocation use separate signature
domains. They are not inferred from the provider receipt.

For `sequence.embedding.v1` or `sequence.masked_logits.v1`, the receipt also
requires:

- `sequenceResultHash`
- `sequence.schema`
- `sequence.workload`
- `sequence.alphabet`
- `sequence.sequenceHash`
- `sequence.requestHash`
- `sequence.resultHash`
- hashes for each requested output class

The raw sequence, pooled vector, token vectors, and logits are not receipt
fields. Requested outputs travel to the requester through the assignment's
WebRTC DataChannel. Redundant agreement and commit-reveal use
`sequenceResultHash`.

## Requester Acceptance

Requester acceptance is a separate artifact.
It must not be conflated with provider receipt creation.

Required fields:

- `signatureDomain`
- `receiptHash`
- `requesterId`
- `accepted`
- `acceptedAt`
- `requesterSignature`

Ring acceptance also binds:

- `jobId`
- `policyId`
- `policyConfigVersion`
- `policyConfigHash`
- `receiptHashes`
- `agreementHash`
- `pointSpend`
- `providerPoints`

Requester signatures use the `poolday.requester_acceptance.v1` domain.

*Last updated: June 2026*
