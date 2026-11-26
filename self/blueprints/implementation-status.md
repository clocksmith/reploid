# Blueprint implementation status

**Classification:** Index & Meta Contract

This file keeps no counts of its own. Status counts and the per-blueprint status table are generated into [`canonical-inventory.md`](canonical-inventory.md) by `node scripts/build-blueprint-registry.js` from each numbered blueprint's metadata. That metadata and the generated `self/config/blueprint-registry.json` are authoritative. A hand-copied count drifts as soon as a status changes, which is why the earlier figures here were removed.

Status meanings are defined in [`README.md`](README.md#status) and [`blueprint-index-contract.md`](blueprint-index-contract.md#status-contract). See [`deduplication-audit.md`](deduplication-audit.md) for the migration record.

## Verification commands

```bash
npm run build:blueprints   # regenerates the inventory, registry and canonical-inventory.md
npm run verify:registry    # read-only: registry --check, then scripts/validate-registry.js
```
