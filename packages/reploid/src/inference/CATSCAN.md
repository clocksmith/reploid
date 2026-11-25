# CATSCAN: Inference API

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
One requester-side inference API (`reploid/inference`) shared by the browser, the CLI and the SDK.

## Authority
Owns capabilities, prepare/run, route pinning, plan expiry, admission, events, results and receipts.
Hosts supply `resolveRoute` (describe, send nothing) and `execute` (the existing peer binding).
The [conversation workspace](../chat/CATSCAN.md) owns history and approval; the peer policy compiler and backend registry live in `chat/execution-policy.js`.

## Scope
Directory.

## Contracts
Inputs: a model pin, generation limits and per-protection requirements (protection, route, participants, metadata); then a plan id, idempotency key and messages.
Outputs: advisory `listCapabilities`; plans `{ id, expiresAt, protection, routeKind, route, maxCharge, disclosure }`; events; results with a receipt.
Display names: [`protections.js`](protections.js).
Specification: [protection and route](../../../../docs/confidential-execution.md).

## Invariants
- prepare takes no prompts, tools or prompt hashes and places no credit hold.
- `attested` always fails closed; `homomorphic` and `secret-sharing` unless enabled. Never retried weaker.
- Plans and receipts name the concrete route, never `auto`; requester-held edges are bound to the requester.
- `maxCharge` is capped or free; times are `YYYY-MM-DDTHH:MM:SS.sssZ`.
- Disclosure readers are never an empty list; a repeated `requestId` never dispatches or charges twice.
- No content leaves before the admitted binding matches the plan; no route substitution after admission.
- Partial text is never a result.
- Every terminal status gets a receipt: privacy, integrity and credits separately.

## Acceptance
Evidence: [routes](../../../../tests/integration/execution-privacy-routes.test.js), [admission](../../../../tests/integration/execution-privacy-admission.test.js), [faults](../../../../tests/integration/execution-privacy-faults.test.js), [presets](../../../../tests/unit/privacy-controls.test.js). Injected generators only.

## Non-goals
Cryptographic or attested backends, model mathematics, transport, UI.

## Freedom
Preserve boundaries and acceptance.
