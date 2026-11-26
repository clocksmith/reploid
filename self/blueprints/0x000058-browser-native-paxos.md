# Blueprint 0x000058: Browser-Native Multi-Model Arena

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000058-browser-native-paxos.md`

## Retired design

This design, filed under the name "browser-native paxos", proposed `/capabilities/cognition/multi-model-paxos.js`: a browser-native Arena in which several models competed on a task and the best-scoring candidate moved forward. That module does not exist. Multi-model comparison is implemented in `self/testing/arena/`: competitors ([0x000064](0x000064-arena-competitor.md)), metrics ([0x000065](0x000065-arena-metrics.md)) and the harness ([0x000066](0x000066-arena-harness.md)). Arena scoring ranks candidates; it never grants activation or adoption, which remain the operator's (see [docs/SECURITY.md](../../docs/SECURITY.md)).
