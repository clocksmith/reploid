# CATSCAN: Agent Core

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Execute bounded agent cycles and tool calls under explicit verification and resource contracts.

## Authority
- Owns agent-loop, context, VFS, tool, verification, and promotion mechanics.
- Does not own Poolday evidence admission, Zero objectives, X evaluation policy, or product claims.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Loop constraints and tool contracts.

Outputs:
- Auditable cycles and verified VFS mutations.
- Browser/VFS compatibility exports for the
  [shared Change Passport contract](../shared/change-passport/CATSCAN.md).

## Invariants
- Execution success is not output quality or causal improvement.
- Every claimed improvement is projected from a signed `rsi.improvement-episode/v1`
  chain that binds a frozen baseline, declared metrics, raw paired observations,
  evaluator authority, generation ancestry, decision, and reflection.
- The [Change Passport adapter](change-passport-improvement-adapter.js) imports
  attributed Zero/X source evidence into a separate external ledger; it never
  imports reviewer, activation, outcome, reopening, or rollback authority.
- The [visual export](visual-change-passport.js) exposes receipt contracts
  without importing review, acceptance, or effect authority.
- Mutations cannot bypass verification and promotion gates.
- Failed, timed-out, or rejected work remains explicit.

## Acceptance
- Agent policy, tool execution, and VFS boundaries pass their tests.
- Evidence: [Change Passport tests](../../tests/unit/change-passport.test.js),
  [improvement adapter tests](../../tests/unit/change-passport-improvement-adapter.test.js),
  [visual workflow tests](../../tests/integration/visual-change-passport.test.js),
  [improvement episode tests](../../tests/unit/improvement-episode.test.js),
  [agent-loop policy tests](../../tests/unit/agent-loop-policies.test.js),
  [tool-runner integration tests](../../tests/integration/tool-runner.test.js), and
  [VFS tests](../../tests/integration/vfs.test.js).

## Non-goals
- Claiming recursive improvement from mutation, logging, or a single aggregate score.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
