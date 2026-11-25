# CATSCAN: Inference API

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
One requester-side inference API (`reploid/inference`) shared by the browser, the CLI and the SDK.

## Authority
Owns prepare/run, route pinning, plan expiry, admission checks, events, results and execution receipts.
Hosts supply `resolveRoute` (describe, send nothing) and `execute` (the existing peer binding).
The [conversation workspace](../chat/CATSCAN.md) owns history and approval; the peer policy compiler and backend registry live in `chat/execution-policy.js`.

## Scope
Directory.

## Contracts
Inputs: a model pin, generation limits and execution requirements (placement, participants, confidentiality, allowed metadata); then a plan id, a caller idempotency key and messages.
Outputs: `{ id, expiresAt, route, maxCharge, disclosures }` plans; `admitted`, `output.delta`, then one terminal event; `{ requestId, attemptId, status, output, usage, settlement, executionReceipt }`.
Specification: [confidential execution](../../../../docs/confidential-execution.md).

## Invariants
- prepare takes no prompts, tools or prompt hashes and places no credit hold.
- Requester-only confidentiality fails closed with `CONFIDENTIAL_EXECUTION_UNAVAILABLE`; it is never retried as readable or made local.
- Attested-execution fails closed (`ATTESTED_EXECUTION_UNAVAILABLE`) unless a host enables `attested/`; then no prompt is sealed before its proof verifies.
- No content leaves before the admitted binding matches the plan; no route substitution after admission.
- Partial text is never a successful result.
- A receipt lists only what this requester checked, with separate confidentiality and integrity evidence.

## Acceptance
Evidence: [attested](../../../../tests/unit/attested-gpu-route.test.js), [routes](../../../../tests/integration/execution-privacy-routes.test.js), [admission](../../../../tests/integration/execution-privacy-admission.test.js), [faults](../../../../tests/integration/execution-privacy-faults.test.js), [presets](../../../../tests/unit/privacy-controls.test.js). Injected generators; physical inference is separate.

## Non-goals
Model mathematics, transport, UI.

## Freedom
Preserve boundaries and acceptance.
