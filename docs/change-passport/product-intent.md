# Reploid Agent Release Passport Product Intent

## Product statement

Reploid Agent Release Passport decides whether an exact versioned agent policy,
tool, MCP server, permission bundle, or production-agent configuration is
eligible to proceed. It preserves why eligibility was granted and reopens the
decision when an authoritative observation invalidates its evidence or policy
basis.

The verified claim is narrow:

> Reploid verifies the declared evidence and policy basis under which a change
> decision became active.

It does not prove objective correctness, complete evidence, honest execution,
or successful rollback.

## First user and controlled action

The first user is an AI platform, developer infrastructure, reliability, or
security operator. The first controlled actions are promotions of:

- an agent tool or MCP server version;
- an agent permission or operating policy;
- production configuration that changes agent behavior.

Model, prompt, and ordinary source-code changes may use the contract later.
They are not the first commercial wedge.

The change is represented in GitHub and evaluated through CI. Ordinary code
changes may use the same contract later, but generic pull-request review is not
the first differentiation target.

## Frozen baseline workflow

The pilot compares Change Passport with the team's existing combination of:

```text
GitHub pull request and branch protection
+ CI tests and model evaluations
+ trace or monitoring output
+ manual approval
+ deployment and rollback records
```

The pilot freezes the repository, change class, baseline checks, evaluator,
approval authority, deployment target, rollback owner, evidence cutoff, cost
units, and success thresholds before observing outcomes.

## User journey

```text
agent or human proposes an exact change
-> Reploid binds candidate, baseline, policy, evaluator, and budget
-> CI submits included, excluded, failed, and contested evidence
-> evaluator records a versioned result and limitations
-> authorized reviewer approves, rejects, or leaves the decision unresolved
-> Reploid exposes an eligible or blocked required check
-> an independently authorized system applies or declines the change
-> Reploid records the deployed effect and observed outcome
-> a verified trigger reopens the decision when its basis changes
-> policy requests review, reevaluation, revocation, or controlled rollback
```

The passport controls a real gate. A document generated after activation is
not the product.

## Passport contents

One passport binds:

- exact proposal and candidate identities;
- baseline code, model, prompt, tool, configuration, and policy identities;
- evidence included in and excluded from the decision;
- failed checks, unresolved conditions, and accountable objections;
- evaluator identity, version, inputs, outputs, and limitations;
- reviewer and activation authorities;
- decision and the policy clauses that permit or block it;
- applied effect, deployment identity, and rollback target;
- outcome observations and their source identities;
- reopening triggers and the action each trigger may request;
- correction, revocation, rollback, and supersession history.

## State model

The deterministic projection keeps three axes separate.

| Axis | States |
|------|--------|
| Evidence | `collecting`, `frozen`, `invalidated`, `superseded` |
| Decision | `proposed`, `contested`, `approved`, `rejected`, `unresolved`, `reopened`, `revoked` |
| Effect | `not_applied`, `applied`, `degraded`, `rollback_requested`, `rolled_back`, `rollback_failed` |

Examples:

- An approved decision can remain `not_applied`.
- A reopened decision can remain `applied` while an operator investigates.
- A revoked decision can be `rollback_failed`.
- Superseded evidence does not silently erase the historical decision.

## Authority

The policy names these roles explicitly:

| Role | Authority |
|------|-----------|
| Proposer | Defines the candidate but cannot approve it |
| Evidence producer | Attests to one observation but cannot decide admissibility alone |
| Evaluator | Applies the frozen evaluation contract |
| Reviewer | Approves, rejects, contests, or leaves unresolved |
| Activator | Applies the approved change to the named target |
| Observer | Records post-activation outcomes |
| Rollback authority | Requests or performs rollback under declared policy |

One person or service may hold multiple roles only when the frozen policy
explicitly permits it. Reploid records that loss of independence rather than
implying independent review.

Automatic reopening is a deterministic decision-state transition. Merge,
deployment, permission revocation, and rollback are external effects that
require separately declared authority and idempotent adapters.

## Data custody

The hosted service stores content identities, policy records, attestations,
state events, and evidence explicitly admitted by the operator. Source code,
prompts, credentials, private traces, and configuration payloads remain in the
operator's existing repository or artifact store by default.

Each evidence reference declares its origin, digest, access requirement,
retention rule, and whether an offline verifier can retrieve it. Change
Passport does not send private customer material to Poolday peers.

## Relationship to existing Reploid systems

`rsi.improvement-episode/v1` is the internal Zero and X causal improvement
record. It supplies proven mechanics for frozen baselines, signed event chains,
paired evaluation, promotion replay, and rollback evidence. It is not the
external customer schema.

Change Passport uses a separate generic contract and authority surface. Zero
and X may produce and evaluate a passport through adapters, but external users
must not need either surface. Poolday retains scientific evidence authority
only. Room-1 remains the scientific proof of contradiction-preserving decision
memory.

## First proof

The first commercial claim requires a real operator to:

1. Freeze its current change-control workflow and success rules.
2. Run agent-generated model, prompt, tool, policy, or configuration changes
   through both the baseline and Reploid workflow.
3. Place Reploid in the required merge or promotion path.
4. Preserve all failed, contested, rejected, and unresolved cases.
5. Exercise at least one real or safely injected reopening trigger.
6. Verify the exported passport independently.
7. Ask to use Reploid for another real change.

The evaluator must report reconstruction cost, prevented regressions, escaped
regressions, false blocks, review effort, reopening correctness, and rollback
record completeness under predeclared definitions.

## Non-goals

- General agent identity or access management.
- Generic trace collection or model observability.
- Autonomous scientific or production closure.
- Automatic rollback without explicit authority.
- Replacing GitHub, CI, deployment systems, or monitoring systems.
- Claiming correctness from signatures, approvals, or successful deployment.
- Requiring Poolday, Zero, or X in the customer workflow.

---

*Last updated: August 2026*
