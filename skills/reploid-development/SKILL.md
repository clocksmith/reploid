---
name: reploid-development
description: Implement Reploid browser-agent, VFS, tool, interface, pool, provider, server, and self-modification features. Use for work in self/, server/, tests/, routes for Poolday, Zero, or X, Genesis recovery, or governed promotion flows.
---

# Reploid Development

Build browser-resident agent behavior while preserving surface authority, recoverable
self state, and evidence-gated activation.

## Establish The Surface

1. Read `docs/INDEX.md`, `docs/style-guide.md`, `EMOJI.md`, the relevant file in
   `self/blueprints/`, and the nearest instructions.
2. Name the target surface: Poolday `/`, X `/x`, or Zero `/zero`. Do not merge their
   routes, boot profiles, trust claims, tools, or state contracts.
3. State the mutation input, VFS or runtime owner, evidence gate, activation boundary,
   and rollback behavior.
4. Inspect `git status --short`; preserve unrelated changes.

## Route The Change

- Agent loop, VFS, state, context, LLM, and tool execution belong in `self/core/`.
- EventBus, DI, HITL, recovery, and substrate services belong in
  `self/infrastructure/`.
- Agent-callable operations belong in `self/tools/` with registered schemas.
- Browser presentation belongs in `self/ui/`; boot and model policy belong in
  `self/config/`.
- Network proxies and remote coordination belong in `server/`.

Preserve the Seed -> Shadow -> Promote boundary: mutate a candidate copy, verify it,
and activate it only through the governed promotion path. Genesis remains immutable
recovery state.

## Implement

1. Keep VFS writes explicit, transactional where supported, and attributable to the
   invoking tool or promotion.
2. Register tool schemas and enforce HITL/capability gates at execution, not only UI.
3. Dispose EventBus listeners, timers, workers, provider streams, and browser resources
   on route or run teardown.
4. Keep Poolday records, Zero operational state, and X self-modification receipts in
   their own schemas and claim rows.
5. Add focused unit coverage plus an integration or browser test for changed persisted
   state, routes, provider flow, or promotion behavior.

## Validate

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify:module-system
npm run verify:surface-claims
npm run verify:pool
npm test
```

Choose the gates matching the changed surface. A unit test does not prove IndexedDB,
browser inference, provider networking, or deployment. Finish with `git diff --check`
and report the exact surface and live boundary verified.
