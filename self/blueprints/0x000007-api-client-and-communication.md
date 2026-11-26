# Blueprint 0x000007: API Client and Communication

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/llm-client.js`, `/self/core/provider-registry.js`, `/tests/integration/llm-client.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/llm-client.js`

**Former Blueprint Paths:** `self/blueprints/0x000007-api-client-and-communication.md`
**Objective:** Give the agent one call, `LLMClient.chat`, that routes a request to a registered model provider (proxy, direct cloud API, in-browser WebLLM, Transformers.js, Doppler or a mock), streams or returns the reply in one response shape, and can be aborted.

**Prerequisites:** [0x000003](0x000003-core-utilities-and-error-handling.md) (Utils), [0x000029](0x000029-rate-limiting-strategies.md) (RateLimiter), [0x000039](0x000039-streaming-response-handler.md) (StreamParser), [0x00005D](0x00005D-transformers-client.md) (TransformersClient)

**Affected Artifacts:** `self/core/llm-client.js`, `self/core/provider-registry.js`, `self/providers/doppler-reploid.js`, `self/providers/external-brain.js`

---

### 1. Modules

There is no `api-client.js`. Two DI modules, both `genesis: { introduced: 'capsule' }`:

- `LLMClient` (`self/core/llm-client.js`), dependencies `Utils`, `ProviderRegistry`, optional `RateLimiter`, `StreamParser`, `TransformersClient`.
- `ProviderRegistry` (`self/core/provider-registry.js`), dependencies `Utils`, optional `VFS`.

### 2. Provider registry

`ProviderRegistry.factory` returns `registerProvider(id, provider, { override, clearLoader })`, `registerProviderLoader(id, loader, { override, clearProvider })`, `hasProvider(id)`, `listProviders()`, `getProvider(id, options)`, `getLoadedProvider(id)` and `getStatus(id, { forceLoad })`.

IDs are lowercased and trimmed. A provider is an object with `chat(messages, modelConfig, requestId, control)` and optionally `stream(messages, modelConfig, onUpdate, requestId, control)`, `status()` and `abort(requestId)`. A loader is called once on first `getProvider`; concurrent requests share the pending load. Two loaders are registered at construction: `doppler` (imports `self/providers/doppler-reploid.js`, browser only) and `external` (`self/providers/external-brain.js`).

### 3. Built-in providers

On the first `chat`, `LLMClient` registers, unless already present: `proxy`, `webllm`, `transformers`, `mock` (delegates to a global `MockLLMProvider`), and cloud providers `openai`, `gemini`, `anthropic` and `other`. A cloud provider calls the vendor API directly from the browser when `modelConfig.hostType === 'browser-cloud'`, using the key stored as `<PROVIDER>_API_KEY` or `REPLOID_KEY_<PROVIDER>`; otherwise it goes through the proxy (`modelConfig.endpoint`, default `/api/chat`).

`resolveProviderId(modelConfig)`: `doppler`, `transformers` and `webllm` by name; `other` with `browser-cloud`; `queryMethod: 'browser'` means `webllm`; a model ID that `TransformersClient.isTransformersModel` recognizes means `transformers`; `ollama` goes to `proxy`; any other registered provider name is used as is; the fallback is `proxy`.

### 4. `chat(messages, modelConfig, onUpdate = null, options = {})`

1. Honor `options.signal`, then wait for a token from the rate limiter (`RateLimiter.createLimiter(60)`; a no-op without `RateLimiter`).
2. Require `modelConfig`; register built-in providers.
3. If `options.tools` is non-empty and `supportsNativeTools(modelConfig)`, pass the tool schemas to the provider.
4. Resolve and load the provider; call `stream` when `onUpdate` is given and the provider has it, else `chat`.
5. Return the normalized response: the provider's fields plus `requestId`, `provider`, `model`, `timestamp`, `raw`, and `content` with thought blocks stripped.

Proxy and direct cloud calls retry HTTP 408, 429, 500, 502, 503 and 504 twice, after 750 ms and 2000 ms or the server's `Retry-After`, and stop if the signal aborts.

### 5. Other members

The factory returns `chat`, `abortRequest(requestId)`, `getWebLLMStatus()`, `getTransformersStatus()`, `getDopplerStatus()`, `loadLoRAAdapter(adapter)`, `unloadLoRAAdapter()`, `getActiveLoRA()`, `prefillKV(prompt, modelConfig, options)` (Doppler only), `releaseGPUMemory()` (unloads WebLLM, Transformers.js and Doppler) and `supportsNativeTools(modelConfig)`.

### 6. Authority

A model reply is input to the agent loop. It grants no tool, write or adoption permission; those stay with the tool runner's gates and the operator.

### 7. Verification

`tests/integration/llm-client.test.js` covers rate limiting, proxy requests and streaming, transient retries, WebLLM context forwarding, thought stripping and Transformers.js routing.
