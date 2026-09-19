# INTENT: Reploid

Parent: none

## Need

Developers and autonomous systems need goal-directed problem-solving agents that collaborate across peers, run local model inference, and improve their own methods without risking unverified self-modification or data exfiltration.

## Target

Deliver an evolving agent that executes goals through authorized models and tools, remains useful alone, optionally collaborates over Poolday WebRTC, and improves its problem-solving methods through independently evaluated recursive self-improvement (RSI).

## Invariants

- Candidate execution, protected evaluation, and active user work have explicit isolation and lifecycle boundaries. Separate machines are required where a particular proof demands them.
- Candidate improvements cannot modify hidden acceptance tests, escalate permissions, erase failure histories, or self-approve.
- The reusable browser agent library in `packages/reploid/` remains completely independent of specific UI frameworks.
- Local inference uses Doppler and executes locally; peer collaboration via Poolday is optional and capability-governed.
- Zero is the minimal starting configuration; X extends it with explicit capabilities. Proposer, evaluator, approver, and activator are separately authorized roles, not route identities.
- Free adoption counts as adoption evidence; commercial outcomes do not gate technical completion. Capability claims still require their stated acceptance evidence.

## Required checks

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
required checks alone is not evidence that the mission has been achieved.

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
