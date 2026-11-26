# Blueprint 0x00001E: Multi-Provider API Gateway

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00001E-multi-provider-api-gateway.md`

## Retired design

This design proposed `/core/api-client-multi.js`, a gateway that routed model requests across Gemini, OpenAI, Anthropic and local backends. That module does not exist. Provider routing is done by `self/core/llm-client.js` with `self/core/provider-registry.js`, described in [0x000007](0x000007-api-client-and-communication.md).
