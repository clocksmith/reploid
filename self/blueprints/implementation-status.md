# Blueprint implementation status

**Classification:** Index & Meta Contract

This file is a summary projection. Canonical per-blueprint metadata and `self/config/blueprint-registry.json` are authoritative.

| Status | Count | Meaning |
| --- | ---: | --- |
| Implemented | 75 | Verified implementation boundary; no required metadata artifact remains planned. |
| In-Progress | 61 | Verified implementation exists, with declared work or evidence still missing. |
| Proposed | 40 | No verified implementation for the declared boundary. |

See [`canonical-inventory.md`](canonical-inventory.md) for every canonical ID and status. See [`deduplication-audit.md`](deduplication-audit.md) for the migration record.

## Verification commands

```bash
npm run build:blueprints
npm run build:genesis
npm run verify:blueprints
npm run test:unit
```
