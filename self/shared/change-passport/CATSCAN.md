# CATSCAN: Shared Change Passport Contract

Parent: [Browser Runtime](../../CATSCAN.md)

## Target

Provide one browser-safe Change Passport contract, policy, Zero/X source
adapter, and Visual Feedback Bridge receipt adapter to browser, server, SDK,
action, and verifier consumers.

## Authority

- Owns canonical schemas, normalization, transition validation, hashing,
  signatures, deterministic projection, policy gates, exports, and source
  adaptation.
- Does not own hosted persistence, UI actions, external effects, Poolday
  evidence, or product claims.

## Scope

- Includes this directory.

## Contracts

Inputs:
- Attributed actor, proposal, evidence, policy, evaluation, decision, effect,
  outcome, trigger, and rollback records.

Outputs:
- Replayable `change.passport-event/v1`, `change.passport/v1`, and
  `change.passport-export/v1` records.

## Invariants

- Evidence, decision, and effect state remain separate.
- Frozen evidence cannot change in place.
- Source signatures never become external endorsements.
- Automatic reopening never asserts an external effect.
- Visual source requests, patch ownership, evaluation, acceptance, render, and
  reversal receipts remain separate content-addressed records.

## Acceptance

- Canonical, policy, adversarial, export, and improvement-adapter tests pass.
- Evidence: [contract tests](../../../tests/unit/change-passport.test.js) and
  [adapter tests](../../../tests/unit/change-passport-improvement-adapter.test.js).
- Visual receipt evidence: [workflow integration tests](../../../tests/integration/visual-change-passport.test.js).

## Non-goals

- Hosting, identity provision, deployment truth, or objective correctness.

## Freedom

Any browser-safe mechanism is permitted if replay and authority remain exact.
