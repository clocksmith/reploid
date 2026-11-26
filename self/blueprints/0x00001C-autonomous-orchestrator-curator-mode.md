# Blueprint 0x00001C: Autonomous Orchestrator - Curator Mode

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00001C-autonomous-orchestrator-curator-mode.md`

## Retired design

This design proposed `upgrades/autonomous-orchestrator.js`, a Curator Mode that ran unattended overnight and queued proposals for review. That module does not exist, and the risk and cost figures the old text gave were not measurements. The agent cycle is [0x000008](0x000008-agent-cognitive-cycle.md). The design's one durable rule is the current one: the agent may generate proposals, and only the operator adopts them (see [INTENT.md](../../INTENT.md)).
