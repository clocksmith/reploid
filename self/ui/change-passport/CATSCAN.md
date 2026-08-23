# CATSCAN: Change Passport Interface

Parent: [Browser Interface](../CATSCAN.md)

## Target

Let authorized operators inspect and act on Change Passports without collapsing
evidence validity, decision state, deployed effect state, or source authority.

## Authority

- Owns the `/passports` presentation, authenticated API interaction, local export
  verification, and role-scoped operator inputs.
- Does not grant roles, approve on behalf of users, apply effects, assert source
  truth, or expose Poolday, Zero, and X as customer dependencies.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Hosted records from the Change Control Service.
- Offline verification from [change-passport.js](../../core/change-passport.js).

Outputs:
- Ordered evidence, disagreement, policy, approval, effect, outcome, reopening,
  rollback, and raw-event views.
- Authenticated event submissions to the hosted service.

## Invariants

- Untrusted record text is escaped before rendering.
- Access tokens are session-scoped and never rendered or logged.
- Approval never renders as activation.
- Reopening never renders as completed rollback.
- Development-only source markers identify the owning UI source without
  granting the Visual Feedback Bridge review or effect authority.
- Failed, excluded, contested, unresolved, and stale evidence remains visible.

## Acceptance

- Unit tests cover safe rendering and state separation.
- Browser tests cover connection, selection, review submission, export, and
  narrow-screen interaction.
- Evidence: [UI tests](../../../tests/unit/change-passport-ui.test.js) and
  [browser journey](../../../tests/e2e/change-passport.spec.js).

## Non-goals

- General compliance dashboards, trace browsing, identity administration, or
  autonomous production actions.

## Freedom

Any implementation is permitted if it preserves these boundaries and passes the
declared acceptance evidence.
