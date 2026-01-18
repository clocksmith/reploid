# Module System Migration Checklist

Use this checklist when refactoring modules, blueprints, and VFS seeding rules.

---

## 1. File Hygiene

- [ ] Remove unused runtime code from `src/`, or move it to `archive/`.
- [ ] Confirm no archived files are referenced by imports or config.
- [ ] Regenerate the VFS manifest after file moves.

---

## 2. Blueprint Coverage

- [ ] Ensure every runtime JavaScript file is listed in `blueprint-registry.json`.
- [ ] Create or update blueprint files for new features or files.
- [ ] Keep multi-file features explicit in the registry.

---

## 3. Genesis Levels

- [ ] Confirm each level is a strict superset of the previous level.
- [ ] Update `metadata.genesis.introduced` when moving modules between levels.
- [ ] Regenerate `genesis-levels.json` if using the build script.

---

## 4. VFS Hydration

- [ ] Regenerate `vfs-manifest.json` after any change to `src/`.
- [ ] Ensure `REPLOID_PRESERVE_ON_BOOT` behavior is preserved.

---

## 5. Verification

- [ ] Run `npm run verify:module-system` and resolve all errors.
- [ ] Review warnings and document any intentional exceptions.

---

*Last updated: December 2025*
