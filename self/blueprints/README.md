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
| Summary Stub / Shell | Generated boilerplate with no unique architecture. These were removed and are forbidden by this contract; the registry script does not detect them, so review does. |
| Index & Meta Contract | Unnumbered runtime, promotion, tool, index, audit, and navigation contracts. |

## Verification and work selection

Numbered blueprints define unique mechanics and verification conditions. These
conditions remain requirements until their scoped evidence exists; removing an
unchecked marker does not mark them verified. Declared artifact/status metadata
and its generated registry remain unchanged. Actual implementation selection
belongs only to the owner's private roadmap, not a blueprint work order.

## Status

Every canonical numbered specification declares exactly one status:

- `Implemented`: verified implementation artifacts exist and no required metadata artifact remains planned.
- `In-Progress`: implementation evidence exists, with declared work or evidence still missing.
- `Proposed`: the declared implementation boundary is absent.

Status is not inferred from prose such as “implemented” in historical examples. `node scripts/build-blueprint-registry.js --check` checks classification, status values, unique ownership, owned-file and verified-artifact existence, and both generated projections; [`blueprint-index-contract.md`](blueprint-index-contract.md#build-and-gate-contract) lists what it does not check. It does not qualify model execution or validate scientific claims.

Run `npm run build:blueprints` to regenerate the source inventory, executable ownership registry, and human sitemap. Run `node scripts/validate-registry.js --json` for the read-only, source-bound registry audit; every unresolved finding produces a failing exit status.

## Numbering and references

IDs are identity, not domain buckets. New canonical blueprints take the next contiguous six-digit hexadecimal ID. Renumbering existing canonical files is forbidden outside an explicit migration that updates every path and reference in one change.

Historical references use exact former paths, not bare legacy IDs, because the old filename and heading ID namespaces conflicted.

## Runtime meta contracts

The unnumbered files in this directory are active supporting contracts or indexes. They do not occupy the canonical numeric sequence. The compact boot-time subset is set in code, not by `self/blueprint-index.json`: `SELF_BLUEPRINT_PATHS` in `self/manifest.js` and the seed prefixes in `self/config/boot-seed.js` select `tabula-rasa-runtime.md`, `blueprint-index-contract.md`, `tool-contract.md` and `promotion-contract.md` for the Reploid self runtime, and Zero/X images seed no blueprints. See [`tabula-rasa-runtime.md`](tabula-rasa-runtime.md#first-context).

| File | Role |
| --- | --- |
| [`README.md`](README.md) | This atlas. |
| [`blueprint-index-contract.md`](blueprint-index-contract.md) | Numbered-file, status and build rules. |
| [`canonical-inventory.md`](canonical-inventory.md) | Generated sitemap and status counts. Do not edit. |
| [`CATSCAN.md`](CATSCAN.md) | Component map for this directory. |
| [`deduplication-audit.md`](deduplication-audit.md) | Merge and removal record. |
| [`implementation-status.md`](implementation-status.md) | Pointer to the generated status counts. |
| [`promotion-contract.md`](promotion-contract.md) | Durable `/self` change paths and authority. |
| [`tool-contract.md`](tool-contract.md) | Primitive tool surface and `CreateTool` behavior. |
| [`tabula-rasa-runtime.md`](tabula-rasa-runtime.md) | Boot context and runtime rules. |
| [`rgr-runtime-contract.md`](rgr-runtime-contract.md) | RGR runtime semantics and promotion gate. |
| [`rgr-slot-topology.md`](rgr-slot-topology.md) | Local and remote ring slots, lab routes. |
| [`rgr-dream-instance-manifest.md`](rgr-dream-instance-manifest.md) | Dream-instance manifest contract. |

**[Back to Repository README](../../README.md)**
