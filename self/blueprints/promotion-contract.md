# Promotion Contract

`Promote` is the only model-visible request path for durable `/self` changes.

## Required Inputs

- Candidate path under `/shadow`.
- Target path under `/self`.
- Evidence path under `/artifacts`.

## Default Behavior

- Deny missing candidates.
- Deny missing evidence.
- Deny direct `/self` writes from ordinary model tools.
- Leave `/self` unchanged on denial.
- Return machine-readable approval or rejection reasons.
- Preserve the prior target bytes and hash before replacing an existing target.
- Write rollback metadata under `/artifacts/promotions/<promotion-id>/` before changing `/self`.
- Fail promotion if rollback evidence cannot be persisted.

Runtime-profile promotion is two-stage: `Promote` installs the exact staged bytes after human approval, then Doppler reruns the frozen canary contract. Canary rejection restores the previous active-profile pointer and records the rollback reason.

*Last updated: July 2026*
