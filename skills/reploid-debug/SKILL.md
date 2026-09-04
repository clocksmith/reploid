---
name: reploid-debug
description: Reproduce and diagnose a named Reploid browser-agent, route, VFS, tool, provider, pool, mutation, state, or deployment failure; repair it only when requested.
---

# Reploid Debug

Diagnosis is read-only. Patch the identified owner only when the user's request includes implementation.

Trace the named surface from route boot through state, tools, provider calls, and
persisted evidence. Diagnose the first broken owner rather than relabeling the UI.

## Prerequisites

Supply the failing route or session object, expected state, reproduction action, build
identity, and relevant VFS, provider, tool, pool, mutation, or persistence evidence.

## Procedure

1. Reproduce the live shape and capture the exact input and persisted identities.
2. Trace route boot, state, tools, providers, pool, mutation, and persistence boundaries.
3. Report the first invalid producer; only if repair is requested, patch that owner and
   run focused, browser, persistence, rollback, and claim checks as applicable.

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

## Authorized Repair And Proof

When repair is requested, patch the first producer whose output violates the next consumer's contract. Add a
regression at that boundary, then run the focused suite and the matching browser,
pool, module, or surface-claim verifier. Confirm reload/rollback for persisted state.
Report the failing object, owner, regression, and live check separately.

## Validation

The original object passes the repaired producer/consumer boundary, reload or rollback
is verified for persisted state, and the matching live surface check succeeds.

## Stop Conditions

Stop before provider calls, promotion, or self-mutation without the required authority.
Stop when the failing route/session object or expected persisted state is unavailable.

## Outputs

A producer/consumer diagnosis with the failing object and owner and, for an authorized
repair, regression, reload/rollback, and live-surface evidence.

## Side Effects

Diagnosis reads local state and may run local checks. Authorized repair may edit
Reploid and write test state; provider calls, promotion, and mutation remain gated.
