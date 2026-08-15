# CATSCAN: Agent Tools

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Expose bounded, schema-defined operations that agents can invoke without bypassing verification, staging, or promotion controls.

## Authority
- Owns model-visible tool schemas and the behavior of individual tool operations.
- Does not own core execution policy, application authority, or direct promotion approval.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Tool execution contracts from [ToolRunner](../core/tool-runner.js).
- Promotion mechanics from [Promote.js](Promote.js).

Outputs:
- Staged tools through [CreateTool.js](CreateTool.js).
- Explicit mutation requests through file-operation tools.

## Invariants
- Tool inputs are validated before side effects.
- Creating or editing a tool cannot silently promote it.
- Errors and denied operations remain explicit results.

## Acceptance
- Tool creation and promotion enforce staging, validation, and governed activation.
- Evidence: [CreateTool tests](../../tests/unit/tools/create-tool.test.js) and [Promote tests](../../tests/unit/tools/promote.test.js).

## Non-goals
- Treating tool availability or invocation counts as capability improvement.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
