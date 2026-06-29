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
