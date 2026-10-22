# CATSCAN: Compact X/Zero Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target

Give X/Zero operators a focused interface for objectives, tool-growing experiments, and candidate proposals.

## Authority
- Owns shared compact X/Zero presentation, explicit export and operator interactions.
- Does not own evaluation, promotion, Poolday evidence, or Research Room navigation.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- X/Zero runtime state through [index.js](index.js).
- X/Zero surface boundaries from [surface intents](../../config/surface-intents.js).

Outputs:
- Explicit operator requests and visible X/Zero state.

## Invariants
- Proposal status cannot be displayed as evaluation or promotion.
- Failures and suspended state remain visible and resumable where supported.

- Conversation, prompt, state, Stop, errors and approval requests stay accessible; technical details use disclosure.

## Acceptance
- The compact interface renders the declared surface and survives state refresh without authority leakage.
- Evidence: [Zero UI tests](../../../tests/unit/zero-ui.test.js) and [Zero refresh journey](../../../tests/e2e/zero-ui-refresh.spec.js).

## Non-goals
- Presenting Zero as the Research Room or as proof of recursive improvement.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
