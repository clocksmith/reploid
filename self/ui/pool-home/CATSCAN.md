# CATSCAN: Reploid Product Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target
Present the intelligence network: objectives, participants, models, shared work, results and evaluated improvement. Standalone use remains a participant property.

## Authority
- Owns product and Room-1 presentation.
- Host owns execution and review.
- Requests candidate transfer, evaluation and adoption/rollback; never judges candidates.
- Excludes Pack validation, admission, transport, receipt validation, scientific interpretation.

## Scope
This tree.

## Contracts
Inputs: [runtime](../../pool/CATSCAN.md), deterministic [room state](room-projection.js).
Outputs: [markup](view.js), [Room-1](room-view.js).

## Invariants
- Brand Reploid; preserve Poolday identities. Keep copy brief and workflows uncluttered.
- Work, Network, Improve are activities, not required destinations.
- Selected, preparing, executing, offered remain observed states.
- Link tasks, helpers, jobs, results, candidates. Expose sharing stop.
- Protein/document examples preserve execution.
- Connected rooms never authorize private-goal sharing.
- User review is not evaluation or promotion.
- Missing admission/evaluators remain visible.
- Preserve request, execution, comparison, acceptance, receipt lifecycle.
- Interrupted jobs expose valid recovery only.
- Inspect Pack, runtime, provider, declared hardware, fallback, timing, output, agreement.
- Shared components/tokens; consistent spacing; accessible light/dark themes; responsive scrolling; futuristic, subtly neumorphic styling.
- Disclose detailed settings/evidence progressively; never conceal grants, failures or stop controls.
- Research administration stays in Room-1; generic Packs inherit no research fields.
- Disclose execution location; preview and approve each exact public peer payload.
- Acceptance names policy; receipts are not hardware attestation.
- Archive and decision memory remain distinct.
- Zero/X remain reachable without inheriting mutation authority.

## Acceptance
- Goals, criteria, sharing, jobs and evidence remain usable. Show outcome benefit and total cost against local and centralized baselines only when measured.
- Injected providers prove neither local nor peer inference.
- Evidence: [navigation](../../../tests/unit/pool-home-nav.test.js), [requests](../../../tests/unit/pool-home-ask-controls.test.js), [records](../../../tests/unit/pool-home-record.test.js), [peers](../../../tests/e2e/p2p-mesh.spec.js).

## Non-goals
Primary scientific administration, reputation, protocol internals.

## Freedom
Preserve these contracts.
