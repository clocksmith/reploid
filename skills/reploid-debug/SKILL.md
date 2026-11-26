---
name: reploid-debug
description: Reproduce and diagnose a named Reploid browser-agent, route, VFS, tool, provider, pool, mutation, state, or deployment failure; repair it only when requested.
---

# Reploid Debug

The procedure (reproduce, trace to the first broken boundary, read-only unless repair is
requested, prove the repair at that boundary) is the Deco workspace `deco-debug` skill
(`ouroboros/deco/skills/deco-debug/SKILL.md` in the workspace). This skill adds only the
Reploid boundaries to trace.

## Trace By Boundary

1. Route selection and surface config in `self/config/`.
2. Seeded modules and VFS reads/writes in `self/core/`.
3. AgentLoop state transition and LLM request/response.
4. Tool schema, ToolRunner invocation, and HITL/capability decision.
5. EventBus listeners, workers, streams, and teardown.
6. Shadow verification, promotion receipt, and Genesis rollback state.
7. Server/provider request, retry, parking, and resume behavior.
8. Rendered UI and persisted reload result.

For Poolday, distinguish signed records from claims about physical execution. For Zero,
inspect process/provider/tool-call/resume state. For X, keep mutation, validation, and
promotion evidence distinct.

## Stop Conditions

Stop before provider calls, promotion, or self-mutation without the required authority.
