# CATSCAN: Deployment Configuration

Parent: [Reploid](../CATSCAN.md)

## Target

Declare reproducible hosted deployment inputs and service boundaries for Reploid runtime surfaces.

## Authority
- Owns checked-in build, service, environment, and artifact-origin deployment configuration.
- Does not own live deployment status, secret values, application semantics, or scientific claims.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Production environment declarations from [env.production.json](env.production.json).
- Service build declarations from [cloudbuild.yaml](cloudbuild.yaml).

Outputs:
- Hosted service configuration in [cloud-run-service.yaml](cloud-run-service.yaml).
- Firebase surface configuration in [firebase.json](../firebase.json).

## Invariants
- Secrets are referenced, never committed as configuration values.
- Checked-in configuration is not proof that a matching revision is live.
- Runtime and build identities remain separately verifiable.

## Acceptance
- Runtime configuration and cloud-access generation remain synchronized with declared sources.
- Evidence: [runtime config tests](../tests/unit/runtime-config-sync.test.js) and [cloud access build tests](../tests/unit/cloud-access-build.test.js).

## Non-goals
- Claiming successful deployment without live URL, revision, traffic, and bundle evidence.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
