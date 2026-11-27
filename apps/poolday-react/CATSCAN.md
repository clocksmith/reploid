# CATSCAN: Poolday Conversation Workspace

Parent: [Reploid](../../CATSCAN.md)

## Target
Every replo.id screen ([routes](src/features/shell/domain/routes.ts)): the conversation workspace on `/`, `/network` and `/work`, and the specialist pages.

## Authority
- Owns the React screens and workspace navigation: conversation and Threads drawer ([chat](src/features/chat)), the end drawer (Conversation details, Computers, Settings) and first-visit, loading and failure states ([app](src/app)).
- Framework-free [host decisions](../poolday/host/decisions/conversation-controller.js) decide; the [host](../poolday/host/CATSCAN.md) and [conversation library](../../packages/reploid/src/chat/CATSCAN.md) own execution, admission and settlement.
- Components come only from `@reploid/poolday-ui` ([contract](../../docs/poolday-ui-architecture.md)).

## Scope
This directory; [Poolday](../poolday/CATSCAN.md) owns the HTML entries and serves the bundles.

## Contracts
Inputs: the opened product host ([adapter](src/features/shell/infrastructure/productHost.ts)) and its conversation controller.

Outputs: the [app entry](src/main-app.tsx) (`initPoolHome`, `mountPoolday`) built to `ui/react/app.js`; the [design entry](src/main-design.tsx) for `/design`.

## Invariants
- Layers follow [the architecture rules](../../scripts/poolday-ui-architecture.json); features never import each other.
- Threads open at the start side, details, Computers or Settings at the end; the address records both, so Back and Forward work. Both stay open only where they fit beside the reading column. Selection never cancels work.
- Chat opens without capacity; Send enforces readiness and disclosure and never downloads; setup shows size before approval.
- Independent threads retain history, permissions and attempts; failures, Stop and unsettled cleanup stay visible.
- Contribution setup lives in Computers, storage in Settings. Connection defaults on; serving compute and files starts off, per switch.
- Labels never imply stronger evidence than the record.

## Acceptance
- Evidence: [shell](../../tests/e2e/poolday-react-shell.spec.js), [navigation](../../tests/e2e/workspace-navigation.spec.js), [conversations](../../tests/e2e/chat-material.spec.js), [workspace](../../tests/unit/poolday-ui/chat-workspace.test.tsx), [boundaries](../../scripts/check-poolday-ui-boundaries.mjs).

## Non-goals
Primitives ([@reploid/poolday-ui](../../packages/poolday-ui)), host decisions, [projections](../poolday/ui/pool-home/CATSCAN.md).

## Freedom
Preserve contracts and acceptance.
