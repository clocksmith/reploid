# Work completion acceptance

Status: acceptance contract, not a qualification claim.

Reploid pursues a bounded outcome through one installed `createReploid`
lifecycle. The application selects tools, models, stores, and authorization;
the UI requests actions and presents that same lifecycle. Poolday is the
optional network implementation, not another product.

## Required demonstration

```text
goal -> plan -> authorized action -> observed result -> revised approach
     -> delivered outcome -> protected acceptance
```

Give the installed agent a problem with independently specified success
criteria. It identifies missing information, requests authorized assistance,
evaluates the observation, and takes a subsequent action that depends on it.
The delivered artifact must pass checks unavailable to candidate tools.

Run the same goal locally. The agent must finish using available capabilities
or name the specific missing capability. A room connection is not a condition
for local usefulness and does not authorize input disclosure.

Retain an accepted finding, restore another instance, and present an unfamiliar
problem. Compare success and total resource use with the same agent without that
finding. Retrieval alone is not evidence of better problem solving.

## Controls and protected boundaries

- Freeze task inputs, acceptance cases, evaluator identity, source identities,
  model/tool permissions, and budgets before candidate execution.
- Change or withhold the peer observation. It must change the justified next
  action or lead to an explicit unresolved result, not merely another log entry.
- Decline disclosure. No peer job may execute and no private input may leave.
- Supply contradictory or unsupported observations. The agent must inspect and
  reject them rather than treating agreement or signatures as correctness.
- Keep failures, cancellations, regressions, disclosures, receipts, and costs,
  including acquisition, coordination, verification, retries, and review.
- Protect evaluators, permission ceilings, activation, and recoverable prior
  versions. Stable work remains pinned while candidate experiments run separately.
- Keep physical peer independence, signed execution identity, semantic acceptance,
  and biological or other domain validity as separate evidence fields.

## Three different improvement claims

| Claim | Required comparison |
| --- | --- |
| Better execution | The same work under comparable resources, including placement, caching, recovery, and coordination costs. |
| Better problem solving | Unseen tasks with and without retained findings or changed methods, against a competent frozen agent. |
| Recursive improvement | A produces B; B's changed improvement process contributes to C under a controlled ablation. |

For the recursive control, enable and disable B's changed improvement machinery
under comparable models, tools, budgets, evaluator access, and attempt counts.
Ancestry, extra attempts, stronger models, outside help, or candidate adoption
alone do not establish the causal contribution.

The learned-routing comparison against random and frozen reliability/load
schedulers gates learned routing. It is not a universal prerequisite for
independently evaluated agent improvements.

## Executable fixture evidence

`node tests/library-package-acceptance.js` packs and installs the browser library
into a detached consumer. Its Work cases reuse the actual application host and
UI, with library imports redirected to the installed bytes. The existing
standalone consumer separately checks library independence from the application.

[Cases](../tests/fixtures/work-goal-cases.json) freeze expected timeout repairs
outside the browser. [The browser fixture](../tests/fixtures/work-goal-journey.js)
uses an explicitly deterministic model procedure and injected peer observations.
Cases cover local completion and missing information, approved and denied
disclosure, counterfactual and unsupported observations, actual file inspection
and download, and restored accepted-history retrieval.

Reports retain source hashes, inputs, generated directives, tool results,
disclosure decisions, output artifacts, failures, and oracle decisions under
`artifacts/library-acceptance/<run>/`. `work-lifecycle-report.json` records
qualification exclusions instead of promoting fixture success.

These cases prove only the exercised wiring and boundaries. The fixture policy
is not learned; its unit-conversion cases do not establish cross-domain transfer.
They do not prove physical Doppler inference, WebRTC execution of the same goal,
independent operators, or any of the three improvement claims.

The complete milestone still requires the joined real-model, real-peer goal
journey, protected held-out task acceptance, and a controlled subsequent-task
comparison. Existing transport and inference results cannot substitute for it.
