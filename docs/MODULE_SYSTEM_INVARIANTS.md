# Module System Invariants

Defines the non-negotiable rules for the module system, blueprint coverage, and VFS seeding.

---

## Scope

These rules apply to runtime artifacts under `src/`, including modules, tools, UI components, config, and blueprints.

---

## Core Invariants

| Invariant | Rule |
|-----------|------|
| Seed coverage | Every file under `src/` is seeded into VFS before boot. |
| Blueprint coverage | Every runtime JavaScript file under `src/` maps to a blueprint entry. |
| Genesis levels | Each level is a strict superset of the previous level. |
| Module identity | `metadata.id` in each module file matches the module ID in `genesis-levels.json`. |
| Registry truth | `blueprint-registry.json` is the canonical map from files to blueprints. |

---

## VFS Seed Rules

- VFS seeding uses `config/vfs-seed.json`, generated from `src/` contents.
- The seed bundle must include every file under `src/`, including blueprints and config.
- When `REPLOID_PRESERVE_ON_BOOT` is true, seeding only fills missing VFS paths.
- Do not rely on `sharedFiles` or `levelFiles` for coverage. They are categorization only.

---

## Blueprint Registry Rules

- Every runtime JavaScript file appears exactly once in `blueprint-registry.json`.
- Each registry entry links to a blueprint file under `src/blueprints/`.
- Multi-file features are allowed only when explicitly listed in the registry.
- If a file is removed from `src/`, it must also be removed from the registry.

---

## Genesis Level Rules

- Levels are strictly additive. No module disappears when moving up a level.
- `metadata.genesis.introduced` must match the first level that introduces the module.
- Module dependencies must appear in the same or an earlier level.

---

## Hygiene Rules

- Unused runtime code is not allowed in `src/`.
- Experimental or archived code must live outside `src/`.
- Generated artifacts must be regenerated whenever source files change.

---

## Verification Expectations

Automated checks must confirm:

- All `src/` files are listed in `config/vfs-manifest.json`.
- `config/vfs-seed.json` matches the manifest and contains the full file set.
- All runtime JavaScript files map to a blueprint entry.
- All registry blueprint IDs exist in `src/blueprints/`.
- All module IDs and genesis levels match `genesis-levels.json`.
- Each level is a strict superset of the previous level.

---

*Last updated: December 2025*
