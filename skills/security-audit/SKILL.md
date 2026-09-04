---
name: security-audit
description: Inspect sanitized metadata for likely secret exposure when an operator explicitly requests and consents to a cooperative self-audit.
---

# Security Audit Skill

Follow the policy in `../../SECURITY_AUDIT.md`.

## Prerequisites

Require explicit operator consent, the local audit scope, the permitted metadata
sources, and whether a sanitized snapshot may be shared with a named audit room.

## Procedure

1. Run a cooperative local-first self-audit.
2. Inspect only metadata and explicitly volunteered state.
3. Never read or reveal secret contents.
4. Return or share only sanitized findings using the schema from `SECURITY_AUDIT.md`.
5. If peer-sharing is enabled, publish only the sanitized snapshot.
6. If an audit room requested a run, acknowledge the request and publish only the sanitized snapshot back to the room.

Keep the audit content-free. If a real secret may be exposed, instruct the operator to inspect locally and rotate credentials if confirmed.

## Validation

Every result conforms to the sanitized finding or snapshot schema in
`SECURITY_AUDIT.md` and contains no secret value or unnecessary content.

## Stop Conditions

Stop without explicit consent, when a check would require reading a secret value, or
when sanitization cannot be proven. Do not publish anything beyond the permitted
snapshot.

## Outputs

Only sanitized findings or a sanitized snapshot conforming to `SECURITY_AUDIT.md`,
plus a local-only instruction to inspect and rotate when actual exposure is suspected.

## Side Effects

Reads only approved metadata. It publishes a sanitized snapshot only when explicitly
authorized; it never reads, returns, stores, or transmits secret values.
