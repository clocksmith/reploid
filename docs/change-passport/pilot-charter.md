# Agent Release Passport External Pilot Charter

## Product boundary

The first external Reploid product governs whether one exact production-agent
release is eligible to proceed and when that eligibility must reopen. The
supported pilot change classes are MCP server versions, agent tool manifests,
agent permission policies, and production-agent configuration. Generic source
patches, model promotion, prompt experiments, visual UI work, deployment
execution, and rollback execution are outside this pilot.

GitHub retains merge authority. Deployment and identity systems retain effect
authority. Reploid binds candidate identity, admitted and excluded evidence,
evaluation, disagreement, human approval, rollback target, and reopening
conditions into one replayable Passport.

## Current status

The implementation has completed one internally operated live GitHub cycle,
but the external pilot is not frozen and has not started. The current GitHub
App is owner-only and therefore cannot yet be installed by a design partner.
The [pilot manifest](pilot-manifest.json) deliberately leaves every external
identity and candidate boundary empty.

Use `npm run verify:change-passport:pilot` to validate the template. Use
`npm run verify:change-passport:pilot:frozen` only after a real adopter supplies
the required identities, repository, agent program, candidate, budget,
evaluator, rollback target, reopening sensors, and digest-bound approvals.

## Admission sequence

1. Make the least-privilege GitHub App installable by the named adopter.
2. Install it on exactly one selected repository.
3. Choose one agent program and one supported change class.
4. Bind the baseline and candidate artifact digests.
5. Freeze admitted evidence, excluded evidence, evaluator, suite, contract,
   evidence cutoff, outcome window, and resource budget.
6. Name distinct proposer, operator, evaluator, reviewer, approval, observer,
   and rollback authorities.
7. Require the App-bound check only on a dedicated pilot branch or ruleset.
8. Bind at least one executable reopening sensor and an exact rollback target.
9. Record approval receipts over the frozen manifest hash.
10. Run the frozen verifier before the first prospective case.

The default App remains check-only: metadata read, pull requests read, and
checks write, with pull-request and pull-request-review webhooks. Content,
deployment, credential, and rollback permissions require separately enabled
effect adapters and are prohibited in the initial pilot.

## Frozen comparison

Both arms receive the same candidate, baseline, evidence cutoff, resource
budget, and outcome window. The baseline arm uses the operator's existing
GitHub, CI, approval, monitoring, and rollback workflow. The Reploid arm adds
the Passport eligibility check and verified export.

Every attempted case remains counted, including missing evidence, failed CI,
rejected and unresolved changes, false blocks, invalid triggers, activation
failures, and rollback failures. Reploid may pass while another required check
fails; eligibility never overrides another system's authority.

## Measures and claim boundary

Measure reconstruction minutes, source retrieval count, unresolved questions,
missing evidence found before approval, false blocks, escaped regressions,
reopening precision, invalidation-to-reopening time, and rollback-target
completeness. At least 20 prospective paired cases must reach their declared
observation boundary.

Commercial continuation requires the operator to request and pay for another
governed release. Internal dogfood, structural validation, installation, or a
passing check proves none of customer value, incident reduction,
qualification, adoption, deployment safety, or rollback success.
