# Blueprint 0x000017: Meta-Blueprint for Creating Blueprints

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000017-blueprint-creation-meta.md`

## Retired design

This design proposed `blueprint-creator.js`, a tool that let the agent write new blueprints from templates. That module does not exist. The rules for blueprints are in [README.md](README.md) and [blueprint-index-contract.md](blueprint-index-contract.md); a new blueprint is ordinary Markdown written with the file tools and checked by `node scripts/build-blueprint-registry.js --check`.
