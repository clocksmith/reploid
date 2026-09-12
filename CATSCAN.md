# CATSCAN: Reploid

Parent: none

## Target

Deliver an evolving problem-solving agent that pursues goals for humans and agents via Doppler model inference, collaborates with peers over WebRTC via Poolday, and recursively improves its problem-solving methods through independently evaluated experience.

## Authority
- Owns repository-wide product boundaries, component precedence, and proof requirements.
- Does not turn infrastructure activity, model output, or accepted evidence into biological truth.

## Scope

- Includes repository-wide work and paths not narrowed by a child CATSCAN.

## Contracts

Inputs:
- Strategic intent from [GOALS.md](GOALS.md).
- Current claim status from the [surface claim index](docs/status/surface-claim-index.json).

Outputs:
- Human navigation in the [README](README.md).
- Recursive component authority in the [component index](docs/component-index.md).

## Invariants
- The agent is the product; chat is an interface, domains are application targets, Poolday is peer collaboration infrastructure, and Doppler is independent model execution.
- Problem-solving and improvement loops operate with strict separation.
- Candidates cannot modify hidden acceptance tests, escalate permissions, erase failures, or self-approve.
- Claims stay bounded by recorded acceptance evidence.
- Free adoption counts; commercial outcomes do not gate technical completion.
- Existing code cannot silently overrule a charter.

## Acceptance
- The charter graph validates, its index is current, and targeted work can resolve its full authority chain.
- Evidence: [CATSCAN validator tests](tests/unit/catscan.test.js).

## Non-goals
- Treating peer count, mutation volume, inference volume, or raw activity as product outcomes.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
