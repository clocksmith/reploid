# CATSCAN: Agent Core

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Execute bounded agent cycles and tool calls against explicit state, policy, verification, and resource contracts.

## Authority
- Owns generic agent-loop, context, VFS, tool-execution, verification, and promotion mechanics.
- Does not own Poolday evidence admission, Zero objectives, X evaluation policy, or product claims.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Loop constraints from [agent-loop-policies.js](agent-loop-policies.js).
- Tool contracts through [tool-runner.js](tool-runner.js).

Outputs:
- Auditable cycle artifacts from [cycle-artifacts.js](cycle-artifacts.js).
- Verified virtual-file mutations through [vfs.js](vfs.js).

## Invariants
- Execution success is not output quality or causal improvement.
- Mutations cannot bypass verification and promotion gates.
- Failed, timed-out, or rejected work remains explicit.

## Acceptance
- Agent policy, tool execution, and VFS boundaries pass their tests.
- Evidence: [agent-loop policy tests](../../tests/unit/agent-loop-policies.test.js), [tool-runner integration tests](../../tests/integration/tool-runner.test.js), and [VFS tests](../../tests/integration/vfs.test.js).

## Non-goals
- Claiming recursive improvement from mutation, logging, or a single aggregate score.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
