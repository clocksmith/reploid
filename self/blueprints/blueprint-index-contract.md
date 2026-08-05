# Blueprint index contract

**Classification:** Index & Meta Contract

## Purpose

The blueprint system separates architectural authority from source enumeration. Numbered files carry maintained decisions; module inventory carries every JavaScript source file; the runtime loads only the compact context it needs.

## Sources of truth

| Question | Authority |
| --- | --- |
| Which canonical blueprints exist? | Numbered files `0x000000`–`0x0000AF` and generated `self/config/blueprint-registry.json` |
| What is each blueprint's status and implementation evidence? | Canonical metadata in that numbered file, validated into the registry |
| Which JavaScript modules exist? | `self/config/module-inventory.json` |
| Which runtime modules depend on which blueprints? | Generated `self/config/module-registry.json` |
| Which compact meta contracts enter boot context? | `self/blueprint-index.json` and `self/config/boot-seed.js` |
| What happened to pre-audit files? | `deduplication-audit.md` and each blueprint's `Former Blueprint Paths` metadata |

## Canonical numbered-file contract

A numbered blueprint must:

1. Use filename `0xNNNNNN-unique-slug.md`.
2. Use the identical six-digit ID in its first heading.
3. Occupy the next contiguous ID with no gaps.
4. Have a unique slug.
5. Declare `Classification`, `Implementation Status`, `Verified Artifacts`, `Planned Artifacts`, `Owned Source Files`, and `Former Blueprint Paths`.
6. Contain unique architectural intent; generic “Describe implementation for …” shells are forbidden.
7. Describe absent artifacts as planned, never implemented.

## Artifact and ownership contract

`Verified Artifacts` may include source, server, test, documentation, or configuration paths and every listed path must exist. `Planned Artifacts` may be absent. `Owned Source Files` are self-relative JavaScript paths used to build the one-owner compatibility mapping in the blueprint and module registries. Cross-cutting blueprints may cite the same verified artifact, but a source file has at most one blueprint owner.

## Status contract

- `Implemented` requires at least one verified artifact and no planned artifact in canonical metadata.
- `In-Progress` requires at least one verified artifact and at least one remaining planned artifact or declared incomplete verification boundary.
- `Proposed` has no verified implementation artifact for its declared boundary.

## Build and gate contract

`npm run build:blueprints` regenerates module inventory, blueprint registry, and module registry, then verifies sequence, metadata, ownership, artifact existence, and references. `npm run build:genesis` regenerates the genesis and VFS manifests. Generated timestamps are informational; IDs, paths, content hashes, and statuses carry authority.

## Reference contract

New references use canonical paths. Bare pre-audit IDs are not aliases because old heading IDs collided with old filename IDs. Runtime code and docs must not reference removed blueprint paths or IDs outside the canonical range.
