# Reploid Blueprint Atlas

**Classification:** Index & Meta Contract

`self/blueprints/` contains maintained architectural decisions, not one generated document per JavaScript module.

## Authority

1. Numbered canonical specifications are contiguous from `0x000000` through `0x0000AF`.
2. [`canonical-inventory.md`](canonical-inventory.md) is the human-readable sitemap.
3. `self/config/blueprint-registry.json` projects each specification's explicit **Owned Source Files**. Generated output and affected-artifact mentions never establish ownership.
4. [`deduplication-audit.md`](deduplication-audit.md) records every merged or removed numbered file and its replacement authority.
5. `self/config/module-inventory.json` owns source-module enumeration. A module does not receive a blueprint unless it introduces a maintained architecture, invariant, protocol, or failure boundary.

## Classification

| Class | Meaning |
| --- | --- |
| Canonical Full Specification | Numbered authoritative architecture. It may be concise when the contract is narrow, but it must contain unique technical intent. |
| Summary Stub / Shell | Generated boilerplate with no unique architecture. These were removed and are forbidden by the verifier. |
| Index & Meta Contract | Unnumbered runtime, promotion, tool, index, audit, and navigation contracts. |

## Status

Every canonical numbered specification declares exactly one status:

- `Implemented`: verified implementation artifacts exist and no required metadata artifact remains planned.
- `In-Progress`: implementation evidence exists, with declared work or evidence still missing.
- `Proposed`: the declared implementation boundary is absent.

Status is not inferred from prose such as “implemented” in historical examples. `node scripts/build-blueprint-registry.js --check` checks classification, status values, unique ownership, owned-file existence, and both generated projections. It does not qualify model execution or validate scientific claims.

Run `npm run build:blueprints` to regenerate the source inventory, executable ownership registry, and human sitemap. Run `node scripts/validate-registry.js --json` for the read-only, source-bound registry audit; every unresolved finding produces a failing exit status.

## Numbering and references

IDs are identity, not domain buckets. New canonical blueprints take the next contiguous six-digit hexadecimal ID. Renumbering existing canonical files is forbidden outside an explicit migration that updates every path and reference in one change.

Historical references use exact former paths, not bare legacy IDs, because the old filename and heading ID namespaces conflicted.

## Runtime meta contracts

The unnumbered files in this directory are active supporting contracts or indexes. They do not occupy the canonical numeric sequence. `self/blueprint-index.json` controls the compact boot-time subset.

**[Back to Repository README](../../README.md)**
