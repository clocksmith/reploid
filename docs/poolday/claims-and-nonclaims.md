# Poolday Claims And Nonclaims

Poolday is the internal/docs name for the public Reploid browser inference pool.
The public UI uses the Reploid name.

## Claim

Poolday provides:

- signed assignment-bound inference receipts
- deterministic output comparison
- artifact hash binding
- redundant provider quorum
- canary audits
- challenge reruns
- provider reputation
- requester countersignatures
- policy-controlled admission

The approved product claim is:

```text
receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference
```

## Nonclaims

Poolday does not provide:

- guaranteed honest browser execution
- trusted hardware attestation
- proof that browser JavaScript was not modified
- proof that a provider did not simulate a result
- proof that a GPU performed the computation
- trustless compute

A receipt proves that a provider key signed an assignment-bound artifact.
It does not prove untampered browser execution or hardware-attested GPU computation.

## Required Copy Rule

Public copy must use terms such as:

- receipt-backed
- audit-backed
- deterministically comparable
- reputation-backed
- challengeable
- policy-controlled

Public copy must not imply hardware-backed or tamper-proof execution.

*Last updated: June 2026*
