# CATSCAN: Pinned Doppler Assets

Parent: [Generated Browser Library Assets](../CATSCAN.md)

## Target
Serve the standard pinned Doppler package's required browser graph from the application origin.

## Authority
Owns verified delivery only. Doppler owns runtime implementation and numerical semantics.

## Scope
The current package directory in this tree.

## Contracts
Inputs: exact archive and SHA-512 from package-lock.json, verified by scripts/vendor-doppler.js.
Outputs: complete source package contents with only the enclosing package directory stripped; a byte-preserving Hosting projection selected by `scripts/hosting-file-set.js`.

## Invariants
- Never edit package contents, substitute a checkout, or change the declared integrity.
- Every runtime uses the same pin. Hosting includes its transitive modules and dynamically selected kernel and policy assets. Historical archives and qualification evidence remain outside normal builds and Hosting.
- Asset availability grants no computation, disclosure, custody or adoption permission.

## Acceptance
Archive integrity and complete browser module graph/shader loading pass repair smoke checks.
Evidence: [browser smoke verifier](../../../scripts/verify-swarm-runtime.js).

## Non-goals
Model generation or distributed execution qualification.

## Freedom
Preserve byte identity and ownership.
