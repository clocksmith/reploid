# Change Passport Runtime Contract

Change Passport remains an inactive alternative. This page defines
its implemented interfaces and required evidence; it does not select work.
[Product intent](product-intent.md) and the [pilot charter](pilot-charter.md)
own their separate product and external-adoption boundaries.

## Local start

The Change Control API is mounted at `/change-control` and the operator surface
at `/passports`.

For a bounded local development instance:

```bash
REPLOID_CHANGE_CONTROL_ALLOW_LOCAL=true \
REPLOID_CHANGE_CONTROL_STORE=file \
REPLOID_CHANGE_CONTROL_STORE_DIR=/absolute/bounded/path \
npm start
```

Loopback development authentication grants the local test principal all roles
and must not be enabled on a shared host.

For scoped bearer authentication, set
`REPLOID_CHANGE_CONTROL_TOKENS` to a JSON object whose keys are secrets and
whose values are principals:

```json
{
  "secret-from-a-secret-manager": {
    "subject": "github-actions:repository-id",
    "authorityId": "authority:ci:repository-id",
    "organizationId": "org:operator",
    "roles": ["evidence_producer"]
  }
}
```

Use different tokens and authorities for proposer, evaluator, reviewer,
activator, observer, and rollback roles when the frozen policy requires
independence.

## Storage modes

| Mode | Intended boundary |
|------|-------------------|
| `memory` | Unit tests and disposable local runs only |
| `file` | One bounded local or single-instance process with atomic files |
| `firestore` | Hosted compare-and-append persistence |

Cloud Run (`K_SERVICE` present) selects `firestore` by default. Other runtimes
select `memory` unless `REPLOID_CHANGE_CONTROL_STORE` is explicit. Firestore
collections use `REPLOID_CHANGE_CONTROL_FIRESTORE_PREFIX`, defaulting to
`reploid`. The store uses separate Change Passport collections and does not
reuse Poolday collections.

## GitHub App configuration

Set these through the deployment secret/configuration system:

```text
REPLOID_GITHUB_APP_ID
REPLOID_GITHUB_APP_PRIVATE_KEY
REPLOID_GITHUB_WEBHOOK_SECRET
REPLOID_CHANGE_CONTROL_PUBLIC_URL
```

The default check-only App needs repository metadata read, pull-request read,
and checks write, with only pull-request and pull-request-review events.
Branch protection remains the merge authority. Content mutation, deployment,
and rollback require separately enabled effect adapters with their own named
authorities and permissions. The deployment adapter first searches for a
matching passport/idempotency payload. The rollback adapter creates a new
commit whose tree equals the frozen rollback revision and whose parent is the
current base, then opens a pull request; it does not claim rollback success
until GitHub returns the effect and Reploid records the result.

Verified webhook handling blocks a passport when GitHub reports a changed or
forked pull-request head, dismissal of a bound reviewer, or loss of the bound
App installation. Reconciliation adds immutable blocking objections; it does
not erase the earlier approval.

## API boundary

```text
GET  /change-control/status
GET  /change-control/principal
GET  /change-control/passports
POST /change-control/passports
GET  /change-control/passports/:id
GET  /change-control/passports/:id/events
GET  /change-control/passports/:id/export
POST /change-control/passports/:id/events
POST /change-control/passports/:id/triggers
POST /change-control/passports/:id/triggers/standard
POST /change-control/passports/:id/effects/execute
POST /change-control/passports/:id/rollbacks/execute
POST /change-control/github/webhooks
```

All writes require an `Idempotency-Key`. Export verification replays the raw
event chain and must not trust the hosted projection.

## Visual Change Passport boundary

`source_patch` passports may ingest `change.requested`, `agent.completed`,
`review.accepted`, `page.rendered`, and `change.reverted` receipts from the
development-only Deco Visual Feedback Bridge. Reploid does not connect to the
Bridge database or grant it hosted authority. The adapter verifies one
project/worktree/session/browser/change identity, complete comment
dispositions, exact changed-file closure, before/after file hashes, the Bridge
patch artifact identity, and restoration of the frozen baseline.

The required order is:

```text
Bridge complaint and patch evidence
-> frozen independent evaluator receipt
-> authenticated reviewer acceptance
-> approved decision
-> ci_activation effect adapter
-> independent post-activation render outcome
-> Bridge source reversal
-> candidate_artifact_changed observation
-> deterministic decision.reopened
```

The source reversal and automatic reopening do not assert that an external CI
or deployed effect rolled back. That effect remains `applied` until its owning
system supplies a separately authorized rollback result.

Run the complete workspace-local proof from Reploid with:

```bash
npm run verify:change-passport:visual
```

The verifier requires the canonical sibling Bridge build and physical Chromium
through Playwright. It uses disposable source and a local CI effect adapter; it
does not prove a live GitHub installation, shared deployment, or external human
operation.

## Release boundary

Repository tests prove local behavior. They do not prove a live GitHub App,
Cloud Run revision, branch-protection rule, deployment target, or external
operator outcome. Those remain blocked in the
[surface claim index](../status/surface-claim-index.json) until matching live
evidence is retained.

## Component ownership

| Path | Responsibility |
|------|----------------|
| `self/shared/change-passport/` | Browser-safe event contract, policy, canonicalization, verification, deterministic projection, and Zero/X adapter |
| `self/core/change-passport*.js` | Browser/VFS compatibility exports for the shared contract |
| `server/change-control/` | Hosted store, authorization, API, GitHub App, effect adapters, and trigger ingestion |
| `self/ui/change-passport/` | Operator review, evidence, dissent, approval, effect, and reopening views |
| `packages/change-passport/` | Standalone TypeScript client, package-local declarations, and bundled offline verifier |
| `.github/actions/change-passport/` | Reusable CI action for candidate freeze, evidence upload, and required-check polling |
| `tests/fixtures/change-passport/` | Canonical valid and adversarial conformance fixtures |
| `tests/unit/change-passport*.test.js` | Contract, projection, policy, and adapter unit evidence |
| `tests/integration/change-passport*.test.js` | Hosted API, store, auth, GitHub, and effect integration evidence |
| `tests/e2e/change-passport.spec.js` | Browser review and complete governed-change journey |
| `scripts/verify-change-passport.js` | Offline export and signature verifier |
| `scripts/build-change-passport-sdk.js` | Deterministic standalone SDK bundle, declaration build, and stale-distribution check |
| `server/change-control/visual-workflow.js` | Bridge receipt ingestion, independent evaluation, human acceptance, CI activation, render outcome, reversal, and reopening orchestration |
| `scripts/verify-visual-change-passport-dogfood.js` | Physical-browser local proof using the canonical Bridge patch implementation |

Each new component receives a CATSCAN before implementation. The generic
change-control service must not be placed under `self/pool/` or `server/pool/`.

## Release and claim gates

Do not claim Change Passport is implemented, secure, live, or commercially
validated from this contract. Update the surface claim index only when matching
evidence exists.

Before a supported release:

```bash
npm run verify:catscan
npm run verify:surface-claims
npm run verify:browser-bundle:local
npm run verify:change-passport:sdk
npm run verify:change-passport:pilot
npm exec -- tsc -p tests/tsconfig.change-passport.json --noEmit
npm run verify:change-passport:visual
npm run test:unit
npm run test:integration
npm run test:e2e
node scripts/verify-change-passport.js <export-path>
```

The release record must bind clean Git source, server revision, browser bundle,
schema version, policy version, SDK and action versions, GitHub App identity,
durable-store migration, verifier bytes, and matching live sandbox evidence.

The [prior implementation record](https://github.com/clocksmith/reploid/blob/342f0760f80f66d851ef33ffaa9b83b482dc2572/docs/change-passport/implementation-plan.md)
retains milestone chronology, local and live observations, and unresolved
external installability/pilot acceptance. Removing that duplicate plan does not
change support status, operator authority, or any blocked external claim.
