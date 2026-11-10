# CATSCAN: Reploid Product Interface

Parent: [Poolday Product](../../CATSCAN.md)

## Target
Shared models first; contribution remains available.

## Authority
Owns presentation/actions, never execution, admission, promotion or scientific/financial truth.

## Scope
This tree.

## Contracts
Inputs: [conversation state](../../../../packages/reploid/src/chat/CATSCAN.md), [host](../../host/CATSCAN.md), [runtime](../../pool/CATSCAN.md), [room projection](room-projection.js).
Outputs: [production](production.js), [conversations](conversation-workspace.js), [Room-1](room-view.js).

## Invariants
- Shared models first. Contribution setup/history live in Computers; reviewed setup shares while open.
- Keep cached files, loaded models, readiness, execution, completion and settlement distinct. Earnings require accounting; simulations prove no production.
- Brief labels/actions; details via setup, tooltips or disclosures.
- Reuse catalog components, tokens, gutters, accessible themes, responsive scrolling, charcoal/prism/grid styling; decoration never signals execution; respect reduced motion.
- Reploid header; URL-backed left Threads drawer and right Conversation/Computers/Settings drawer preserve center chat (both on wide screens, one on narrow) with mirrored 7⁷ transitions. Bounded choices/confirmations use dialogs; storage lives in Settings.
- Distinguish public, paired private and local capacity. Send never downloads; setup shows size before approval.
- Chat opens without capacity; sending enforces readiness/disclosure.
- Independent threads retain history, permissions and attempts; selection never cancels work; failures, Stop and unsettled cleanup stay visible.
- Discovery, cached files and viewing grant nothing. Compute, file, training and remote disclosures keep separate permissions and local opt-outs.
- Connection/cached sharing default on; downloads require approval. Preserve training consent, bounded rounds, unadopted results, provenance, budgets, adapter compatibility and separate Room-1 administration.

## Acceptance
Evidence: [UI](../../../../tests/unit/production-surface.test.js), [conversations](../../../../tests/e2e/chat-material.spec.js), [CSS](../../../../scripts/verify-poolday-css-layers.js), desktop/mobile checks. Qualification separate.

## Non-goals
Primary research administration, reputation or protocol internals.

## Freedom
Preserve contracts.
