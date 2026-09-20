# INTENT: Reploid

Parent: none

## Need

Humans and agents need cooperating systems that solve problems, share model storage and computation, and learn to use their collective resources better within explicit contribution and disclosure limits.

## Target

Reploid is a peer-to-peer network of agents that runs and distributes model computation, coordinates problem solving, and improves individual agents and collective efficiency through Bayesian learning and evaluated experiments. Each agent remains useful independently, and each participant controls what it shares and contributes. This target is not a claim of completed implementation.

## Invariants

- Candidate execution, protected evaluation, and active user work have explicit isolation and lifecycle boundaries. Separate machines are required where a particular proof demands them.
- Candidate improvements cannot modify hidden acceptance tests, escalate permissions, erase failure histories, or self-approve.
- The reusable browser agent library in `packages/reploid/` remains completely independent of specific UI frameworks.
- Doppler owns model mathematics and valid executable partitions; Reploid owns eligible placement and Poolday peer transfer and recovery. Placement preserves model semantics. Activations require input-derived disclosure grants.
- Model storage, partitioned computation and agent work are distinct distribution mechanisms. GPU readback, transfer and upload costs count alongside computation.
- Bayesian beliefs retain uncertainty and observation dependencies. Posterior updates are adaptation; replacing the updater or scheduler is an evaluated candidate change.
- Operators may preauthorize bounded reversible adoption; candidates cannot change those policies or gain permissions. Runtime reasoning, collaboration and evolution within grants do not depend on CI or software release.
- One connected interface exposes actual agents, model locations, shared work, contribution controls, and improvement states. It never fabricates activity or merges evaluation with adoption authority.
- Zero is the minimal starting configuration; X extends it with explicit capabilities. Proposer, evaluator, approver, and activator are separately authorized roles, not route identities.
- Free adoption counts as adoption evidence; commercial outcomes do not gate technical completion. Capability claims still require their stated acceptance evidence.

## Development checks

These checks verify repository changes. They are not runtime prerequisites for
authorized reasoning, collaboration, evaluation or adoption.

- Run CATSCAN charter verification via `npx vitest run tests/unit/catscan.test.js`.
- Run applicable unit, integration, browser, and peer protocol checks in `tests/`.
- Validate claim references with `npm run verify:surface-claims`.

## Recorded evidence

The [surface claim index](docs/status/surface-claim-index.json) bounds claims by
their evidence and blockers. The versioned
[architecture convergence report](artifacts/architecture-convergence-2026-09-19/report.json)
records shared-engine, contract, browser, and installed-package checks for its
identified sources. It does not demonstrate the full recursive-improvement
mission or physical GPU qualification. Each capability or improvement claim
requires its own versioned observations and declared comparison; passing the
development checks alone is not evidence that the mission has been achieved.

## Non-goals

- Monolithic cloud chatbot services or centralized agent swarms.
- Unconstrained autonomous code execution without human or sandbox verification.
- Conflating peer activity volume or token generation counts with problem-solving success.

## Truth

Independently evaluated test suites and frozen benchmark populations govern all capability and improvement claims. Self-reported agent confidence does not constitute evidence.

---

Links:
- Root strategy: [GOALS.md](GOALS.md)
- Technical charter: [CATSCAN.md](CATSCAN.md)
