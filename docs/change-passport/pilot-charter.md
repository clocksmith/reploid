# Change Passport External Operator Pilot Charter

## Current status

The implementation can run the protocol, but the pilot is not frozen and has
not started. The machine-readable
[pilot manifest](pilot-manifest.json) deliberately leaves the adopter,
operator, evaluator, approval authority, repository, evidence cutoff, and
resource budget empty. Those are external facts; inventing them would create a
false product proof.

Use `npm run verify:change-passport:pilot` to validate the protocol structure.
Use `npm run verify:change-passport:pilot:frozen` only after real named parties
sign the manifest. The second command fails while any external authority or
comparison boundary remains unfrozen.

## Question

Does Change Passport reduce the cost of reconstructing and safely governing an
agent-generated model, prompt, tool, policy, or configuration change without
increasing escaped regressions or false blocks relative to the operator's
existing workflow?

## Frozen comparison

Both arms receive the same candidate, baseline revision, evidence cutoff,
resource budget, and outcome window.

The baseline arm uses the operator's existing GitHub, CI/evaluation, approval,
deployment, monitoring, and rollback workflow. The Reploid arm adds a required
Change Passport gate, admitted and excluded evidence, attributed disagreement,
separate decision/effect state, verified export, and declared reopening rules.

Every attempted case remains counted, including failed CI, rejected and
unresolved changes, missing evidence, false blocks, deployment failures,
invalid triggers, and rollback failures.

## Authority

- The adopter names the repository and permits the pilot.
- The operator executes both frozen workflows.
- The independent evaluator defines and scores outcomes but does not author the
  candidate evidence.
- The approving authority may approve or reject but cannot alter the frozen
  evaluator or retroactively exclude failed cases.
- GitHub, CI, deployment, monitoring, and rollback systems attest only to their
  own observations and effects.
- Reploid verifies the declared evidence and policy basis; it does not claim
  objective correctness.

## Reportable result

At least 20 cases must reach their declared observation boundary. A result
passes only one of the predeclared quality or effort paths in the manifest. If
neither passes, the hypothesis is rejected or remains unresolved. Commercial
proof additionally requires the operator to ask to govern another real change.
