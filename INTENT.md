# INTENT: Reploid

Parent: none

## Need

Developers and autonomous systems need goal-directed problem-solving agents that collaborate across peers, run local model inference, and improve their own methods without risking unverified self-modification or data exfiltration.

## Target

Deliver an evolving agent that executes goals through authorized tools, collaborates with peers over Poolday WebRTC, and iteratively improves problem-solving capabilities through independently evaluated recursive self-improvement (RSI).

## Invariants

- Problem-solving and recursive improvement loops operate under strict physical and lifecycle separation.
- Candidate improvements cannot modify hidden acceptance tests, escalate permissions, erase failure histories, or self-approve.
- The reusable browser agent library in `packages/reploid/` remains completely independent of specific UI frameworks.
- Local inference uses Doppler and executes locally; peer collaboration via Poolday is optional and capability-governed.
- Free adoption counts as full technical success; commercial milestones do not gate technical completion.

## Evidence

- Passing CATSCAN charter repository verification via `npx vitest run tests/unit/catscan.test.js`.
- Clean execution of unit, integration, and peer protocol suites in `tests/`.
- Validated surface claims in `docs/status/surface-claim-index.json`.

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
