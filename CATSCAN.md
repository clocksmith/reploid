# CATSCAN: Reploid

Parent: none

## Target

Deliver a goal-directed agent using Doppler inference, Poolday collaboration, and evaluated recursive improvement.

## Authority
- Owns library, application, and UI boundaries: `packages/reploid/` implements reusable behavior; applications compose APIs; UI requests actions.
- Extraction proves neither qualification, publication nor deployment.
- Owns repository product boundaries, precedence, and proof requirements.
- Does not turn model output or infrastructure into biological truth.

## Scope

- Repository work not narrowed by child charters.

## Contracts

Inputs:
- Strategic intent from [GOALS.md](GOALS.md).
- Human purpose and invariants from [INTENT.md](INTENT.md).
- Current claim status from the [surface claim index](docs/status/surface-claim-index.json).

Outputs:
- Human navigation in the [README](README.md).
- Recursive component authority in the [component index](docs/component-index.md).

## Invariants
- The agent is the product; chat is an interface, domains are targets, Poolday is peer infrastructure, Doppler is model execution.
- Problem-solving and improvement loops operate with strict separation.
- Candidates cannot modify hidden acceptance tests, escalate permissions, or self-approve.
- Claims stay bounded by recorded acceptance evidence.
- Free adoption counts; commercial outcomes do not gate completion.
- Existing code cannot silently overrule a charter.

## Acceptance
- The charter graph validates, its index is current, and targeted work resolves its authority chain.
- Acceptance evidence verifies that [INTENT.md](INTENT.md) and [GOALS.md](GOALS.md) remain supported.
- Evidence: [CATSCAN validator tests](tests/unit/catscan.test.js).

## Non-goals
- Treating peer count, mutation volume, inference volume, or raw activity as product outcomes.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes acceptance evidence.
