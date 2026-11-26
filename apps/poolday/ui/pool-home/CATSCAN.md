# CATSCAN: Reploid Product Interface

Parent: [Poolday Product](../../CATSCAN.md)

## Target
The vanilla shell for the specialist routes (`/ask`, `/compute`, `/records`, `/room-1`, `/history`, `/improve`, `/examples`, `/experiments`); contribution remains available. The conversation workspace belongs to [apps/poolday-react](../../../poolday-react/CATSCAN.md).

## Authority
Owns presentation/actions, never execution, admission, promotion or scientific/financial truth.

## Scope
This tree.

## Contracts
Inputs: [conversation state](../../../../packages/reploid/src/chat/CATSCAN.md), [host](../../host/CATSCAN.md), [runtime](../../pool/CATSCAN.md), [room projection](room-projection.js).
Outputs: [Room-1](room-view.js), specialist routes, the [vanilla bundle](app.bundle.js).

## Invariants
- Keep cached files, loaded models, readiness, execution, completion and settlement distinct. Earnings require accounting; simulations prove no production.
- Brief labels/actions; details via setup, tooltips or disclosures.
- Reuse catalog components, tokens, gutters, accessible themes, responsive scrolling, charcoal/prism/grid styling; decoration never signals execution; respect reduced motion.
- Bounded choices/confirmations use dialogs.
- Distinguish public, paired private and local capacity. Send never downloads; setup shows size before approval.
- Discovery, cached files and viewing grant nothing. Compute, file, training and remote disclosures keep separate permissions and local opt-outs.
- Connection and introductions default on; serving compute and files starts off, per switch; downloads require approval. Preserve training consent, bounded rounds, unadopted results, provenance, budgets, adapter compatibility and separate Room-1 administration.

## Acceptance
Evidence: [routes](../../../../tests/e2e/poolday-react-shell.spec.js), [UI](../../../../tests/unit/production-surface.test.tsx), [CSS](../../../../scripts/verify-poolday-css-layers.js), desktop/mobile checks. Qualification separate.

## Non-goals
Primary research administration, reputation or protocol internals; the conversation workspace.

## Freedom
Preserve contracts.
