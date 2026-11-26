# Blueprint 0x00003B: Browser-Native DOGS/CATS Parser

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00003B-dogs-cats-browser-parser.md`

## Retired design

This design proposed `dogs-parser-browser.js`, a browser parser and writer for the PAWS DOGS change bundles and CATS context bundles. That module does not exist, and PAWS is archived. Unused helpers for the two formats remain in `shared/core/utils.js` (`parseCatsBundle`, `generateCatsBundle`, `parseDogsBundle`, `generateDogsBundle`; see [0x000003](0x000003-core-utilities-and-error-handling.md)); no module calls them. Change representation is consolidated in the Proposed [0x00003F](0x00003F-diff-utilities.md).
