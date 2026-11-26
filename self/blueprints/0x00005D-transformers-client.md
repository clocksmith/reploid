# Blueprint 0x00005D: Transformers.js Client

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/transformers-client.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/transformers-client.js`

**Former Blueprint Paths:** `self/blueprints/0x00005D-transformers-client.md`

**Module ID:** `TransformersClient` (version 1.0.0, genesis level `cognition`, type `service`; dependencies `Utils`, `EventBus`)

**Source:** `self/core/transformers-client.js`

---

## Purpose

`TransformersClient` runs a small text-generation model in the browser with Hugging Face Transformers.js, on WebGPU. It is one of the local providers behind `LLMClient` ([0x000007](0x000007-api-client-and-communication.md)); Doppler is the other local path and is not part of this module.

## Runtime loading

On first use the client imports `https://cdn.jsdelivr.net/npm/@huggingface/transformers@3` (`transformers-client.js:77`), stores `{ pipeline, env }` on `window.transformers`, and sets `env.backends.onnx.wasm.proxy = false`. A failed import clears the cached promise so a later call can retry, and throws `ConfigError('Failed to load Transformers.js runtime')`. Outside a browser it throws `ConfigError` immediately. The major version is pinned only to `3`, so the exact runtime build is whatever that CDN range serves.

## Models

Only these IDs load (`modelConfigs`, `:26`):

| ID | Hugging Face model | dtype |
| --- | --- | --- |
| `qwen3-0.6b` | `onnx-community/Qwen3-0.6B-ONNX` | q4 |
| `qwen3-1.7b` | `onnx-community/Qwen3-1.7B-ONNX` | q4 |
| `gemma3-1b` | `onnx-community/gemma-3-1b-it-ONNX` | q4 |
| `smollm2-360m` | `HuggingFaceTB/SmolLM2-360M-Instruct` | fp16 |
| `smollm2-1.7b` | `HuggingFaceTB/SmolLM2-1.7B-Instruct` | q4 |
| `deepseek-r1-1.5b` | `onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX` | q4 |
| `phi4-mini` | `onnx-community/Phi-4-mini-instruct-ONNX` | q4 |

All use `device: 'webgpu'`.

## Exports

| Export | Behavior |
| --- | --- |
| `loadModel(modelId)` | Loads the runtime, rejects an unknown ID with `ConfigError`, returns early if that model is already loaded, disposes the previous pipeline, and creates a `text-generation` pipeline. Emits `agent:status` `{ state: 'DOWNLOADING', activity, progress }` at start and on each 5% of download progress. On failure it clears state and throws `ApiError(..., 500)`. |
| `chat(messages, modelConfig, onUpdate?)` | Uses `modelConfig.transformersModelId` or `modelConfig.id`, calls `loadModel`, joins messages into one prompt with `<|system|>`, `<|user|>`, `<|assistant|>` tags and a trailing `<|assistant|>`, and generates with `max_new_tokens: 2048`, `temperature: 0.7`, `do_sample: true`. With `onUpdate`, decoded tokens are streamed to the callback. Returns `{ requestId, content, raw, model, timestamp, provider: 'transformers' }`, where `content` has `<think>`/`<thinking>` blocks removed. |
| `unload()` | Disposes the pipeline and clears the loaded model. |
| `getStatus()` | `{ loaded, model, available }`; `available` is whether `navigator.gpu` exists. |
| `getAvailableModels()` | `[{ id, hfId, dtype }]` from the table above. |
| `isTransformersModel(id)` | `true` for a table ID or any ID starting with `transformers:`. |

## Routing

`LLMClient` routes to this client when `modelConfig.provider === 'transformers'`, or when `isTransformersModel(modelConfig.id)` is true (`self/core/llm-client.js:929-936`), and calls `chat` at `:812`.

## Known gaps

- `isTransformersModel` accepts `transformers:<anything>`, but `loadModel` only accepts the table IDs, so such an ID routes here and then fails with `Unknown Transformers.js model`.
- `LLMClient.releaseGPUMemory` calls `TransformersClient.cleanup` (`llm-client.js:1068`), which this module does not export; the model stays loaded until `unload()` is called directly.
- The prompt template is generic rather than each model's own chat template.
- No unit test for this module exists in `tests/`.

## Related blueprints

- [0x000007 API Client and Communication](0x000007-api-client-and-communication.md): the caller and router.
- [0x00003A Context Management](0x00003A-context-management.md): `MODEL_LIMITS` includes small-model limits such as `smollm` and `qwen`.
