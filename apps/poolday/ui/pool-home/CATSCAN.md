# CATSCAN: Reploid Product Interface

Parent: [Poolday Product](../../CATSCAN.md)

## Target
Shared models first; contribution and production remain available.

## Authority
Owns presentation/actions, never execution, admission, promotion or scientific/financial truth.

## Scope
This tree.

## Contracts
Inputs: [conversation state](../../../../packages/reploid/src/chat/CATSCAN.md), [host](../../host/CATSCAN.md), [runtime](../../pool/CATSCAN.md), [room projection](room-projection.js).
Outputs: [production](production.js), [conversations](conversation-workspace.js), [Room-1](room-view.js).

## Invariants
- Shared models first across screens. Local contribution setup and history live under Computers; reviewed setup enables sharing while open.
- Cached files, loaded models, readiness, execution, completion and settlement remain distinct. Earnings require accounting; simulations prove no production.
- Brief labels, values and actions; explanations through setup, tooltips or details.
- Reuse catalog components, tokens, gutters, accessible themes and responsive scrolling. Charcoal, prism, grids; mathematical decoration never signals execution. Respect reduced motion.
- Reploid header; aligned actions. Threads, Computers and Settings are URL-backed workspace destinations; bounded choices and confirmations use dialogs. Conversation inspection stays alongside the answer on wide screens and in a dismissible sheet on narrow screens. No left rail or nested Options.
- Storage belongs in Settings. Chat opens without capacity; sending enforces readiness and disclosure.
- Independent threads retain history, permissions and attempts. Selection never cancels work. Keep failures, Stop and incomplete cleanup visible.
- Discovery, cached files and viewing grant nothing. Compute, file, training and remote disclosures retain separate permissions. Preserve local-only boundaries and opt-outs.
- Connection/cached sharing default on; downloads require approval. Preserve training consent, bounded rounds and unadopted results.
- Preserve execution provenance, budgets, adapter compatibility and research lifecycles. Keep Room-1 administration separate; generic Packs exclude research fields.

## Acceptance
Evidence: [UI](../../../../tests/unit/production-surface.test.js), [conversations](../../../../tests/e2e/chat-material.spec.js), [CSS](../../../../scripts/verify-poolday-css-layers.js), desktop/mobile checks. Qualification remains separate.

## Non-goals
Primary research administration, reputation or protocol internals.

## Freedom
Preserve contracts.
