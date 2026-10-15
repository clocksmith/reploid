# CATSCAN: Earning Composition

Parent: [Hosted Services](../CATSCAN.md)

## Target

Operators enable the earning routes from environment and one policy file kept outside the repository.

## Authority
- Owns store and provider selection, policy reading, quote and offer templates, conversion publication, operator digests, evidence files, scheduler hosting.
- Excludes policy values, credentials, component rules, route behavior, capacity measurement.

## Scope

- This directory.

## Contracts

Inputs:
- `REPLOID_EARNING_*` variables and the [provider variables](../providers/env.js); a `reploid.earning-policy/v1` file ([policy.js](policy.js)).

Outputs:
- `createEarningComposition({ env, production })` in [index.js](index.js) for [mount.js](../earning-routes/mount.js).

## Invariants
- Files are absolute paths outside the repository; the repository ships no policy or credential.
- No price, rate, budget, deadline or limit defaults; components validate their own sections.
- Real providers only when configured; test sign-in and processor only when switched on, never in production.
- Production refuses memory stores; all stores share one database.
- Quotes and offers come only from templates; clients name a model or category, never terms.
- Templates the ledger or Community Access would refuse refuse to start.
- A published conversion id never changes; conflicting policy refuses to start.
- Deferred work runs through the scheduler, in-process or external; production with evidence terms or Community Access requires it.
- Operator tokens are matched by SHA-256 digest; the file holds none.

## Acceptance
- Evidence: [composition](../../tests/integration/earning-composition.test.js) and [scheduler](../../tests/integration/earning-scheduler.test.js) tests.
- Limits: operator-declared capacity evidence; live providers await acceptance.

## Non-goals
- Choosing prices, rewards, budgets, providers or intervals; cron triggers.

## Freedom
Preserve boundaries; pass acceptance.
