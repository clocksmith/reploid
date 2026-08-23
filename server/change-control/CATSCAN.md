# CATSCAN: Change Control Service

Parent: [Hosted Services](../CATSCAN.md)

## Target

Persist Change Passports under tenant, role, idempotency, GitHub,
trigger, and effect boundaries.

## Authority

- Owns authentication, append control, replay, GitHub integration, trigger
  ingestion, and effect requests.
- Does not own Poolday evidence, correctness, merge authority, deployment,
  monitoring, or rollback success.

## Scope

- This directory.

## Contracts

Inputs:
- Canonical events from the [shared contract](../../self/shared/change-passport/contract.js).
- Frozen policy from the [shared policy](../../self/shared/change-passport/policy.js).

Outputs:
- Authenticated records, GitHub check and effect requests, and verifiable exports.

## Invariants

- Storage is separate from Poolday collections and authority.
- Every append is compare-and-append and idempotent.
- Authenticated subjects cannot claim roles or organizations they do not hold.
- GitHub, deployment, monitor, and rollback observations remain source-bounded.
- Projections are caches. Raw event replay is authoritative.
- Cloud Run defaults to Firestore compare-and-append; memory is local/test and
  file storage is bounded to one instance.
- Automatic reopening never implies that revocation or rollback succeeded.
- The Visual Feedback Bridge supplies source evidence only. It cannot approve,
  activate, record an external effect, or reopen a decision directly.

## Acceptance

- Tests prove authorization, idempotency, append conflicts, durable replay,
  webhooks, checks, triggers, and failed effects.
- Evidence: [service integration tests](../../tests/integration/change-control-service.test.js)
  [Firestore store tests](../../tests/unit/change-control-firestore-store.test.js),
  [GitHub tests](../../tests/unit/change-control-github.test.js), and the
  [Visual Change Passport workflow](../../tests/integration/visual-change-passport.test.js).

## Non-goals

- Acting as an identity provider, code host, deployment platform, trace store, or
  scientific-policy authority.

## Freedom

Any mechanism is permitted if it preserves these boundaries and passes the
declared acceptance evidence.
