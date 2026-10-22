# CATSCAN: Zero Capsule

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Assemble a small fresh Zero from its saved configuration, UI and agent capsules.

## Authority

Owns explicit browser composition and source-only reproduction. The shared agent
engine owns execution; the existing verification and activation owners gate tools.

## Scope

This subtree. Existing Zero instances, X and Poolday retain their own startup.

## Contracts

Inputs: a complete hash-bound source descriptor and explicitly selected inference.
Outputs: a preserved VFS, conversation and reproducible source image.

## Invariants

- Never clear, migrate or overwrite an existing instance to install this seed.
- Configuration and exports never contain credentials or private run state.
- Missing verification, changed bytes or rejected activation cannot install tools.
- Capsules receive only scoped host ports; source hashes prove integrity, not trust.
- Count host, provider and verification dependencies separately from assembly code.

## Acceptance

Fresh and returning boot, verified tool creation, disposal, source reproduction,
tamper rejection and legacy preservation pass focused capsule tests.

Evidence: [boot preservation](../../tests/unit/zero-capsule-boot.test.js),
[real verification and scoped tools](../../tests/unit/zero-capsule-tools.test.js),
[source-only image](../../tests/unit/zero-capsule-image.test.js).

## Non-goals

Automatic upgrades, arbitrary JavaScript isolation, L1/L2/L3 qualification, deployment.

## Freedom

Keep the composition compact and readable without hiding required dependencies.
