# Transformers.js Client

**Module:** `TransformersClient`
**File:** `./core/transformers-client.js`
**Purpose:** Browser-native LLM inference using Transformers.js and WebGPU

## Overview

Enables running small language models (<2B params) directly in browser using WebGPU for acceleration. No server required - fully offline capable.

## Key Concepts

- **Transformers.js** - Port of HuggingFace transformers to JavaScript/WASM
- **WebGPU** - Modern GPU API for browser (successor to WebGL)
- **ONNX Runtime** - Optimized model execution engine

## Implementation

```javascript
const TransformersClient = {
  metadata: {
    id: 'TransformersClient',
    dependencies: ['Utils'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    let _pipeline = null;

    const loadModel = async (modelId) => {
      if (!window.transformers) {
        throw new Error('Transformers.js not loaded');
      }

      const { pipeline, env } = window.transformers;
      env.backends.onnx.wasm.proxy = false; // Run in main thread

      logger.info(`Loading model: ${modelId}`);
      _pipeline = await pipeline('text-generation', modelId);
      return true;
    };

    const generate = async (prompt, options = {}) => {
      if (!_pipeline) throw new Error('No model loaded');

      const result = await _pipeline(prompt, {
        max_new_tokens: options.maxTokens || 512,
        temperature: options.temperature || 0.7,
        top_p: options.topP || 0.9
      });

      return result[0].generated_text;
    };

    return { loadModel, generate };
  }
};
```

## Recommended Models

- `Xenova/Qwen2.5-0.5B-Instruct` - 500MB, fast
- `Xenova/SmolLM2-360M-Instruct` - 360MB, tiny
- `Xenova/Phi-3-mini-4k-instruct` - 2.3GB, capable
