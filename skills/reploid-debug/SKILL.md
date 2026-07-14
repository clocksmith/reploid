---
name: reploid-debug
description: Reproduce and fix Reploid browser-agent, route, VFS, tool, provider, pool, self-mutation, state, and deployment failures. Use when Poolday, X, or Zero behaves incorrectly or evidence and live state disagree.
---

# Reploid Debug

Trace the named surface from route boot through state, tools, provider calls, and
persisted evidence. Fix the first broken owner rather than relabeling the UI.

## Reproduce The Live Shape

Capture the URL, build identity, surface boot profile, browser console/network output,
VFS namespace, provider status, and exact user action. For deployment claims, verify
the deployed URL and artifact rather than relying on local tests.

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

## Fix And Prove

Patch the first producer whose output violates the next consumer's contract. Add a
regression at that boundary, then run the focused suite and the matching browser,
pool, module, or surface-claim verifier. Confirm reload/rollback for persisted state.
Report the failing object, owner, regression, and live check separately.
