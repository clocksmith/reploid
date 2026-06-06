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

The first implementation may deny by default until replay evidence exists.

*Last updated: June 2026*
