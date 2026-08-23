# Reploid Change Passport Implementation Plan

## Status

This is the executable repository plan for the first commercial Change
Passport workflow. Product intent and authority boundaries are frozen in
[product-intent.md](product-intent.md). The implementation milestones below
are not complete unless their acceptance evidence exists.

Current state:

- [x] Product direction and claim boundary recorded.
- [x] Poolday and generic change-control authority separated in repository
  intent.
- [x] External Change Passport contract, deterministic replay, and offline
  verifier implemented and locally tested.
- [x] Hosted service, durable store, SDK, CI action, GitHub checks, browser
  review, activation, outcome, reopening, and rollback paths implemented and
  locally tested.
- [x] Zero/X source-evidence adapter implemented without importing approval or
  effect authority.
- [x] Visual Feedback Bridge receipt contract and complete local Visual Change
  Passport dogfood workflow implemented with a physical Chromium oracle,
  conflict-safe reverse patch, and deterministic reopening.
- [x] Live GitHub App installation and App-bound branch-protection rule recorded
  for `clocksmith/reploid` in the
  [status artifact](../status/change-passport-github-installation-2026-08-23.json).
- [ ] Live blocked and eligible Change Passport check-run evidence recorded.
- [x] Clean dual-host Firebase Hosting and Cloud Run release identity recorded
  without qualification in the
  [status artifact](../status/poolday-clean-dual-host-release-2026-08-23.json).
- [ ] Real operator pilot completed.

## Win condition

An external AI platform operator can install Reploid on a GitHub repository,
submit an agent-generated model, prompt, tool, policy, configuration, or source
patch change,
and obtain one independently verifiable passport that:

1. Freezes the candidate, baseline, evaluator, policy, budget, and rollback
   target before candidate evaluation.
2. Preserves included, excluded, failed, contested, rejected, and unresolved
   evidence.
3. Controls a required merge or promotion check.
4. Records approval separately from the applied production effect.
5. Reopens deterministically when a verified declared trigger occurs.
6. Requests only effects authorized by the frozen policy.
7. Can be exported and verified without trusting the hosted projection.
8. Produces measured value against the operator's frozen existing workflow.

## System boundary

```text
GitHub pull request or promotion manifest
             |
             v
CI action -> Change Passport service <- evaluator attestations
             |          |
             |          +-> append-only events and deterministic projection
             |
             +-> GitHub required check
             +-> review and approval surface
             +-> activation adapter
             +-> outcome and reopening adapters
             +-> offline verifier export
```

The hosted service coordinates records and policy. GitHub, CI, deployment, and
monitoring systems remain the authorities for their own effects and
observations.

## Planned component map

| Path | Responsibility |
|------|----------------|
| `self/shared/change-passport/` | Browser-safe event contract, policy, canonicalization, verification, deterministic projection, and Zero/X adapter |
| `self/core/change-passport*.js` | Browser/VFS compatibility exports for the shared contract |
| `server/change-control/` | Hosted store, authorization, API, GitHub App, effect adapters, and trigger ingestion |
| `self/ui/change-passport/` | Operator review, evidence, dissent, approval, effect, and reopening views |
| `sdk/change-passport/` | Standalone TypeScript client, package-local declarations, and bundled offline verifier |
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

## Milestone 1: Canonical passport contract and verifier

Implement `change.passport-event/v1` and `change.passport/v1` as an append-only,
hash-linked event chain with a deterministic projection.

Required events:

```text
passport.created
proposal.recorded
evidence.admitted
evidence.excluded
evidence.frozen
evidence.invalidated
objection.recorded
evaluation.recorded
review.recorded
decision.recorded
effect.requested
effect.recorded
outcome.recorded
trigger.declared
trigger.observed
decision.reopened
decision.revoked
rollback.requested
rollback.recorded
passport.superseded
```

Required behavior:

- Bind exact candidate, baseline, policy, evaluator, budget, evidence cutoff,
  target environment, and rollback identities.
- Preserve actor-specific attestations. A Reploid recorder signature must not
  impersonate an evaluator, reviewer, GitHub, deployment system, or monitor.
- Reject missing sequence numbers, hash-chain forks, signature substitution,
  unknown event types, invalid state transitions, stale candidates, and
  conflicting effect identities.
- Project evidence, decision, and effect state independently.
- Recompute the projection from raw events during every governed decision.
- Export a self-describing verification package containing events, public keys,
  policy, referenced evidence manifest, and projection.
- Add an explicit adapter from `rsi.improvement-episode/v1` without treating
  the two schemas as identical or broadening Zero and X authority.

Acceptance gate:

- Unit tests cover every valid transition and adversarial failure above.
- The offline verifier rejects a modified event, forged signer, omitted event,
  reordered chain, invalid role, and projection that does not match replay.
- Existing improvement-episode tests continue to pass unchanged.

## Milestone 2: Hosted append-only service and custody boundary

Create `server/change-control/` with its own CATSCAN and these contracts:

- authenticated passport creation and event append;
- compare-and-append sequence control to prevent concurrent forks;
- idempotency keys for CI, webhook, trigger, and effect submissions;
- actor and organization membership with scoped roles;
- content-addressed evidence references with explicit admission;
- append-only event persistence and deterministic projection cache;
- export retrieval and offline verification;
- retention and deletion behavior that preserves required integrity records
  without retaining private payloads by default.

Implement an in-memory test store and a production durable-store adapter. Do
not reuse the Poolday store or collections.

Acceptance gate:

- Integration tests prove tenant isolation, role enforcement, concurrent
  append rejection, replay resistance, idempotent retries, projection recovery,
  and content-hash mismatch rejection.
- Security tests prove that a proposer cannot approve, activate, rewrite,
  reopen, revoke, or roll back outside the frozen policy.
- A clean restart reconstructs the same projection from durable events.

## Milestone 3: TypeScript SDK and CI action

Build the TypeScript SDK before the GitHub UI so the contract remains usable by
other CI and agent systems.

SDK operations:

```text
createPassport
freezeProposal
submitEvidence
excludeEvidence
recordObjection
submitEvaluation
recordReview
requestDecision
recordEffect
recordOutcome
observeTrigger
requestRollback
exportPassport
verifyPassport
```

The CI action accepts the candidate type, baseline and candidate revisions,
policy ID, evaluator command or result manifest, budget, evidence paths,
excluded evidence, and rollback target. It uploads hashes and admitted
artifacts, then returns the deterministic gate state.

Acceptance gate:

- SDK type tests and runtime conformance fixtures match the canonical schema.
- A local fixture repository can run the action against the test service.
- Interrupted and retried jobs remain idempotent and cannot attach results to a
  stale candidate revision.
- Logs redact tokens, credentials, private prompt contents, and unadmitted
  artifacts.

## Milestone 4: GitHub App and required check

Implement GitHub App authentication, installation scoping, webhook signature
verification, pull-request identity binding, and one required check named
`Reploid Change Passport`.

The first supported change classifications are:

```text
model
prompt
agent_tool
agent_policy
agent_configuration
source_patch
```

Repository configuration maps paths or manifest fields to one classification
and frozen policy. The check reports concrete blockers such as missing frozen
baseline, evaluator mismatch, unresolved objection, missing reviewer,
superseded candidate SHA, or rollback target absent.

Reploid authorizes by check result. GitHub branch protection performs the merge.
Reploid must not report a merge as activated until the named deployment adapter
records the effect.

Acceptance gate:

- Mocked GitHub integration tests cover installation, uninstallation, webhook
  replay, force-push, stale SHA, forked pull request, reviewer removal, and
  required-check updates.
- A sandbox repository proves that a blocked passport cannot satisfy the
  required check and an eligible passport can.
- The live record binds the exact repository, pull request, head SHA, policy,
  check run, and reviewer identities.

## Milestone 5: Review, approval, and activation surface

Create a separate Change Passport browser surface. It must show, in order:

1. Proposed change and target effect.
2. Current evidence, decision, and effect states.
3. Policy clauses and unsatisfied conditions.
4. Included, excluded, failed, and stale evidence.
5. Evaluations, objections, limitations, and disagreements.
6. Approval authority and review history.
7. Rollback target and reopening rules.
8. Raw events, signatures, and export.

Review actions include approve, reject, contest, leave unresolved, request
evidence, and revoke. Eligibility remains distinct from activation. The first
activation adapter records a GitHub deployment or named CI promotion result and
uses an idempotency key tied to the exact passport and candidate.

Acceptance gate:

- Browser tests prove role-specific action visibility and server enforcement.
- Approval cannot activate a change by itself.
- Activation failure leaves the decision approved and effect not applied or
  failed, with the failure retained.
- Accessibility and narrow-screen interaction pass the existing UI standards.

## Milestone 6: Outcomes, reopening, revocation, and rollback

Implement versioned trigger contracts for the first bounded sources:

- candidate artifact or dependency identity changes;
- a declared security advisory matches a dependency identity;
- a frozen evaluation or policy is superseded or revoked;
- a declared production metric crosses its threshold;
- a post-deployment evaluation fails its frozen contract.

Each trigger binds its sensor identity, observation, freshness, target,
deduplication key, and policy rule. A matching verified trigger automatically
records `decision.reopened`. It may request reevaluation, human review,
revocation, or rollback only when the frozen policy grants that request
authority.

The first rollback integration creates or invokes a controlled rollback target.
It records requested, started, succeeded, failed, and independently observed
states. It never converts a request into a successful rollback record.

Acceptance gate:

- Deterministic tests cover matching, non-matching, stale, duplicate, forged,
  conflicting, and withdrawn triggers.
- End-to-end tests prove that an applied change can become reopened while still
  applied, then become rolled back or remain unresolved without state collapse.
- Safe injected failures prove rollback failure remains explicit and retryable.

## Milestone 7: Zero and X dogfood adapter

Use Change Passport to govern one real Reploid model, prompt, tool, policy, or
configuration promotion.

- Zero may propose the candidate.
- X may supply a frozen evaluation.
- `rsi.improvement-episode/v1` remains the internal causal record.
- The adapter imports the relevant signed evidence into a separate Change
  Passport.
- A non-Zero/X reviewer and change-control policy decide eligibility.
- A separate adapter records activation and outcome.

Acceptance gate:

- The passport can be verified without trusting the Zero or X UI.
- The adapter preserves source identities and does not translate internal
  signatures into external endorsements.
- Rejection, reopening, and rollback all leave both ledgers internally
  consistent and cross-referenced.

## Milestone 7.5: Visual Change Passport local dogfood v0

The Visual Feedback Bridge remains the development-only owner of annotation,
project/worktree/session pairing, render notices, patch capture, and
conflict-safe source reversal. Reploid consumes versioned content-addressed
receipts and owns the governed state transitions:

```text
visual complaint
-> source-owned reversible patch
-> frozen independent checks and render oracle
-> attributed human acceptance
-> exact-candidate CI activation
-> post-activation rendered verification
-> Bridge reverse patch
-> candidate-artifact trigger
-> automatic decision reopening
```

The local v0 is implemented by
[`visual-change.js`](../../self/shared/change-passport/visual-change.js) and
[`visual-workflow.js`](../../server/change-control/visual-workflow.js). The
workflow rejects Bridge identity drift, missing DOM/source context, incomplete
comment dispositions, changed-file closure drift, proposer/evaluator identity
collapse, activation before acceptance, render verification before activation,
and reversal that does not restore the frozen baseline.

Acceptance evidence:

- [`visual-change-passport.test.js`](../../tests/integration/visual-change-passport.test.js)
  proves the 14-event signed transition chain and adversarial file-closure gate.
- [`verify-visual-change-passport-dogfood.js`](../../scripts/verify-visual-change-passport-dogfood.js)
  uses the canonical Bridge workspace-patch build and physical Chromium through
  Playwright, restores exact source bytes, verifies the export, and confirms
  that reopening leaves the external effect state applied rather than claiming
  rollback.

This is local dogfood evidence. It is not a live GitHub check, deployed CI
activation, external human study, or commercial proof.

## Milestone 8: External pilot and commercial proof

Before running the pilot, freeze:

- named adopter, operator role, evaluator, and approving authority;
- repository and supported change classification;
- current baseline workflow and evidence cutoff;
- paired or prospective assignment policy;
- reconstruction-cost definition;
- escaped-regression and prevented-regression definitions;
- false-block tolerance and review-effort units;
- reopening and rollback scenarios;
- minimum reportable sample and success or rejection thresholds.

Retain every attempted case, including failed CI, rejected decisions, unresolved
objections, invalid triggers, deployment failures, and rollback failures. The
independent evaluator receives a blinded comparison export where the design
permits blinding and publishes the signed result.

Commercial proof passes only through one predeclared quality-or-effort path and
when an operator asks to place Reploid on another real change. Otherwise the
hypothesis is rejected or remains unresolved.

## Parallel scientific track: Room-1

Room-1 continues under its existing charter and scientific authority. It does
not block implementation of the commercial integration, and commercial
activity does not satisfy Room-1 evidence gates.

After the generic passport contract passes its own gates, Room-1 may export a
Decision Passport projection for a protein-adjudication case. Poolday remains
the authority for scientific evidence admission and curator decisions.

## Release and claim gates

Do not claim Change Passport is implemented, secure, live, or commercially
validated from this plan. Update the surface claim index only when matching
evidence exists.

Before a supported release:

```bash
npm run verify:catscan
npm run verify:surface-claims
npm run verify:browser-bundle:local
npm run verify:change-passport:sdk
npm run verify:change-passport:pilot
npm exec -- tsc -p tsconfig.change-passport.json --noEmit
npm run verify:change-passport:visual
npm run test:unit
npm run test:integration
npm run test:e2e
node scripts/verify-change-passport.js <export-path>
```

The release record must bind clean Git source, server revision, browser bundle,
schema version, policy version, SDK and action versions, GitHub App identity,
durable-store migration, verifier bytes, and matching live sandbox evidence.

## Work deliberately excluded from the first release

- Generic enterprise workflow design outside the six change classifications.
- Agent identity-provider or permission-directory features.
- MCP or A2A protocol replacement.
- Trace collection that is not admitted as decision evidence.
- Autonomous merge, deployment, revocation, or rollback without frozen policy
  authority.
- Private payload replication through browser peers.
- General compliance dashboards.
- New model development or additional Zero and X presentation work.

---

*Last updated: August 2026*
