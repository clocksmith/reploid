# CATSCAN: Poolday Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target

Run signed Doppler Packs locally or on peers; inspect and recover jobs.

## Authority
- Owns primary workflows, experiment footer, and Research Room-1.
- Does not own Pack validation, execution, admission, transport, receipt validation, or scientific interpretation.

## Scope

- This tree.

## Contracts

Inputs:
- Records from [Poolday runtime](../../pool/CATSCAN.md).
- Deterministic room state from [room-projection.js](room-projection.js).

Outputs:
- Markup: [view.js](view.js).
- Room-1: [room-view.js](room-view.js).

## Invariants
- Public branding: Reploid. Internal Poolday identities remain unchanged.
- Primary navigation contains exactly Run a model, Share compute, Recent jobs, and a compact network indicator.
- The homepage footer links Zero and X, labeled Experiments.
- Request, execution, comparison, acceptance, and receipt retention remain one visible lifecycle.
- Interrupted jobs expose only valid recovery actions.
- Pack, runtime, provider, hardware declaration, fallback, timing, output, and agreement remain inspectable when available.
- Recent jobs Advanced contains only execution evidence, peer identities, retries, and recovery.
- Research administration renders only on Room-1.
- Generic Pack execution never inherits Research Room question or laboratory fields.
- Private documents never enter peer jobs or room drafts.
- Accepted means admitted under a named policy; receipts are not hardware attestation.
- Archive and decision memory remain distinct.

## Acceptance
- Users can run Packs, share compute, inspect jobs, recover work, and open evidence.
- Evidence: [navigation](../../../tests/unit/pool-home-nav.test.js), [request](../../../tests/unit/pool-home-ask-controls.test.js), [records](../../../tests/unit/pool-home-record.test.js), and [peer journey](../../../tests/e2e/p2p-mesh.spec.js).

## Non-goals
- Exposing Zero, X, scientific administration, reputation, or protocol internals as primary navigation.

## Freedom
Implementation varies.
