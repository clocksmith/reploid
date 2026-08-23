# CATSCAN: Change Control Service

Parent: [Hosted Services](../CATSCAN.md)

## Target

Persist, verify, project, and expose Change Passports while enforcing tenant,
role, idempotency, GitHub, trigger, and external-effect boundaries.

## Authority

- Owns hosted Change Passport authentication, append control, projection replay,
  GitHub integration, trigger ingestion, and effect-adapter requests.
- Does not own Poolday evidence, objective correctness, GitHub merge authority,
  deployment truth, monitoring truth, or rollback success.

## Scope

- This directory.

## Contracts

Inputs:
- Canonical events from the [shared contract](../../self/shared/change-passport/contract.js).
- Frozen policy from the [shared policy](../../self/shared/change-passport/policy.js).

Outputs:
- Authenticated API records.
- GitHub required-check projections and effect requests.
- Offline-verifiable export packages.

## Invariants

- Storage is separate from Poolday collections and authority.
- Every append is compare-and-append and idempotent.
- Authenticated subjects cannot claim roles or organizations they do not hold.
- GitHub, deployment, monitor, and rollback observations remain source-bounded.
- Projections are caches. Raw event replay is authoritative.
- Cloud Run selects the Firestore compare-and-append store by default; memory
  storage remains a local/test mode and file storage remains a bounded
  single-instance mode.
- Automatic reopening never implies that revocation or rollback succeeded.

## Acceptance

- Tests prove tenant and role enforcement, idempotency, append conflicts,
  durable replay, webhooks, GitHub checks, triggers, and failed effects.
- Evidence: [service integration tests](../../tests/integration/change-control-service.test.js)
  [Firestore store tests](../../tests/unit/change-control-firestore-store.test.js),
  and [GitHub tests](../../tests/unit/change-control-github.test.js).

## Non-goals

- Acting as an identity provider, code host, deployment platform, trace store, or
  scientific-policy authority.

## Freedom

Any mechanism is permitted if it preserves these boundaries and passes the
declared acceptance evidence.
