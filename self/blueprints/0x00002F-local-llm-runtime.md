# Blueprint 0x00002F: Local LLM Runtime

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00002F-local-llm-runtime.md`

## Retired design

This design proposed `/capabilities/cognition/local-llm.js`, in-browser inference of quantized models through WebLLM. That module does not exist and WebLLM is not used. Local inference runs through Doppler (`self/core/doppler-runtime-service.js`, [0x0000A6](0x0000A6-core-doppler-runtime-service.md)) and Transformers.js (`self/core/transformers-client.js`, [0x00005D](0x00005D-transformers-client.md)), and the provider is chosen by the LLM client ([0x000007](0x000007-api-client-and-communication.md)).
