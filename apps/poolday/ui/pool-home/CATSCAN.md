# CATSCAN: Reploid Product Projections

Parent: [Poolday Product](../../CATSCAN.md)

## Target
Framework-free projections, labels and browser-local stores that the [host decisions](../../host/decisions) read for the React screens. No interface is rendered here; every screen belongs to [apps/poolday-react](../../../poolday-react/CATSCAN.md).

## Authority
Owns framework-free projections, wording and browser-local stores read by the [host decisions](../../host/decisions). No markup or presentation; never execution, admission, promotion or scientific/financial truth.

## Scope
This tree.

## Contracts
Inputs: [conversation state](../../../../packages/reploid/src/chat/CATSCAN.md), [host](../../host/CATSCAN.md), [runtime](../../pool/CATSCAN.md), [room projection](room-projection.js).
Outputs: records and labels for the React screens, through the host decisions.

## Invariants
- Keep cached files, loaded models, readiness, execution, completion and settlement distinct. Earnings require accounting; simulations prove no production.
- Brief labels/actions; details via setup, tooltips or disclosures.
- Labels and projections feed the React screens (apps/poolday-react); decoration never signals execution.
- Distinguish public, paired private and local capacity. Send never downloads; setup shows size before approval.
- Discovery, cached files and viewing grant nothing. Compute, file, training and remote disclosures keep separate permissions and local opt-outs.
- Connection and introductions default on; serving compute and files starts off, per switch; downloads require approval. Preserve training consent, bounded rounds, unadopted results, provenance, budgets, adapter compatibility and separate Room-1 administration.

## Acceptance
Evidence: [routes](../../../../tests/e2e/poolday-react-shell.spec.js), [UI](../../../../tests/unit/production-surface.test.tsx), [CSS](../../../../scripts/verify-poolday-css-layers.js), desktop/mobile checks. Qualification separate.

## Non-goals
Primary research administration, reputation or protocol internals; the conversation workspace.

## Freedom
Preserve contracts.
