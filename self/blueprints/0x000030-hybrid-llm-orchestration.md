# Blueprint 0x000030: Hybrid LLM Orchestration

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000030-hybrid-llm-orchestration.md`

## Retired design

This design proposed `/capabilities/cognition/hybrid-llm-provider.js`, which switched between local WebLLM inference and cloud APIs. That module does not exist. Provider choice is made by `self/core/llm-client.js` with `self/core/provider-registry.js`, described in [0x000007](0x000007-api-client-and-communication.md).
