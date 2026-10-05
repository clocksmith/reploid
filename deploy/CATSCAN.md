# CATSCAN: Deployment Configuration

Parent: [Reploid](../CATSCAN.md)

## Target

Declare reproducible deployment inputs and service boundaries.

## Authority
- Owns build, service, environment, and artifact-origin configuration.
- Does not own live status, secrets, application semantics, or scientific claims.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Production environment declarations from [env.production.json](env.production.json).
- Service build declarations from [cloudbuild.yaml](cloudbuild.yaml).

Outputs:
- Hosted service configuration in [cloud-run-service.yaml](cloud-run-service.yaml).
- Firebase surface configuration in [firebase.json](../firebase.json).
- Hosting output from [asset selection](../scripts/hosting-file-set.js) and [packaging](../scripts/package-hosting.js).
- Discovery and temporary TURN issuance in [Cloudflare configuration](cloudflare/wrangler.jsonc).

## Invariants
- Secrets are referenced, never committed as configuration values.
- Checked-in configuration is not proof that a matching revision is live.
- Runtime/build identities remain verifiable.
- In-memory public discovery requires one rendezvous process and unsplit revision traffic; scaling requires shared rendezvous.
- Cloudflare discovery uses one hibernating object per namespace and bounded admission; inference and Firebase records retain their owners. Cutover requires live discovery and TURN evidence; old endpoints remain for rollback.
- Backend and Hosting share the exact integrity-verified Doppler package, never an unpinned replacement.
- Hosting publishes a byte-preserving runtime projection, not every retained package. Its byte descriptor and VFS manifest must describe the same selected assets.

## Acceptance
- Runtime configuration and cloud-access generation remain synchronized with declared sources.
- Evidence: [runtime config tests](../tests/unit/runtime-config-sync.test.js) and [cloud access build tests](../tests/unit/cloud-access-build.test.js).

## Non-goals
- Deployment claims without URL, revision, traffic, and bundle evidence.

## Freedom
Preserve boundaries and acceptance.
