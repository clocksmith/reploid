# CATSCAN: Pinned Doppler Assets

Parent: [Generated Browser Library Assets](../CATSCAN.md)

## Target
Serve the complete pinned Doppler package from the application origin.

## Authority
Owns verified delivery only. Doppler owns runtime implementation and numerical semantics.

## Scope
Versioned package directories in this tree.

## Contracts
Inputs: exact archive and SHA-512 from package-lock.json, verified by scripts/vendor-doppler.js.
Outputs: complete package contents with only the enclosing package directory stripped.

## Invariants
- Never edit package contents, substitute a checkout, or change the declared integrity.
- Asset availability grants no computation, disclosure, custody or adoption permission.

## Acceptance
Archive integrity and complete browser module graph/shader loading pass repair smoke checks.
Evidence: [browser smoke verifier](../../../scripts/verify-swarm-runtime.js).

## Non-goals
Model generation or distributed execution qualification.

## Freedom
Preserve byte identity and ownership.
