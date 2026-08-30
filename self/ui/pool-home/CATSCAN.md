# CATSCAN: Poolday Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target

Run signed Doppler Packs on browser peers, share qualified compute, and inspect or recover jobs.

## Authority
- Owns Run a model, Share compute, Recent jobs, and contextual advanced details.
- Does not own Pack validation, execution, admission, transport, receipt validation, or scientific interpretation.

## Scope

- This tree.

## Contracts

Inputs:
- Governed records from the [Poolday runtime](../../pool/CATSCAN.md).
- Deterministic room state from [room-projection.js](room-projection.js).

Outputs:
- Product markup through [view.js](view.js).
- Contextual research projection through [room-view.js](room-view.js).

## Invariants
- Primary navigation contains exactly Run a model, Share compute, and Recent jobs, plus a compact network indicator.
- Request, assignment, execution, comparison, acceptance, and receipt retention remain one visible lifecycle.
- Interrupted jobs expose only valid recovery actions.
- Pack, runtime, provider, hardware declaration, fallback, timing, output, and agreement remain inspectable when available.
- Research rooms, policies, reputation, commit/reveal, and raw protocol records stay behind Advanced details.
- Accepted means admitted under a named policy; receipts are not hardware attestation.
- Archive and decision memory remain distinct.

## Acceptance
- Users can run a Pack, share compute, inspect jobs, recover work, and open deeper evidence only when needed.
- Evidence: [navigation](../../../tests/unit/pool-home-nav.test.js), [request](../../../tests/unit/pool-home-ask-controls.test.js), [records](../../../tests/unit/pool-home-record.test.js), and [peer journey](../../../tests/e2e/p2p-mesh.spec.js).

## Non-goals
- Exposing Zero, X, scientific administration, reputation, or protocol internals as primary navigation.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes acceptance.
