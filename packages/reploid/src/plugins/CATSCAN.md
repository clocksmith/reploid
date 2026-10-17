# CATSCAN: Plugin Sessions

Parent: [Browser Library](../../CATSCAN.md)

## Target
Run versioned research and game sessions through host-owned capabilities.

## Authority
Owns session transitions, durable effect intents, cancellation and bounded audit records.
Plugins own their rules and projections; hosts own permissions, model connections,
storage and trusted registration. Doppler owns inference.

## Scope
This directory.

## Contracts
Inputs: registered definitions, frozen configuration, capability ports, storage.

Outputs: participant projections and explicit private session exports.

## Invariants
- Imports perform no work. Opening or restoring never executes model requests.
- Persist an effect's intent before invoking its capability; retain failures.
- Bound calls and record size. Cancellation does not claim remote GPU termination.
- Restored pending work becomes interrupted; never automatically replay it.
- Versions and configuration remain attached to every result.
- Projection excludes private experiment data; browser-local hiding is not adversarial secrecy.
- Trusted built-ins only; registration is not an untrusted-code sandbox.

## Acceptance
Evidence: [session tests](../../../../tests/unit/plugin-session.test.js).
Injected capabilities prove lifecycle behavior, not real inference or scientific validity.

## Non-goals
Marketplace, arbitrary code installation, model execution, automatic spending or scientific conclusions.

## Freedom
Preserve the capability and evidence boundaries.
