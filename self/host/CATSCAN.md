# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Boot trusted seeds.

## Authority
- Owns substrate seeding and startup from the VFS.
- Product conversations, network participation and contribution belong to the [product host](../../apps/poolday/host/CATSCAN.md).
- Excludes policy/module semantics/recovery-root mutation.

## Scope

Subtree.

## Contracts

Inputs: [seed](../config/boot-seed.js), [start-app.js](start-app.js).

Outputs: [VFS](seed-vfs.js), [startup](start-reploid.js).

## Invariants
- Explicit seeds; no missing/unverified module substitutions.
- Lab images export complete self-source; builds never delete existing work.
- A stored product mode opens the product entry; the substrate loads no product module.
- Files grant no permissions/correctness.
- Candidate delivery grants no evaluation/adoption authority.

## Acceptance
- Complete seeds; VFS round-trips.
- Evidence: [boot](../../tests/unit/boot-seed.test.js), [VFS](../../tests/integration/vfs.test.js).

## Non-goals
- Scientific question/model policy/promotion.

## Freedom
Preserve.
